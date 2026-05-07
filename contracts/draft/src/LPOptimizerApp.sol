// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

// ── Uniswap V3 interfaces (minimal) ──────────────────────────────────────

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata) external payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function increaseLiquidity(IncreaseLiquidityParams calldata) external payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);
    function decreaseLiquidity(DecreaseLiquidityParams calldata) external payable
        returns (uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata) external payable
        returns (uint256 amount0, uint256 amount1);
    function burn(uint256 tokenId) external payable;
    function positions(uint256 tokenId) external view
        returns (
            uint96 nonce, address operator, address token0, address token1,
            uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity,
            uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0, uint128 tokensOwed1
        );
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint8 feeProtocol, bool unlocked
    );
    function tickSpacing() external view returns (int24);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

/// @title LPOptimizerApp - Automated V3 LP management via perpetual intents
/// @notice Users deposit tokens, the app mints V3 positions, and perpetual intents
///         let solvers compete to find optimal rebalancing and fee compounding strategies.
///
///         Two intents:
///           - rebalance: Remove liquidity, rebalance token ratio, mint in new tick range
///           - compound:  Collect earned fees, rebalance ratio, add back as liquidity
///
///         The solving engine evaluates each tick whether action is profitable after gas.
///         Perpetual orders with cooldown ensure positions stay optimized over time.
///
///         Rebalance intent params:
///           abi.encode(address pool, int24 newTickLower, int24 newTickUpper)
///
///         Compound intent params:
///           abi.encode(address pool)
contract LPOptimizerApp is AppIntentBase, IERC721Receiver {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    bytes4 public constant REBALANCE_SELECTOR = bytes4(keccak256(
        "rebalance(address,int24,int24)"
    ));

    bytes4 public constant COMPOUND_SELECTOR = bytes4(keccak256(
        "compound(address)"
    ));

    // ── Immutables ─────────────────────────────────────────────────────────

    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable v3Factory;

    // ── State ──────────────────────────────────────────────────────────────

    struct Position {
        uint256 tokenId;
        address pool;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 deposited0;     // total token0 deposited (for value tracking)
        uint256 deposited1;     // total token1 deposited
    }

    /// @notice user => pool => position
    mapping(address => mapping(address => Position)) public positions;

    /// @notice Fee on rebalance improvement in BPS (e.g., 500 = 5%)
    uint256 public feeBps;
    address public feeCollector;

    bool private _simulating;

    // ── Events ─────────────────────────────────────────────────────────────

    event PositionCreated(
        address indexed user, address indexed pool,
        uint256 tokenId, int24 tickLower, int24 tickUpper, uint128 liquidity
    );
    event PositionWithdrawn(
        address indexed user, address indexed pool,
        uint256 amount0, uint256 amount1
    );
    event Rebalanced(
        bytes32 indexed orderId, address indexed user, address indexed pool,
        uint256 oldTokenId, uint256 newTokenId,
        int24 newTickLower, int24 newTickUpper, uint128 newLiquidity
    );
    event Compounded(
        bytes32 indexed orderId, address indexed user, address indexed pool,
        uint256 fees0Collected, uint256 fees1Collected, uint128 liquidityAdded
    );

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _maxPlatformFeeWei,
        address _positionManager,
        address _v3Factory,
        address _feeCollector,
        uint256 _feeBps
    ) AppIntentBase(
        _relayer, _validatorRegistry, _quorumBps, _scoreThreshold,
        _wrappedNativeToken, _platformFeeCollector, _maxPlatformFeeWei
    ) {
        require(_positionManager != address(0), "Invalid PM");
        require(_v3Factory != address(0), "Invalid factory");
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_feeBps <= 2000, "Fee too high"); // Max 20%

        positionManager = INonfungiblePositionManager(_positionManager);
        v3Factory = IUniswapV3Factory(_v3Factory);
        feeCollector = _feeCollector;
        feeBps = _feeBps;

        registeredIntents[REBALANCE_SELECTOR] = true;
        registeredIntents[COMPOUND_SELECTOR] = true;
    }

    // ── ERC721 receiver (required to hold V3 NFT positions) ───────────────

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ── Deposit: create initial LP position ───────────────────────────────

    /// @notice Deposit tokens and create a V3 position in the specified range.
    ///         User must approve this contract for both tokens before calling.
    /// @param pool      The V3 pool address
    /// @param amount0   Amount of token0 to deposit
    /// @param amount1   Amount of token1 to deposit
    /// @param tickLower Lower tick bound
    /// @param tickUpper Upper tick bound
    function deposit(
        address pool, uint256 amount0, uint256 amount1,
        int24 tickLower, int24 tickUpper
    ) external nonReentrant {
        require(amount0 > 0 || amount1 > 0, "Zero amounts");
        require(positions[msg.sender][pool].tokenId == 0, "Position exists");

        // Verify pool is a real V3 pool from our factory
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        uint24 fee = IUniswapV3Pool(pool).fee();
        require(v3Factory.getPool(token0, token1, fee) == pool, "Invalid pool");

        // Pull tokens from user
        if (amount0 > 0) IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);

        // Approve position manager
        if (amount0 > 0) IERC20(token0).approve(address(positionManager), amount0);
        if (amount1 > 0) IERC20(token1).approve(address(positionManager), amount1);

        // Mint V3 position
        (uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: fee,
                tickLower: tickLower, tickUpper: tickUpper,
                amount0Desired: amount0, amount1Desired: amount1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );

        // Return unused tokens to user
        if (amount0 > used0) IERC20(token0).safeTransfer(msg.sender, amount0 - used0);
        if (amount1 > used1) IERC20(token1).safeTransfer(msg.sender, amount1 - used1);

        // Store position
        positions[msg.sender][pool] = Position({
            tokenId: tokenId, pool: pool,
            token0: token0, token1: token1, fee: fee,
            tickLower: tickLower, tickUpper: tickUpper,
            liquidity: liquidity,
            deposited0: used0, deposited1: used1
        });

        emit PositionCreated(msg.sender, pool, tokenId, tickLower, tickUpper, liquidity);
    }

    /// @notice Withdraw entire position: remove liquidity, collect fees, return tokens.
    function withdraw(address pool) external nonReentrant {
        Position storage pos = positions[msg.sender][pool];
        require(pos.tokenId != 0, "No position");

        uint256 tokenId = pos.tokenId;
        address token0 = pos.token0;
        address token1 = pos.token1;

        // Remove all liquidity
        if (pos.liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: tokenId, liquidity: pos.liquidity,
                    amount0Min: 0, amount1Min: 0, deadline: block.timestamp
                })
            );
        }

        // Collect all (liquidity + fees)
        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId, recipient: address(this),
                amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );

        // Burn empty NFT
        positionManager.burn(tokenId);

        // Send everything to user
        if (collected0 > 0) IERC20(token0).safeTransfer(msg.sender, collected0);
        if (collected1 > 0) IERC20(token1).safeTransfer(msg.sender, collected1);

        // Clear state
        delete positions[msg.sender][pool];

        emit PositionWithdrawn(msg.sender, pool, collected0, collected1);
    }

    // ── Intent dispatch ────────────────────────────────────────────────────

    function _handleIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal override returns (uint256 score, bool valid) {
        if (order.intentSelector == REBALANCE_SELECTOR) {
            return _rebalance(order, plan);
        }
        if (order.intentSelector == COMPOUND_SELECTOR) {
            return _compound(order, plan);
        }
        revert("Unknown intent");
    }

    function scoreIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) external override onlyRelayer nonReentrant returns (uint256 sc, bool valid) {
        _simulating = true;
        (sc, valid) = _handleIntent(order, plan);
        _simulating = false;
    }

    // ── Rebalance intent ───────────────────────────────────────────────────
    //
    //  Solver proposes: new tick range + swap plan to rebalance token ratio.
    //
    //  Flow:
    //    1. Remove all liquidity from current position
    //    2. Collect all tokens (liquidity + earned fees)
    //    3. Burn old NFT
    //    4. Send tokens to ephemeral proxy → solver's plan swaps to optimal ratio
    //    5. Tokens return to this contract
    //    6. Mint new position in solver's proposed range
    //    7. Score: new position value vs old (must not lose value after swap cost)

    function _rebalance(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (address pool, int24 newTickLower, int24 newTickUpper) =
            abi.decode(order.intentParams, (address, int24, int24));

        Position storage pos = positions[order.submittedBy][pool];

        if (_simulating) {
            // In simulation, the position may not exist — just run the plan
            // and score based on whether the proposed range makes sense
            if (pos.tokenId == 0) return (5000, true);
        } else {
            require(pos.tokenId != 0, "No position");
        }

        address token0 = pos.token0;
        address token1 = pos.token1;

        // 1. Remove all liquidity
        uint256 preBalance0 = IERC20(token0).balanceOf(address(this));
        uint256 preBalance1 = IERC20(token1).balanceOf(address(this));

        if (pos.liquidity > 0) {
            positionManager.decreaseLiquidity(
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: pos.tokenId, liquidity: pos.liquidity,
                    amount0Min: 0, amount1Min: 0, deadline: block.timestamp
                })
            );
        }

        // 2. Collect everything (liquidity tokens + accrued fees)
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: pos.tokenId, recipient: address(this),
                amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );

        // 3. Burn empty NFT
        positionManager.burn(pos.tokenId);

        // Total tokens available (collected liquidity + fees)
        uint256 available0 = IERC20(token0).balanceOf(address(this)) - preBalance0;
        uint256 available1 = IERC20(token1).balanceOf(address(this)) - preBalance1;

        // 4. Send to proxy for rebalancing swap, then snapshot
        address proxy = _deployProxy(order);
        if (available0 > 0) IERC20(token0).safeTransfer(proxy, available0);
        if (available1 > 0) IERC20(token1).safeTransfer(proxy, available1);

        _snapshot(token0);
        _snapshot(token1);
        _runPlan(proxy, plan);

        // 5. Tokens should be back in this contract after solver's plan
        uint256 bal0 = _gained(token0);
        uint256 bal1 = _gained(token1);

        // 6. Mint new position
        if (bal0 > 0) IERC20(token0).approve(address(positionManager), bal0);
        if (bal1 > 0) IERC20(token1).approve(address(positionManager), bal1);

        (uint256 newTokenId, uint128 newLiquidity, uint256 used0, uint256 used1) =
            positionManager.mint(INonfungiblePositionManager.MintParams({
                token0: token0, token1: token1, fee: pos.fee,
                tickLower: newTickLower, tickUpper: newTickUpper,
                amount0Desired: bal0, amount1Desired: bal1,
                amount0Min: 0, amount1Min: 0,
                recipient: address(this), deadline: block.timestamp
            }));

        require(newLiquidity > 0, "Zero liquidity");

        // Return dust to user
        if (bal0 > used0) IERC20(token0).safeTransfer(order.submittedBy, bal0 - used0);
        if (bal1 > used1) IERC20(token1).safeTransfer(order.submittedBy, bal1 - used1);

        // 7. Update position state
        pos.tokenId = newTokenId;
        pos.tickLower = newTickLower;
        pos.tickUpper = newTickUpper;
        pos.liquidity = newLiquidity;

        // Score: per-token value retention (both tokens must retain >= 90%)
        // This avoids the mixed-decimals problem of adding raw amounts.
        // JS scoring does the real price-weighted evaluation.
        uint256 minRetention = type(uint256).max;
        if (available0 > 0) {
            uint256 retention0 = (used0 * 10000) / available0;
            if (retention0 < minRetention) minRetention = retention0;
        }
        if (available1 > 0) {
            uint256 retention1 = (used1 * 10000) / available1;
            if (retention1 < minRetention) minRetention = retention1;
        }
        if (minRetention == type(uint256).max) minRetention = 0;

        // Require at least 90% retention on the worse-performing token.
        // Score ramps from 5000 at 90% to 10000 at 100%+.
        score = _scoreLinear(minRetention, 9000);
        valid = true;

        emit Rebalanced(
            order.orderId, order.submittedBy, pool,
            0, newTokenId, newTickLower, newTickUpper, newLiquidity
        );
    }

    // ── Compound intent ────────────────────────────────────────────────────
    //
    //  Collect earned fees and reinvest as additional liquidity.
    //
    //  Flow:
    //    1. Collect unclaimed fees from position
    //    2. Send to proxy → solver swaps to balanced ratio for current range
    //    3. Increase liquidity on existing position
    //    4. Score: liquidity increase relative to fee value

    function _compound(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (address pool) = abi.decode(order.intentParams, (address));

        Position storage pos = positions[order.submittedBy][pool];

        if (_simulating) {
            if (pos.tokenId == 0) return (5000, true);
        } else {
            require(pos.tokenId != 0, "No position");
        }

        address token0 = pos.token0;
        address token1 = pos.token1;

        // 1. Collect unclaimed fees
        (uint256 fees0, uint256 fees1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: pos.tokenId, recipient: address(this),
                amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );

        // Nothing to compound
        if (fees0 == 0 && fees1 == 0) return (0, false);

        // Fee on collected fees
        uint256 fee0 = (fees0 * feeBps) / 10000;
        uint256 fee1 = (fees1 * feeBps) / 10000;
        if (fee0 > 0) IERC20(token0).safeTransfer(feeCollector, fee0);
        if (fee1 > 0) IERC20(token1).safeTransfer(feeCollector, fee1);

        uint256 net0 = fees0 - fee0;
        uint256 net1 = fees1 - fee1;

        // 2. Send to proxy for ratio rebalancing, then snapshot
        address proxy = _deployProxy(order);
        if (net0 > 0) IERC20(token0).safeTransfer(proxy, net0);
        if (net1 > 0) IERC20(token1).safeTransfer(proxy, net1);

        _snapshot(token0);
        _snapshot(token1);
        _runPlan(proxy, plan);

        uint256 bal0 = _gained(token0);
        uint256 bal1 = _gained(token1);

        // 3. Increase liquidity on existing position
        if (bal0 > 0) IERC20(token0).approve(address(positionManager), bal0);
        if (bal1 > 0) IERC20(token1).approve(address(positionManager), bal1);

        (uint128 liquidityAdded,,) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: pos.tokenId,
                amount0Desired: bal0, amount1Desired: bal1,
                amount0Min: 0, amount1Min: 0,
                deadline: block.timestamp
            })
        );

        pos.liquidity += liquidityAdded;

        // Score: did we actually add meaningful liquidity?
        uint256 feeValue = fees0 + fees1; // simplified
        score = liquidityAdded > 0
            ? _scoreLinear(feeValue, 1) // any compound is good
            : 0;
        valid = liquidityAdded > 0;

        emit Compounded(order.orderId, order.submittedBy, pool, fees0, fees1, liquidityAdded);
    }

    // ── View helpers ───────────────────────────────────────────────────────

    function getPosition(address user, address pool) external view returns (Position memory) {
        return positions[user][pool];
    }
}

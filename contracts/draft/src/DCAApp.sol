// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DCAApp - Dollar-Cost Averaging via App Intent
/// @notice Users deposit source tokens upfront, then perpetual orders
///         automatically buy the target token at the best available rate.
///         No per-execution approvals needed — funds are held in the DCA app.
///
///         Flow:
///           1. User calls deposit(token, amount) to fund their DCA position
///           2. User submits a perpetual "buy" order via the Minotaur API
///           3. Each tick, the solver finds the best swap route
///           4. The DCA app spends from the user's deposited balance
///           5. Bought tokens are sent to the user's receiver address
///
///         Intent params encoding:
///           abi.encode(address tokenIn, address tokenOut,
///                      uint256 amountPerBuy, uint256 minAmountOut, address receiver)
contract DCAApp is AppIntentBase {
    using SafeERC20 for IERC20;

    bytes4 public constant BUY_SELECTOR = bytes4(keccak256(
        "buy(address,address,uint256,uint256,address)"
    ));

    uint256 public feeBps;
    address public feeCollector;

    /// @notice Per-user deposited balance: user => token => amount
    mapping(address => mapping(address => uint256)) public deposits;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event BuyExecuted(
        bytes32 indexed orderId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _maxPlatformFeeWei,
        address _feeCollector,
        uint256 _feeBps
    ) AppIntentBase(_relayer, _validatorRegistry, _quorumBps, _scoreThreshold, _wrappedNativeToken, _platformFeeCollector, _maxPlatformFeeWei) {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_feeBps <= 10000, "Fee too high");
        feeCollector = _feeCollector;
        feeBps = _feeBps;
        registeredIntents[BUY_SELECTOR] = true;
    }

    // ── Deposit / Withdraw ───────────────────────────────────────────────

    /// @notice Deposit tokens into the DCA contract for future buys.
    ///         User must approve this contract before calling deposit.
    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Relayer-funded deposit: relayer sends tokens on behalf of a user.
    ///         Used for testnet faucet flow where the relayer fronts the tokens.
    ///         In production, users call deposit() directly.
    function depositFor(address user, address token, uint256 amount) external onlyRelayer {
        require(amount > 0, "Zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        deposits[user][token] += amount;
        emit Deposited(user, token, amount);
    }

    /// @notice Withdraw unused deposited tokens.
    function withdraw(address token, uint256 amount) external {
        require(deposits[msg.sender][token] >= amount, "Insufficient deposit");
        deposits[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Check a user's deposited balance for a token.
    function depositBalance(address user, address token) external view returns (uint256) {
        return deposits[user][token];
    }

    // ── Intent execution ─────────────────────────────────────────────────

    function _handleIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal override returns (uint256 score, bool valid) {
        if (order.intentSelector == BUY_SELECTOR) {
            return _buy(order, plan);
        }
        revert("Unknown intent");
    }

    /// @dev Track whether we're in simulation mode (scoreIntent path).
    ///      In simulation, skip deposit balance checks — the simulator
    ///      seeds the contract with tokens directly.
    bool private _simulating;

    /// @notice Override scoreIntent to enable simulation mode.
    ///         Seeds the contract with input tokens via deal, skips deposit check.
    function scoreIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) external override onlyRelayer nonReentrant returns (uint256 sc, bool valid) {
        _simulating = true;
        (sc, valid) = _handleIntent(order, plan);
        _simulating = false;
    }

    function _buy(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn, address tokenOut,
            uint256 amountPerBuy, uint256 minAmountOut, address receiver
        ) = abi.decode(order.intentParams, (address, address, uint256, uint256, address));

        require(tokenIn != tokenOut, "Same token");

        if (_simulating) {
            // Simulation: contract was seeded with tokens by the simulator.
            // No deposit accounting needed (state reverts after simulation).
        } else {
            // Real execution: debit from user's deposited balance
            require(deposits[order.submittedBy][tokenIn] >= amountPerBuy, "Insufficient deposit");
            deposits[order.submittedBy][tokenIn] -= amountPerBuy;
        }

        // Snapshot output token balance, fund proxy from contract, execute plan
        _snapshot(tokenOut);
        _fundFromContract(order, plan, tokenIn, amountPerBuy);

        uint256 gained = _gained(tokenOut);
        if (gained < minAmountOut) return (0, false);

        // Fee on positive slippage only
        uint256 fee = ((gained - minAmountOut) * feeBps) / 10000;
        IERC20(tokenOut).safeTransfer(receiver, gained - fee);
        if (fee > 0) IERC20(tokenOut).safeTransfer(feeCollector, fee);

        score = _scoreLinear(gained, minAmountOut);
        valid = true;

        emit BuyExecuted(order.orderId, order.submittedBy, tokenIn, tokenOut, amountPerBuy, gained, fee);
    }

    /// @notice Fund ephemeral proxy from the contract's own balance and execute.
    ///         Unlike _fundAndExecute which pulls from an external address,
    ///         this transfers from the contract's held deposits.
    function _fundFromContract(
        IntentOrder calldata order,
        ExecutionPlan calldata plan,
        address token,
        uint256 amount
    ) internal {
        address proxy = _deployProxy(order);
        IERC20(token).safeTransfer(proxy, amount);
        _runPlan(proxy, plan);
    }
}

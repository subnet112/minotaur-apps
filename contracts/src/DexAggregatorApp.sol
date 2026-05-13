// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @title DexAggregatorApp - DEX aggregation via App Intent
/// @notice Settlement-style swap execution on the App Intent framework.
///         Solvers generate optimal execution plans (multi-DEX routing),
///         validators verify via simulation, and the app handles token
///         management, positive slippage fee capture, and delivery.
///
///         Intent params encoding (11 fields for swap):
///           abi.encode(address tokenIn, address tokenOut,
///                      uint256 amountIn, uint256 minAmountOut, address receiver,
///                      uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
///                      uint256 platformFeeWei,
///                      bool unwrapOutput)
///         platformFeeWei is consumed by AppIntentBase via `_calculateProtocolFee`
///         (overridden below to read field 10, since `unwrapOutput` follows).
///
///         Execution flow (via _handleIntent → _swap dispatch):
///           1. Decode params, handle optional ERC-2612 permit.
///           2. Deploy EphemeralProxy, fund it, execute solver's plan calls.
///           3. Verify output >= minAmountOut, deliver protocol fee in WETH
///              (from output when tokenOut==WETH and surplus covers it; otherwise
///              from the app's paymaster), capture positive-slippage fee in
///              tokenOut, deliver remainder to receiver.
///
///         Fee model:
///           - This app deploys in `FeeMode.APP` by default. The end user only
///             approves `amountIn` of `tokenIn` — they NEVER hold or approve
///             the wrapped native token. The app pays the protocol fee in WETH
///             out of the swap surplus (when possible) or its own working
///             capital (paymaster).
///           - The paymaster (typically the same address as `feeCollector`)
///             must pre-approve this contract to pull WETH. App operator is
///             responsible for keeping a WETH float on the paymaster.
contract DexAggregatorApp is AppIntentBase {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    bytes4 public constant SWAP_SELECTOR = bytes4(keccak256(
        "swap(address,address,uint256,uint256,address)"
    ));

    bytes4 public constant BRIDGE_SELECTOR = bytes4(keccak256(
        "bridge(address,uint256,uint256,address)"
    ));

    // ── State ──────────────────────────────────────────────────────────────

    /// @notice Fee on positive slippage in BPS (e.g., 5000 = 50%)
    uint256 public feeBps;

    /// @notice Address that receives positive slippage fees (in tokenOut)
    address public feeCollector;

    // ── Events ─────────────────────────────────────────────────────────────

    event SwapExecuted(
        bytes32 indexed orderId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    event FeeCollectorUpdated(address indexed newCollector);
    event FeeBpsUpdated(uint256 newFeeBps);

    // ── Constructor ────────────────────────────────────────────────────────

    /// @notice Deploy the DEX aggregator app.
    /// @dev `appPaymaster` defaults to `_feeCollector` when passed as address(0).
    ///      The feeCollector both (a) receives positive-slippage fees in tokenOut,
    ///      and (b) acts as the WETH paymaster for protocol fees in APP mode.
    ///      App operators wishing to separate these roles can pass a distinct
    ///      `_appPaymaster` address.
    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _minPlatformFeeWei,
        uint256 _maxPlatformFeeWei,
        AppIntentBase.FeeMode _feeMode,
        address _appPaymaster,
        address _feeCollector,
        uint256 _feeBps
    ) AppIntentBase(
        _relayer,
        _validatorRegistry,
        _quorumBps,
        _scoreThreshold,
        _wrappedNativeToken,
        _platformFeeCollector,
        _minPlatformFeeWei,
        _maxPlatformFeeWei,
        _feeMode,
        _appPaymaster == address(0) ? _feeCollector : _appPaymaster
    ) {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_feeBps <= 10000, "Fee too high");
        feeCollector = _feeCollector;
        feeBps = _feeBps;
        registeredIntents[SWAP_SELECTOR] = true;
        registeredIntents[BRIDGE_SELECTOR] = true;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setFeeCollector(address _feeCollector) external onlyRelayer {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function setFeeBps(uint256 _feeBps) external onlyRelayer {
        require(_feeBps <= 10000, "Fee too high");
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
    }

    // ── Fee calculation override ──────────────────────────────────────────

    /// @notice Read platformFeeWei from intentParams.
    /// @dev SWAP intent params has 11 fields; the fee is at index 9 with
    ///      `unwrapOutput` (bool) as the trailing field. The base contract's
    ///      default decoder reads the LAST 32 bytes and would return the bool
    ///      cast to uint, so we override to read the penultimate slot.
    ///      BRIDGE intent params has 5 fields with platformFeeWei trailing,
    ///      so we delegate to the base helper for that case.
    function _calculateProtocolFee(
        IntentOrder calldata order
    ) internal view override returns (uint256) {
        if (order.intentSelector == SWAP_SELECTOR) {
            bytes calldata p = order.intentParams;
            if (p.length < 64) return 0;
            return abi.decode(p[p.length - 64:p.length - 32], (uint256));
        }
        return _decodePlatformFee(order.intentParams);
    }

    // ── Intent dispatch ────────────────────────────────────────────────────

    /// @notice Dispatch to real intent functions based on intentSelector
    function _handleIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal override returns (uint256 score, bool valid) {
        if (order.intentSelector == SWAP_SELECTOR) {
            return _swap(order, plan);
        }
        if (order.intentSelector == BRIDGE_SELECTOR) {
            return _bridge(order, plan);
        }
        revert("Unknown intent");
    }

    // ── Intent functions ────────────────────────────────────────────────────

    /// @notice Token swap: collect input, execute plan, settle protocol fee,
    ///         capture positive slippage, deliver output to receiver.
    function _swap(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address receiver,
            uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
            uint256 platformFeeRaw,
            bool unwrapOutput
        ) = abi.decode(order.intentParams, (address, address, uint256, uint256, address, uint256, uint8, bytes32, bytes32, uint256, bool));

        require(tokenIn != tokenOut, "Same token");

        // 1. Collect user tokens and execute plan.
        _snapshot(tokenOut);
        _tryPermit(tokenIn, order.submittedBy, amountIn, permitDeadline, permitV, permitR, permitS);
        _fundAndExecute(order, plan, tokenIn, order.submittedBy, amountIn);

        // 2. Check invariant: did user get expected output?
        uint256 gained = _gained(tokenOut);
        if (gained < minAmountOut) return (0, false);

        // 3. Deliver protocol fee in WETH (APP mode only — USER mode was
        //    settled by AppIntentBase before _handleIntent ran, and on the
        //    native-input path the base already returned early).
        //
        //    Strategy:
        //      a) tokenOut == WETH and surplus ≥ fee → take from output
        //         (no DEX hop, no paymaster touch).
        //      b) otherwise → pull WETH from appPaymaster.
        //
        //    Either path delivers to platformFeeCollector in WETH wei. The
        //    base verifies the collector balance grew by ≥ feeOwed after
        //    _handleIntent returns. Silent skip is intentionally NOT
        //    supported — the protocol fee is mandatory.
        if (feeMode == AppIntentBase.FeeMode.APP && platformFeeRaw > 0 && msg.value == 0) {
            uint256 platformFee = _clampFee(platformFeeRaw);
            if (platformFee > 0) {
                address weth = address(wrappedNativeToken);
                if (tokenOut == weth && gained >= minAmountOut + platformFee) {
                    IERC20(weth).safeTransfer(platformFeeCollector, platformFee);
                    gained -= platformFee;
                } else {
                    require(appPaymaster != address(0), "App paymaster not set");
                    IERC20(weth).safeTransferFrom(appPaymaster, platformFeeCollector, platformFee);
                }
            }
        }

        // 4. Positive-slippage capture (app revenue, in tokenOut).
        uint256 fee = ((gained - minAmountOut) * feeBps) / 10000;
        uint256 userAmount = gained - fee;

        // Auto-unwrap: if user selected native ETH/TAO as output (not WETH),
        // the frontend sets unwrapOutput=true. We unwrap WETH → native ETH
        // and send it directly so the user doesn't have to deal with WETH.
        // The slippage fee stays in WETH at the app's feeCollector — they
        // can unwrap themselves if desired.
        if (unwrapOutput && tokenOut == address(wrappedNativeToken) && userAmount > 0) {
            IWETH(address(wrappedNativeToken)).withdraw(userAmount);
            (bool sent,) = payable(receiver).call{value: userAmount}("");
            require(sent, "ETH delivery failed");
        } else {
            IERC20(tokenOut).safeTransfer(receiver, userAmount);
        }
        if (fee > 0) IERC20(tokenOut).safeTransfer(feeCollector, fee);

        // 5. Score: 5000 at minAmountOut, linear to 10000 at 2x
        score = _scoreLinear(gained, minAmountOut);
        valid = true;

        emit SwapExecuted(order.orderId, order.submittedBy, tokenIn, tokenOut, amountIn, gained, fee);
    }

    // ── Bridge intent ─────────────────────────────────────────────────────────

    event BridgeExecuted(
        bytes32 indexed orderId,
        address indexed user,
        address tokenIn,
        uint256 amountBridged
    );

    /// @notice Bridge deposit: pull user tokens, execute plan (approve + bridge call),
    ///         verify tokens left the proxy to the bridge contract.
    /// @dev Used as the source leg of cross-chain intents. The plan typically
    ///      contains: approve(bridgeContract, amount) + bridgeContract.transferRemote(...).
    ///      Invariant: proxy balance of tokenIn after plan = 0 (all sent to bridge).
    ///
    ///      Protocol fee is settled by AppIntentBase (USER mode pulls from user
    ///      pre-handle; APP mode requires the app/paymaster to top up the
    ///      collector by `feeOwed` before this function returns — typically by
    ///      the relayer's plan including an explicit transferFrom to the
    ///      collector, or by the bridge router topping up via paymaster).
    function _bridge(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn,
            uint256 amountIn,
            uint256 minBridged,
            address receiver,
            /* uint256 platformFeeWei — consumed by AppIntentBase._calculateProtocolFee() */
        ) = abi.decode(order.intentParams, (address, uint256, uint256, address, uint256));

        // 1. Pull user tokens and execute plan (approve + bridge deposit)
        address proxy = _deployProxy(order);
        IERC20(tokenIn).safeTransferFrom(order.submittedBy, proxy, amountIn);
        _runPlan(proxy, plan);

        // 2. Invariant: proxy should have sent all tokens to the bridge
        uint256 remaining = IERC20(tokenIn).balanceOf(proxy);
        uint256 bridged = amountIn - remaining;
        if (bridged < minBridged) return (0, false);

        // 3. App-mode protocol fee fallback: bridge legs don't have a
        //    "swap surplus" to draw on. Pull from paymaster directly.
        uint256 platformFeeRaw = _calculateProtocolFee(order);
        if (feeMode == AppIntentBase.FeeMode.APP && platformFeeRaw > 0 && msg.value == 0) {
            uint256 platformFee = _clampFee(platformFeeRaw);
            if (platformFee > 0) {
                require(appPaymaster != address(0), "App paymaster not set");
                IERC20(address(wrappedNativeToken)).safeTransferFrom(
                    appPaymaster, platformFeeCollector, platformFee
                );
            }
        }

        // 4. Score: 5000 at minBridged, 10000 at full amount
        score = _scoreLinear(bridged, minBridged);
        valid = true;

        emit BridgeExecuted(order.orderId, order.submittedBy, tokenIn, bridged);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    function _tryPermit(
        address token, address owner, uint256 amount,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) internal {
        if (deadline > 0) {
            try IERC20Permit(token).permit(owner, address(this), amount, deadline, v, r, s) {} catch {}
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBaseV2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @title DexAggregatorAppV2 - Gas-optimized DexAggregatorApp
/// @notice Identical swap/bridge/fee/scoring semantics to DexAggregatorApp.
///         Differences (each marked `V2:`):
///
///         1. Inherits AppIntentBaseV2 (per-order executor clones, transient
///            snapshots/guard, lean replay protection).
///
///         2. APP-mode protocol fee is paid from a WETH float held BY THIS
///            CONTRACT (safeTransfer) instead of pulled from an external
///            paymaster (safeTransferFrom). Same consolidated,
///            direction-independent settlement as V1's
///            `_settleAppProtocolFee` — never skimmed from the user's
///            output, identical fee incidence for every order — and the
///            base still verifies the collector balance delta, so the fee
///            stays mandatory. What's saved is the per-swap allowance
///            bookkeeping. Operators fund the app directly instead of
///            approving from a paymaster address; `withdrawFloat` lets the
///            relayer recover the float.
contract DexAggregatorAppV2 is AppIntentBaseV2 {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    bytes4 public constant SWAP_SELECTOR = bytes4(keccak256(
        "swap(address,address,uint256,uint256,address)"
    ));

    bytes4 public constant BRIDGE_SELECTOR = bytes4(keccak256(
        "bridge(address,uint256,uint256,address)"
    ));

    // ── State ──────────────────────────────────────────────────────────────

    uint256 public feeBps;
    uint256 public volumeCapBps;
    uint256 public constant DEFAULT_VOLUME_CAP_BPS = 98;
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
    event VolumeCapBpsUpdated(uint256 newVolumeCapBps);
    event FloatWithdrawn(address indexed to, uint256 amount);

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _minPlatformFeeWei,
        uint256 _maxPlatformFeeWei,
        AppIntentBaseV2.FeeMode _feeMode,
        address _appPaymaster,
        address _appRegistry,
        address _feeCollector,
        uint256 _feeBps
    ) AppIntentBaseV2(
        _relayer,
        _validatorRegistry,
        _scoreThreshold,
        _wrappedNativeToken,
        _platformFeeCollector,
        _minPlatformFeeWei,
        _maxPlatformFeeWei,
        _feeMode,
        _appPaymaster == address(0) ? _feeCollector : _appPaymaster,
        _appRegistry
    ) {
        require(_feeCollector != address(0), "Invalid fee collector");
        require(_feeBps <= 10000, "Fee too high");
        feeCollector = _feeCollector;
        feeBps = _feeBps;
        volumeCapBps = DEFAULT_VOLUME_CAP_BPS;
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

    function setVolumeCapBps(uint256 _volumeCapBps) external onlyRelayer {
        require(_volumeCapBps <= 10000, "Cap too high");
        volumeCapBps = _volumeCapBps;
        emit VolumeCapBpsUpdated(_volumeCapBps);
    }

    /// @notice V2: recover WETH float parked on this contract for protocol
    ///         fees. Safe to call between orders — mid-order the base's fee
    ///         verification would revert the swap if the float goes missing.
    function withdrawFloat(address to, uint256 amount) external onlyRelayer {
        require(to != address(0), "Invalid recipient");
        wrappedNativeToken.safeTransfer(to, amount);
        emit FloatWithdrawn(to, amount);
    }

    // ── Fee calculation override ──────────────────────────────────────────

    function _calculateProtocolFee(
        IntentOrder calldata order
    ) internal view override returns (uint256) {
        if (order.intentSelector == SWAP_SELECTOR) {
            bytes calldata p = order.intentParams;
            if (p.length < 96) return 0;
            return abi.decode(p[p.length - 96:p.length - 64], (uint256));
        }
        return _decodePlatformFee(order.intentParams);
    }

    // ── Protocol fee settlement (APP mode) ─────────────────────────────────

    /// @notice Settle the APP-mode protocol fee — direction-independent,
    ///         shared by `_swap` and `_bridge` (mirrors V1's
    ///         `_settleAppProtocolFee`).
    /// @dev V2: paid via safeTransfer from the WETH float held by THIS
    ///      contract, not safeTransferFrom an external paymaster — drops the
    ///      per-swap allowance read/write. Never sourced from the user or
    ///      skimmed from the swap output, so fee incidence is identical for
    ///      every order regardless of trade direction.
    ///
    ///      USER mode is settled by AppIntentBaseV2 before `_handleIntent`
    ///      runs, and the native-input path (`msg.value > 0`) is settled
    ///      there too — both are no-ops here. The base's
    ///      `_verifyFeeSettlementPost` confirms `platformFeeCollector` grew
    ///      by `feeOwed`, so a silent skip reverts the whole order.
    function _settleAppProtocolFee(IntentOrder calldata order) internal {
        if (feeMode != AppIntentBaseV2.FeeMode.APP || msg.value != 0) return;
        uint256 raw = _calculateProtocolFee(order);
        if (raw == 0) return;
        uint256 platformFee = _clampFee(raw);
        if (platformFee == 0) return;
        IERC20(address(wrappedNativeToken)).safeTransfer(platformFeeCollector, platformFee);
    }

    // ── Intent dispatch ────────────────────────────────────────────────────

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

    function _swap(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address receiver,
            uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
            , // platformFeeWei — read + settled via _settleAppProtocolFee/_calculateProtocolFee
            uint256 quotedOutput,
            bool unwrapOutput
        ) = abi.decode(order.intentParams, (address, address, uint256, uint256, address, uint256, uint8, bytes32, bytes32, uint256, uint256, bool));

        require(tokenIn != tokenOut, "Same token");

        // 1. Collect user tokens and execute plan.
        _snapshot(tokenOut);
        _tryPermit(tokenIn, order.submittedBy, amountIn, permitDeadline, permitV, permitR, permitS);
        _fundAndExecute(order, plan, tokenIn, order.submittedBy, amountIn);

        // 2. Check invariant: did user get expected output?
        uint256 gained = _gained(tokenOut);
        if (gained < minAmountOut) return (0, false);

        // 3. Deliver the protocol fee in WETH from the app's float (APP mode).
        //    Direction-independent and shared with _bridge — never skimmed
        //    from the user's output, even when tokenOut == WETH. The base
        //    verifies the collector balance grew by ≥ feeOwed after
        //    _handleIntent returns; a silent skip reverts the order.
        _settleAppProtocolFee(order);

        // 4. Capture price improvement over the quoted output (unchanged).
        uint256 fee = 0;
        if (quotedOutput > 0 && gained > quotedOutput) {
            fee = ((gained - quotedOutput) * feeBps) / 10000;
            uint256 cap = (gained * volumeCapBps) / 10000;
            if (fee > cap) fee = cap;
            uint256 surplusOverMin = gained - minAmountOut;
            if (fee > surplusOverMin) fee = surplusOverMin;
        }
        uint256 userAmount = gained - fee;

        if (unwrapOutput && tokenOut == address(wrappedNativeToken) && userAmount > 0) {
            IWETH(address(wrappedNativeToken)).withdraw(userAmount);
            (bool sent,) = payable(receiver).call{value: userAmount}("");
            require(sent, "ETH delivery failed");
        } else {
            IERC20(tokenOut).safeTransfer(receiver, userAmount);
        }
        if (fee > 0) IERC20(tokenOut).safeTransfer(feeCollector, fee);

        score = _scoreSwap(gained, minAmountOut, quotedOutput);
        valid = true;

        emit SwapExecuted(order.orderId, order.submittedBy, tokenIn, tokenOut, amountIn, gained, fee);
    }

    uint256 private constant PAR_SCORE = 7500;

    function _scoreSwap(
        uint256 gained,
        uint256 minOut,
        uint256 quote
    ) private pure returns (uint256) {
        if (gained <= minOut) return 5000;
        if (quote > minOut && gained <= quote) {
            return 5000 + ((gained - minOut) * (PAR_SCORE - 5000)) / (quote - minOut);
        }
        uint256 par      = quote > minOut ? quote : minOut;
        uint256 parScore = quote > minOut ? PAR_SCORE : 5000;
        uint256 decay = ((10000 - parScore) * par) / gained;
        if (decay == 0) decay = 1;
        return 10000 - decay;
    }

    // ── Bridge intent ─────────────────────────────────────────────────────────

    event BridgeExecuted(
        bytes32 indexed orderId,
        address indexed user,
        address tokenIn,
        uint256 amountBridged
    );

    function _bridge(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn,
            uint256 amountIn,
            uint256 minBridged,
            address receiver,
            /* uint256 platformFeeWei — consumed via _calculateProtocolFee() */
        ) = abi.decode(order.intentParams, (address, uint256, uint256, address, uint256));

        address proxy = _deployProxy(order);
        IERC20(tokenIn).safeTransferFrom(order.submittedBy, proxy, amountIn);
        _runPlan(proxy, plan);

        uint256 remaining = IERC20(tokenIn).balanceOf(proxy);
        uint256 bridged = amountIn - remaining;
        if (bridged < minBridged) return (0, false);

        // 3. App-mode protocol fee from the app's own WETH float (same
        //    consolidated path as _swap).
        _settleAppProtocolFee(order);

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

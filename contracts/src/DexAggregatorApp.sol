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
///         Intent params encoding (10 fields, last 5 optional/platform):
///           abi.encode(address tokenIn, address tokenOut,
///                      uint256 amountIn, uint256 minAmountOut, address receiver,
///                      uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
///                      uint256 platformFeeWei)
///         The platformFeeWei trailer is consumed by AppIntentBase before _swap runs.
///
///         Execution flow (via _handleIntent → _swap dispatch):
///           1. Decode params, handle optional ERC-2612 permit.
///           2. Deploy EphemeralProxy, fund it, execute solver's plan calls.
///           3. Verify output >= minAmountOut, capture fee on positive slippage.
///           4. Deliver output tokens to receiver.
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

    /// @notice Address that receives positive slippage fees
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

    /// @notice Override: do NOT pull WETH fee up-front. _swap/_bridge handle
    ///         fee collection themselves, deducting from the swap output when
    ///         possible so users swapping ERC-20 → WETH don't need to hold
    ///         or approve WETH before the trade.
    function _collectPlatformFee(
        bytes32 /*orderId*/,
        address /*user*/,
        bytes calldata /*intentParams*/
    ) internal pure override {
        // Intentionally no-op — see DexAggregatorApp._swap / _bridge.
    }

    /// @notice Token swap: collect input, execute plan, verify output, score.
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

        // When user sends msg.value (native ETH path), fee is skipped —
        // same logic as the base class's _collectPlatformFee which returns
        // early on msg.value > 0. The user is paying gas directly so there's
        // no relayer to reimburse.
        // Note: we read platformFeeRaw from the decoded tuple (field 10)
        // rather than _decodePlatformFee() because the 11th field (bool)
        // shifted the "last 32 bytes" position.
        uint256 platformFee = (msg.value > 0) ? 0 : platformFeeRaw;
        if (platformFee > 0) {
            require(platformFee <= maxPlatformFeeWei, "Fee exceeds cap");
            require(platformFeeCollector != address(0), "No fee collector");
        }

        // 1. Collect user tokens and execute plan.
        // The user approves exactly `amountIn` of `tokenIn` ONCE — no
        // separate fee approval. `platformFee` is denominated in WETH wei
        // but is collected from the swap OUTPUT, converted at the swap's
        // actual rate. This makes the approval UX consistent regardless of
        // whether the input or output happens to be WETH.
        _snapshot(tokenOut);
        _tryPermit(tokenIn, order.submittedBy, amountIn, permitDeadline, permitV, permitR, permitS);
        _fundAndExecute(order, plan, tokenIn, order.submittedBy, amountIn);

        // 2. Check invariant: did user get expected output?
        uint256 gained = _gained(tokenOut);
        if (gained < minAmountOut) return (0, false);

        // 3. Platform fee — always taken from output, never from input.
        //
        // Three cases the swap can be in:
        //   a) tokenOut == WETH    → fee_in_output = platformFee directly
        //                            (1:1 — both denominated in WETH).
        //   b) tokenIn  == WETH    → fee_in_output = platformFee × gained / amountIn
        //                            (the actual WETH→tokenOut rate from THIS swap).
        //   c) neither              → we don't have a reliable WETH price reference
        //                            without an oracle. Fee is skipped; relayer
        //                            absorbs gas. Solver should set platformFee=0
        //                            in this case.
        //
        // ALL three avoid pulling extra tokens from the user — the swap input
        // (`amountIn`) is the only allowance the user needs.
        if (platformFee > 0) {
            address weth = address(wrappedNativeToken);
            uint256 feeInOutput = 0;
            if (tokenOut == weth) {
                feeInOutput = platformFee;
            } else if (tokenIn == weth && amountIn > 0) {
                feeInOutput = (gained * platformFee) / amountIn;
            }
            // Must not eat into the user's guaranteed minimum.
            if (feeInOutput > 0 && gained >= minAmountOut + feeInOutput) {
                IERC20(tokenOut).safeTransfer(platformFeeCollector, feeInOutput);
                gained -= feeInOutput;
                emit PlatformFeeCollected(order.orderId, order.submittedBy, feeInOutput);
            }
            // If feeInOutput would push gained below minAmountOut, we silently
            // skip the fee rather than fail the swap — keeping the user whole
            // is more important than collecting a tiny platform fee.
        }

        // 3. Fee on positive slippage + deliver
        uint256 fee = ((gained - minAmountOut) * feeBps) / 10000;
        uint256 userAmount = gained - fee;

        // Auto-unwrap: if user selected native ETH/TAO as output (not WETH),
        // the frontend sets unwrapOutput=true. We unwrap the WETH → native
        // and send ETH directly so the user doesn't have to deal with WETH.
        // Fee stays as WETH to the feeCollector (they can unwrap themselves).
        if (unwrapOutput && tokenOut == address(wrappedNativeToken) && userAmount > 0) {
            IWETH(address(wrappedNativeToken)).withdraw(userAmount);
            (bool sent,) = payable(receiver).call{value: userAmount}("");
            require(sent, "ETH delivery failed");
        } else {
            IERC20(tokenOut).safeTransfer(receiver, userAmount);
        }
        if (fee > 0) IERC20(tokenOut).safeTransfer(feeCollector, fee);

        // 4. Score: 5000 at minAmountOut, linear to 10000 at 2x
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
    function _bridge(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address tokenIn,
            uint256 amountIn,
            uint256 minBridged,
            address receiver,
            /* uint256 platformFeeWei — consumed by AppIntentBase._collectPlatformFee() */
        ) = abi.decode(order.intentParams, (address, uint256, uint256, address, uint256));

        // 1. Pull user tokens and execute plan (approve + bridge deposit)
        address proxy = _deployProxy(order);
        IERC20(tokenIn).safeTransferFrom(order.submittedBy, proxy, amountIn);
        _runPlan(proxy, plan);

        // 2. Invariant: proxy should have sent all tokens to the bridge
        uint256 remaining = IERC20(tokenIn).balanceOf(proxy);
        uint256 bridged = amountIn - remaining;
        if (bridged < minBridged) return (0, false);

        // 3. Dust stays in proxy (no selfdestruct — negligible amounts only)
        //    Well-formed plans should leave remaining == 0.

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

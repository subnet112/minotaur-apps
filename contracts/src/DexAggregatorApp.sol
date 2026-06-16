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
///         Intent params encoding (12 fields for swap):
///           abi.encode(address tokenIn, address tokenOut,
///                      uint256 amountIn, uint256 minAmountOut, address receiver,
///                      uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
///                      uint256 platformFeeWei,
///                      uint256 quotedOutput,
///                      bool unwrapOutput)
///         platformFeeWei is consumed by AppIntentBase via `_calculateProtocolFee`
///         (overridden below to read the 3rd-from-last slot, since quotedOutput
///         and unwrapOutput follow it). `quotedOutput` is the off-chain quoted
///         net output we showed the user (validator-set, signed in); the app fee
///         is a share of execution ABOVE it (CoW-style), not above minAmountOut.
///
///         Native wrap/unwrap (Ethereum + Base, chain-agnostic via
///         `wrappedNativeToken`): native-ETH input is wrapped to WETH by
///         AppIntentBase._fundAndExecute (msg.value → deposit); native-ETH
///         output is delivered by unwrapping WETH here when unwrapOutput is set.
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

    /// @notice Share of price improvement over the quoted output, in BPS
    ///         (e.g., 5000 = 50%). Applied to (gained - quotedOutput), the
    ///         CoW-style "improvement over the quote we showed you" — NOT to
    ///         the slippage band above minAmountOut.
    uint256 public feeBps;

    /// @notice Hard cap on the app fee as BPS of realised output volume.
    ///         CoW uses 0.98% (98 bps). Bounds the worst case regardless of the
    ///         quotedOutput reference, so a mispriced/adversarial quotedOutput
    ///         can never let the fee exceed this share of the trade. Tunable
    ///         via setVolumeCapBps without a redeploy.
    uint256 public volumeCapBps;

    /// @notice Default volume cap (0.98%) set at construction.
    uint256 public constant DEFAULT_VOLUME_CAP_BPS = 98;

    /// @notice Address that receives the app fee (in tokenOut)
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
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _minPlatformFeeWei,
        uint256 _maxPlatformFeeWei,
        AppIntentBase.FeeMode _feeMode,
        address _appPaymaster,
        address _appRegistry,
        address _feeCollector,
        uint256 _feeBps
    ) AppIntentBase(
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

    // ── Fee calculation override ──────────────────────────────────────────

    /// @notice Read platformFeeWei from intentParams.
    /// @dev SWAP intent params has 12 fields; the fee is the 3rd-from-last,
    ///      with `quotedOutput` (uint256) then `unwrapOutput` (bool) trailing.
    ///      All swap fields are static (32-byte words), so we read the word at
    ///      [len-96 : len-64]. The base contract's default decoder reads the
    ///      LAST 32 bytes (the bool) and would be wrong here, hence the
    ///      override. BRIDGE intent params has 5 fields with platformFeeWei
    ///      trailing, so we delegate to the base helper for that case.
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

        // 4. Capture price improvement over the quoted output (app revenue,
        //    in tokenOut). CoW-style: the fee is a share of execution ABOVE the
        //    off-chain quote we showed the user (`quotedOutput`, validator-set
        //    and signed into the order), NOT a share of the slippage band above
        //    `minAmountOut`. So in expectation (execution ≈ quote) the fee is
        //    ~0 and the quote stays honest; only genuine improvement is taxed.
        //    Three clamps, applied in order:
        //      a) feeBps share of (gained - quotedOutput)
        //      b) volumeCapBps of gained                 — hard volume cap
        //      c) gained - minAmountOut                  — never deliver the
        //         user below the minimum they signed
        //    quotedOutput == 0 means "no reference supplied" ⇒ no app fee.
        uint256 fee = 0;
        if (quotedOutput > 0 && gained > quotedOutput) {
            fee = ((gained - quotedOutput) * feeBps) / 10000;
            uint256 cap = (gained * volumeCapBps) / 10000;
            if (fee > cap) fee = cap;
            uint256 surplusOverMin = gained - minAmountOut; // gained >= minAmountOut (checked above)
            if (fee > surplusOverMin) fee = surplusOverMin;
        }
        uint256 userAmount = gained - fee;

        // Auto-unwrap: if user selected native ETH/TAO as output (not WETH),
        // the frontend sets unwrapOutput=true. We unwrap WETH → native ETH
        // and send it directly so the user doesn't have to deal with WETH.
        // The app fee stays in WETH at the app's feeCollector — they
        // can unwrap themselves if desired.
        if (unwrapOutput && tokenOut == address(wrappedNativeToken) && userAmount > 0) {
            IWETH(address(wrappedNativeToken)).withdraw(userAmount);
            (bool sent,) = payable(receiver).call{value: userAmount}("");
            require(sent, "ETH delivery failed");
        } else {
            IERC20(tokenOut).safeTransfer(receiver, userAmount);
        }
        if (fee > 0) IERC20(tokenOut).safeTransfer(feeCollector, fee);

        // 5. Score against the off-chain QUOTE (the honest promise), not the
        //    slippage-guard min. Anchoring on quotedOutput keeps the score
        //    meaningful (≈5000 when execution ≈ quote, >5000 only for genuine
        //    improvement, scaled down below) instead of saturating at 10000
        //    whenever the min is loose. Mirrors the CoW fee, which already keys
        //    off quotedOutput. Falls back to minAmountOut when no quote supplied.
        score = _scoreVsQuote(gained, quotedOutput > 0 ? quotedOutput : minAmountOut);
        valid = true;

        emit SwapExecuted(order.orderId, order.submittedBy, tokenIn, tokenOut, amountIn, gained, fee);
    }

    /// @notice Score execution against an anchor (the quoted output): 5000 at the
    ///         anchor, ramped to 10000 at 2x above, and ramped down to 0 below.
    ///         Unlike _scoreLinear (which floors at 0 below the anchor — safe only
    ///         when gained >= anchor is guaranteed), this grades the below-anchor
    ///         region so an honest execution landing just under the gross quote
    ///         isn't scored 0.
    function _scoreVsQuote(uint256 gained, uint256 anchor) private pure returns (uint256) {
        if (anchor == 0) return 0;
        if (gained >= anchor * 2) return 10000;
        if (gained >= anchor) return 5000 + ((gained - anchor) * 5000) / anchor;
        return (gained * 5000) / anchor;
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

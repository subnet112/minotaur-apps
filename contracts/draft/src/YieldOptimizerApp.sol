// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title YieldOptimizerApp - Automated yield optimization via App Intent
/// @notice Solvers compete to find the best lending allocation for deposited
///         assets. The app handles deposits, rebalancing execution, and
///         invariant verification. Scoring rewards higher APY and penalizes
///         unnecessary churn.
///
///         Intent params encoding:
///           abi.encode(address asset, uint256 amount, address[] protocols,
///                      uint256 minBalance)
///
///         Execution flow (via _handleIntent -> _rebalance dispatch):
///           1. Record pre-execution balances across all known protocols
///           2. Deploy EphemeralProxy, execute solver's rebalance plan
///           3. Record post-execution balances
///           4. Verify: total balance >= minBalance (no funds lost)
///           5. Score: proportional to balance improvement
contract YieldOptimizerApp is AppIntentBase {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    bytes4 public constant REBALANCE_SELECTOR = bytes4(keccak256(
        "rebalance(address,uint256,address[],uint256)"
    ));

    // ── State ──────────────────────────────────────────────────────────────

    /// @notice Fee on yield improvement in BPS (e.g., 1000 = 10%)
    uint256 public feeBps;

    /// @notice Address that receives yield fees
    address public feeCollector;

    // ── Events ─────────────────────────────────────────────────────────────

    event Rebalanced(
        bytes32 indexed orderId,
        address indexed user,
        address asset,
        uint256 balanceBefore,
        uint256 balanceAfter,
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
        require(_feeBps <= 5000, "Fee too high"); // Max 50%
        feeCollector = _feeCollector;
        feeBps = _feeBps;
        registeredIntents[REBALANCE_SELECTOR] = true;
    }

    // ── Admin ──────────────────────────────────────────────────────────────

    function setFeeCollector(address _feeCollector) external onlyRelayer {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(_feeCollector);
    }

    function setFeeBps(uint256 _feeBps) external onlyRelayer {
        require(_feeBps <= 5000, "Fee too high");
        feeBps = _feeBps;
        emit FeeBpsUpdated(_feeBps);
    }

    // ── Intent dispatch ────────────────────────────────────────────────────

    function _handleIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal override returns (uint256 score, bool valid) {
        if (order.intentSelector == REBALANCE_SELECTOR) {
            return _rebalance(order, plan);
        }
        revert("Unknown intent");
    }

    // ── Intent functions ────────────────────────────────────────────────────

    /// @notice Rebalance: execute solver's plan, verify no funds lost, score improvement.
    function _rebalance(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address asset,
            uint256 amount,
            , // address[] protocols (used by solver, not needed here)
            uint256 minBalance
        ) = abi.decode(order.intentParams, (address, uint256, address[], uint256));

        // 1. Snapshot balance before rebalancing
        _snapshot(asset);

        // 2. Fund proxy and execute solver's rebalancing plan
        //    The plan may: withdraw from Aave → deposit to Compound, etc.
        _fundAndExecute(order, plan, asset, order.submittedBy, amount);

        // 3. Check invariant: total balance must not decrease
        uint256 gained = _gained(asset);
        uint256 totalAfter = amount + gained; // gained can be negative via underflow protection

        // The key invariant: user's assets are not lost
        if (IERC20(asset).balanceOf(address(this)) < minBalance) {
            return (0, false);
        }

        // 4. Score: proportional to balance maintenance
        //    5000 = exact same balance, up to 10000 for any improvement
        score = _scoreLinear(IERC20(asset).balanceOf(address(this)), minBalance);
        valid = true;

        // 5. Deliver assets back to the app (they stay in the contract for next rebalance)
        //    Fee on any positive yield captured during rebalance
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        if (currentBalance > amount) {
            uint256 profit = currentBalance - amount;
            uint256 fee = (profit * feeBps) / 10000;
            if (fee > 0) {
                IERC20(asset).safeTransfer(feeCollector, fee);
            }
        }

        emit Rebalanced(
            order.orderId,
            order.submittedBy,
            asset,
            amount,
            IERC20(asset).balanceOf(address(this)),
            0
        );
    }
}

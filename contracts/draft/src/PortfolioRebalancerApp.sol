// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title PortfolioRebalancerApp - Portfolio rebalancing via App Intent
/// @notice Rebalances token allocations to target weights. Solvers generate
///         execution plans (swaps across DEXes), validators verify via
///         simulation, and the app validates that post-rebalance balances
///         meet minimum thresholds and weights are valid.
///
///         Intent params encoding:
///           abi.encode(address[] tokens, uint256[] targetWeightsBps,
///                      uint256[] minAmountsOut, address owner)
///
///         Execution flow (via _handleIntent → _rebalance dispatch):
///           1. Decode params, validate weights sum to 10000 BPS.
///           2. Execute solver's plan calls via _executePlan.
///           3. Verify post-execution balances haven't decreased below minimums.
///           4. Return passing score (7500 BPS). Real scoring happens in JS.
contract PortfolioRebalancer is AppIntentBase {
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────

    bytes4 public constant REBALANCE_SELECTOR = bytes4(keccak256(
        "rebalance(address[],uint256[],uint256[],address)"
    ));

    // ── Events ─────────────────────────────────────────────────────────────

    event RebalanceExecuted(
        bytes32 indexed orderId,
        address indexed owner,
        uint256 numTokens,
        uint256 score
    );

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _maxPlatformFeeWei
    ) AppIntentBase(_relayer, _validatorRegistry, _quorumBps, _scoreThreshold, _wrappedNativeToken, _platformFeeCollector, _maxPlatformFeeWei) {
        registeredIntents[REBALANCE_SELECTOR] = true;
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

    function _rebalance(
        IntentOrder calldata order,
        ExecutionPlan calldata plan
    ) internal returns (uint256 score, bool valid) {
        (
            address[] memory tokens,
            uint256[] memory targetWeightsBps,
            uint256[] memory minAmountsOut,
            address owner
        ) = abi.decode(order.intentParams, (address[], uint256[], uint256[], address));

        require(tokens.length > 0, "No tokens");
        require(tokens.length == targetWeightsBps.length, "Length mismatch: weights");
        require(tokens.length == minAmountsOut.length, "Length mismatch: mins");

        // Validate weights sum to 10000 BPS (100%)
        uint256 weightSum = 0;
        for (uint256 i = 0; i < targetWeightsBps.length; i++) {
            weightSum += targetWeightsBps[i];
        }
        require(weightSum == 10000, "Weights must sum to 10000");

        // Execute the solver's plan
        _executePlan(order, plan);

        // Verify post-execution balances meet minimums
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance = IERC20(tokens[i]).balanceOf(owner);
            require(balance >= minAmountsOut[i], "Balance below minimum");
        }

        // Return passing score — real quality scoring happens in JS
        score = 7500;
        valid = true;

        emit RebalanceExecuted(order.orderId, owner, tokens.length, score);
    }
}

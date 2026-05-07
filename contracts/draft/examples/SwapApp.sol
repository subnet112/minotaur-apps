// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title SwapApp - Example App Intent for token swaps
/// @notice Validates that a swap plan moved tokens correctly and returns a score
contract SwapApp is AppIntentBase {
    // Intent function selector for swaps
    bytes4 public constant SWAP_SELECTOR = bytes4(keccak256("swap(bytes32,address,address,uint256,uint256)"));

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _maxPlatformFeeWei
    ) AppIntentBase(_relayer, _validatorRegistry, _quorumBps, _scoreThreshold, _wrappedNativeToken, _platformFeeCollector, _maxPlatformFeeWei) {
        // Auto-register the swap intent
        registeredIntents[SWAP_SELECTOR] = true;
    }

    /// @notice Check swap invariants after execution
    /// @dev Decodes params, checks output token was received by user
    function _checkIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata /* plan */,
        address /* proxy */
    ) internal view override returns (uint256 score, bool valid) {
        // Decode swap params: (orderId, inputToken, outputToken, inputAmount, minOutput)
        (
            ,
            address inputToken,
            address outputToken,
            uint256 inputAmount,
            uint256 minOutput
        ) = abi.decode(order.intentParams, (bytes32, address, address, uint256, uint256));

        // Check that user received at least minOutput of the output token
        uint256 outputBalance = IERC20(outputToken).balanceOf(order.submittedBy);
        if (outputBalance < minOutput) {
            return (0, false);
        }

        // Score: 5000 at minOutput, linear to 10000 at 2x
        score = _scoreLinear(outputBalance, minOutput);
        valid = true;
    }
}

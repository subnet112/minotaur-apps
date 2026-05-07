// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "minotaur_contracts/src/AppIntentBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ArbitrageApp - App Intent for cross-fee-tier WETH/USDC arbitrage
/// @notice Validates that a round-trip arb (WETH → USDC → WETH) returned
///         at least minReturn WETH to the user. Hardcoded tokens and fee tiers.
contract ArbitrageApp is AppIntentBase {
    // Intent function selector for arbitrage
    bytes4 public constant ARBITRAGE_SELECTOR =
        bytes4(keccak256("arbitrage(bytes32,uint256,uint256)"));

    // Hardcoded arb route: WETH/USDC cross-fee-tier
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    uint24 public constant FEE_BUY  = 3000;  // buy USDC on 0.3% pool
    uint24 public constant FEE_SELL = 500;   // sell USDC for WETH on 0.05% pool

    constructor(
        address _relayer,
        address _validatorRegistry,
        uint256 _quorumBps,
        uint256 _scoreThreshold,
        address _wrappedNativeToken,
        address _platformFeeCollector,
        uint256 _maxPlatformFeeWei
    ) AppIntentBase(_relayer, _validatorRegistry, _quorumBps, _scoreThreshold, _wrappedNativeToken, _platformFeeCollector, _maxPlatformFeeWei) {
        // Auto-register the arbitrage intent
        registeredIntents[ARBITRAGE_SELECTOR] = true;
    }

    /// @notice Check arbitrage invariants after execution
    /// @dev Decodes params, checks user got back at least minReturn WETH
    function _checkIntent(
        IntentOrder calldata order,
        ExecutionPlan calldata /* plan */,
        address /* proxy */
    ) internal view override returns (uint256 score, bool valid) {
        // Decode arbitrage params: (orderId, inputAmount, minReturn)
        (
            ,
            uint256 inputAmount,
            uint256 minReturn
        ) = abi.decode(order.intentParams, (bytes32, uint256, uint256));

        // Check that user received at least minReturn WETH
        uint256 wethBalance = IERC20(WETH).balanceOf(order.submittedBy);
        if (wethBalance < minReturn) {
            return (0, false);
        }

        // Score: 5000 at minReturn, linear to 10000 at 2x minReturn
        score = _scoreLinear(wethBalance, minReturn);
        valid = true;
    }
}

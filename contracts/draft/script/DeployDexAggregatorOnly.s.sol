// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/DexAggregatorApp.sol";

/// @title DeployDexAggregatorOnly
/// @notice Deploy a fresh DexAggregatorApp against an EXISTING ValidatorRegistry.
/// @dev Used when we're re-deploying the app contract after a source change (e.g. making
///      executeIntent payable) but want to keep the existing registry — so validators
///      don't need to be re-registered and off-chain consensus keeps working.
///
/// Env inputs:
///   DEPLOYER_PRIVATE_KEY  - relayer key that pays gas
///   RELAYER_ADDRESS       - relayer address (also used as platformFeeCollector)
///   VALIDATOR_REGISTRY    - existing registry address to reuse
///   WRAPPED_NATIVE_TOKEN  - WETH on the target chain (required for seamless ETH path)
///   FEE_COLLECTOR         - positive-slippage fee recipient
///   QUORUM_BPS            - defaults to 6666
///   SCORE_THRESHOLD       - defaults to 5000
///   FEE_BPS               - defaults to 5000
///   MAX_PLATFORM_FEE_WEI  - defaults to 0.1 ether
contract DeployDexAggregatorOnly is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        address registry = vm.envAddress("VALIDATOR_REGISTRY");
        address wrappedNative = vm.envAddress("WRAPPED_NATIVE_TOKEN");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");

        uint256 quorumBps = vm.envOr("QUORUM_BPS", uint256(6666));
        uint256 scoreThreshold = vm.envOr("SCORE_THRESHOLD", uint256(5000));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(5000));
        uint256 maxPlatformFee = vm.envOr("MAX_PLATFORM_FEE_WEI", uint256(0.1 ether));

        console.log("=== DeployDexAggregatorOnly ===");
        console.log("Relayer:", relayer);
        console.log("Existing ValidatorRegistry:", registry);
        console.log("WrappedNativeToken:", wrappedNative);
        console.log("FeeCollector:", feeCollector);
        console.log("QuorumBps:", quorumBps);
        console.log("ScoreThreshold:", scoreThreshold);
        console.log("FeeBps:", feeBps);

        vm.startBroadcast(deployerKey);

        DexAggregatorApp app = new DexAggregatorApp(
            relayer,
            registry,
            quorumBps,
            scoreThreshold,
            wrappedNative,
            relayer,           // platformFeeCollector = relayer
            maxPlatformFee,
            feeCollector,
            feeBps
        );

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYED ===");
        console.log("DexAggregatorApp:", address(app));
    }
}

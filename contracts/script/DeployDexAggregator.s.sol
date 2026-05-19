// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/DexAggregatorApp.sol";

/// @title DeployDexAggregator
/// @notice Deploy the new fee-settlement + AppRegistry-aware DexAggregatorApp
///         on a single chain. Mirrors the constructor verbatim so every arg
///         is sourced from env. Sensible defaults are provided for
///         quorum / score threshold / fee mode / fee bounds — override per
///         chain when needed.
///
/// Env inputs (required):
///   DEPLOYER_PRIVATE_KEY      - pays gas. Becomes the relayer address baked
///                               into the contract (immutable).
///   VALIDATOR_REGISTRY        - existing ValidatorRegistry address on this chain
///   WRAPPED_NATIVE_TOKEN      - WETH on Ethereum/Base, WTAO on BT EVM
///   PLATFORM_FEE_COLLECTOR    - subnet treasury / FeeSplitter proxy
///   APP_REGISTRY              - AppRegistry deployed via DeployAppRegistry.s.sol
///                               (set to 0x000...0 to disable the on-chain gate)
///   FEE_COLLECTOR             - DexAggregator's own positive-slippage collector
///                               (the constructor defaults appPaymaster to this
///                               when APP_PAYMASTER is the zero address)
///
/// Env inputs (optional, with defaults):
///   SCORE_THRESHOLD           - default 5000
///   MIN_PLATFORM_FEE_WEI      - default 0
///   MAX_PLATFORM_FEE_WEI      - default 0.1 ether (1e17)
///   FEE_MODE                  - "USER" or "APP" (default "APP" for the DEX)
///   APP_PAYMASTER             - default address(0) → falls back to FEE_COLLECTOR
///   FEE_BPS                   - default 5000 (50% of positive slippage)
///
/// Output (parseable):
///   DEX_AGGREGATOR=0x...
contract DeployDexAggregator is Script {
    function run() external {
        // Required
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address validatorRegistry = vm.envAddress("VALIDATOR_REGISTRY");
        address wrappedNative = vm.envAddress("WRAPPED_NATIVE_TOKEN");
        address platformFeeCollector = vm.envAddress("PLATFORM_FEE_COLLECTOR");
        address appRegistry = vm.envAddress("APP_REGISTRY");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");

        // Optional
        uint256 scoreThreshold = vm.envOr("SCORE_THRESHOLD", uint256(5000));
        uint256 minFee = vm.envOr("MIN_PLATFORM_FEE_WEI", uint256(0));
        uint256 maxFee = vm.envOr("MAX_PLATFORM_FEE_WEI", uint256(0.1 ether));
        string memory modeStr = vm.envOr("FEE_MODE", string("APP"));
        address appPaymaster = vm.envOr("APP_PAYMASTER", address(0));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(5000));

        AppIntentBase.FeeMode mode;
        if (keccak256(bytes(modeStr)) == keccak256(bytes("USER"))) {
            mode = AppIntentBase.FeeMode.USER;
        } else if (keccak256(bytes(modeStr)) == keccak256(bytes("APP"))) {
            mode = AppIntentBase.FeeMode.APP;
        } else {
            revert("FEE_MODE must be USER or APP");
        }

        require(validatorRegistry != address(0), "VALIDATOR_REGISTRY unset");
        require(wrappedNative != address(0), "WRAPPED_NATIVE_TOKEN unset");
        require(platformFeeCollector != address(0), "PLATFORM_FEE_COLLECTOR unset");
        require(feeCollector != address(0), "FEE_COLLECTOR unset");
        // appRegistry == address(0) is permitted — disables the on-chain gate.

        address deployer = vm.addr(deployerKey);

        console.log("=== DeployDexAggregator ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer (= relayer):", deployer);
        console.log("ValidatorRegistry:", validatorRegistry);
        console.log("WrappedNativeToken:", wrappedNative);
        console.log("PlatformFeeCollector:", platformFeeCollector);
        console.log("AppRegistry:", appRegistry);
        console.log("FeeCollector:", feeCollector);
        // Quorum is sourced from ValidatorRegistry.quorumBps() at execution time.
        console.log("ScoreThreshold:", scoreThreshold);
        console.log("MinPlatformFeeWei:", minFee);
        console.log("MaxPlatformFeeWei:", maxFee);
        console.log("FeeMode:", modeStr);
        console.log("AppPaymaster:", appPaymaster, "(zero => falls back to FeeCollector)");
        console.log("FeeBps:", feeBps);

        vm.startBroadcast(deployerKey);
        DexAggregatorApp app = new DexAggregatorApp(
            deployer,                // _relayer = deployer key
            validatorRegistry,
            scoreThreshold,
            wrappedNative,
            platformFeeCollector,
            minFee,
            maxFee,
            mode,
            appPaymaster,
            appRegistry,
            feeCollector,
            feeBps
        );
        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYED ===");
        console.log("DEX_AGGREGATOR=%s", vm.toString(address(app)));
        if (appRegistry != address(0)) {
            console.log("NEXT: register this contract via RegisterApp.s.sol before submitting orders.");
        }
    }
}

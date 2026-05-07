// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ValidatorRegistry.sol";
import "../src/DexAggregatorApp.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address relayer = vm.envAddress("RELAYER_ADDRESS");

        // Parse validator addresses from comma-separated string
        string memory validatorsStr = vm.envString("VALIDATORS");
        address[] memory validators = _parseAddresses(validatorsStr);

        uint256 quorumBps = vm.envOr("QUORUM_BPS", uint256(8000));
        uint256 scoreThreshold = vm.envOr("SCORE_THRESHOLD", uint256(5000));
        address feeCollector = vm.envAddress("FEE_COLLECTOR");
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(5000));

        vm.startBroadcast(deployerPrivateKey);

        // Deploy ValidatorRegistry first
        ValidatorRegistry registry = new ValidatorRegistry(relayer, validators);

        // Deploy DexAggregatorApp referencing the registry
        address wrappedNativeToken = vm.envOr("WRAPPED_NATIVE_TOKEN", address(0));
        uint256 maxPlatformFee = vm.envOr("MAX_PLATFORM_FEE_WEI", uint256(0.1 ether));

        DexAggregatorApp app = new DexAggregatorApp(
            relayer,
            address(registry),
            quorumBps,
            scoreThreshold,
            wrappedNativeToken,
            relayer,           // platformFeeCollector = relayer
            maxPlatformFee,
            feeCollector,
            feeBps
        );

        console.log("ValidatorRegistry deployed at:", address(registry));
        console.log("DexAggregatorApp deployed at:", address(app));
        console.log("Relayer:", relayer);
        console.log("Fee Collector:", feeCollector);
        console.log("Validators:", validators.length);
        console.log("Quorum BPS:", quorumBps);
        console.log("Fee BPS:", feeBps);

        vm.stopBroadcast();
    }

    function _parseAddresses(string memory csv) internal pure returns (address[] memory) {
        // Simple CSV parser for deployment script
        // For production, use a more robust approach
        bytes memory data = bytes(csv);
        uint256 count = 1;
        for (uint256 i = 0; i < data.length; i++) {
            if (data[i] == ",") count++;
        }

        address[] memory result = new address[](count);
        uint256 start = 0;
        uint256 idx = 0;

        for (uint256 i = 0; i <= data.length; i++) {
            if (i == data.length || data[i] == ",") {
                bytes memory addrBytes = new bytes(i - start);
                for (uint256 j = start; j < i; j++) {
                    addrBytes[j - start] = data[j];
                }
                result[idx] = vm.parseAddress(string(addrBytes));
                idx++;
                start = i + 1;
            }
        }

        return result;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "minotaur_contracts/src/ValidatorRegistry.sol";
import "minotaur_contracts/src/AppRegistry.sol";
import "../src/DexAggregatorApp.sol";
import "../script/DeployAndWireDexAggregator.s.sol";
import "./mocks/MockToken.sol";

/// @notice Runs the redeploy script end-to-end against mocks and asserts a fresh
///         deploy comes out FULLY WIRED — the three on-chain steps whose
///         omission took prod down:
///           1. SWAP/BRIDGE intents registered (constructor)
///           2. mapped in the AppRegistry (registerApp)
///           3. protocol-fee WETH approval granted (paymaster -> app)
///         and that the script FAILS LOUD when it can't grant the approval.
///         This locks the guarantee in CI, not just at deploy time.
contract DeployAndWireDexAggregatorTest is Test {
    DeployAndWireDexAggregator internal script;
    ValidatorRegistry internal vr;
    AppRegistry internal appReg;
    MockToken internal weth;

    address internal deployer;
    uint256 internal deployerKey;
    address internal feeCollector;

    bytes32 internal constant APP_ID = keccak256("test-dex-app");
    bytes32 internal constant MANIFEST_HASH = keccak256("test-manifest");
    uint256 internal constant MAX_FEE = 0.1 ether;
    bytes4 internal constant SWAP_SEL =
        bytes4(keccak256("swap(address,address,uint256,uint256,address)"));

    function setUp() public {
        (deployer, deployerKey) = makeAddrAndKey("deployer");
        feeCollector = makeAddr("feeCollector");

        address[] memory vals = new address[](1);
        vals[0] = makeAddr("validator0");
        vr = new ValidatorRegistry(deployer, vals, 8000);
        weth = new MockToken("Wrapped ETH", "WETH", 18);

        // This test is the AppRegistry owner; allowlist the deployer so it can
        // registerApp in GATED mode (mirrors the live config where the deployer
        // key is an allowlisted developer).
        appReg = new AppRegistry(address(this));
        appReg.setDeveloperAllowed(deployer, true);

        script = new DeployAndWireDexAggregator();
    }

    /// @dev vm.setEnv writes the process environment, which forge does NOT roll
    ///      back between tests — so set the full base env at the start of every
    ///      test (deployer is also the fee paymaster, like the live config)
    ///      rather than once in setUp, to stay immune to test ordering.
    function _baseEnv() internal {
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(deployerKey));
        vm.setEnv("VALIDATOR_REGISTRY", vm.toString(address(vr)));
        vm.setEnv("WRAPPED_NATIVE_TOKEN", vm.toString(address(weth)));
        vm.setEnv("PLATFORM_FEE_COLLECTOR", vm.toString(makeAddr("treasury")));
        vm.setEnv("APP_REGISTRY", vm.toString(address(appReg)));
        vm.setEnv("FEE_COLLECTOR", vm.toString(feeCollector));
        vm.setEnv("APP_ID", vm.toString(APP_ID));
        vm.setEnv("MANIFEST_HASH", vm.toString(MANIFEST_HASH));
        vm.setEnv("MAX_PLATFORM_FEE_WEI", vm.toString(MAX_FEE));
        vm.setEnv("APP_PAYMASTER", vm.toString(deployer)); // == deployer
    }

    function test_freshDeploy_comesOutFullyWired() public {
        _baseEnv();
        address app = script.run();
        assertTrue(app != address(0), "no contract deployed");

        // 1. Intents registered by the constructor.
        assertTrue(
            DexAggregatorApp(payable(app)).registeredIntents(SWAP_SEL),
            "SWAP intent not registered"
        );

        // 2. Mapped in the AppRegistry under the supplied appId.
        assertEq(appReg.appByContract(app), APP_ID, "AppRegistry mapping missing");

        // 3. Protocol-fee WETH approval granted from the paymaster (== deployer).
        assertGe(
            weth.allowance(deployer, app),
            MAX_FEE,
            "WETH fee approval missing/insufficient (the prod-outage gap)"
        );

        // Sanity: the relayer baked into the immutable is the deployer.
        assertEq(DexAggregatorApp(payable(app)).relayer(), deployer, "relayer != deployer");
    }

    function test_failsLoud_whenPaymasterIsNotDeployer() public {
        // If the fee paymaster isn't the deployer, the script can't grant the
        // WETH approval in its own broadcast — it must revert up front rather
        // than ship a contract that reverts on fee settlement.
        _baseEnv();
        vm.setEnv("APP_PAYMASTER", vm.toString(makeAddr("otherPaymaster")));
        vm.expectRevert(
            bytes(
                "APP-mode fee paymaster != deployer: run WETH.approve(app,max) from the paymaster key separately, or set APP_PAYMASTER/FEE_COLLECTOR to the deployer"
            )
        );
        script.run();
    }
}

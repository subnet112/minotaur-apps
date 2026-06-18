// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/DexAggregatorApp.sol";
import "minotaur_contracts/src/AppRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployAndWireDexAggregator
/// @notice One-broadcast redeploy of DexAggregatorApp that performs — and then
///         ASSERTS — every wiring step a fresh deploy needs, so a redeploy can
///         never again silently ship a half-wired contract. It folds together
///         what used to be three separate, easy-to-forget steps:
///
///           1. DEPLOY            — constructor auto-registers SWAP + BRIDGE
///                                  intents (so "intent registration" is never
///                                  a manual step).
///           2. APP REGISTRY      — registerApp(appId, manifestHash, contract)
///                                  so the on-chain `_requireRegistered()` gate
///                                  passes (was a separate RegisterApp.s.sol).
///           3. WETH FEE APPROVAL — approve the protocol-fee WETH pull from the
///                                  fee paymaster to the new contract. THIS is
///                                  the step whose omission took prod down: the
///                                  old contract had the approval, the redeploy
///                                  did not, so every swap reverted in fee
///                                  settlement with an opaque WETH9 revert.
///
///         All three run from DEPLOYER_PRIVATE_KEY, which on the live config is
///         simultaneously the contract relayer, the AppRegistry owner +
///         allowlisted developer, and the fee paymaster — one key, one
///         broadcast. After broadcasting, the script reads back the three
///         invariants and REVERTS if any is missing, so an incomplete deploy
///         fails loud (and, run with --broadcast, aborts before sending).
///
///         OFF-CHAIN STEP (NOT here): pointing the platform deployment record
///         at this address so the blockloop routes orders to it. A forge script
///         cannot touch the platform store — see the companion wrapper
///         (redeploy-dex.sh) which runs this then updates the record.
///
/// Env (required):
///   DEPLOYER_PRIVATE_KEY   - relayer + AppRegistry owner/dev + fee paymaster
///   VALIDATOR_REGISTRY     - ValidatorRegistry on this chain
///   WRAPPED_NATIVE_TOKEN   - WETH (Base/ETH) / WTAO (BT EVM); the fee token
///   PLATFORM_FEE_COLLECTOR - subnet treasury / FeeSplitter
///   APP_REGISTRY           - AppRegistry on this chain (the on-chain gate)
///   FEE_COLLECTOR          - DexAggregator positive-slippage collector
///   APP_ID                 - fresh bytes32 app id minted by the platform
///   MANIFEST_HASH          - bytes32 sha256 of the JS scoring bundle
/// Env (optional, with defaults):
///   SCORE_THRESHOLD(5000), MIN_PLATFORM_FEE_WEI(0), MAX_PLATFORM_FEE_WEI(1e17),
///   FEE_MODE("APP"), APP_PAYMASTER(0 => FEE_COLLECTOR), FEE_BPS(5000),
///   FEE_APPROVAL_AMOUNT(uint256 max)
///
/// Output (parseable): DEX_AGGREGATOR=0x...
contract DeployAndWireDexAggregator is Script {
    function run() external {
        // ── Inputs ──────────────────────────────────────────────────────────
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address validatorRegistry = vm.envAddress("VALIDATOR_REGISTRY");
        address wrappedNative = vm.envAddress("WRAPPED_NATIVE_TOKEN");
        address platformFeeCollector = vm.envAddress("PLATFORM_FEE_COLLECTOR");
        address appRegistry = vm.envAddress("APP_REGISTRY");
        address feeCollector = vm.envAddress("FEE_COLLECTOR");
        bytes32 appId = vm.envBytes32("APP_ID");
        bytes32 manifestHash = vm.envBytes32("MANIFEST_HASH");

        uint256 scoreThreshold = vm.envOr("SCORE_THRESHOLD", uint256(5000));
        uint256 minFee = vm.envOr("MIN_PLATFORM_FEE_WEI", uint256(0));
        uint256 maxFee = vm.envOr("MAX_PLATFORM_FEE_WEI", uint256(0.1 ether));
        string memory modeStr = vm.envOr("FEE_MODE", string("APP"));
        address appPaymaster = vm.envOr("APP_PAYMASTER", address(0));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(5000));
        uint256 approvalAmount = vm.envOr("FEE_APPROVAL_AMOUNT", type(uint256).max);

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
        require(appRegistry != address(0), "APP_REGISTRY unset (on-chain gate must be on for prod)");
        require(appId != bytes32(0), "APP_ID unset");
        require(manifestHash != bytes32(0), "MANIFEST_HASH unset");

        address deployer = vm.addr(deployerKey);
        // The contract resolves appPaymaster the same way (0 => feeCollector).
        address paymaster = appPaymaster == address(0) ? feeCollector : appPaymaster;
        bytes4 swapSel = bytes4(keccak256("swap(address,address,uint256,uint256,address)"));
        AppRegistry registry = AppRegistry(appRegistry);

        // Step 3 approves WETH from the *broadcast sender* (deployer). For that
        // to be the paymaster's approval, deployer must BE the paymaster. In
        // any other config the paymaster must approve from its own key — fail
        // loud now rather than ship a contract that can't settle fees.
        if (mode == AppIntentBase.FeeMode.APP) {
            require(
                paymaster == deployer,
                "APP-mode fee paymaster != deployer: run WETH.approve(app,max) from the paymaster key separately, or set APP_PAYMASTER/FEE_COLLECTOR to the deployer"
            );
        }

        console.log("=== DeployAndWireDexAggregator ===");
        console.log("chain id:", block.chainid);
        console.log("deployer:", deployer);
        console.log("validatorRegistry:", validatorRegistry);
        console.log("appRegistry:", appRegistry);
        console.log("appId:", vm.toString(appId));
        console.log("wrappedNative (fee token):", wrappedNative);
        console.log("fee paymaster:", paymaster);
        console.log("feeMode:", modeStr);

        vm.startBroadcast(deployerKey);

        // 1. Deploy — constructor sets registeredIntents[SWAP]/[BRIDGE] = true.
        DexAggregatorApp app = new DexAggregatorApp(
            deployer,
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

        // 2. Register in the AppRegistry. A fresh appId per deploy means no
        //    conflict with the previous contract's record (no revoke needed).
        registry.registerApp(appId, manifestHash, address(app));

        // 3. Approve the protocol-fee WETH pull (APP mode only — in USER mode
        //    the fee is pulled from the user, not the paymaster). The app pulls
        //    via transferFrom(paymaster -> collector), so the paymaster (==
        //    deployer here) must approve the app. This is the gap that broke
        //    prod; it now ships with the deploy.
        if (mode == AppIntentBase.FeeMode.APP) {
            IERC20(wrappedNative).approve(address(app), approvalAmount);
        }

        vm.stopBroadcast();

        // ── Read-back: fail loud if any wiring is missing ────────────────────
        require(app.registeredIntents(swapSel), "POST: SWAP intent not registered on the new contract");
        require(
            registry.appByContract(address(app)) == appId,
            "POST: new contract not mapped in AppRegistry"
        );
        if (mode == AppIntentBase.FeeMode.APP) {
            require(
                IERC20(wrappedNative).allowance(paymaster, address(app)) >= maxFee,
                "POST: WETH fee approval missing/insufficient (the prod-outage gap)"
            );
        }

        console.log("");
        console.log("=== DEPLOYED + WIRED + VERIFIED ===");
        console.log("DEX_AGGREGATOR=%s", vm.toString(address(app)));
        console.log("APP_ID=%s", vm.toString(appId));
        console.log("[ok] SWAP/BRIDGE intents registered (constructor)");
        console.log("[ok] AppRegistry mapping set");
        if (mode == AppIntentBase.FeeMode.APP) {
            console.log("[ok] WETH fee approval granted (paymaster -> app)");
        }
        console.log("");
        console.log("OFF-CHAIN NEXT: point the platform deployment record at the");
        console.log("address above (see redeploy-dex.sh) so orders route here.");
    }
}

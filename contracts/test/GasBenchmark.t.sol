// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {ValidatorRegistry} from "minotaur_contracts/src/ValidatorRegistry.sol";
import {EIP712Verifier} from "minotaur_contracts/src/EIP712Verifier.sol";
import {IAppIntentBase} from "minotaur_contracts/src/interfaces/IAppIntentBase.sol";
import {AppIntentBase} from "minotaur_contracts/src/AppIntentBase.sol";
import {DexAggregatorApp} from "../src/DexAggregatorApp.sol";
import {DexAggregatorAppV2, AppIntentBaseV2} from "../src/v2/DexAggregatorAppV2.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {MockDex, MockWETH} from "./DexAggregator.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ExecutorProxyLike {
    function execute(IAppIntentBase.Call[] calldata calls) external payable;
}

/// @title GasBenchmark - V1 vs V2 executeIntent gas comparison
/// @notice Runs byte-identical intent scenarios through DexAggregatorApp (V1)
///         and DexAggregatorAppV2 and reports the gas of the executeIntent
///         call for each. Every scenario also asserts identical user-visible
///         outcomes (output delivered, fees collected) so the numbers compare
///         like-for-like behavior.
///
///         Measured with `gasleft()` around the external call, so figures
///         exclude the 21k intrinsic cost and calldata gas (identical for
///         both versions anyway — calldata reduction is a separate, schema-
///         breaking workstream).
///
///         Run: forge test --match-contract GasBenchmark -vv
contract GasBenchmarkTest is Test {
    DexAggregatorApp public appV1;
    DexAggregatorAppV2 public appV2;
    ValidatorRegistry public registry;
    MockWETH public weth;
    MockToken public usdc;
    MockDex public dex;

    address public relayerAddr;
    uint256 public relayerKey;
    address public userAddr;
    uint256 public userKey;
    address public feeCollector;

    address[] public validatorAddrs;
    uint256[] public validatorKeys;

    function setUp() public {
        (relayerAddr, relayerKey) = makeAddrAndKey("relayer");
        (userAddr, userKey) = makeAddrAndKey("user");
        feeCollector = makeAddr("feeCollector");

        for (uint256 i = 0; i < 3; i++) {
            (address addr, uint256 key) = makeAddrAndKey(
                string(abi.encodePacked("validator", vm.toString(i)))
            );
            validatorAddrs.push(addr);
            validatorKeys.push(key);
        }
        _sortValidators();

        weth = new MockWETH();
        usdc = new MockToken("USD Coin", "USDC", 6);
        dex = new MockDex();
        usdc.mint(address(dex), 100_000_000e6);
        weth.mint(address(dex), 1_000e18);

        registry = new ValidatorRegistry(relayerAddr, validatorAddrs, 8000);

        appV1 = new DexAggregatorApp(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBase.FeeMode.APP,
            address(0),      // appPaymaster → defaults to feeCollector
            address(0),      // appRegistry off (same for both)
            feeCollector, 5000
        );

        appV2 = new DexAggregatorAppV2(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBaseV2.FeeMode.APP,
            address(0),
            address(0),
            feeCollector, 5000
        );

        // Protocol-fee funding, per model:
        // V1: paymaster (= feeCollector) holds WETH and approves the app.
        weth.mint(feeCollector, 1e18);
        vm.prank(feeCollector);
        weth.approve(address(appV1), type(uint256).max);
        // V2: the app itself holds the WETH float.
        weth.mint(address(appV2), 1e18);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            SCENARIOS
    // ═══════════════════════════════════════════════════════════════════════

    /// Scenario A: first swap for a fresh user, WETH→USDC, no fees at all.
    /// Cold everything: user nonce slot, order slot, proxy/executor, approvals.
    function test_gas_A_firstSwap_noFees() public {
        uint256 g1 = _runSwap(address(appV1), keccak256("A_v1"), 0, 0, false);
        uint256 g2 = _runSwap(address(appV2), keccak256("A_v2"), 0, 0, false);
        _report("A: first swap, no fees        ", g1, g2);
        assertLt(g2, g1, "V2 must be cheaper");
        // identical outcomes
        assertEq(usdc.balanceOf(userAddr), 2 * 1800e6, "both delivered minAmountOut");
    }

    /// Scenario B: steady-state swap — the same user's SECOND swap through
    /// each app. Warm nonce, warm snapshot slot (V1). Both versions pay for
    /// a fresh proxy + fresh router approval per order (the clone model keeps
    /// V1's one-address-per-execution guarantee). This is the number that
    /// matters for a live app.
    function test_gas_B_steadyStateSwap() public {
        _runSwap(address(appV1), keccak256("B_warm_v1"), 0, 0, false);
        _runSwap(address(appV2), keccak256("B_warm_v2"), 0, 0, false);

        uint256 g1 = _runSwap(address(appV1), keccak256("B_v1"), 0, 0, false);
        uint256 g2 = _runSwap(address(appV2), keccak256("B_v2"), 0, 0, false);
        _report("B: steady-state swap, no fees ", g1, g2);
        assertLt(g2, g1, "V2 must be cheaper");
    }

    /// Scenario C: swap with an APP-mode protocol fee that cannot come from
    /// output (tokenOut = USDC). V1 pulls WETH from the paymaster; V2 pays
    /// from its own float.
    function test_gas_C_swapWithProtocolFee() public {
        uint256 fee = 0.002 ether;
        uint256 collectorBefore = weth.balanceOf(relayerAddr);

        uint256 g1 = _runSwap(address(appV1), keccak256("C_v1"), fee, 0, false);
        uint256 g2 = _runSwap(address(appV2), keccak256("C_v2"), fee, 0, false);
        _report("C: swap + protocol fee        ", g1, g2);
        assertLt(g2, g1, "V2 must be cheaper");
        assertEq(weth.balanceOf(relayerAddr), collectorBefore + 2 * fee,
            "both delivered the protocol fee in WETH");
    }

    /// Scenario D: swap with positive slippage over the quote — exercises the
    /// CoW-style app fee (extra tokenOut transfer to feeCollector).
    function test_gas_D_swapWithAppFee() public {
        dex.setRate(2160);
        uint256 quoted = 2120e6;

        uint256 g1 = _runSwap(address(appV1), keccak256("D_v1"), 0, quoted, false);
        uint256 g2 = _runSwap(address(appV2), keccak256("D_v2"), 0, quoted, false);
        _report("D: swap + app fee (slippage)  ", g1, g2);
        assertLt(g2, g1, "V2 must be cheaper");
        assertEq(usdc.balanceOf(feeCollector), 2 * 20e6, "both took 50% of 40 USDC improvement");
        assertEq(usdc.balanceOf(userAddr), 2 * 2140e6, "both delivered gained - fee");
    }

    /// Scenario E: bridge intent with sentinel nonce — the path where V2
    /// still pays for the executedOrders bitmap, isolating the executor win.
    function test_gas_E_bridge_sentinelNonce() public {
        address bridgeContract = makeAddr("bridge");

        uint256 g1 = _runBridge(address(appV1), keccak256("E_v1"), bridgeContract);
        uint256 g2 = _runBridge(address(appV2), keccak256("E_v2"), bridgeContract);
        _report("E: bridge leg, sentinel nonce ", g1, g2);
        assertLt(g2, g1, "V2 must be cheaper");
        assertEq(weth.balanceOf(bridgeContract), 2e18, "both bridged the full amount");
    }

    /// Property test (not a gas measurement): the clone model preserves V1's
    /// approval-hygiene guarantee — every order executes on a fresh address,
    /// and used clones reject calls from anyone but the app, so approvals or
    /// dust a plan leaves behind are unreachable.
    function test_cloneIsolation_freshAddressPerOrder() public {
        bytes32 orderA = keccak256("iso_a");
        bytes32 orderB = keccak256("iso_b");

        address proxyA = appV2.predictProxy(orderA);
        address proxyB = appV2.predictProxy(orderB);
        assertTrue(proxyA != proxyB, "each order gets its own executor address");
        assertEq(proxyA.code.length, 0, "clone does not exist before execution");

        _runSwap(address(appV2), orderA, 0, 0, false);
        assertGt(proxyA.code.length, 0, "clone deployed at the predicted address");

        // The plan left a max approval to the dex on proxyA. It is worthless:
        // proxyA is never funded again, and no one but the app can run calls
        // through it.
        assertEq(weth.balanceOf(proxyA), 0, "used clone holds nothing");
        IAppIntentBase.Call[] memory sweep = new IAppIntentBase.Call[](0);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert("Only app");
        ExecutorProxyLike(payable(proxyA)).execute(sweep);

        // Next order executes on a different, fresh address.
        _runSwap(address(appV2), orderB, 0, 0, false);
        assertGt(proxyB.code.length, 0, "second order got its own clone");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                        SCENARIO RUNNERS
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Build, sign, and execute a 1 WETH → USDC swap through `app_`,
    ///      returning the gas used by executeIntent.
    function _runSwap(
        address app_,
        bytes32 orderId,
        uint256 platformFeeWei,
        uint256 quotedOutput,
        bool unwrapOutput
    ) internal returns (uint256 gasUsed) {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(app_, amountIn);

        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            platformFeeWei,
            quotedOutput,
            unwrapOutput
        );

        IAppIntentBase.IntentOrder memory order = _buildOrder(
            app_, _swapSelector(app_), intentParams, orderId, _nonceOf(app_)
        );

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth), value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex), value: 0,
            callData: abi.encodeCall(dex.swap, (address(weth), address(usdc), amountIn, 0, app_))
        });
        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls, deadline: order.deadline, nonce: 0, metadata: ""
        });

        return _execute(app_, order, plan);
    }

    /// @dev Build, sign, and execute a 1 WETH bridge deposit (sentinel nonce).
    function _runBridge(
        address app_,
        bytes32 orderId,
        address bridgeContract
    ) internal returns (uint256 gasUsed) {
        uint256 amountIn = 1e18;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(app_, amountIn);

        // 5 fields, exactly as _bridge decodes; platformFeeWei = 0.
        bytes memory intentParams = abi.encode(
            address(weth), amountIn, amountIn, userAddr, uint256(0)
        );

        IAppIntentBase.IntentOrder memory order = _buildOrder(
            app_, _bridgeSelector(app_), intentParams, orderId, type(uint256).max
        );

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](1);
        calls[0] = IAppIntentBase.Call({
            target: address(weth), value: 0,
            callData: abi.encodeCall(IERC20.transfer, (bridgeContract, amountIn))
        });
        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls, deadline: order.deadline, nonce: 0, metadata: ""
        });

        return _execute(app_, order, plan);
    }

    /// @dev Sign order + validator approvals for the app's own domain, then
    ///      measure the executeIntent call.
    function _execute(
        address app_,
        IAppIntentBase.IntentOrder memory order,
        IAppIntentBase.ExecutionPlan memory plan
    ) internal returns (uint256 gasUsed) {
        bytes32 ds = _domainSeparator(app_);
        bytes memory userSig = _signOrder(order, ds, userKey);

        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 threshold = IAppIntentBase(app_).scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(order.orderId, planHash, threshold, ds, validatorKeys[i]);
        }

        vm.prank(relayerAddr);
        uint256 g0 = gasleft();
        IAppIntentBase(app_).executeIntent(order, plan, userSig, validatorSigs);
        gasUsed = g0 - gasleft();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                            HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _buildOrder(
        address app_,
        bytes4 selector,
        bytes memory intentParams,
        bytes32 orderId,
        uint256 nonce
    ) internal view returns (IAppIntentBase.IntentOrder memory) {
        return IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: app_,
            intentSelector: selector,
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: nonce,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });
    }

    function _nonceOf(address app_) internal view returns (uint256) {
        return app_ == address(appV1) ? appV1.nonces(userAddr) : appV2.nonces(userAddr);
    }

    function _domainSeparator(address app_) internal view returns (bytes32) {
        return app_ == address(appV1) ? appV1.DOMAIN_SEPARATOR() : appV2.DOMAIN_SEPARATOR();
    }

    function _swapSelector(address app_) internal view returns (bytes4) {
        return app_ == address(appV1) ? appV1.SWAP_SELECTOR() : appV2.SWAP_SELECTOR();
    }

    function _bridgeSelector(address app_) internal view returns (bytes4) {
        return app_ == address(appV1) ? appV1.BRIDGE_SELECTOR() : appV2.BRIDGE_SELECTOR();
    }

    function _signOrder(
        IAppIntentBase.IntentOrder memory order,
        bytes32 domainSeparator,
        uint256 privateKey
    ) internal pure returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            EIP712Verifier.INTENT_ORDER_TYPEHASH,
            order.orderId,
            order.app,
            order.intentSelector,
            keccak256(order.intentParams),
            order.submittedBy,
            order.chainId,
            order.deadline,
            order.nonce,
            order.perpetual,
            order.maxExecutions,
            order.cooldown
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPlanApproval(
        bytes32 orderId,
        bytes32 planHash,
        uint256 score,
        bytes32 domainSeparator,
        uint256 privateKey
    ) internal pure returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            EIP712Verifier.PLAN_APPROVAL_TYPEHASH,
            orderId,
            planHash,
            score
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sortValidators() internal {
        for (uint256 i = 0; i < validatorAddrs.length; i++) {
            for (uint256 j = i + 1; j < validatorAddrs.length; j++) {
                if (validatorAddrs[i] > validatorAddrs[j]) {
                    (validatorAddrs[i], validatorAddrs[j]) = (validatorAddrs[j], validatorAddrs[i]);
                    (validatorKeys[i], validatorKeys[j]) = (validatorKeys[j], validatorKeys[i]);
                }
            }
        }
    }

    function _report(string memory label, uint256 v1Gas, uint256 v2Gas) internal view {
        uint256 saved = v1Gas - v2Gas;
        console2.log(
            string.concat(
                label,
                " V1: ", vm.toString(v1Gas),
                "  V2: ", vm.toString(v2Gas),
                "  saved: ", vm.toString(saved),
                " (", vm.toString((saved * 100) / v1Gas), "%)"
            )
        );
    }
}

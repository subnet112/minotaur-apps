// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "minotaur_contracts/src/AppIntentBase.sol";
import "minotaur_contracts/src/ValidatorRegistry.sol";
import "minotaur_contracts/src/EIP712Verifier.sol";
import "../src/DexAggregatorApp.sol";
import "./mocks/MockToken.sol";

/// @title MockDex - Simulates a DEX router for DexAggregator tests
/// @notice Pulls input token from msg.sender, sends output from its reserves.
///         Rate is configurable. Used to test the app's token management flow.
contract MockDex {
    uint256 public rate = 1800; // 1 input = 1800 output (e.g., WETH→USDC)
    uint8 public inputDecimals = 18;
    uint8 public outputDecimals = 6;

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function setDecimals(uint8 _inputDec, uint8 _outputDec) external {
        inputDecimals = _inputDec;
        outputDecimals = _outputDec;
    }

    /// @notice Swap: pull input from caller, send output to recipient
    function swap(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutput,
        address recipient
    ) external returns (uint256 outputAmount) {
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);

        // Calculate output accounting for decimal difference
        if (inputDecimals >= outputDecimals) {
            outputAmount = (inputAmount * rate) / (10 ** (inputDecimals - outputDecimals));
        } else {
            outputAmount = (inputAmount * rate) * (10 ** (outputDecimals - inputDecimals));
        }

        require(outputAmount >= minOutput, "MockDex: insufficient output");
        IERC20(outputToken).transfer(recipient, outputAmount);
    }
}

/// @title MockWETH - MockToken plus native wrap/unwrap (deposit/withdraw), to
///        exercise the auto-wrap (input) and auto-unwrap (output) paths.
contract MockWETH is MockToken {
    constructor() MockToken("Wrapped ETH", "WETH", 18) {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "MockWETH: ETH send failed");
    }

    receive() external payable {}
}

contract DexAggregatorTest is Test {
    DexAggregatorApp public app;
    ValidatorRegistry public registry;
    MockWETH public weth;
    MockToken public usdc;
    MockDex public dex;

    // Test accounts
    address public relayerAddr;
    uint256 public relayerKey;
    address public userAddr;
    uint256 public userKey;
    address public feeCollector;

    address[] public validatorAddrs;
    uint256[] public validatorKeys;

    bytes32 public DOMAIN_SEPARATOR;

    function setUp() public {
        // Deterministic accounts
        (relayerAddr, relayerKey) = makeAddrAndKey("relayer");
        (userAddr, userKey) = makeAddrAndKey("user");
        feeCollector = makeAddr("feeCollector");

        // 3 validators
        for (uint256 i = 0; i < 3; i++) {
            (address addr, uint256 key) = makeAddrAndKey(
                string(abi.encodePacked("validator", vm.toString(i)))
            );
            validatorAddrs.push(addr);
            validatorKeys.push(key);
        }
        _sortValidators();

        // Deploy tokens
        weth = new MockWETH();
        usdc = new MockToken("USD Coin", "USDC", 6);

        // Deploy DEX and fund with reserves
        dex = new MockDex();
        usdc.mint(address(dex), 100_000_000e6);

        // Deploy registry + app.
        // App-paid protocol fees by default: the user only ever needs to
        // approve `amountIn` of `tokenIn`. The app sources the protocol fee
        // in WETH from swap surplus when possible, otherwise from its
        // paymaster (defaulted to feeCollector here).
        registry = new ValidatorRegistry(relayerAddr, validatorAddrs, 8000);
        app = new DexAggregatorApp(
            relayerAddr,
            address(registry),
            5000,  // scoreThreshold (quorum sourced from ValidatorRegistry)
            address(weth),   // wrappedNativeToken (WETH for platform fees)
            relayerAddr,     // platformFeeCollector (subnet treasury proxy)
            0,               // minPlatformFeeWei (no floor in tests)
            0.1 ether,       // maxPlatformFeeWei
            AppIntentBase.FeeMode.APP,   // app pays, user is WETH-unaware
            address(0),                  // appPaymaster (defaults to feeCollector)
            address(0),                  // appRegistry — gate off for these tests
            feeCollector,
            5000   // feeBps: 50% of positive slippage
        );

        DOMAIN_SEPARATOR = app.DOMAIN_SEPARATOR();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     CONSTRUCTOR / ADMIN TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_constructor() public view {
        assertEq(app.feeBps(), 5000);
        assertEq(app.feeCollector(), feeCollector);
        assertEq(app.volumeCapBps(), 98, "volume cap defaults to 0.98%");
        assertEq(app.DEFAULT_VOLUME_CAP_BPS(), 98);
        assertTrue(app.registeredIntents(app.SWAP_SELECTOR()));
    }

    function test_constructor_revert_zeroFeeCollector() public {
        vm.expectRevert("Invalid fee collector");
        new DexAggregatorApp(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBase.FeeMode.APP, address(0),
            address(0),  // appRegistry
            address(0), 5000
        );
    }

    function test_constructor_revert_feeTooHigh() public {
        vm.expectRevert("Fee too high");
        new DexAggregatorApp(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBase.FeeMode.APP, address(0),
            address(0),  // appRegistry
            feeCollector, 10001
        );
    }

    function test_setFeeCollector() public {
        address newCollector = makeAddr("newCollector");
        vm.prank(relayerAddr);
        app.setFeeCollector(newCollector);
        assertEq(app.feeCollector(), newCollector);
    }

    function test_setFeeCollector_revert_zero() public {
        vm.prank(relayerAddr);
        vm.expectRevert("Invalid fee collector");
        app.setFeeCollector(address(0));
    }

    function test_setFeeBps() public {
        vm.prank(relayerAddr);
        app.setFeeBps(3000);
        assertEq(app.feeBps(), 3000);
    }

    function test_setFeeBps_revert_tooHigh() public {
        vm.prank(relayerAddr);
        vm.expectRevert("Fee too high");
        app.setFeeBps(10001);
    }

    function test_setVolumeCapBps() public {
        vm.prank(relayerAddr);
        app.setVolumeCapBps(50);
        assertEq(app.volumeCapBps(), 50);
    }

    function test_setVolumeCapBps_revert_tooHigh() public {
        vm.prank(relayerAddr);
        vm.expectRevert("Cap too high");
        app.setVolumeCapBps(10001);
    }

    function test_setVolumeCapBps_revert_nonRelayer() public {
        vm.expectRevert("Only relayer");
        app.setVolumeCapBps(50);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     PLATFORM FEE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_platformFee_collected() public {
        // In APP mode (the default for DexAggregatorApp) the end user is
        // unaware of Bittensor and only ever approves ``amountIn`` of
        // ``tokenIn``. The protocol fee is paid in the wrapped native token
        // (WETH here) and is sourced by the app from two places, in order:
        //
        //   1. The swap output, when ``tokenOut == WETH`` AND the swap
        //      surplus is at least ``platformFee`` above ``minAmountOut``.
        //      No paymaster touch, no extra approval — atomic with the swap.
        //   2. The app's paymaster, otherwise. The paymaster (set to
        //      ``feeCollector`` in this fixture) must hold WETH and have
        //      pre-approved the app to pull it. App operator's responsibility
        //      to keep this account funded.
        //
        // This test exercises path (2) because tokenOut is USDC.
        dex.setRate(2000); // 1 WETH = 2000 USDC, surplus over minAmountOut

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        uint256 platformFee = 0.002 ether;

        // KEY: user holds + approves only amountIn — no headroom for the fee.
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // Paymaster (feeCollector) is funded with WETH and approves the app.
        // This is the app operator's working capital — what makes Bittensor
        // invisible to the end user.
        weth.mint(feeCollector, platformFee * 10);
        vm.prank(feeCollector);
        weth.approve(address(app), type(uint256).max);

        bytes32 orderId = keccak256("platform_fee_swap");
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            platformFee,
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex),
            value: 0,
            callData: abi.encodeCall(dex.swap, (
                address(weth), address(usdc), amountIn, 0, address(app)
            ))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        uint256 paymasterWethBefore = weth.balanceOf(feeCollector);

        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "swap must succeed with allowance == amountIn");

        // Stage 1: protocol fee paid to platformFeeCollector in WETH (NOT USDC).
        // The amount is exactly platformFee — no rate-conversion math at the
        // contract layer, because the base verifies WETH-denominated delivery.
        assertEq(weth.balanceOf(relayerAddr), platformFee,
            "protocol fee paid to platformFeeCollector in wrapped native");

        // Stage 2: the paymaster's WETH balance dropped by exactly platformFee.
        // This is the visible cost to the app of running an order where the
        // output token can't cover the fee — paid out of its working capital.
        assertEq(weth.balanceOf(feeCollector), paymasterWethBefore - platformFee,
            "paymaster WETH float decreased by the protocol fee");

        // Stage 3: positive-slippage capture on the FULL output (no platform-
        // fee deduction from gained any more — the protocol fee was paid in
        // WETH, not in tokenOut).
        // gained    = 2000e6
        // surplus   = 200e6 (= 2000e6 - 1800e6)
        // slip fee  = 100e6 (50% of surplus)
        // user      = 1900e6
        // quotedOutput == 0 ⇒ no app fee. The protocol fee was paid in WETH
        // from the paymaster above; the full USDC output goes to the user.
        assertEq(usdc.balanceOf(feeCollector), 0,
            "no app fee when quotedOutput is unset");
        assertEq(usdc.balanceOf(userAddr), 2000e6,
            "user receives full output (no app fee)");

        // No WETH ever left the user beyond amountIn (no separate fee pull).
        assertEq(weth.balanceOf(userAddr), 0, "all user WETH went to the swap");
    }

    function test_platformFee_exceedsCap_reverts() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        uint256 platformFee = 1 ether; // exceeds 0.1 ether cap

        weth.mint(userAddr, amountIn + platformFee);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn + platformFee);

        bytes32 orderId = keccak256("fee_too_high");
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            platformFee,
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](1);
        calls[0] = IAppIntentBase.Call({ target: address(0), value: 0, callData: "" });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls, deadline: order.deadline, nonce: 0, metadata: ""
        });

        vm.prank(relayerAddr);
        vm.expectRevert("Fee exceeds cap");
        app.scoreIntent(order, plan);
    }

    function test_platformFee_zeroFee_noop() public {
        // Verify zero fee doesn't attempt any transfer
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("zero_fee_swap");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        uint256 collectorBefore = weth.balanceOf(relayerAddr);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid);
        assertEq(weth.balanceOf(relayerAddr), collectorBefore, "No platform fee collected");
    }

    function test_platformFee_paidFromPaymaster_whenNoHeadroom() public {
        // When the realised output equals minAmountOut exactly there is no
        // swap surplus to draw the protocol fee from. Under the old design
        // the contract silently dropped the fee — which let apps quietly
        // bypass paying the subnet whenever a solver happened to barely hit
        // the threshold.
        //
        // The new contract NEVER skips: it falls back to the app's paymaster
        // for the WETH-denominated fee. User still receives full minAmountOut
        // in tokenOut. App pays the protocol fee from its working capital.
        dex.setRate(1800); // gained == minAmountOut exactly, no headroom

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        uint256 platformFee = 0.002 ether;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // Paymaster funded + approved.
        weth.mint(feeCollector, platformFee * 10);
        vm.prank(feeCollector);
        weth.approve(address(app), type(uint256).max);

        bytes32 orderId = keccak256("fee_from_paymaster");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);
        order.intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            platformFee,
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false
        );

        uint256 paymasterBefore = weth.balanceOf(feeCollector);

        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "swap must succeed - paymaster covers the fee");
        assertEq(weth.balanceOf(relayerAddr), platformFee,
            "protocol fee delivered in WETH from paymaster");
        assertEq(weth.balanceOf(feeCollector), paymasterBefore - platformFee,
            "paymaster float decreased by exactly the protocol fee");
        assertEq(usdc.balanceOf(userAddr), 1800e6, "user receives full minAmountOut");
    }

    function test_platformFee_revertsIfPaymasterUnfunded() public {
        // When the paymaster has no WETH (or no allowance), an APP-mode swap
        // that needs paymaster funding MUST revert — the protocol fee cannot
        // be silently dropped. This is the property that closes the bypass
        // attack: a dev cannot deploy with paymaster=feeCollector, never fund
        // it, and run free orders. They'd just see their orders revert.
        dex.setRate(2000);

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        uint256 platformFee = 0.002 ether;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);
        // Paymaster intentionally NOT funded/approved.

        bytes32 orderId = keccak256("fee_paymaster_dry");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);
        order.intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            platformFee,
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false
        );

        vm.prank(relayerAddr);
        vm.expectRevert();
        app.scoreIntent(order, plan);
    }

    function test_platformFee_adminSetCollector() public {
        address newCollector = makeAddr("treasury");
        vm.prank(relayerAddr);
        app.setPlatformFeeCollector(newCollector);
        assertEq(app.platformFeeCollector(), newCollector);
    }

    function test_platformFee_adminSetMaxFee() public {
        vm.prank(relayerAddr);
        app.setMaxPlatformFeeWei(0.5 ether);
        assertEq(app.maxPlatformFeeWei(), 0.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     BASIC SWAP VIA SCOREINTENT
    // ═══════════════════════════════════════════════════════════════════════

    function test_basicSwap_scoreIntent() public {
        // Setup: user has WETH, approves app
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // Build order + plan
        bytes32 orderId = keccak256("basic_swap");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        // Call scoreIntent (simulation mode — relayer only, no user signatures needed)
        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "Should be valid");
        assertEq(score, 5000, "Score should be 5000 at exactly minAmountOut");

        // Verify tokens delivered
        assertEq(usdc.balanceOf(userAddr), minAmountOut, "User should receive minAmountOut");
        assertEq(usdc.balanceOf(feeCollector), 0, "No fee at exact min output");
    }

    function test_swap_positiveSlippage() public {
        // CoW-style: the app fee is a share of improvement OVER the quoted
        // output, not over minAmountOut. Execution (2160) beats the quote
        // (2120) by 40 USDC; the app takes 50% of that 40 = 20 USDC. Uncapped
        // here because 20 < the 0.98% volume cap (~21.17 USDC).
        dex.setRate(2160); // 1 WETH = 2160 USDC

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        uint256 quotedOutput = 2120e6; // what we quoted the user (net)
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("slippage_swap");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapWithQuote(orderId, amountIn, minAmountOut, userAddr, app, quotedOutput);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid);
        assertGt(score, 5000, "Score should be above 5000 with surplus");

        // improvement = 2160 - 2120 = 40 USDC; fee = 50% = 20 USDC (uncapped)
        assertEq(usdc.balanceOf(feeCollector), 20e6, "app fee = 50% of improvement over quote");
        assertEq(usdc.balanceOf(userAddr), 2140e6, "user gets gained - app fee");
    }

    function test_swap_noFeeWhenZeroFeeBps() public {
        // Deploy app with 0% positive-slippage fee
        DexAggregatorApp noFeeApp = new DexAggregatorApp(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBase.FeeMode.APP, address(0),
            address(0),  // appRegistry
            feeCollector, 0
        );

        dex.setRate(2160); // 20% surplus
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(noFeeApp), amountIn);

        bytes32 orderId = keccak256("no_fee_swap");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlanForApp(orderId, amountIn, minAmountOut, userAddr, noFeeApp);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = noFeeApp.scoreIntent(order, plan);

        assertTrue(valid);
        // User gets entire output (2160 USDC), no fee
        assertEq(usdc.balanceOf(userAddr), 2160e6, "User gets full output");
        assertEq(usdc.balanceOf(feeCollector), 0, "No fee");
    }

    function test_swap_belowMinimum_reverts() public {
        // Set DEX rate to give less than minimum
        dex.setRate(1700); // 1 WETH = 1700 USDC (below 1800 min)

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("bad_swap");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertFalse(valid, "Should fail: output below minimum");
        assertEq(score, 0);
    }

    function test_swap_sameToken_reverts() public {
        uint256 amountIn = 1e18;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("same_token");
        bytes memory intentParams = abi.encode(
            address(weth), address(weth), amountIn, uint256(1e18), userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](0);
        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        vm.prank(relayerAddr);
        vm.expectRevert("Same token");
        app.scoreIntent(order, plan);
    }

    function test_swap_differentReceiver() public {
        address receiver = makeAddr("receiver");

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("diff_receiver");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, receiver);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid);
        assertEq(usdc.balanceOf(receiver), minAmountOut, "Receiver gets tokens");
        assertEq(usdc.balanceOf(userAddr), 0, "User doesn't get tokens");
    }

    function test_swap_returnsRemainingInput() public {
        // DEX only consumes 0.5 WETH, returns 900 USDC
        // User sent 1 WETH, so 0.5 WETH should be returned
        // We'll use a partial swap by having the DEX consume less

        // Deploy a partial-consuming DEX
        PartialDex partialDex = new PartialDex();
        usdc.mint(address(partialDex), 10_000_000e6);

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 900e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("partial_swap");
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        // Plan: approve partialDex, swap only 0.5 WETH, and transfer remaining 0.5 WETH back to user
        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](3);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(partialDex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(partialDex),
            value: 0,
            callData: abi.encodeCall(partialDex.swapPartial, (
                address(weth), address(usdc), 0.5e18, 900e6, address(app)
            ))
        });
        calls[2] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.transfer, (userAddr, 0.5e18))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid);
        assertEq(usdc.balanceOf(userAddr), 900e6, "User gets USDC");
        assertEq(weth.balanceOf(userAddr), 0.5e18, "User gets remaining WETH back");
    }

    function test_swap_maxScore() public {
        // Give user 3600+ USDC (>= 2x minAmountOut) → max score
        dex.setRate(3600); // 2x rate

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("max_score");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid);
        assertEq(score, 10000, "Max score at 2x min output");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     FULL EXECUTEINTENT FLOW
    // ═══════════════════════════════════════════════════════════════════════

    function test_fullExecuteIntent() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        // Setup
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // Build order
        bytes32 orderId = keccak256("full_e2e");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        // Sign user order
        bytes memory userSig = _signOrder(order, userKey);

        // Sign validator approvals
        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 scoreThreshold = app.scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(orderId, planHash, scoreThreshold, validatorKeys[i]);
        }

        // Execute
        vm.prank(relayerAddr);
        app.executeIntent(order, plan, userSig, validatorSigs);

        // Verify
        assertEq(usdc.balanceOf(userAddr), minAmountOut, "User gets USDC");
        assertEq(weth.balanceOf(userAddr), 0, "WETH consumed");
        assertEq(app.nonces(userAddr), 1, "Nonce incremented");
        assertTrue(app.executedOrders(orderId), "Order marked executed");
    }

    function test_fullExecuteIntent_withSlippage() public {
        dex.setRate(2000); // ~11% surplus

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("e2e_slippage");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        bytes memory userSig = _signOrder(order, userKey);
        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 scoreThreshold = app.scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(orderId, planHash, scoreThreshold, validatorKeys[i]);
        }

        vm.prank(relayerAddr);
        app.executeIntent(order, plan, userSig, validatorSigs);

        // Output: 2000 USDC. quotedOutput == 0 in this order ⇒ no app fee.
        assertEq(usdc.balanceOf(userAddr), 2000e6, "user gets full output (no app fee)");
        assertEq(usdc.balanceOf(feeCollector), 0, "no app fee when quotedOutput unset");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_swapExecutedEvent() public {
        dex.setRate(2000);

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("event_test");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        vm.prank(relayerAddr);
        vm.expectEmit(true, true, false, true);
        emit DexAggregatorApp.SwapExecuted(
            orderId, userAddr, address(weth), address(usdc), amountIn, 2000e6, 0
        );
        app.scoreIntent(order, plan);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     ERC-2612 PERMIT TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_swap_withPermit() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);

        // No pre-approval — rely solely on permit

        // Build ERC-2612 permit signature
        uint256 permitDeadline = block.timestamp + 3600;
        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 domainSep = weth.DOMAIN_SEPARATOR();
        bytes32 structHash = keccak256(abi.encode(
            permitTypehash,
            userAddr,
            address(app),
            amountIn,
            weth.nonces(userAddr),
            permitDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, digest);

        // Encode intent params with permit fields
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            permitDeadline, v, r, s,
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        bytes32 orderId = keccak256("permit_swap");
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex),
            value: 0,
            callData: abi.encodeCall(dex.swap, (
                address(weth), address(usdc), amountIn, 0, address(app)
            ))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "Permit swap should succeed");
        assertEq(score, 5000, "Score should be 5000 at exactly minAmountOut");
        assertEq(usdc.balanceOf(userAddr), minAmountOut, "User should receive tokens");
        assertEq(weth.balanceOf(userAddr), 0, "WETH consumed");
    }

    function test_swap_permitFails_fallsBackToApproval() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);

        // Pre-approve (the fallback)
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // Encode with a bad permit (wrong v/r/s but non-zero deadline triggers attempt)
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(block.timestamp + 3600), uint8(27), bytes32(uint256(1)), bytes32(uint256(2)),
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        bytes32 orderId = keccak256("bad_permit_swap");
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex),
            value: 0,
            callData: abi.encodeCall(dex.swap, (
                address(weth), address(usdc), amountIn, 0, address(app)
            ))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        // Bad permit is silently caught, falls back to approve()
        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "Should succeed via approval fallback");
        assertEq(score, 5000);
        assertEq(usdc.balanceOf(userAddr), minAmountOut, "User should receive tokens");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                     SECURITY TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_scoreIntent_revert_nonRelayer() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("nonrelayer_score");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        // Calling without relayer should revert
        vm.expectRevert("Only relayer");
        app.scoreIntent(order, plan);

        // Random address should also revert
        vm.prank(makeAddr("attacker"));
        vm.expectRevert("Only relayer");
        app.scoreIntent(order, plan);
    }

    function test_perpetualOrder_multiExecution() public {
        dex.setRate(1800);

        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        // Mint enough for 2 executions
        weth.mint(userAddr, amountIn * 2);
        vm.prank(userAddr);
        weth.approve(address(app), type(uint256).max);

        bytes32 orderId = keccak256("perpetual_dex");
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: true,
            maxExecutions: 3,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex),
            value: 0,
            callData: abi.encodeCall(dex.swap, (
                address(weth), address(usdc), amountIn, 0, address(app)
            ))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        // First execution
        bytes memory userSig = _signOrder(order, userKey);
        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 scoreThreshold = app.scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(orderId, planHash, scoreThreshold, validatorKeys[i]);
        }

        vm.prank(relayerAddr);
        app.executeIntent(order, plan, userSig, validatorSigs);
        assertEq(app.executionCounts(orderId), 1);

        // Second execution — should succeed with new salt (no CREATE2 collision)
        order.nonce = 1;
        userSig = _signOrder(order, userKey);

        vm.prank(relayerAddr);
        app.executeIntent(order, plan, userSig, validatorSigs);
        assertEq(app.executionCounts(orderId), 2, "Second perpetual execution should succeed");
        assertEq(usdc.balanceOf(userAddr), minAmountOut * 2, "User gets tokens from both executions");
    }

    function test_executeIntent_revert_wrongChain() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("wrong_chain");
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: 999, // Wrong chain
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](0);
        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        bytes memory userSig = _signOrder(order, userKey);
        bytes[] memory validatorSigs = new bytes[](0);

        vm.prank(relayerAddr);
        vm.expectRevert("Wrong chain");
        app.executeIntent(order, plan, userSig, validatorSigs);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                    MULTI-LEG / BRIDGE TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_bridge_scoreIntent() public {
        // Setup: user has WETH, approves app. Bridge = a mock contract that receives tokens.
        uint256 amountIn = 1e18;
        uint256 minBridged = 1e18;  // expect all tokens to reach bridge
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        // The "bridge contract" is just an address that receives tokens
        address bridgeContract = makeAddr("bridge");

        bytes memory intentParams = abi.encode(
            address(weth), amountIn, minBridged, userAddr,
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        bytes32 orderId = keccak256("bridge_test");
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.BRIDGE_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: type(uint256).max,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        // Plan: approve bridge, then transfer all tokens to bridge
        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (bridgeContract, amountIn))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.transfer, (bridgeContract, amountIn))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        // Call scoreIntent — should succeed
        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertTrue(valid, "Bridge should be valid");
        assertGe(score, 5000, "Score should be >= 5000");
        assertEq(weth.balanceOf(bridgeContract), amountIn, "Bridge should have received all tokens");
    }

    function test_bridge_belowMinimum_reverts() public {
        // Only half the tokens reach the bridge — should fail invariant
        uint256 amountIn = 1e18;
        uint256 minBridged = 1e18;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        address bridgeContract = makeAddr("bridge2");

        bytes memory intentParams = abi.encode(
            address(weth), amountIn, minBridged, userAddr,
            uint256(0), // platformFeeWei
            uint256(0), // quotedOutput (0 ⇒ no app fee)
            false       // unwrapOutput
        );

        bytes32 orderId = keccak256("bridge_fail");
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(app),
            intentSelector: app.BRIDGE_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: type(uint256).max,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        // Plan only transfers HALF to bridge
        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](1);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.transfer, (bridgeContract, amountIn / 2))
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });

        vm.prank(relayerAddr);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);
        assertFalse(valid, "Should fail - only half bridged");
        assertEq(score, 0, "Score should be 0");
    }

    function test_executeLeg_basic() public {
        // Test executeLeg (renamed from executeCrossChainLeg)
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);

        bytes32 orderId = keccak256("leg_test");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        // Sign
        bytes memory userSig = _signOrder(order, userKey);
        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 st = app.scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(orderId, planHash, st, validatorKeys[i]);
        }

        // Execute via executeLeg
        vm.prank(relayerAddr);
        app.executeLeg(order, plan, 0, userSig, validatorSigs);

        // Verify leg marked as executed
        assertTrue(app.legExecuted(orderId, 0), "Leg 0 should be marked executed");

        // Verify tokens delivered
        assertEq(usdc.balanceOf(userAddr), minAmountOut, "User should receive output");
    }

    function test_executeLeg_replay_reverts() public {
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;
        weth.mint(userAddr, 2 * amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), 2 * amountIn);

        bytes32 orderId = keccak256("leg_replay");
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapOrderAndPlan(orderId, amountIn, minAmountOut, userAddr);

        bytes memory userSig = _signOrder(order, userKey);
        bytes32 planHash = EIP712Verifier.hashPlanMem(plan);
        uint256 st = app.scoreThreshold();
        bytes[] memory validatorSigs = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) {
            validatorSigs[i] = _signPlanApproval(orderId, planHash, st, validatorKeys[i]);
        }

        // First execution succeeds
        vm.prank(relayerAddr);
        app.executeLeg(order, plan, 0, userSig, validatorSigs);

        // Second execution reverts — replay protection
        vm.expectRevert("Leg already executed");
        vm.prank(relayerAddr);
        app.executeLeg(order, plan, 0, userSig, validatorSigs);
    }

    function test_executeLeg_differentOrderIds() public {
        // Multi-leg: each leg uses a different orderId to avoid proxy salt collision.
        // In production, the platform generates unique orderId per leg.
        uint256 amountIn = 1e18;
        uint256 minAmountOut = 1800e6;

        // Leg 0
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);
        bytes32 orderId0 = keccak256("multi_leg_0");
        (IAppIntentBase.IntentOrder memory order0, IAppIntentBase.ExecutionPlan memory plan0) =
            _buildSwapOrderAndPlan(orderId0, amountIn, minAmountOut, userAddr);
        bytes memory userSig0 = _signOrder(order0, userKey);
        bytes32 planHash0 = EIP712Verifier.hashPlanMem(plan0);
        uint256 st = app.scoreThreshold();
        bytes[] memory valSigs0 = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) valSigs0[i] = _signPlanApproval(orderId0, planHash0, st, validatorKeys[i]);
        vm.prank(relayerAddr);
        app.executeLeg(order0, plan0, 0, userSig0, valSigs0);
        assertTrue(app.legExecuted(orderId0, 0));

        // Leg 1 — different orderId, different proxy
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr);
        weth.approve(address(app), amountIn);
        bytes32 orderId1 = keccak256("multi_leg_1");
        (IAppIntentBase.IntentOrder memory order1, IAppIntentBase.ExecutionPlan memory plan1) =
            _buildSwapOrderAndPlan(orderId1, amountIn, minAmountOut, userAddr);
        bytes memory userSig1 = _signOrder(order1, userKey);
        bytes32 planHash1 = EIP712Verifier.hashPlanMem(plan1);
        bytes[] memory valSigs1 = new bytes[](3);
        for (uint256 i = 0; i < 3; i++) valSigs1[i] = _signPlanApproval(orderId1, planHash1, st, validatorKeys[i]);
        vm.prank(relayerAddr);
        app.executeLeg(order1, plan1, 1, userSig1, valSigs1);
        assertTrue(app.legExecuted(orderId1, 1));

        assertEq(usdc.balanceOf(userAddr), 2 * minAmountOut, "Both legs delivered tokens");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //              COW-STYLE APP FEE (improvement over the quote)
    // ═══════════════════════════════════════════════════════════════════════

    function test_appFee_cappedAtVolumeCap() public {
        // Large improvement over the quote: 50% would exceed the 0.98% volume
        // cap, so the fee is clamped down to the cap.
        dex.setRate(2160); // gained = 2160e6
        uint256 amountIn = 1e18; uint256 minOut = 1800e6; uint256 quoted = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr); weth.approve(address(app), amountIn);
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapWithQuote(keccak256("fee_capped"), amountIn, minOut, userAddr, app, quoted);
        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);
        assertTrue(valid);
        // improvement = 360e6; 50% = 180e6; cap = 2160e6*98/10000 = 21.168e6 → fee = cap
        uint256 cap = 2160e6 * 98 / 10000; // 21_168_000
        assertEq(usdc.balanceOf(feeCollector), cap, "fee clamped to 0.98% volume cap");
        assertEq(usdc.balanceOf(userAddr), 2160e6 - cap, "user gets gained - capped fee");
    }

    function test_appFee_clampedToUserMin() public {
        // A tight minOut: the fee may never push the user below the minimum
        // they signed — the (gained - minOut) clamp wins even over the cap.
        dex.setRate(2160); // gained = 2160e6
        uint256 amountIn = 1e18; uint256 minOut = 2150e6; uint256 quoted = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr); weth.approve(address(app), amountIn);
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapWithQuote(keccak256("fee_minclamp"), amountIn, minOut, userAddr, app, quoted);
        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);
        assertTrue(valid);
        // surplusOverMin = 10e6; cap = 21.168e6; 50%*improvement = 180e6
        // → fee = min(180e6, 21.168e6, 10e6) = 10e6; user gets exactly minOut.
        assertEq(usdc.balanceOf(feeCollector), 10e6, "fee clamped to surplus over user min");
        assertEq(usdc.balanceOf(userAddr), minOut, "user always receives at least their signed minimum");
    }

    function test_appFee_zeroAtOrBelowQuote() public {
        // Execution does not beat the quote → no fee.
        dex.setRate(2160); // gained = 2160e6
        uint256 amountIn = 1e18; uint256 minOut = 1800e6; uint256 quoted = 2200e6; // > gained
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr); weth.approve(address(app), amountIn);
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapWithQuote(keccak256("fee_atquote"), amountIn, minOut, userAddr, app, quoted);
        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);
        assertTrue(valid);
        assertEq(usdc.balanceOf(feeCollector), 0, "no fee when execution <= quote");
        assertEq(usdc.balanceOf(userAddr), 2160e6, "user keeps the full output");
    }

    function test_appFee_zeroWhenQuotedUnset() public {
        // quotedOutput == 0 disables the app fee even with large surplus.
        dex.setRate(2160);
        uint256 amountIn = 1e18; uint256 minOut = 1800e6;
        weth.mint(userAddr, amountIn);
        vm.prank(userAddr); weth.approve(address(app), amountIn);
        (IAppIntentBase.IntentOrder memory order, IAppIntentBase.ExecutionPlan memory plan) =
            _buildSwapWithQuote(keccak256("fee_noquote"), amountIn, minOut, userAddr, app, 0);
        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);
        assertTrue(valid);
        assertEq(usdc.balanceOf(feeCollector), 0, "no fee when quotedOutput is 0");
        assertEq(usdc.balanceOf(userAddr), 2160e6, "user keeps the full output");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //              AUTO-UNWRAP NATIVE OUTPUT (Ethereum + Base)
    // ═══════════════════════════════════════════════════════════════════════

    function test_swap_unwrapNativeOutput_withFee() public {
        // tokenOut == WETH and unwrapOutput == true → the user must receive
        // NATIVE ETH, not WETH. Exercises the auto-unwrap path (IWETH.withdraw
        // + native send) together with the CoW-style app fee, which stays in
        // WETH at the feeCollector. Same code on Ethereum and Base — only
        // wrappedNativeToken differs by chain.
        MockDex wdex = new MockDex();
        wdex.setDecimals(18, 18);
        wdex.setRate(1);                 // 1:1 (mock units)
        weth.mint(address(wdex), 10e18); // WETH reserves for the dex to pay out
        vm.deal(address(weth), 5e18);    // ETH backing the MockWETH.withdraw()

        uint256 amountIn = 2e18;
        uint256 minOut = 1.5e18;
        uint256 quoted = 1.99e18;        // improvement = 0.01e18 → fee = 0.005e18 (uncapped)

        usdc.mint(userAddr, amountIn);
        vm.prank(userAddr);
        usdc.approve(address(app), amountIn);

        bytes memory intentParams = abi.encode(
            address(usdc), address(weth), amountIn, minOut, userAddr,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0),  // platformFeeWei (none — focus on app fee + unwrap)
            quoted,      // quotedOutput
            true         // unwrapOutput → deliver native ETH
        );

        bytes32 orderId = keccak256("unwrap_swap");
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: orderId, app: address(app), intentSelector: app.SWAP_SELECTOR(),
            intentParams: intentParams, submittedBy: userAddr, chainId: block.chainid,
            deadline: block.timestamp + 3600, nonce: 0, perpetual: false,
            maxExecutions: 1, cooldown: 0
        });

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(usdc), value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(wdex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(wdex), value: 0,
            callData: abi.encodeCall(wdex.swap, (address(usdc), address(weth), amountIn, 0, address(app)))
        });
        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls, deadline: order.deadline, nonce: 0, metadata: ""
        });

        uint256 userEthBefore = userAddr.balance;

        vm.prank(relayerAddr);
        (, bool valid) = app.scoreIntent(order, plan);
        assertTrue(valid, "unwrap swap should succeed");

        // gained = 2e18 WETH; improvement = 0.01e18; fee = 0.005e18 (uncapped).
        uint256 expectedFee = 0.005e18;
        uint256 expectedUser = 2e18 - expectedFee; // delivered as native ETH

        assertEq(userAddr.balance - userEthBefore, expectedUser, "user receives native ETH (unwrapped)");
        assertEq(weth.balanceOf(userAddr), 0, "user holds no WETH (it was unwrapped)");
        assertEq(weth.balanceOf(feeCollector), expectedFee, "app fee stays in WETH at feeCollector");
        assertEq(weth.balanceOf(address(app)), 0, "app holds no residual WETH");
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _buildSwapOrderAndPlan(
        bytes32 orderId,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver
    ) internal view returns (
        IAppIntentBase.IntentOrder memory order,
        IAppIntentBase.ExecutionPlan memory plan
    ) {
        return _buildSwapOrderAndPlanForApp(orderId, amountIn, minAmountOut, receiver, app);
    }

    function _buildSwapOrderAndPlanForApp(
        bytes32 orderId,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        DexAggregatorApp targetApp
    ) internal view returns (
        IAppIntentBase.IntentOrder memory order,
        IAppIntentBase.ExecutionPlan memory plan
    ) {
        // Default: quotedOutput = 0 ⇒ no app fee (keeps fee-agnostic tests simple)
        return _buildSwapWithQuote(orderId, amountIn, minAmountOut, receiver, targetApp, 0);
    }

    function _buildSwapWithQuote(
        bytes32 orderId,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        DexAggregatorApp targetApp,
        uint256 quotedOutput
    ) internal view returns (
        IAppIntentBase.IntentOrder memory order,
        IAppIntentBase.ExecutionPlan memory plan
    ) {
        bytes memory intentParams = abi.encode(
            address(weth), address(usdc), amountIn, minAmountOut, receiver,
            uint256(0), uint8(0), bytes32(0), bytes32(0),
            uint256(0),   // platformFeeWei (fee trailer)
            quotedOutput, // quotedOutput — CoW-style app-fee reference
            false         // unwrapOutput
        );

        order = IAppIntentBase.IntentOrder({
            orderId: orderId,
            app: address(targetApp),
            intentSelector: targetApp.SWAP_SELECTOR(),
            intentParams: intentParams,
            submittedBy: userAddr,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: 0,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0
        });

        // Plan: approve dex, then call dex.swap(weth, usdc, amountIn, 0, targetApp)
        // Output goes to app for fee capture, then _checkIntent delivers to receiver
        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: address(weth),
            value: 0,
            callData: abi.encodeCall(IERC20.approve, (address(dex), type(uint256).max))
        });
        calls[1] = IAppIntentBase.Call({
            target: address(dex),
            value: 0,
            callData: abi.encodeCall(dex.swap, (
                address(weth), address(usdc), amountIn, 0, address(targetApp)
            ))
        });

        plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: order.deadline,
            nonce: 0,
            metadata: ""
        });
    }

    function _signOrder(
        IAppIntentBase.IntentOrder memory order,
        uint256 privateKey
    ) internal view returns (bytes memory) {
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPlanApproval(
        bytes32 orderId,
        bytes32 planHash,
        uint256 score,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            EIP712Verifier.PLAN_APPROVAL_TYPEHASH,
            orderId,
            planHash,
            score
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
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
}

/// @title PartialDex - Consumes only a portion of input
contract PartialDex {
    function swapPartial(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        address recipient
    ) external {
        IERC20(inputToken).transferFrom(msg.sender, address(this), inputAmount);
        IERC20(outputToken).transfer(recipient, outputAmount);
    }
}

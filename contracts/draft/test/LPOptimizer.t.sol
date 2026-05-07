// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/LPOptimizerApp.sol";
import "../src/ValidatorRegistry.sol";
import "./mocks/MockToken.sol";

// ── Mock V3 Pool ────────────────────────────────────────────────────────────

contract MockV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;
    int24 public currentTick;

    constructor(address _t0, address _t1, uint24 _fee) {
        (token0, token1) = _t0 < _t1 ? (_t0, _t1) : (_t1, _t0);
        fee = _fee;
        currentTick = 0;
    }

    function setTick(int24 _tick) external { currentTick = _tick; }

    function slot0() external view returns (
        uint160, int24, uint16, uint16, uint16, uint8, bool
    ) {
        return (79228162514264337593543950336, currentTick, 0, 1, 1, 0, true);
    }

    function tickSpacing() external pure returns (int24) { return 60; }
}

// ── Mock V3 Factory ─────────────────────────────────────────────────────────

contract MockV3Factory {
    mapping(bytes32 => address) public pools;

    function setPool(address t0, address t1, uint24 fee, address pool) external {
        (address a, address b) = t0 < t1 ? (t0, t1) : (t1, t0);
        pools[keccak256(abi.encode(a, b, fee))] = pool;
    }

    function getPool(address t0, address t1, uint24 fee) external view returns (address) {
        (address a, address b) = t0 < t1 ? (t0, t1) : (t1, t0);
        return pools[keccak256(abi.encode(a, b, fee))];
    }
}

// ── Mock V3 PositionManager ─────────────────────────────────────────────────

contract MockPositionManager {
    using SafeERC20 for IERC20;

    uint256 public nextTokenId = 1;

    struct StoredPosition {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    mapping(uint256 => StoredPosition) public storedPositions;
    mapping(uint256 => address) public owners;

    // Accumulated "fees" for testing compound
    mapping(uint256 => uint256) public pendingFees0;
    mapping(uint256 => uint256) public pendingFees1;
    mapping(uint256 => uint256) public owed0;
    mapping(uint256 => uint256) public owed1;

    function setFees(uint256 tokenId, uint256 f0, uint256 f1) external {
        pendingFees0[tokenId] = f0;
        pendingFees1[tokenId] = f1;
    }

    function mint(INonfungiblePositionManager.MintParams calldata params)
        external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        tokenId = nextTokenId++;

        // Pull tokens
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        if (amount0 > 0) IERC20(params.token0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(params.token1).safeTransferFrom(msg.sender, address(this), amount1);

        // Simplified liquidity = sqrt(amount0 * amount1)
        liquidity = uint128(_sqrt(amount0 * amount1));
        if (liquidity == 0 && (amount0 > 0 || amount1 > 0)) liquidity = 1;

        storedPositions[tokenId] = StoredPosition({
            token0: params.token0, token1: params.token1, fee: params.fee,
            tickLower: params.tickLower, tickUpper: params.tickUpper,
            liquidity: liquidity
        });
        owners[tokenId] = params.recipient;

        // Callback for ERC721
        if (params.recipient.code.length > 0) {
            IERC721Receiver(params.recipient).onERC721Received(msg.sender, address(0), tokenId, "");
        }
    }

    function increaseLiquidity(INonfungiblePositionManager.IncreaseLiquidityParams calldata params)
        external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        StoredPosition storage pos = storedPositions[params.tokenId];
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
        if (amount0 > 0) IERC20(pos.token0).safeTransferFrom(msg.sender, address(this), amount0);
        if (amount1 > 0) IERC20(pos.token1).safeTransferFrom(msg.sender, address(this), amount1);

        liquidity = uint128(_sqrt(amount0 * amount1));
        if (liquidity == 0 && (amount0 > 0 || amount1 > 0)) liquidity = 1;
        pos.liquidity += liquidity;
    }

    function decreaseLiquidity(INonfungiblePositionManager.DecreaseLiquidityParams calldata params)
        external payable returns (uint256 amount0, uint256 amount1)
    {
        StoredPosition storage pos = storedPositions[params.tokenId];
        require(params.liquidity <= pos.liquidity, "Not enough liquidity");

        // Compute proportional tokens owed
        uint256 total0 = IERC20(pos.token0).balanceOf(address(this));
        uint256 total1 = IERC20(pos.token1).balanceOf(address(this));

        amount0 = (total0 * params.liquidity) / (pos.liquidity > 0 ? pos.liquidity : 1);
        amount1 = (total1 * params.liquidity) / (pos.liquidity > 0 ? pos.liquidity : 1);

        pos.liquidity -= params.liquidity;
        // Track owed amounts (delivered by collect)
        owed0[params.tokenId] += amount0;
        owed1[params.tokenId] += amount1;
    }

    function collect(INonfungiblePositionManager.CollectParams calldata params)
        external payable returns (uint256 amount0, uint256 amount1)
    {
        StoredPosition storage pos = storedPositions[params.tokenId];

        // Deliver owed liquidity tokens
        amount0 = owed0[params.tokenId];
        amount1 = owed1[params.tokenId];
        owed0[params.tokenId] = 0;
        owed1[params.tokenId] = 0;

        // Add pending fees (mock: mint fee tokens)
        if (pendingFees0[params.tokenId] > 0) {
            MockToken(pos.token0).mint(address(this), pendingFees0[params.tokenId]);
            amount0 += pendingFees0[params.tokenId];
            pendingFees0[params.tokenId] = 0;
        }
        if (pendingFees1[params.tokenId] > 0) {
            MockToken(pos.token1).mint(address(this), pendingFees1[params.tokenId]);
            amount1 += pendingFees1[params.tokenId];
            pendingFees1[params.tokenId] = 0;
        }

        if (amount0 > uint256(params.amount0Max)) amount0 = uint256(params.amount0Max);
        if (amount1 > uint256(params.amount1Max)) amount1 = uint256(params.amount1Max);

        if (amount0 > 0) IERC20(pos.token0).safeTransfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(pos.token1).safeTransfer(params.recipient, amount1);
    }

    function burn(uint256 tokenId) external payable {
        require(storedPositions[tokenId].liquidity == 0, "Not empty");
        delete storedPositions[tokenId];
        delete owners[tokenId];
    }

    function positions(uint256 tokenId) external view returns (
        uint96, address, address, address, uint24, int24, int24, uint128,
        uint256, uint256, uint128, uint128
    ) {
        StoredPosition storage p = storedPositions[tokenId];
        return (0, address(0), p.token0, p.token1, p.fee, p.tickLower, p.tickUpper, p.liquidity, 0, 0, 0, 0);
    }

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
        return y;
    }
}

// ── Test contract ───────────────────────────────────────────────────────────

contract LPOptimizerTest is Test {
    LPOptimizerApp public app;
    ValidatorRegistry public registry;
    MockToken public tokenA; // will be token0 or token1 depending on sort
    MockToken public tokenB;
    MockToken public weth;
    MockV3Pool public pool;
    MockV3Factory public v3Factory;
    MockPositionManager public pm;

    address public relayer;
    address public user;
    address public feeCollector;

    function setUp() public {
        relayer = makeAddr("relayer");
        user = makeAddr("user");
        feeCollector = makeAddr("feeCollector");

        // Deploy tokens
        tokenA = new MockToken("Token A", "TKA", 18);
        tokenB = new MockToken("Token B", "TKB", 18);
        weth = new MockToken("WETH", "WETH", 18);

        // Deploy V3 mocks
        pm = new MockPositionManager();
        v3Factory = new MockV3Factory();
        pool = new MockV3Pool(address(tokenA), address(tokenB), 3000);
        v3Factory.setPool(address(tokenA), address(tokenB), 3000, address(pool));

        // Deploy validator registry
        address[] memory validators = new address[](1);
        validators[0] = relayer;
        registry = new ValidatorRegistry(relayer, validators);

        // Deploy app
        app = new LPOptimizerApp(
            relayer,
            address(registry),
            8000,  // quorumBps
            5000,  // scoreThreshold
            address(weth),
            relayer,          // platformFeeCollector
            0.1 ether,        // maxPlatformFeeWei
            address(pm),
            address(v3Factory),
            feeCollector,
            500               // feeBps = 5%
        );

        // Fund user
        tokenA.mint(user, 100 ether);
        tokenB.mint(user, 100 ether);
    }

    // ── Deposit tests ───────────────────────────────────────────────────────

    function test_deposit() public {
        vm.startPrank(user);
        tokenA.approve(address(app), 10 ether);
        tokenB.approve(address(app), 10 ether);
        app.deposit(address(pool), 10 ether, 10 ether, -600, 600);
        vm.stopPrank();

        LPOptimizerApp.Position memory pos = app.getPosition(user, address(pool));
        assertGt(pos.tokenId, 0);
        assertGt(pos.liquidity, 0);
        assertEq(pos.tickLower, -600);
        assertEq(pos.tickUpper, 600);
        assertEq(pos.token0, pool.token0());
        assertEq(pos.token1, pool.token1());
    }

    function test_deposit_revertsIfPositionExists() public {
        vm.startPrank(user);
        tokenA.approve(address(app), 20 ether);
        tokenB.approve(address(app), 20 ether);
        app.deposit(address(pool), 10 ether, 10 ether, -600, 600);
        vm.expectRevert("Position exists");
        app.deposit(address(pool), 10 ether, 10 ether, -1200, 1200);
        vm.stopPrank();
    }

    function test_deposit_revertsZeroAmounts() public {
        vm.prank(user);
        vm.expectRevert("Zero amounts");
        app.deposit(address(pool), 0, 0, -600, 600);
    }

    function test_deposit_revertsInvalidPool() public {
        MockV3Pool fakePool = new MockV3Pool(address(tokenA), address(tokenB), 3000);
        // NOT registered in factory
        vm.startPrank(user);
        tokenA.approve(address(app), 10 ether);
        tokenB.approve(address(app), 10 ether);
        vm.expectRevert("Invalid pool");
        app.deposit(address(fakePool), 10 ether, 10 ether, -600, 600);
        vm.stopPrank();
    }

    // ── Withdraw tests ──────────────────────────────────────────────────────

    function test_withdraw() public {
        vm.startPrank(user);
        tokenA.approve(address(app), 10 ether);
        tokenB.approve(address(app), 10 ether);
        app.deposit(address(pool), 10 ether, 10 ether, -600, 600);

        uint256 balA_before = tokenA.balanceOf(user);
        uint256 balB_before = tokenB.balanceOf(user);

        app.withdraw(address(pool));
        vm.stopPrank();

        // User got tokens back
        assertGt(tokenA.balanceOf(user), balA_before);
        assertGt(tokenB.balanceOf(user), balB_before);

        // Position cleared
        LPOptimizerApp.Position memory pos = app.getPosition(user, address(pool));
        assertEq(pos.tokenId, 0);
    }

    function test_withdraw_revertsNoPosition() public {
        vm.prank(user);
        vm.expectRevert("No position");
        app.withdraw(address(pool));
    }

    // ── Rebalance via scoreIntent (simulation path) ─────────────────────────

    function test_scoreIntent_rebalance() public {
        // Deposit first
        vm.startPrank(user);
        tokenA.approve(address(app), 10 ether);
        tokenB.approve(address(app), 10 ether);
        app.deposit(address(pool), 10 ether, 10 ether, -600, 600);
        vm.stopPrank();

        // Build intent order for rebalance
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: keccak256("test-rebalance"),
            app: address(app),
            intentSelector: app.REBALANCE_SELECTOR(),
            intentParams: abi.encode(address(pool), int24(-1200), int24(1200)),
            submittedBy: user,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: type(uint256).max,
            perpetual: true,
            maxExecutions: 100,
            cooldown: 3600
        });

        // Build plan: proxy sends tokens back to the app (no actual swap in test)
        address token0 = pool.token0();
        address token1 = pool.token1();

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: token0,
            value: 0,
            callData: abi.encodeWithSignature("transfer(address,uint256)", address(app), 10 ether)
        });
        calls[1] = IAppIntentBase.Call({
            target: token1,
            value: 0,
            callData: abi.encodeWithSignature("transfer(address,uint256)", address(app), 10 ether)
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls,
            deadline: block.timestamp + 3600,
            nonce: 0,
            metadata: ""
        });

        // Call scoreIntent as relayer (simulation mode)
        vm.prank(relayer);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertGt(score, 0);
        assertTrue(valid);
    }

    // ── Compound via scoreIntent ────────────────────────────────────────────

    function test_scoreIntent_compound() public {
        // Deposit
        vm.startPrank(user);
        tokenA.approve(address(app), 10 ether);
        tokenB.approve(address(app), 10 ether);
        app.deposit(address(pool), 10 ether, 10 ether, -600, 600);
        vm.stopPrank();

        LPOptimizerApp.Position memory pos = app.getPosition(user, address(pool));

        // Set pending fees on the position
        pm.setFees(pos.tokenId, 1 ether, 1 ether);

        // Build compound order
        IAppIntentBase.IntentOrder memory order = IAppIntentBase.IntentOrder({
            orderId: keccak256("test-compound"),
            app: address(app),
            intentSelector: app.COMPOUND_SELECTOR(),
            intentParams: abi.encode(address(pool)),
            submittedBy: user,
            chainId: block.chainid,
            deadline: block.timestamp + 3600,
            nonce: type(uint256).max,
            perpetual: true,
            maxExecutions: 1000,
            cooldown: 86400
        });

        // Plan: send fees back to app (no swap needed if ratio is balanced)
        address token0 = pool.token0();
        address token1 = pool.token1();

        IAppIntentBase.Call[] memory calls = new IAppIntentBase.Call[](2);
        calls[0] = IAppIntentBase.Call({
            target: token0, value: 0,
            callData: abi.encodeWithSignature("transfer(address,uint256)", address(app), 0.95 ether) // after 5% fee
        });
        calls[1] = IAppIntentBase.Call({
            target: token1, value: 0,
            callData: abi.encodeWithSignature("transfer(address,uint256)", address(app), 0.95 ether)
        });

        IAppIntentBase.ExecutionPlan memory plan = IAppIntentBase.ExecutionPlan({
            calls: calls, deadline: block.timestamp + 3600, nonce: 0, metadata: ""
        });

        vm.prank(relayer);
        (uint256 score, bool valid) = app.scoreIntent(order, plan);

        assertGt(score, 0);
        assertTrue(valid);

        // Verify fees went to collector
        assertGt(MockToken(token0).balanceOf(feeCollector), 0);
    }

    // ── Intent registration ─────────────────────────────────────────────────

    function test_intentsRegistered() public view {
        assertTrue(app.registeredIntents(app.REBALANCE_SELECTOR()));
        assertTrue(app.registeredIntents(app.COMPOUND_SELECTOR()));
    }

    // ── Access control ──────────────────────────────────────────────────────

    function test_scoreIntent_onlyRelayer() public {
        IAppIntentBase.IntentOrder memory order;
        order.intentSelector = app.REBALANCE_SELECTOR();
        IAppIntentBase.ExecutionPlan memory plan;

        vm.prank(user);
        vm.expectRevert("Only relayer");
        app.scoreIntent(order, plan);
    }

    // ── ERC721 receiver ─────────────────────────────────────────────────────

    function test_onERC721Received() public view {
        bytes4 result = app.onERC721Received(address(0), address(0), 0, "");
        assertEq(result, IERC721Receiver.onERC721Received.selector);
    }
}

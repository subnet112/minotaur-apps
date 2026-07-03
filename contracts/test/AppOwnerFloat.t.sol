// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DexAggregatorAppV2, AppIntentBaseV2} from "../src/v2/DexAggregatorAppV2.sol";
import {ValidatorRegistry} from "minotaur_contracts/src/ValidatorRegistry.sol";
import {MockWETH} from "./DexAggregator.t.sol";

/// @notice appOwner float-recovery rights: the WETH fee float is the app
///         funder's money — recovering it (e.g. to migrate to a new contract
///         version) must not require the relayer's cooperation. The relayer
///         bootstraps appOwner once (no constructor change, so deploy
///         tooling stays argument-compatible); after that the owner can
///         withdraw the float and rotate ownership independently.
contract AppOwnerFloatTest is Test {
    DexAggregatorAppV2 public app;
    MockWETH public weth;
    address public relayerAddr;
    address public owner;
    address public stranger;

    function setUp() public {
        relayerAddr = makeAddr("relayer");
        owner = makeAddr("appOwner");
        stranger = makeAddr("stranger");
        weth = new MockWETH();

        address[] memory vals = new address[](1);
        vals[0] = makeAddr("validator");
        ValidatorRegistry registry = new ValidatorRegistry(relayerAddr, vals, 8000);

        app = new DexAggregatorAppV2(
            relayerAddr, address(registry), 5000,
            address(weth), relayerAddr, 0, 0.1 ether,
            AppIntentBaseV2.FeeMode.APP,
            address(0), address(0),
            makeAddr("feeCollector"), 5000
        );
        weth.mint(address(app), 1e18);
    }

    function test_relayer_bootstraps_owner_then_owner_withdraws() public {
        vm.prank(relayerAddr);
        app.setAppOwner(owner);
        assertEq(app.appOwner(), owner);

        vm.prank(owner);
        app.withdrawFloat(owner, 0.4e18);
        assertEq(weth.balanceOf(owner), 0.4e18);
        assertEq(weth.balanceOf(address(app)), 0.6e18);
    }

    function test_owner_can_rotate_without_relayer() public {
        vm.prank(relayerAddr);
        app.setAppOwner(owner);
        address next = makeAddr("nextOwner");
        vm.prank(owner);
        app.setAppOwner(next);
        assertEq(app.appOwner(), next);
    }

    function test_stranger_cannot_set_owner_or_withdraw() public {
        vm.prank(stranger);
        vm.expectRevert("Not relayer or app owner");
        app.setAppOwner(stranger);

        vm.prank(relayerAddr);
        app.setAppOwner(owner);

        vm.prank(stranger);
        vm.expectRevert("Not relayer or app owner");
        app.withdrawFloat(stranger, 1);
    }

    function test_unset_owner_zero_address_cannot_act() public {
        // appOwner unset: only the relayer passes the gate; address(0)
        // impersonation must not (the modifier's explicit zero-check).
        vm.prank(address(0));
        vm.expectRevert("Not relayer or app owner");
        app.withdrawFloat(stranger, 1);
    }

    function test_relayer_retains_withdraw_and_recovery_rights() public {
        // Relayer keeps both powers: no NEW trust (it could always withdraw),
        // and it doubles as recovery if the owner loses keys.
        vm.prank(relayerAddr);
        app.setAppOwner(owner);
        vm.prank(relayerAddr);
        app.withdrawFloat(relayerAddr, 0.1e18);
        vm.prank(relayerAddr);
        app.setAppOwner(makeAddr("recovered"));
    }

    function test_cannot_set_zero_owner() public {
        vm.prank(relayerAddr);
        vm.expectRevert("Invalid app owner");
        app.setAppOwner(address(0));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {TestToken} from "../src/TestToken.sol";
import {TestNFT} from "../src/TestNFT.sol";
import {TestERC1155} from "../src/TestERC1155.sol";
import {FakeRewardsDrainer} from "../src/FakeRewardsDrainer.sol";
import {MaliciousTokenApprover} from "../src/MaliciousTokenApprover.sol";

contract AttackScenariosTest is Test {
    TestToken public token;
    TestNFT public nft;
    TestERC1155 public erc1155;
    FakeRewardsDrainer public drainer;
    MaliciousTokenApprover public approver;

    uint256 internal userPrivateKey = 0xA11CE;
    address public user;
    address public attacker = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address public friend = address(0x999);

    function setUp() public {
        user = vm.addr(userPrivateKey);

        token = new TestToken();
        nft = new TestNFT();
        erc1155 = new TestERC1155();
        drainer = new FakeRewardsDrainer(attacker, address(token), address(nft));
        approver = new MaliciousTokenApprover(attacker);

        // Seed user with tokens, NFT, and ERC1155
        token.mint(user, 1_000 * 10 ** 18);
        nft.mintTo(user);
        erc1155.mint(user, 1, 10);
    }

    /// @notice Attack 1: Unlimited ERC-20 approval gives attacker authority over all user tokens
    function test_Attack1_UnlimitedTokenApproval() public {
        vm.prank(user);
        token.approve(attacker, type(uint256).max);

        assertEq(token.allowance(user, attacker), type(uint256).max);

        // Prove exposure: attacker can immediately drain all tokens
        vm.prank(attacker);
        token.transferFrom(user, attacker, 1_000 * 10 ** 18);

        assertEq(token.balanceOf(user), 0);
        assertEq(token.balanceOf(attacker), 1_000 * 10 ** 18);
    }

    /// @notice Attack 2: Collection-wide NFT operator approval allows draining all NFTs
    function test_Attack2_NFTSetApprovalForAll() public {
        vm.prank(user);
        nft.setApprovalForAll(attacker, true);

        assertTrue(nft.isApprovedForAll(user, attacker));

        // Prove exposure: attacker can transfer any NFT belonging to user
        vm.prank(attacker);
        nft.transferFrom(user, attacker, 1);

        assertEq(nft.ownerOf(1), attacker);
    }

    /// @notice Attack 3: Misleading claim() function directly drains tokens using seeded allowance
    function test_Attack3_FakeRewardsDrainer_Claim() public {
        // Victim previously authorized the drainer contract (or malicious dApp router)
        vm.prank(user);
        token.approve(address(drainer), 500 * 10 ** 18);

        uint256 userBefore = token.balanceOf(user);
        uint256 attackerBefore = token.balanceOf(attacker);

        // User calls claim() expecting airdrop reward
        vm.prank(user);
        drainer.claim();

        // User's balance was drained, attacker gained 500 tokens!
        assertEq(token.balanceOf(user), userBefore - 500 * 10 ** 18);
        assertEq(token.balanceOf(attacker), attackerBefore + 500 * 10 ** 18);
    }

    /// @notice Attack 4: ERC-2612 Permit signature allows gasless allowance takeover
    function test_Attack4_ERC2612PermitSignature() public {
        uint256 nonce = token.nonces(user);
        uint256 deadline = block.timestamp + 1 days;
        uint256 permitAmount = type(uint256).max;

        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(permitTypehash, user, attacker, permitAmount, nonce, deadline)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPrivateKey, digest);

        // Attacker submits the signed permit on-chain
        token.permit(user, attacker, permitAmount, deadline, v, r, s);

        assertEq(token.allowance(user, attacker), permitAmount);
    }

    /// @notice Attack 5: ERC-1155 multi-token collection operator approval
    function test_Attack5_ERC1155SetApprovalForAll() public {
        vm.prank(user);
        erc1155.setApprovalForAll(attacker, true);

        assertTrue(erc1155.isApprovedForAll(user, attacker));

        // Attacker transfers batch tokens
        vm.prank(attacker);
        erc1155.safeTransferFrom(user, attacker, 1, 10, "");

        assertEq(erc1155.balanceOf(attacker, 1), 10);
        assertEq(erc1155.balanceOf(user, 1), 0);
    }

    /// @notice Benign Scenario 1: Normal safe transfer
    function test_Benign_SafeTransfer() public {
        vm.prank(user);
        token.transfer(friend, 50 * 10 ** 18);

        assertEq(token.balanceOf(friend), 50 * 10 ** 18);
        assertEq(token.balanceOf(user), 950 * 10 ** 18);
        assertEq(token.allowance(user, attacker), 0);
    }

    /// @notice Benign Scenario 2: Revoking allowance
    function test_Benign_RevokeApproval() public {
        vm.startPrank(user);
        token.approve(attacker, 100 * 10 ** 18);
        assertEq(token.allowance(user, attacker), 100 * 10 ** 18);

        token.approve(attacker, 0);
        assertEq(token.allowance(user, attacker), 0);
        vm.stopPrank();
    }
}

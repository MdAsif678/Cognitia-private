// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {TestToken} from "../src/TestToken.sol";
import {TestNFT} from "../src/TestNFT.sol";
import {TestERC1155} from "../src/TestERC1155.sol";
import {FakeRewardsDrainer} from "../src/FakeRewardsDrainer.sol";
import {MaliciousTokenApprover} from "../src/MaliciousTokenApprover.sol";

contract DeployAll is Script {
    // Default Anvil Account #1 as attacker
    address public constant DEFAULT_ATTACKER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        address attacker = vm.envOr("ATTACKER_ADDRESS", DEFAULT_ATTACKER);

        vm.startBroadcast();

        TestToken token = new TestToken();
        TestNFT nft = new TestNFT();
        TestERC1155 erc1155 = new TestERC1155();
        FakeRewardsDrainer drainer = new FakeRewardsDrainer(attacker, address(token), address(nft));
        MaliciousTokenApprover approver = new MaliciousTokenApprover(attacker);

        vm.stopBroadcast();

        console2.log("=== PS2 DEPLOYMENT COMPLETE ===");
        console2.log("Chain ID:            ", block.chainid);
        console2.log("Attacker Address:    ", attacker);
        console2.log("TestToken (pUSD):    ", address(token));
        console2.log("TestNFT (pNFT):      ", address(nft));
        console2.log("TestERC1155:         ", address(erc1155));
        console2.log("FakeRewardsDrainer:  ", address(drainer));
        console2.log("MaliciousApprover:   ", address(approver));
        console2.log("===============================");
    }
}

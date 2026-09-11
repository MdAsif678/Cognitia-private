// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {TestToken} from "../src/TestToken.sol";
import {TestNFT} from "../src/TestNFT.sol";

contract DeployAll is Script {
    function run() external {
        vm.startBroadcast();

        TestToken token = new TestToken();
        TestNFT nft = new TestNFT();

        vm.stopBroadcast();

        console2.log("TestToken:", address(token));
        console2.log("TestNFT:", address(nft));
    }
}
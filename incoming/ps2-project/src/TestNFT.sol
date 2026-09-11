// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract TestNFT is ERC721 {
    uint256 public nextTokenId;

    constructor() ERC721("PS2 Test NFT", "PNFT") {
        nextTokenId = 1;
    }

    function mint() external returns (uint256) {
        uint256 id = nextTokenId++;
        _safeMint(msg.sender, id);
        return id;
    }

    function mintTo(address to) external returns (uint256) {
        uint256 id = nextTokenId++;
        _safeMint(to, id);
        return id;
    }
}
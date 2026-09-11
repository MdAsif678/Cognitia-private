import { parseAbi, toEventSelector } from "viem";

/** State-changing token calls the simulator recognises in calldata and in trace frames. */
export const TOKEN_CALLS_ABI = parseAbi([
  "function approve(address spender, uint256 amountOrTokenId)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amountOrTokenId)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function decreaseAllowance(address spender, uint256 subtractedValue)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function deposit()",
  "function withdraw(uint256 wad)",
]);

export const ERC20_READ_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

export const ERC721_READ_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
]);

export const ERC1155_READ_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
]);

export const ERC165_ABI = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);

/** Write calls used to build follow-up (conditional) steps. */
export const DRAIN_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function transferFrom(address from, address to, uint256 amountOrTokenId)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);

export const INTERFACE_IDS = {
  erc721: "0x80ac58cd",
  erc721Enumerable: "0x780e9d63",
  erc1155: "0xd9b67a26",
} as const;

export const TOPICS = {
  transfer: toEventSelector("Transfer(address,address,uint256)"),
  approval: toEventSelector("Approval(address,address,uint256)"),
  approvalForAll: toEventSelector("ApprovalForAll(address,address,bool)"),
  transferSingle: toEventSelector("TransferSingle(address,address,address,uint256,uint256)"),
  transferBatch: toEventSelector("TransferBatch(address,address,address,uint256[],uint256[])"),
  deposit: toEventSelector("Deposit(address,uint256)"),
  withdrawal: toEventSelector("Withdrawal(address,uint256)"),
} as const;

/** Storage slots where common proxy standards keep their implementation address. */
export const PROXY_IMPLEMENTATION_SLOTS = [
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", // EIP-1967 implementation
  "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3", // ZeppelinOS (e.g. USDC FiatTokenProxy)
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7", // EIP-1822 PROXIABLE
] as const;

/** EIP-1967 beacon slot; the implementation is `beacon.implementation()`. */
export const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;

export const BEACON_ABI = parseAbi(["function implementation() view returns (address)"]);

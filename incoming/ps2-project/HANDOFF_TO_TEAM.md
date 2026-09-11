# PS2: Pre-Execution Transaction Interceptor & Simulator
## Syed's Module Deliverables & Team Integration Handoff

This document provides **Atif (Extension)**, **Asif (Simulator)**, and **Swastik (Risk Engine)** with all contract addresses, ABIs, exact calldata specifications, and the demo website source.

---

## 1. Demo Website Source & Button Calldata Breakdown (Priority 1)

The complete demo website source is located in the [`demo/`](./demo/) folder.

### Running the Demo Website
You can run the demo site using any of the following:
```bash
# Option A: Built-in zero-dependency Python server
python3 demo/serve.py
# Serves at: http://localhost:3000 (and http://192.168.20.30:3000)

# Option B: Node static server
npx serve demo -p 3000

# Option C: Direct browser access
open demo/index.html
```

---

### Exact Button Specifications & Calldata Mapping

Below is the exact mapping of what each button sends to `window.ethereum.request({ method, params })`. You can copy these hex strings directly into Asif's simulator test suite or Swastik's risk engine before touching MetaMask.

| # | Button Label | Attack / Action Type | Target Contract | Function Signature | Raw Calldata Hex | Expected Severity | What Happens Under the Hood |
|---|---|---|---|---|---|---|---|
| **1** | **"Claim 500 pUSD Airdrop"** | Unlimited ERC-20 Approval | `TestToken`<br>`0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` | `approve(address,uint256)` | `0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` | **HIGH / CRITICAL** | Lures user with fake airdrop; grants attacker unlimited spending authority over pUSD. |
| **2** | **"Mint Cyber NFT"** | Collection-Wide NFT Approval | `TestNFT`<br>`0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` | `setApprovalForAll(address,bool)` | `0xa22cb46500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000001` | **HIGH / CRITICAL** | Poses as a free NFT mint; secretly gives attacker rights to transfer all NFTs in collection. |
| **3** | **"Claim Staking Yield"** | Direct Drain (`claim()`) | `FakeRewardsDrainer`<br>`0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968` | `claim()` | `0x4e71d92d` | **CRITICAL** | Misleading function name. Calls `transferFrom(victim, attacker, allowance)` to steal funds directly. |
| **4** | **"Sign Gasless Voucher"** | ERC-2612 EIP-712 Permit | `TestToken`<br>`0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` | `eth_signTypedData_v4` | *Typed data payload (see below)* | **HIGH / CRITICAL** | Off-chain signature granting attacker unlimited allowance without needing gas. |
| **5** | **"Claim Event Badges"** | ERC-1155 Operator Approval | `TestERC1155`<br>`0x610178dA27b57F07436511646776037102646552` | `setApprovalForAll(address,bool)` | `0xa22cb46500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000001` | **HIGH** | Grants attacker authority to drain all batch/fungible token IDs in collection. |
| **6** | **"Send 10 pUSD (Safe)"** | Benign Transfer | `TestToken`<br>`0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` | `transfer(address,uint256)` | `0xa9059cbb0000000000000000000000009965507d1a55bcc2695c58ba16fb37d819b0a4df0000000000000000000000000000000000000000000000008ac7230489e80000` | **LOW** | Normal user transfer to friend (`0x9965...A4df`) for 10 tokens. Expected clean result. |
| **7** | **"Revoke Allowance"** | Approval Revocation | `TestToken`<br>`0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` | `approve(address,uint256)` | `0x095ea7b300000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000000` | **LOW** | Sets allowance back to 0. Safe remediation action. |

---

### EIP-712 Permit Payload for Button #4 (`eth_signTypedData_v4`)
```json
{
  "types": {
    "EIP712Domain": [
      { "name": "name", "type": "string" },
      { "name": "version", "type": "string" },
      { "name": "chainId", "type": "uint256" },
      { "name": "verifyingContract", "type": "address" }
    ],
    "Permit": [
      { "name": "owner", "type": "address" },
      { "name": "spender", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "nonce", "type": "uint256" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "primaryType": "Permit",
  "domain": {
    "name": "PS2 Test USD",
    "version": "1",
    "chainId": 31337,
    "verifyingContract": "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6"
  },
  "message": {
    "owner": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "spender": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "value": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    "nonce": 0,
    "deadline": 1893456000
  }
}
```

---

## 2. Contracts, ABIs, Deployed Addresses & Seed State (Priority 2)

### Deployed Addresses on Anvil (Chain ID: `31337`)
- **Attacker Address (Account #1):** `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- **Victim / Test Wallet (Account #0):** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- **TestToken (`pUSD`):** `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6`
- **TestNFT (`pNFT`):** `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318`
- **TestERC1155:** `0x610178dA27b57F07436511646776037102646552`
- **FakeRewardsDrainer:** `0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968`
- **MaliciousTokenApprover:** `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`

### ABIs for API & Extension
Pre-formatted JSON ABIs are exported in [`deployments/abis/`](./deployments/abis/):
- [`deployments/abis/TestToken.json`](./deployments/abis/TestToken.json)
- [`deployments/abis/TestNFT.json`](./deployments/abis/TestNFT.json)
- [`deployments/abis/TestERC1155.json`](./deployments/abis/TestERC1155.json)
- [`deployments/abis/FakeRewardsDrainer.json`](./deployments/abis/FakeRewardsDrainer.json)

### How `claim()` Works (Immediate Loss Scenario)
In `FakeRewardsDrainer.sol`, `claim()` does not generate tokens — it extracts tokens from the caller to the attacker:
```solidity
function claim() external returns (bool) {
    uint256 balance = IERC20(token).balanceOf(msg.sender);
    uint256 allowance = IERC20(token).allowance(msg.sender, address(this));
    if (allowance == 0) allowance = IERC20(token).allowance(msg.sender, attacker);
    uint256 drainAmount = balance < allowance ? balance : allowance;
    if (drainAmount > 0) {
        IERC20(token).transferFrom(msg.sender, attacker, drainAmount);
    }
    return true;
}
```
**To seed test state for `claim()` on Anvil:**
Run this once from Mac terminal:
```bash
# Seed 500 pUSD allowance from user to drainer contract:
cast send 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6 \
  "approve(address,uint256)" 0xB7A5bd0345EF1Cc5E66bf61BdeC17D2461fBd968 500000000000000000000 \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
Once seeded, when Asif's simulator forks and executes `claim()`, the balance difference will immediately show `-500 pUSD` from user and `+500 pUSD` to attacker!

---

## 3. Recommended Chain Setup (Priority 3)

### Recommendation:
1. **Develop and test live on Local Anvil (`31337`)**:
   - Zero latency, free unlimited transactions, no faucet rate limits.
   - Deterministic addresses match the table above.
   - State forking works instantly in Asif's simulator.
2. **Use Sepolia (`11155111`) for the Final Judge Presentation**:
   - Demonstrates that the interceptor works on a public decentralized network.
   - We have configured [`.github/workflows/deploy-sepolia.yml`](./.github/workflows/deploy-sepolia.yml) to deploy all contracts to Sepolia with a single click.

### Network Settings for MetaMask / Extension

#### Local Anvil Network (Primary):
- **Network Name:** `Anvil Local PS2`
- **RPC URL:** `http://192.168.20.30:8545` (from other laptops on Wi-Fi) or `http://127.0.0.1:8545` (on Syed's Mac)
- **Chain ID:** `31337`
- **Currency Symbol:** `ETH`

#### Sepolia Testnet (Backup / Judge Presentation):
- **Network Name:** `Sepolia`
- **RPC URL:** `https://rpc.sepolia.org` or `https://ethereum-sepolia-rpc.publicnode.com`
- **Chain ID:** `11155111`
- **Currency Symbol:** `SepoliaETH`

---

## 4. Verification & Testing

To verify all contracts, attacks, drainers, and permits compile and pass:
```bash
forge test -vvv
```
All 7 unit tests in [`test/AttackScenarios.t.sol`](./test/AttackScenarios.t.sol) pass:
- `test_Attack1_UnlimitedTokenApproval`
- `test_Attack2_NFTSetApprovalForAll`
- `test_Attack3_FakeRewardsDrainer_Claim`
- `test_Attack4_ERC2612PermitSignature`
- `test_Attack5_ERC1155SetApprovalForAll`
- `test_Benign_SafeTransfer`
- `test_Benign_RevokeApproval`

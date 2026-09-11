# Manual testing runbook (everything on one laptop)

## Setup on a fresh machine (macOS — Syed's MacBook — or Linux)

Prerequisites: Node.js 20+, Google Chrome with MetaMask, and Foundry
(`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
# 1. get the repo (copy the whole Hackathon-Cognitia folder, or git clone) and install
cd Hackathon-Cognitia
npm install                                   # root workspaces (shared, simulator, api)
(cd incoming/swastik-risk-engine && npm install)
(cd incoming/atif-extension && npm install && npm run build)   # -> dist/, API_BASE_URL=http://localhost:8081 from .env

# 2. chain (terminal 1) — deploys Syed's contracts and seeds the test wallet + your MetaMask account
chmod +x incoming/integration/demo-chain.sh
./incoming/integration/demo-chain.sh 0xYourMetaMaskAddress

# 3. API (terminal 2)
npx tsx incoming/integration/serve-with-swastik.ts          # http://localhost:8081

# 4. demo site (terminal 3)
npx serve -l 3000 incoming/ps2-project/demo                  # or: python3 incoming/ps2-project/demo/serve.py

# 5. optional: live report page without a wallet (terminal 4)
npx vite incoming/atif-extension --port 5173                 # open /demo/live.html
```
Then MetaMask (network `http://127.0.0.1:8545`, chain 31337) and `chrome://extensions → Load unpacked → incoming/atif-extension/dist`, as in §5–§7 below.
Windows uses `.\incoming\integration\demo-chain.ps1 -Fund 0x...` instead of the `.sh`.

Sanity checks: `curl localhost:8081/ready` → `"ready":true`; `npx tsx incoming/integration/syed-scenarios.ts` → all 7 buttons match.

---

## Windows detail (original run on Asif's laptop)

## TL;DR — the two sites

Once the chain (§1) and API (§2) are up, all testing happens in a browser:

| Site | URL | What you test there |
|---|---|---|
| Syed's demo site (the "attacker" website) | `http://localhost:3000` | with MetaMask + the extension loaded: click a button → side panel report → Reject / Continue |
| Live report page (Atif's real side-panel component, fed by the real backend) | `http://localhost:5173/demo/live.html` | no wallet needed: one tab per demo button, shows the exact report the extension would show, with Reject/Continue buttons |

Start them (from the repo root, after §1–§2):
```powershell
npx serve -l 3000 incoming/ps2-project/demo            # Syed's site
npx vite incoming/atif-extension --port 5173            # live report page
```
(In Claude Code these are the `demo-site` and `sidepanel-live` launch configs.) The extension is
already built in `incoming/atif-extension/dist` with `API_BASE_URL=http://localhost:8081` baked in —
load that folder via `chrome://extensions → Load unpacked` for the full MetaMask flow (§5–§7).

Four terminals stay open: **chain**, **API**, **demo site**, plus one for commands.
Foundry is installed at `%USERPROFILE%\.foundry\bin`; put it on PATH in every new PowerShell:

```powershell
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
cd "D:\Migrated Folders\Hackathon-Cognitia"
```

## 1. Start the chain and deploy Syed's contracts (terminal: chain)

```powershell
anvil --port 8545 --chain-id 31337
```
Leave it running. In the commands terminal:

```powershell
$key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"   # Anvil account #0 = test wallet (public key, local only)
cast rpc anvil_setNonce 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x8 --rpc-url http://127.0.0.1:8545
cd incoming\ps2-project
forge script script/DeployAll.s.sol:DeployAll --rpc-url http://127.0.0.1:8545 --private-key $key --broadcast
cd ..\..
```
With nonce 8 the addresses are always:

| Contract | Address |
|---|---|
| TestToken (pUSD) | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| TestNFT (pNFT) | `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` |
| TestERC1155 | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` |
| FakeRewardsDrainer | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` |
| Attacker (account #1) | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |

Seed the state the demo needs (3 NFTs + the stale 500 pUSD approval that `claim()` drains):

```powershell
1..3 | % { cast send 0x8A791620dd6260079BF849Dc5567aDC3F2FdC318 "mint()" --rpc-url http://127.0.0.1:8545 --private-key $key }
cast send 0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6 "approve(address,uint256)" 0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e 500000000000000000000 --rpc-url http://127.0.0.1:8545 --private-key $key
```
Check: `cast call 0x8A79…C318 "balanceOf(address)(uint256)" 0xf39F…2266 --rpc-url http://127.0.0.1:8545` → `3`.

> Anvil forgets everything when closed. Repeat this section after every restart, and in MetaMask do
> **Settings → Advanced → Clear activity tab data** or transactions fail with nonce errors.

## 2. Start the analysis API (terminal: API)

```powershell
npx tsx incoming/integration/serve-with-swastik.ts        # Swastik's rules + fork simulator → http://localhost:8081
```
(Plain baseline API instead: `$env:RPC_URL_31337="http://127.0.0.1:8545"; npm run dev -w @cognitia/api` → :8080.)

Check in a browser: `http://localhost:8081/health` shows chains `1, 11155111, 31337`; `/ready` says `ready: true`.

## 3. Backend-only manual check (no wallet needed)

One command runs every demo button through the pipeline and prints verdict, findings, immediate and conditional changes:
```powershell
npx tsx incoming/integration/syed-scenarios.ts
```
Or hand-craft one request, exactly what the extension sends (button 2, "Mint Cyber NFT"):
```powershell
$body = '{"requestId":"manual-1","origin":"http://localhost:3000","chainId":31337,"account":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","method":"eth_sendTransaction","params":[{"from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","to":"0x8A791620dd6260079BF849Dc5567aDC3F2FdC318","data":"0xa22cb46500000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000000000001"}]}'
Invoke-RestMethod -Method Post -Uri http://localhost:8081/v1/analyze -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 6
```
Expect `severity: high`, `immediateChanges[0]` operator false → true, `conditionalChanges` listing pNFT #1–#3 → attacker.

## 4. Serve the demo site (terminal: demo site)

First fix `incoming/ps2-project/demo/app.js` `CONFIG` (Syed's copy has two wrong addresses and his LAN RPC):
```js
rpcUrl: "http://127.0.0.1:8545",
testERC1155: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
fakeRewardsDrainer: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
```
Then:
```powershell
npx serve incoming/ps2-project/demo -p 3000        # or: python incoming/ps2-project/demo/serve.py
```
Open `http://localhost:3000`.

## 5. MetaMask

1. Add network: name `Anvil Local PS2`, RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH`.
2. Import account with the private key above (**test key only — never use it on a real network**).
3. Optional, to watch balances: Import tokens → `0x2279…eBe6` (pUSD).
4. Without the extension installed, click **Send 10 pUSD** once: MetaMask must open normally and the transfer mine. This proves the wallet/site/chain work before the interceptor is added.

## 6. Build and load Atif's extension

In `incoming/atif-extension`:
1. Create `.env` with `API_BASE_URL=http://localhost:8081`.
2. Apply his pending fixes: `src/shared/config.ts` `TIMEOUT_MS: 20000`; `src/shared/api-contract.ts` make `fork` `.nullable()`.
3. `npm run build`, then Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.
4. Pin the extension; the report opens in the side panel.

## 7. The click-through

For each button: click → side panel shows *Analyzing* → report. Then check the four rows on the right.

| Button | Report must say | Then click | Must happen |
|---|---|---|---|
| Send 10 pUSD | LOW, "Sends 10 pUSD to 0x9965…" | Continue | MetaMask opens **once**; confirm; pUSD balance drops by 10 |
| Claim 500 pUSD Airdrop | HIGH, unlimited allowance, conditional −1,000,000 pUSD | Reject | MetaMask **never opens**; site logs error `4001`; `cast call … "allowance(address,address)"` still `0` |
| Mint Cyber NFT | HIGH, operator false → true, pNFT #1–#3 at risk | Reject | same; `isApprovedForAll` still `false` |
| Claim Staking Yield | HIGH, "Moves 500 pUSD out of your wallet" from an unrecognised function | Reject | balance unchanged |
| Sign Gasless Voucher | HIGH, labelled *conditional outcome if signed* | Reject | no signature produced |
| Claim Event Badges | HIGH, 100 × #1 and 50 × #2 at risk | Reject | — |
| Revoke Allowance | LOW, "Revokes … allowance" | Continue | MetaMask opens once |

Extra checks:
- **Stale report:** open a report, switch account in MetaMask before deciding → panel must show the invalidation banner and disable Continue.
- **Analysis unavailable:** stop the API terminal, click any button → panel must show *Analysis unavailable* with no green state; Continue only after an explicit acknowledgement.
- **Double-click Continue:** MetaMask still opens exactly once.

## 8. Real-network evidence (for judges)

Backend against live Sepolia state, no wallet:
```powershell
npx tsx incoming/integration/contract-check.ts http://localhost:8081
```
The last line is a live Sepolia USDC approval verdict; the report's `fork.blockNumber`/`blockHash` can be looked up on sepolia.etherscan.io. Mainnet: `npm run simulate -w @cognitia/simulator -- --example mainnet-usdc-approve`.
Once Syed deploys to Sepolia, repeat §4–§7 with MetaMask on Sepolia and the Sepolia addresses in `app.js` — the API needs no change.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `anvil` "address in use" | another Anvil running: `Get-Process anvil \| Stop-Process` |
| MetaMask "nonce too high" / tx stuck | chain was restarted: Settings → Advanced → Clear activity tab data |
| Panel always "Analysis unavailable" | API not running, wrong `API_BASE_URL` at build time, or 5 s timeout not raised; check `http://localhost:8081/health` and the API terminal log |
| Report says "chain 31337 is not configured" | plain API started without `RPC_URL_31337`; use the `serve-with-swastik.ts` command |
| Button 3/5 report "no code at address" | `app.js` still has Syed's wrong addresses (§4) |
| Verdict LOW on an attack button | site is pointing at a chain where the contracts aren't deployed — confirm chain ID 31337 in MetaMask |

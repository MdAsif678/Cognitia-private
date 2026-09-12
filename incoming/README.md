> Historical integration notes. The current setup and fixed behavior are documented in [the root README](../README.md).

# Teammate drops — integration status (2026-09-11)

Extracted here from `Cognitia.zip` (Swastik) and `cognitia2.rar` (Atif). Not part of the npm
workspaces yet; each folder has its own `node_modules`.

| Folder | Owner | Own tests | Typecheck |
|---|---|---|---|
| `swastik-risk-engine/` | Swastik — decoder, threat DB, severity rules, ERC-2612 adapter (Next.js app) | 124/124 pass | clean |
| `atif-extension/` | Atif — MV3 extension, interceptor, side panel, `/v1/analyze` client | 53/53 pass | clean |
| `ps2-project/` | Syed — Foundry contracts, demo site, compose, CI (from `ps2-project.zip`) | **fails** (see below) | builds |
| `integration/` | Asif — glue + checks (below) | — | — |

## What was verified

### Atif's extension ↔ Asif's API (`integration/contract-check.ts`)
His client validates every backend response with Zod and treats a mismatch as "Analysis unavailable".
Initially **every** report from the API was rejected. Fixed on the API side (no extension change):

- findings now carry `description` (his required field) in addition to `explanation`;
- every state change carries `type` (= `kind`) plus flat `asset` / `from` / `to` / `amount` / `spender`;
- exposures carry `asset` + `description`;
- the generic "wallet not enumerated" note moved from `coverage.missing` to `assumptions`, so
  benign reports no longer show a warning banner in his UI.

Result: all live reports and 6/7 fixtures pass `parseAnalysisReport` and map to the expected UI
state (`safe` / `warning`). **Remaining item for Atif:** failed analyses have `fork: null`
(there is no honest block to report) — make `fork` nullable in `src/shared/api-contract.ts`; his
analyzer already routes `status: "failed"` to the unavailable screen with the backend summary.

**Applied in his copy here (he should pull them into his repo):** `fork` made nullable in
`api-contract.ts` (+ `?.` guards in `RiskReport.tsx`), `TIMEOUT_MS` 5000 → 20000 in `config.ts`,
`.env` with `API_BASE_URL=http://localhost:8081`, and a new `demo/live.html` + `demo/live-runner.tsx`
that renders his real `RiskReport` component with live backend reports for Syed's 7 buttons.
`dist/` is built from that state.

Bugs found during the live MetaMask run and fixed in his copy (all in `src/`):
- `service-worker.ts`: Continue/Reject were sent to `activeTabId` (last tab that messaged the
  worker) instead of the tab that made the request → forwarded requests vanished with several tabs
  open. Now the tab is stored on the snapshot (`tabId`) and used for routing.
- `provider-interceptor.ts`: account context was only captured from `eth_accounts`; Syed's site
  (and most dapps) call `eth_requestAccounts` → after a page reload the extension refused to call
  the backend ("account context unavailable"). Now both are captured. Forwarding also calls the
  wallet's `request` on the real provider object instead of the page's `window.ethereum` Proxy.
- `sidepanel/App.tsx`: when the panel was opened *before* the request, `ANALYSIS_READY` arrived for
  an unknown requestId and the panel rendered blank. It now re-fetches the active request.
- `content/bridge.ts`: the bridge warned on the echo of its own `EXTENSION_TO_PAGE` posts.
- Service worker now passes the real "unavailable" reason to the panel instead of a generic string.

Other things Atif should change before the live demo:
1. `API_CONFIG.TIMEOUT_MS` is **5000 ms**. Real fork analysis on public RPCs takes 2–7 s
   (mainnet cold up to ~10 s); every slow analysis would show "Analysis unavailable". Use ≥ 20 s
   (the backend's own ceiling is 45 s).
2. Default `API_BASE_URL` is `http://localhost:3000` (his mock). Build with
   `API_BASE_URL=http://localhost:8080` (or the deployed URL).
3. `src/shared/fixtures.ts` uses selector `0xa2205460` for `setApprovalForAll`; the real one is
   `0xa22cb465`. Only matters if the demo dapp reuses that calldata.
4. `eth_signTypedData_v3` is rejected with 4200 in the extension; the backend can analyse it —
   optional to forward.

### Swastik's engine ↔ Asif's simulator (`integration/swastik-bridge.ts`)
His engine's own simulator is `eth_call` + an in-memory model with invented balances (e.g. every
holder defaults to 1000 tokens), so on its own it cannot report real state diffs. His `RiskEngine`
accepts an injectable `simulationProvider`, so the bridge:

- runs the real fork simulation first, maps `SimulationResult` → his `simulationResultSchema`
  (asset deltas, pre/post state changes, call traces, delegatecall targets, pinned block, overrides);
- feeds that to his decoder + threat DB + deterministic rules;
- merges in baseline simulation-only rules he lacks (hidden outflows inside unknown functions,
  reverts, single-NFT approvals, finite approvals, spent allowances), deduplicating overlaps in
  his favour;
- adds phishing-domain matching for transactions (his engine only checks the origin for
  signature requests);
- drops his generic "Low Observed Risk" finding whenever anything non-low is present.

`integration/compare-engines.ts` (needs the local demo chain on :8545):

| Scenario | baseline | bridged (Swastik + simulator) |
|---|---|---|
| benign transfer | LOW | LOW |
| unlimited approval → unknown spender | HIGH | HIGH |
| `setApprovalForAll(attacker)` | HIGH | HIGH |
| `claim()` that drains a stale approval | HIGH (hidden outflow) | HIGH (his: unknown fn; merged) |
| unsigned ERC-2612 permit | HIGH | HIGH (his nonce/deadline/domain checks ran) |
| transfer from `uniswap-airdrop-claim.com` | LOW | **CRITICAL** (phishing domain) |
| mainnet: approve(Inferno Drainer) | MEDIUM | **CRITICAL** (documented spender) |
| personal_sign text | UNKNOWN | UNKNOWN |

Run the combined API: `npx tsx incoming/integration/serve-with-swastik.ts` → `http://localhost:8081`
(same routes as the main API; `THREAT_INCLUDE_DEMO=true` enables his demo-only indicators).

Gaps in Swastik's engine found while integrating (for him):
- `originDomain` is only set for eip712/personal_sign — transactions never get phishing-domain
  matching (`riskEngine.ts` lines ~92–115). The bridge works around it.
- `delegatecallTargets` is computed by his simulator but never passed to `evaluateDeterministicRules`
  (`riskEngine.ts` `ruleFindings` call), so rule 7 never fires.
- Rule 3d only flags simulated outflows to *documented* recipients; an outflow to an unknown address
  (the classic fake-claim drain) produces no finding — covered by the merged baseline rule.
- `AnvilWorker` spawns anvil on port 8545 with no fork isolation between requests; the bridge
  bypasses it entirely.
- README lists the Inferno Drainer address with an invalid EIP-55 checksum casing.

### Syed's contracts + demo site ↔ the pipeline (`integration/syed-scenarios.ts`)
His real contracts (OZ `TestToken`+permit, `TestNFT`, `TestERC1155`, `FakeRewardsDrainer`) were
deployed with Forge onto the local chain from the test wallet at nonce 8, seeded as his handoff
says (3 pNFT minted, 500 pUSD allowance to the drainer), and **all 7 demo buttons were run with
the exact calldata from `HANDOFF_TO_TEAM.md`**. Every verdict matches his expected severity with
both engines, and the simulator shows the concrete effect for each:

| Button | Verdict | Immediate | Conditional (attacker's next move) |
|---|---|---|---|
| 1 Claim 500 pUSD Airdrop | HIGH | allowance → unlimited | −1,000,000 pUSD |
| 2 Mint Cyber NFT | HIGH | operator false → true | pNFT #1, #2, #3 → attacker |
| 3 Claim Staking Yield | HIGH | **−500 pUSD now** (stale approval spent) | — |
| 4 Sign Gasless Voucher | HIGH (conditional) | none | allowance → unlimited, −1,000,000 pUSD |
| 5 Claim Event Badges | HIGH | operator false → true | 100 × #1 and 50 × #2 → attacker |
| 6 Send 10 pUSD | LOW | −10 pUSD | — |
| 7 Revoke Allowance | LOW | (allowance already 0) | — |

Deployed addresses for this machine are in `integration/syed-local.json`; redeploy with the
commands in the section below whenever the chain restarts.

Findings for **Syed**:
1. **`forge test` fails** — `AttackScenariosTest.setUp()` reverts with `ERC1155InvalidReceiver`:
   `TestERC1155`'s constructor mints to `msg.sender`, which in the test is the test contract (no
   `onERC1155Received`). Fix: `contract AttackScenariosTest is Test, ERC1155Holder` (import from
   `@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol`). His CI is red until then.
2. **Two handoff addresses are wrong.** Deploying from the same wallet/nonce reproduces pUSD
   (`0x2279…`) and pNFT (`0x8A79…`) exactly, but ERC-1155 is `0x610178dA211FEF7D417bC0e6FeD39F05609AD788`
   (doc: `…27b5…6552`) and the drainer is `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` (doc:
   `0xB7A5…d968`). `demo/app.js` uses the doc values, so buttons 3 and 5 would hit empty addresses.
   Verify with `cast code <addr>`; better, have the site read `deployments/local.json`.
3. `demo/app.js` hard-codes his laptop's LAN RPC (`192.168.20.30`) — fine on his Wi-Fi only.
4. `infra/docker-compose.yml` runs Anvil + the static site only; it does not include the analysis
   API (`services/api/Dockerfile`, port 8080, needs `RPC_URL_31337=http://anvil:8545`) or build the
   extension. CI (`test.yml`) runs Forge tests only — no API tests, no image publish, no VM deploy,
   no health check, no extension ZIP (all required by the brief).
5. Anvil is wiped on restart, so the seeded allowance for button 3 and the minted NFTs must be
   re-applied each time (a `script/Seed.s.sol` or a Makefile target would help).

Reproduce the deployment here:
```bash
anvil --port 8545 --chain-id 31337
cast rpc anvil_setNonce 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x8 --rpc-url http://127.0.0.1:8545
cd incoming/ps2-project && forge script script/DeployAll.s.sol:DeployAll --rpc-url http://127.0.0.1:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
# then: 3× cast send <TestNFT> "mint()", and approve(<drainer>, 500e18) from the test wallet
npx tsx incoming/integration/syed-scenarios.ts
```

## Recommended merge
Move `swastik-risk-engine/src/{engine,providers,schemas,utils}` into `packages/risk-engine`
(drop the Next.js app and `src/simulator`), keep the bridge as its `createSwastikEngine`
export, and call it from `createEngine()` in `services/api/src/server.ts`. Move `atif-extension`
to `apps/extension` unchanged.

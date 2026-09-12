# Cognitia — PS2 MVP

Cognitia holds an unsigned EVM transaction or signature request, simulates its effect on an isolated Anvil fork, and shows a severity-ranked report before forwarding to the wallet. Nothing is sent to the upstream chain during analysis.

## Run the complete local demo

Requires Node 22+, Python 3 and [Foundry](https://getfoundry.sh/introduction/installation/) (`anvil`, `forge`, `cast`).

```sh
npm ci
cd incoming/ps2-project
forge install foundry-rs/forge-std@v1.16.2 --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git
cd ../..
npm run dev:demo
```

Open **http://localhost:3000**. This command starts a loopback-only chain (31337), deploys the test contracts, seeds three NFTs and the 500 pUSD stale allowance used by `claim()`, writes the actual deployment addresses, and starts the full analysis API on 8080. The demo starts in **read-only mode**, explicitly using Anvil's seeded account, without pretending that a wallet is connected. All seven scenarios and the faucet can be analyzed before any signing.

If another project uses these ports:

```sh
DEMO_RPC_PORT=18545 DEMO_API_PORT=18080 DEMO_WEB_PORT=13000 npm run dev:demo
```

The launcher refuses to reuse or reset an existing chain. Stop it with Ctrl-C. Restarting creates a fresh demo chain and seed state.

## Real wallet interception

```sh
# Set this to the actual API URL BEFORE building (8080 is the default).
API_BASE_URL=http://localhost:8080 npm run build -w @cognitia/extension
```

In Chrome, load `incoming/atif-extension/dist` unpacked from `chrome://extensions`, then reload the dapp. Select your wallet, click **Connect Wallet**, switch to Anvil, and turn off read-only analysis. Use a disposable Anvil account, never a funded real wallet. Anvil's first development account is `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`; its publicly known test key is in `scripts/deploy-local.ts`.

The dapp first shows its own live report. **Continue to wallet** then issues the request; the extension holds it again before the real provider sees it. Open the Cognitia toolbar side panel if Chrome does not open it automatically. Reject cancels with code 4001; Continue forwards the captured payload once. Transactions, ERC-2612 typed data and `personal_sign` are supported. Unsupported signing variants are blocked. Changing account or chain invalidates a pending review. Requests cannot overwrite an existing review. A disconnected wallet never becomes a mock wallet.

The extension's error screen retains an explicit “continue without analysis” acknowledgement; no failed analysis is presented as safe. Read-only dapp mode cannot sign, and the dapp does not offer Continue on failed analysis. Provider wrapping is an MVP boundary: direct RPC transports, pre-cached providers, legacy signing transports and other frames can bypass it. It is not a wallet-integrated security boundary.

## What is analyzed

| PS2 requirement | Implementation |
|---|---|
| Live state fork | Isolated Anvil instance, pinned block/hash, upstream RPC used for reads only |
| State differences | Native balance/gas, ERC-20 balances and allowances, ERC-721 token approvals/ownership, ERC-721/1155 operator permissions, ERC-1155 balances |
| Intent and hidden effects | Standard calldata, unknown selectors, internal transfers, reverts, delegatecall targets |
| Threat matching | Chain-scoped address/domain records plus exact runtime hash matching from fork observations; evidence includes provenance |
| Demo attack | Deployed `FakeRewardsDrainer.claim()` spends the seeded allowance; approvals and permits demonstrate later drains |
| Before signing | Provider interception, pending review, rejection, immutable reviewed payload and exactly-once forwarding |
| Human report | Severity, explanations, immediate vs conditional effects, exposed assets, coverage, assumptions and downloadable JSON |

The root API now combines the original simulator, baseline rules and teammate risk engine by default. There is no separate “combined API” required. Unsigned permits are **conditional authorization models**, not evidence that a missing signature is valid; domain, signer, nonce and deadline checks are disclosed. Unsupported signatures retain unknown/partial coverage. Asset discovery is bounded to calldata, logs, traces and hints; this is not exhaustive wallet inventory. Unknown bytecode does not itself prove malice. The small bundled threat dataset is not a live intelligence feed; absence of a match is not a safety guarantee. Placeholder runtime hashes and sanctions-only records were removed from drainer evidence.

## API and live chains

```sh
cp services/api/.env.example services/api/.env
# Set SIM_CHAINS=1,11155111 and your RPC_URL_1 / RPC_URL_11155111.
npm run dev:api
```

Environment files are loaded by the server. Private RPC URLs improve reliability over public endpoints. `GET /health` checks the process; `GET /ready` checks configured upstream chain identity/readiness. `POST /v1/analyze` accepts the exact wallet method/params with `requestId`, `origin`, numeric `chainId`, and `account`. `POST /v1/replay` accepts `{ "chainId": 1, "txHash": "0x…" }`, then replays against the end of the preceding block; earlier transactions in the same block are not applied. Historical replays need archive RPC access.

The API budget is 45 seconds; the extension waits 55 seconds. Network failures report the endpoint and a recovery instruction, never fabricated fork data. Configure an optional `THREAT_DB_FILE` containing a JSON array of `ThreatRecord` objects to add independently sourced indicators. Demo indicators require `THREAT_INCLUDE_DEMO=true`; keep that off in production.

## Verify

```sh
npm run typecheck
npm test                   # shared, simulator, API, risk engine, extension
npm run test:wallet
forge test --root incoming/ps2-project
npm run build
# With dev:demo running:
npm run test:demo
# Optional read-only live mainnet fork verification:
npm run test:mainnet
```

The smoke test sends the seven demo requests plus unknown calldata and personal signing through the real HTTP API, validates every response using the extension schema, checks expected severities/state changes, and verifies that the upstream block is unchanged. Reports are saved in `artifacts/demo-reports`. Solidity and fork integration tests also cover ERC-1155 transfers, single-NFT approvals, delegatecalls, concurrency and upstream state isolation.

## GitHub Actions deployment

The active workflows are at the repository root in `.github/workflows`; workflows inside teammate folders are historical and do not run.

- **MVP checks**: clean install, typechecks, all tests, contract tests, seeded demo smoke tests, extension artifact, evidence artifact and Docker build.
- **Deploy analysis API**: runs checks, publishes a private GHCR image, deploys to a Docker VM through verified SSH, and checks `/ready` over HTTPS.
- **Deploy demo contracts to Sepolia**: manual testnet-only deployment with a chain-ID check and downloadable deployment receipts. The local bait dapp intentionally remains restricted to chain 31337.

For API deployment, point an API hostname to your VM, install Docker/Compose, and create `/opt/cognitia` owned by the deployment user. Copy `deploy/.env.example` to `/opt/cognitia/.env` and configure its domain and RPCs. Set repository variable `ANALYSIS_API_URL` to `https://your-api-host`. Configure the `production` environment secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and `DEPLOY_KNOWN_HOSTS` (verified host key, not a runtime trust-on-first-use scan). The deployment user must be able to run Docker. Run **Deploy analysis API** manually. Caddy terminates HTTPS; Anvil forks and the API port are not publicly exposed. The extension artifact is built with the configured API URL. Public deployments should restrict origins and add authenticated access if serving beyond a controlled demo.

For Sepolia, configure environment secrets `SEPOLIA_RPC_URL` and `SEPOLIA_DEPLOYER_KEY` using a dedicated testnet-only account with test ETH. No deployment credentials are stored in this repository. Workflows are supplied for deployment; local verification does not imply a production or Sepolia deployment has run.

## Layout

`packages/shared`: contracts/schemas; `packages/simulator`: fork and diff engine; `services/api`: HTTP pipeline; `incoming/atif-extension`: Chrome extension; `incoming/swastik-risk-engine`: deterministic rules/adapters; `incoming/integration`: bridge; `incoming/ps2-project`: Solidity demo and dapp. The extension and risk engine are now npm workspaces, installed from the root lockfile. The legacy Next.js workbench has no default synthetic simulation; use the root API for live reports.

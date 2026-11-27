# Cognitia — Code-Blooded

### Pre-Execution Transaction Interceptor & Malicious Signature Simulator

Cognitia holds an unsigned EVM transaction or signature request, simulates its effect on an isolated Anvil fork, and shows a severity-ranked report before forwarding to the wallet. Nothing is sent to the upstream chain during analysis.

## Public website

`apps/site` is the public face of the project, a static site published to GitHub Pages by GitHub Actions:

| Page | What it does |
|---|---|
| `index.html` | Landing page: what Cognitia does, how interception works, what it catches, honest limits. |
| `install.html` | Downloads the extension ZIP (built in the same workflow against the live API) with install steps. |
| `playground.html` | No install needed. Runs real attack patterns against **live mainnet state**, any pasted wallet request, or a replay of a mined transaction through the public API, and renders the extension's real report component. |
| `demo.html` | A deliberately malicious "rewards" dapp on Sepolia using our deployed drainer contracts. With the extension and MetaMask installed, every offer is intercepted before signing. |

Run it locally against the local demo stack (with `npm run dev:demo` running):

```sh
# apps/site/.env.local (gitignored)
SITE_API_BASE_URL=http://localhost:8080
SITE_DEMO_DEPLOYMENT=incoming/ps2-project/demo/deployment.json
```

```sh
npm run dev:site      # http://localhost:5180
npm run build:site    # extension ZIP + static site in apps/site/dist
```

### Going live: what still has to be filled in

**Step-by-step guide, including getting a server if you don't have one: [docs/DEPLOY.md](docs/DEPLOY.md).**

Everything below is intentionally empty in the repository. Nothing else needs code changes.

1. **GitHub Pages**: Settings → Pages → Source: *GitHub Actions*. (Pages on a private repository needs a paid GitHub plan; otherwise make the repository public.)
2. **Analysis API server**: any Linux VM with Docker. Run `deploy/bootstrap.sh <api-hostname>` on it, point DNS at it, then add to the `production` environment the secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, and the repository variable `ANALYSIS_API_URL` (e.g. `https://api.example.com`). Run **Deploy analysis API**. It republishes the site when it finishes.
3. **Sepolia demo contracts**: in the `sepolia` environment add `SEPOLIA_RPC_URL` and `SEPOLIA_DEPLOYER_KEY` (a testnet-only key with a little Sepolia ETH; optional `ETHERSCAN_API_KEY` to verify sources, optional variable `SEPOLIA_ATTACKER_ADDRESS`). Run **Deploy demo contracts to Sepolia**. It commits `incoming/ps2-project/deployments/sepolia.json` and republishes the site.
4. **Optional links**: repository variables `SITE_REPO_URL`, `CHROME_STORE_URL`, `DEMO_VIDEO_URL`, and documented real attack transactions for one-click replay in `realAttackReplays` in `apps/site/site.config.json`.

Until the API is configured the site still publishes: pages show "Analysis API not configured yet" instead of failing silently, and the demo page says the contracts are not deployed yet.

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

Open **http://localhost:3000**. This command starts a loopback-only chain (31337), deploys the test contracts, seeds three NFTs and the 500 pUSD stale allowance used by `claim()`, writes the actual deployment addresses, and starts the full analysis API on 8080. AuraRewards is only the test dapp: it connects a wallet and sends ordinary wallet requests. It never calls the analysis API or renders risk reports. Install the Cognitia extension using the steps below to intercept and analyze those requests.

If another project uses these ports:

```sh
DEMO_RPC_PORT=18545 DEMO_API_PORT=18080 DEMO_WEB_PORT=13000 npm run dev:demo
```

The launcher refuses to reuse or reset an existing chain. Stop it with Ctrl-C. Restarting creates a fresh demo chain and seed state.

## Real wallet interception

```sh
# Set this to the actual API URL BEFORE building (8080 is the default).
API_BASE_URL=http://localhost:8080 npm run build -w @cognitia/extension
# Or use the API URL from your running demo deployment automatically:
npm run build:demo-extension
```

In Chrome, load `incoming/atif-extension/dist` unpacked from `chrome://extensions`, then reload the dapp. After rebuilding, click Reload on the extension and reload the dapp again. Select your wallet, click **Connect Wallet**, switch to Anvil, and choose an offer. Use a disposable Anvil account, never a funded real wallet. Anvil's first development account is `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`; its publicly known test key is in `scripts/deploy-local.ts`. This seeded account is required to reproduce the hidden 500 pUSD drain; other accounts do not have that stale allowance.

The extension holds the dapp's request before the original wallet provider sees it. Its background worker calls the simulation API and displays the real report in the extension side panel. Reports stay docked in the browser side panel. If the browser blocks automatic opening, click Cognitia’s toolbar icon (marked with an ! badge while a request is held). No separate review window is created. **Reject** cancels with code 4001; **Continue to wallet** forwards the captured payload once. Transactions, ERC-2612 typed data and `personal_sign` are supported. Unsupported signing variants are blocked. Changing account or chain invalidates a pending review. Requests cannot overwrite an existing review. A disconnected wallet never becomes a mock wallet. Without the extension installed, this ordinary test dapp sends requests directly to the wallet.

The extension's error screen retains an explicit “continue without analysis” acknowledgement; no failed analysis is presented as safe. Reports include immediate before/after state, conditional permit effects, exposure, findings and downloadable evidence. The extension and AuraRewards share `incoming/ps2-project/demo/theme.css`; extension fonts are bundled for offline rendering. The build grants host permission for the configured analysis API. Provider wrapping is an MVP boundary: direct RPC transports, pre-cached providers, legacy signing transports and other frames can bypass it. It is not a wallet-integrated security boundary.

## What is analyzed

| PS2 requirement | Implementation |
|---|---|
| Live state fork | Isolated Anvil instance, pinned block/hash, upstream RPC used for reads only |
| State differences | Native balance/gas, ERC-20 balances and allowances, ERC-721 token approvals/ownership, ERC-721/1155 operator permissions, ERC-1155 balances |
| Intent and hidden effects | Standard calldata, unknown selectors, internal transfers, reverts, delegatecall targets |
| Threat matching | Chain-scoped address/domain records plus exact runtime hash matching from fork observations; evidence includes provenance |
| Demo attack | Deployed `FakeRewardsDrainer.claim()` spends the seeded allowance; `FakeNFTRewards` is the "verify eligibility (approve-all) → claim rewards" flow that sweeps every NFT; approvals and permits demonstrate later drains |
| Before signing | Provider interception, pending review, rejection, immutable reviewed payload and exactly-once forwarding |
| Human report | Severity, explanations, immediate vs conditional effects, exposed assets, coverage, assumptions and downloadable JSON |

The root API now combines the original simulator, baseline rules and teammate risk engine by default. There is no separate “combined API” required. Unsigned permits are **conditional authorization models**, not evidence that a missing signature is valid; domain, signer, nonce and deadline checks are disclosed. Unsupported signatures retain unknown/partial coverage. Asset discovery is bounded to calldata, logs, traces and hints; this is not exhaustive wallet inventory. Unknown bytecode does not itself prove malice. The small bundled threat dataset is not a live intelligence feed; absence of a match is not a safety guarantee. Placeholder runtime hashes and sanctions-only records were removed from drainer evidence.

## API and live chains

```sh
cp services/api/.env.example services/api/.env
# Set SIM_CHAINS=1,11155111. No RPC configuration is required.
npm run dev:api
```

Environment files are loaded by the server. **No RPC provider account or API key is needed.** Chains 1 and 11155111 default to keyless public endpoints, each with fallbacks: an endpoint that rate-limits or goes down is parked for a minute and the next one in the list is used, so a public RPC throttling mid-demo degrades latency instead of failing the report. `RPC_URL_<chainId>` replaces a chain's whole list, highest preference first, so a keyed endpoint can sit in front of a public backup: `RPC_URL_1=https://my-keyed-endpoint,https://ethereum-rpc.publicnode.com`. Only fork acquisition rotates; once an analysis is running its reads stay bound to the fork it started on. `/ready` reports the host that answered and how many endpoints are configured, never the full URL, which may carry a key. `GET /health` checks the process; `GET /ready` checks configured upstream chain identity/readiness. `POST /v1/analyze` accepts the exact wallet method/params with `requestId`, `origin`, numeric `chainId`, and `account`. `POST /v1/replay` accepts `{ "chainId": 1, "txHash": "0x…" }`, then replays against the end of the preceding block; earlier transactions in the same block are not applied. Historical replays need archive RPC access.

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
# Verify the bundled production API from an isolated folder, with the same chain:
npm run test:packaged
# Built MV3 extension + real API + non-signing wallet double in isolated Chromium:
npx playwright install chromium
npm run test:extension
# For custom testbed ports:
DEMO_WEB_URL=http://localhost:13000 npm run test:extension
# Optional read-only live mainnet fork verification:
npm run test:mainnet
```

The smoke test sends the eight demo requests (including the NFT rewards sweep) plus unknown calldata and personal signing through the real HTTP API, validates every response using the extension schema, checks expected severities/state changes, and verifies that the upstream block is unchanged. Reports are saved in `artifacts/demo-reports`. `test:packaged` copies only the built server into a temporary folder, checks readiness and disabled debug routes, and repeats the scenarios without repository dependencies. Its reports are in `artifacts/packaged-reports`. CI also runs the same scenarios against the Docker image and uploads `artifacts/container-reports`. `TEST_API_URL` and `TEST_REPORT_DIR` override the smoke-test endpoint and evidence directory. Solidity and fork integration tests also cover ERC-1155 transfers, single-NFT approvals, delegatecalls, concurrency and upstream state isolation.

## GitHub Actions deployment

The active workflows are at the repository root in `.github/workflows`; workflows inside teammate folders are historical and do not run.

- **MVP checks**: clean install, typechecks, all tests, contract tests, seeded demo smoke tests, extension artifact, evidence artifact and Docker build.
- **Deploy analysis API**: runs checks, publishes a private GHCR image, deploys to a Docker VM through verified SSH, and checks `/ready` over HTTPS.
- **Deploy demo contracts to Sepolia**: manual testnet-only deployment with a chain-ID check; records the addresses for the site and republishes it. The local bait dapp (`incoming/ps2-project/demo`) stays restricted to chain 31337; the public Sepolia demo is `apps/site/demo.html`.
- **Publish site**: builds the extension ZIP against `ANALYSIS_API_URL` and publishes `apps/site` to GitHub Pages.

For API deployment, run `deploy/bootstrap.sh <api-hostname>` on the VM as the deployment user. It installs Docker, creates `/opt/cognitia` owned by that user, and writes a keyless `/opt/cognitia/.env` (an existing one is left alone); `deploy/.env.example` documents the same settings if you would rather write it by hand. Point an A record for the hostname at the VM and open ports 80 and 443 — Caddy needs port 80 to obtain its certificate. Set repository variable `ANALYSIS_API_URL` to `https://your-api-host`. Configure the `production` environment secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and `DEPLOY_KNOWN_HOSTS` (verified host key, not a runtime trust-on-first-use scan). The deployment user must be able to run Docker. Run **Deploy analysis API** manually. Caddy terminates HTTPS; Anvil forks and the API port are not publicly exposed. The extension artifact is built with the configured API URL. Public deployments should restrict origins and add authenticated access if serving beyond a controlled demo.

For Sepolia, configure environment secrets `SEPOLIA_RPC_URL` and `SEPOLIA_DEPLOYER_KEY` using a dedicated testnet-only account with test ETH. No deployment credentials are stored in this repository. Workflows are supplied for deployment; local verification does not imply a production or Sepolia deployment has run.

## Layout

`apps/site`: public website (landing, install, playground, live demo); `packages/shared`: contracts/schemas; `packages/simulator`: fork and diff engine; `services/api`: HTTP pipeline; `incoming/atif-extension`: Chrome extension; `incoming/swastik-risk-engine`: deterministic rules/adapters; `incoming/integration`: bridge; `incoming/ps2-project`: Solidity demo and dapp. The extension and risk engine are now npm workspaces, installed from the root lockfile. The legacy Next.js workbench has no default synthetic simulation; use the root API for live reports.

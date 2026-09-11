# Cognitia

Pre-execution transaction interceptor for EVM wallets. A browser extension catches signing
requests before MetaMask sees them, an analysis API simulates the transaction on a forked chain,
and the side panel shows what would actually happen (asset outflows, approvals, drainer patterns)
before the user decides to continue or reject.

**This repository is private.** Only invited collaborators can clone it; see
[Cloning](#cloning-private-repo) below.

## Layout

| Path | Owner | What it is |
|---|---|---|
| `packages/shared` | Asif | Shared types, Zod schemas, fixtures |
| `packages/simulator` | Asif | Anvil fork simulation (state diffs, traces, exposures) |
| `services/api` | Asif | Fastify analysis API (`/v1/analyze`, `/v1/chains`, `/v1/replay`, `/health`) |
| `incoming/atif-extension` | Atif | Chrome MV3 extension: interceptor, service worker, side panel (React + Vite) |
| `incoming/swastik-risk-engine` | Swastik | Decoder, threat DB, severity rules (Next.js app) |
| `incoming/ps2-project` | Syed | Foundry contracts, demo dapp, docker compose, CI |
| `incoming/integration` | Asif | Glue: engine bridge, contract checks, combined server |

The three `incoming/*` folders are teammate drops and are **not** part of the npm workspaces yet.
Each one is installed separately (see below). Integration status, verified scenarios, and open
items per person are in [`incoming/README.md`](incoming/README.md).

## Prerequisites

- **Node.js 20.11+** (`node -v`)
- **Foundry** (`anvil`, `forge`, `cast`) — the API forks chains with `anvil`, and Syed's contracts
  build with `forge`. Install: <https://book.getfoundry.sh/getting-started/installation>
- **Google Chrome** for the extension
- **Python 3** only if you want to serve Syed's demo site with `serve.py`
- (optional) **Docker** for `incoming/ps2-project/infra/docker-compose.yml`

## Cloning (private repo)

You need to be added as a collaborator first. Then either:

```bash
# with GitHub CLI (easiest; run `gh auth login` once)
gh repo clone MdAsif678/Cognitia-private

# or with plain git; you'll be prompted for your GitHub username and a
# Personal Access Token (classic, `repo` scope) as the password
git clone https://github.com/MdAsif678/Cognitia-private.git

# or over SSH if you have a key on your GitHub account
git clone git@github.com:MdAsif678/Cognitia-private.git
```

Never commit tokens, private keys, or `.env` files. `.gitignore` already excludes `.env*`
(except `.env.example`), `node_modules/`, build output, and local archives.

## Quick start (API + extension)

### 1. Analysis API

```bash
npm install          # installs packages/* and services/* via workspaces
npm run dev:api      # http://localhost:8080
```

Check it: `curl http://localhost:8080/health`

No `.env` is required; it defaults to keyless public RPCs. For faster, unthrottled forks copy
[`services/api/.env.example`](services/api/.env.example) to `services/api/.env` and set
`RPC_URL_1` / `RPC_URL_11155111` to an Alchemy or Infura URL.

To run the API **with Swastik's risk engine merged in** (recommended for the demo), first install
his folder (step 3), then:

```bash
npx tsx incoming/integration/serve-with-swastik.ts   # http://localhost:8081, same routes
```

### 2. Chrome extension

The backend URL is baked in at **build time**, so set it before building:

```bash
cd incoming/atif-extension
npm install
cp .env.example .env     # API_BASE_URL=http://localhost:8080 (use 8081 for the combined server)
npm run build            # -> dist/
```

Then in Chrome: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select
`incoming/atif-extension/dist`. Open any dapp, trigger a wallet signature, and the side panel opens.

Tests: `npm test` (in that folder). Mock backend for UI work only: `npm run mock-backend`
(port 3000).

### 3. Swastik's risk engine (standalone Next.js app)

```bash
cd incoming/swastik-risk-engine
npm install
cp .env.example .env
npm run dev              # http://localhost:3000
npm test
```

Only needed standalone for his UI; the API consumes his engine through
`incoming/integration/swastik-bridge.ts`.

### 4. Syed's contracts + demo dapp (local chain)

```bash
cd incoming/ps2-project
forge install            # restores lib/forge-std and lib/openzeppelin-contracts (not committed)
forge build
```

Run a local chain and deploy (the private key below is Anvil's default test account #0, not a
secret):

```bash
anvil --port 8545 --chain-id 31337
cast rpc anvil_setNonce 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0x8 --rpc-url http://127.0.0.1:8545
forge script script/DeployAll.s.sol:DeployAll --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```

Seeding for buttons 2/3/5 (mint 3 NFTs, approve 500 pUSD to the drainer) and the addresses are
described in [`incoming/ps2-project/HANDOFF_TO_TEAM.md`](incoming/ps2-project/HANDOFF_TO_TEAM.md)
and [`incoming/README.md`](incoming/README.md). Serve the site:

```bash
python3 demo/serve.py    # http://localhost:3000
# or: docker compose -f infra/docker-compose.yml up   (anvil + site)
```

Point the API at the local chain with `RPC_URL_31337=http://127.0.0.1:8545` in `services/api/.env`.

> Known issue: `forge test` currently fails in `AttackScenariosTest.setUp()`
> (`ERC1155InvalidReceiver`). Fix is to make the test contract inherit `ERC1155Holder`; see
> `incoming/README.md`.

## Tests and checks

```bash
npm test                 # shared + simulator + api (vitest)
npm run typecheck
cd incoming/atif-extension && npm test
cd incoming/swastik-risk-engine && npm test
cd incoming/ps2-project && forge test
```

## Ports

| Service | Port |
|---|---|
| Analysis API | 8080 |
| API + Swastik engine (combined) | 8081 |
| Local Anvil chain | 8545 |
| Syed's demo site / Swastik's Next app / Atif's mock backend | 3000 (run one at a time) |

## Contributing

- Work on a branch and open a pull request into `main`.
- Keep teammate code in its `incoming/<name>` folder until the planned merge
  (`packages/risk-engine`, `apps/extension`) described at the end of `incoming/README.md`.
- Do not commit `.env`, keys, `node_modules`, `dist/`, `out/`, `cache/`, or archives.

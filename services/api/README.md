# @cognitia/api — analysis endpoint

`POST /v1/analyze` takes a wallet request the extension intercepted and returns a severity-ranked
`AnalysisReport`. Pipeline: **normalize → decode → simulate → compare → assess → report**.

## Run it

```bash
npm install                      # from the repo root; needs Foundry's anvil (foundryup, or ANVIL_PATH)
npm run dev -w @cognitia/api     # http://localhost:8080, forks Sepolia + mainnet via public RPCs
```

Configuration is environment-only — see [.env.example](.env.example). The defaults work without API keys.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/analyze[?blockNumber=N]` | **The extension's endpoint.** Body = `AnalyzeRequest`. Always 200 with a report (failed ones included); 400 only for malformed bodies. |
| POST | `/v1/replay` | `{chainId, txHash}` — re-analyse a mined transaction as if unsigned, forked at the block before it. For real, documented attack transactions (old blocks need an archive RPC). |
| POST | `/v1/simulate` | Raw `SimulationResult` without risk assessment (debug; disable with `ENABLE_DEBUG_ROUTES=false`). |
| GET | `/v1/chains` | Supported chains. |
| GET | `/health` | Liveness + fork pool stats. |
| GET | `/ready` | 200 only if every upstream RPC is reachable and serves the right chain. |

### Contract with the extension

- Request: `AnalyzeRequest` (frozen) — `packages/shared/src/request.ts`.
- Response: `AnalysisReport` — `packages/shared/src/report.ts`. Amounts are decimal strings; token
  symbols/decimals for display are in `report.tokens`.
- `report.requestHash` = `computeRequestHash(request)` from `@cognitia/shared`. Recompute it before
  forwarding to MetaMask and discard a report whose hash does not match.
- `immediateChanges` are what signing does; `conditionalChanges` are what could happen afterwards
  (every entry carries `timing`). Never show conditional losses as immediate.
- Safety rules the API enforces:
  - timeout or simulation failure → `status: "failed"`, `severity: "unknown"`, summary starting
    `ANALYSIS UNAVAILABLE`;
  - any report that is not `complete` is never `low`.
- Sample reports generated from real runs: `packages/shared/fixtures/*.json` (`{ request, report }`
  pairs: benign transfer, NFT operator approval, unlimited approval, hidden drain in `claim()`,
  revert, permit signature, failed analysis). Regenerate with `npm run fixtures -w @cognitia/api`.

```bash
curl -s localhost:8080/v1/analyze -H 'content-type: application/json' -d '{
  "requestId": "demo-1", "origin": "https://claim.example", "chainId": 11155111,
  "account": "0xd46F94e12cfbdf39103617bf29Be11daf78E9ad3", "method": "eth_sendTransaction",
  "params": [{ "from": "0xd46F94e12cfbdf39103617bf29Be11daf78E9ad3",
               "to": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
               "data": "0x095ea7b3000000000000000000000000a77ac0000000000000000000000000000000bad1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }] }'
# → HIGH RISK — Grants unlimited USDC spending to 0xA77a…BAd1 (real Sepolia USDC balance at a verified block)
```

### Risk engine seam

The API depends only on the `RiskEngine` interface (`packages/shared/src/engine.ts`: `decode()` and
`assess()`). It ships a **baseline engine** (`src/engine/`) so the pipeline works end to end today:
standard-ABI decoding, ERC-2612/DAI permit adapters, and conservative severity rules (unlimited
approvals, operator approvals, hidden outflows, reverts, non-proxy delegatecalls, failed permit
checks). `@cognitia/risk-engine` replaces it in `createEngine()` in `src/server.ts`; its inputs
are the normalized request, the decoded intent and the full `SimulationResult`.

## Build, test, deploy

```bash
npm test -w @cognitia/api        # unit + pipeline guarantees + end-to-end against a local chain
npm run build -w @cognitia/api   # single-file bundle: dist/server.mjs
docker build -f services/api/Dockerfile -t cognitia-api .    # from the repo root; bundles anvil
docker run -p 8080:8080 --env-file services/api/.env cognitia-api
```

The container runs anvil internally on `127.0.0.1`, so forks are never exposed; only port 8080 is
published. For CI, install Foundry with `foundry-rs/foundry-toolchain@v1` before `npm test`
(without it the fork tests are skipped, not failed), and use `GET /ready` as the post-deploy health check.

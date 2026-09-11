# @cognitia/simulator — fork simulation & state diff engine

Executes an **unsigned** transaction (or models an unsigned signature) on a **private Anvil fork of live
chain state** and reports exactly what changes. Nothing is ever broadcast: the upstream RPC is only
read from, and execution happens on a loopback-only anvil process that is killed after each analysis.

```ts
import { Simulator, chainsFromEnv } from "@cognitia/simulator";

const sim = new Simulator({ chains: chainsFromEnv(), warmForksPerChain: 1 });
const result = await sim.simulateTransaction({
  chainId: 11155111,
  tx: { from, to, data, value },       // exactly what the dapp asked the wallet to send
  blockNumber: undefined,               // optional: pin a historical block (replays)
  hints: undefined,                     // optional: extra entities from the decoder
  signal,                               // aborting kills the fork
});
```

The result type is `SimulationResult` in `@cognitia/shared` (Zod schema + TS type).

## How one analysis runs

1. **Pin a block.** Anvil forks `head − blockLag` (or the requested block). The pinned number,
   hash and timestamp are read back from the fork and the hash is **verified against the upstream
   RPC** (`fork.verified`).
2. **Warm the cache.** `eth_createAccessList` on the upstream tells us which slots the tx touches;
   those plus the per-block system-contract slots (EIP-4788/2935/7002/7251) are fetched in parallel.
3. **Execute on the fork only.** The sender is impersonated, gas is priced at zero (so native diffs
   show transferred value, not fees), and the block timestamp is deterministic. Receipt, logs and a
   `callTracer` trace are collected.
4. **Discover.** Tokens, accounts, token IDs and approval relationships are collected from
   **calldata + every internal CALL frame + logs** (so a `claim()` that internally calls
   `transferFrom` is found even though the calldata says nothing about tokens, and allowances spent
   without an `Approval` event are still read).
5. **Classify tokens** via ERC-165, event shapes, then an ERC-20 probe; read symbol/decimals.
6. **Read after-state**, then `evm_revert` to the clean snapshot of the *same block* and **read
   before-state** for the same set of entities.
7. **Diff** → `immediateChanges`. Compute **exposure** (authority someone else now holds).
8. **Conditional follow-up.** If authority was granted, a second scenario impersonates the
   spender and uses it (`transferFrom` / NFT takeover) → `conditional.changes`, always labelled
   `timing: "conditional"`.
9. The fork process is killed.

### State coverage

| Asset | Read before/after |
|---|---|
| Native currency | balances of sender, target, every value-transferring frame (gas excluded) |
| ERC-20 | `balanceOf`, `allowance(owner, spender)`, WETH deposit/withdraw |
| ERC-721 | `ownerOf`, `getApproved`, `isApprovedForAll`, holder counts, enumerable IDs |
| ERC-1155 | `balanceOf(account, id)` for single and batch transfers, `isApprovedForAll` |

Failed reads are never guessed: they appear in `coverage.missing` and set `coverage.complete = false`.

### Signatures (`simulateConditional`)

An unsigned permit cannot be executed (the signature does not exist yet). The simulator models it:
it validates the message against live state (`nonce`, `deadline`, `chainId`, `verifyingContract`,
`DOMAIN_SEPARATOR`), grants the equivalent allowance by **impersonating the owner** and calling
`approve`, then has the spender pull `min(allowance, balance)`. The result has `immediateChanges: []`
and every assumption spelled out, starting with *"Conditional outcome if this signature is signed
and accepted"*.

### Isolation guarantees

- One anvil process per analysis (optionally pre-started), bound to `127.0.0.1`, killed afterwards.
- Concurrency is capped (`maxConcurrentForks`); excess requests queue, then fail with `BUSY`.
- The upstream RPC client only issues reads. Tests assert the upstream chain is unchanged.

## Performance (public publicnode.com RPC, from a laptop)

| Case | Time |
|---|---|
| Local chain (tests) | 0.3–0.9 s |
| Sepolia USDC transfer, warm fork | ~2.3 s |
| Mainnet/Sepolia unlimited approval + conditional drain, warm fork | ~6–7 s |
| Same, cold fork | ~9–12 s |

Most remaining time is upstream round-trips; a keyed RPC (Alchemy/Infura) via `RPC_URL_<chainId>`
is noticeably faster. `scripts/bench.ts` prints per-stage timings (`timingsMs` is in every result).

## Scripts & tests

```bash
npm test -w @cognitia/simulator            # unit + integration (integration skips if anvil is missing)
npm run simulate -w @cognitia/simulator -- --example mainnet-usdc-approve
npm run simulate -w @cognitia/simulator -- --chain 11155111 --from 0x.. --to 0x.. --data 0x..
npx tsx packages/simulator/scripts/bench.ts --runs 3 --warm 1
```

Integration tests start a local anvil as the "upstream", deploy fixture tokens/NFTs/drainer
(`test/fixtures/Fixtures.sol`, compiled with solc-js), and fork it exactly as they would fork
Sepolia. They cover transfers, unlimited approvals, operator approvals, single NFT approvals,
ERC-1155 batches, hidden `transferFrom` inside `claim()`, reverts, native value vs gas,
delegatecalls, historical block pinning, permits (valid and invalid), concurrent isolation, and
that the upstream never changes.

## Known limits

- Only assets referenced by calldata, logs or the trace are compared — wallets are not enumerated.
- ERC-721 token IDs are only enumerable for ERC721Enumerable collections (or IDs seen in the tx).
- Permit2 and other signature types need an adapter that produces a `ConditionalAuthorization`.
- Deterministic next-block timestamps are `fork timestamp + blockTime`, which can lag real time by
  up to the warm-fork age (default 30 s).

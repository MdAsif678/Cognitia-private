import { toHex, type Address, type Hex, type PublicClient } from "viem";
import type { ForkRpc } from "./rpc";
import { mapLimit } from "./util";

/**
 * Anvil fetches missing remote state one slot at a time while executing, so a cold fork pays a
 * full upstream round-trip per storage slot. Everything here warms that cache in parallel before
 * execution; it is purely a performance optimisation and every failure is ignored.
 */

const BEACON_ROOTS = "0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02" as Address; // EIP-4788
const HISTORY_STORAGE = "0x0000F90827F1C53a10cb7A02335B175320002935" as Address; // EIP-2935
const WITHDRAWAL_REQUESTS = "0x00000961Ef480Eb55e80D19ad83579A64c007002" as Address; // EIP-7002
const CONSOLIDATION_REQUESTS = "0x0000BBdDc7CE488642fb579F8B00f3a590007251" as Address; // EIP-7251
const RING = 8191n;

type Touch = { address: Address; slots: Hex[] };

/** Slots the per-block system calls touch when mining block `number` at `timestamp`. */
function systemTouches(firstBlock: bigint, firstTimestamp: bigint, blocks: number, blockTime: bigint): Touch[] {
  const beacon: Hex[] = [];
  const history: Hex[] = [];
  for (let i = 0n; i < BigInt(blocks); i++) {
    const ts = firstTimestamp + i * blockTime;
    beacon.push(toHex(ts % RING, { size: 32 }), toHex((ts % RING) + RING, { size: 32 }));
    history.push(toHex((firstBlock + i - 1n) % RING, { size: 32 }));
  }
  const queueHeader = [0n, 1n, 2n, 3n].map((s) => toHex(s, { size: 32 }));
  return [
    { address: BEACON_ROOTS, slots: beacon },
    { address: HISTORY_STORAGE, slots: history },
    { address: WITHDRAWAL_REQUESTS, slots: queueHeader },
    { address: CONSOLIDATION_REQUESTS, slots: queueHeader },
  ];
}

async function warm(rpc: ForkRpc, touches: Touch[]): Promise<void> {
  const jobs: (() => Promise<unknown>)[] = [];
  const seen = new Set<string>();
  for (const t of touches) {
    const a = t.address.toLowerCase();
    if (!seen.has(a)) {
      seen.add(a);
      jobs.push(() => rpc.request("eth_getCode", [t.address, "latest"]));
      jobs.push(() => rpc.request("eth_getBalance", [t.address, "latest"]));
      jobs.push(() => rpc.request("eth_getTransactionCount", [t.address, "latest"]));
    }
    for (const s of t.slots) {
      const k = `${a}:${s.toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      jobs.push(() => rpc.request("eth_getStorageAt", [t.address, s, "latest"]));
    }
  }
  await mapLimit(jobs, 32, (job) => job().catch(() => undefined));
}

export async function prefetchSystemState(rpc: ForkRpc, nextBlock: bigint, nextTimestamp: bigint, blocks: number, blockTime: bigint) {
  const coinbase = await rpc.request<Address>("eth_coinbase").catch(() => undefined);
  const touches = systemTouches(nextBlock, nextTimestamp, blocks, blockTime);
  if (coinbase) touches.push({ address: coinbase, slots: [] });
  return warm(rpc, touches);
}

type AccessListResult = { accessList: { address: Address; storageKeys: Hex[] }[] };

/**
 * Ask the upstream node which accounts/slots the transaction touches at the pinned block
 * (eth_createAccessList), then pull them into the fork's cache concurrently.
 */
export async function prefetchTransactionState(
  rpc: ForkRpc,
  upstream: PublicClient,
  blockNumber: bigint,
  tx: { from: Address; to?: Address; data?: Hex; value: bigint },
): Promise<number> {
  const accounts: Touch[] = [{ address: tx.from, slots: [] }];
  if (tx.to) accounts.push({ address: tx.to, slots: [] });
  try {
    const call: Record<string, string> = { from: tx.from, value: toHex(tx.value), gasPrice: "0x0" };
    if (tx.to) call.to = tx.to;
    if (tx.data) call.data = tx.data;
    const res = await upstream.request({ method: "eth_createAccessList", params: [call, toHex(blockNumber)] } as never) as AccessListResult;
    for (const e of res.accessList ?? []) accounts.push({ address: e.address, slots: e.storageKeys ?? [] });
  } catch {
    // Upstream may not support eth_createAccessList (or the call reverts); fall back to lazy fetching.
  }
  await warm(rpc, accounts);
  return accounts.reduce((n, a) => n + a.slots.length, 0);
}

/** Deterministic timestamp for the block mined by step `stepIndex`, so repeated runs hit the cache. */
export function stepTimestamp(forkTimestamp: bigint, stepIndex: number, blockTime: bigint) {
  return forkTimestamp + blockTime * BigInt(stepIndex + 1);
}

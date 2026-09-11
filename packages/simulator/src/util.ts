import { getAddress, type Address } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Checksummed form, used for every address the simulator emits. */
export function addr(value: string): Address {
  return getAddress(value);
}

export function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function isZeroAddress(a: string | undefined | null): boolean {
  return !a || /^0x0{40}$/i.test(a);
}

export function short(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: string; details?: string; message?: string };
    const msg = e.shortMessage ?? e.message ?? String(err);
    return e.details && !msg.includes(e.details) ? `${msg} (${e.details})` : msg;
  }
  return String(err);
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

const UNLIMITED_SENTINELS = new Set<bigint>([
  (1n << 96n) - 1n,
  (1n << 112n) - 1n,
  (1n << 128n) - 1n,
  (1n << 160n) - 1n,
]);

/** Max uint256, anything ≥ 2^255, and the common uintN max values tokens use as "infinite". */
export function isUnlimitedAmount(v: bigint): boolean {
  return v >= 1n << 255n || UNLIMITED_SENTINELS.has(v);
}

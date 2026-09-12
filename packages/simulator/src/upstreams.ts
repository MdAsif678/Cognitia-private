import { SimulationError } from "./errors";
import { errorMessage } from "./util";

/** Endpoints parked after a failure are retried again after this long. */
export const UPSTREAM_COOLDOWN_MS = 60_000;

/**
 * The ordered upstream endpoints configured for one chain. Keyless public RPCs rate-limit without
 * warning, so a failing endpoint is parked for a cooldown and the next one is used instead of the
 * analysis failing. Nothing is ever dropped permanently: a 429 is a transient condition, and the
 * configured order is the preference order the operator asked for.
 */
export class UpstreamRotation {
  private readonly parkedUntil = new Map<string, number>();

  constructor(
    readonly endpoints: readonly string[],
    private readonly cooldownMs: number = UPSTREAM_COOLDOWN_MS,
  ) {
    if (endpoints.length === 0) throw new Error("an upstream rotation needs at least one endpoint");
  }

  /** Configured order, with any endpoint still cooling down moved to the back. */
  order(now: number = Date.now()): string[] {
    return this.endpoints
      .map((url, rank) => ({ url, rank, parked: (this.parkedUntil.get(url) ?? 0) > now }))
      .sort((a, b) => Number(a.parked) - Number(b.parked) || a.rank - b.rank)
      .map((e) => e.url);
  }

  /** The endpoint to prefer right now. */
  current(now: number = Date.now()): string {
    return this.order(now)[0]!;
  }

  /** True while every configured endpoint is parked, i.e. the chain has no known-good upstream. */
  allParked(now: number = Date.now()): boolean {
    return this.endpoints.every((url) => (this.parkedUntil.get(url) ?? 0) > now);
  }

  park(url: string, now: number = Date.now()) {
    this.parkedUntil.set(url, now + this.cooldownMs);
  }

  clear(url: string) {
    this.parkedUntil.delete(url);
  }
}

/** Ordered, de-duplicated upstream endpoints for a chain: the primary first, then its fallbacks. */
export function upstreamsOf(chain: { rpcUrl: string; fallbackRpcUrls?: string[] }): string[] {
  const all = [chain.rpcUrl, ...(chain.fallbackRpcUrls ?? [])].map((u) => u.trim()).filter(Boolean);
  return [...new Set(all)];
}

/** Host only: an upstream URL may carry an API key in its path or query, so never log it whole. */
export function upstreamLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/** Splits one `RPC_URL_<id>` value into a primary and its fallbacks (comma or whitespace separated). */
export function parseUpstreamList(value: string): string[] {
  return [...new Set(value.split(/[,\s]+/).map((u) => u.trim()).filter(Boolean))];
}

const TRANSIENT = /\b(429|rate.?limit|too many requests|timed? ?out|502|503|504|bad gateway|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up)\b/i;

/**
 * Whether the next upstream is worth trying. Local faults (no anvil binary, pool at capacity, an
 * aborted or malformed request) are not upstream problems, so they never rotate.
 */
export function isUpstreamFailure(err: unknown): boolean {
  if (err instanceof SimulationError) {
    return err.code === "FORK_FAILED" || err.code === "UPSTREAM_UNAVAILABLE" || err.code === "CHAIN_MISMATCH";
  }
  return TRANSIENT.test(errorMessage(err));
}

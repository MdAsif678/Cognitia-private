import type { Address } from "viem";
import type { Exposure, StateChange, Timing, TokenInfo } from "@cognitia/shared";
import { probeKey, type Probe, type ProbeReadings, type ProbeResult } from "./probes";
import { isUnlimitedAmount, isZeroAddress, sameAddress } from "./util";

export type DiffOutput = {
  changes: StateChange[];
  /** Probes where the before or after read failed. */
  failed: { probe: Probe; error: string }[];
};

function value(r: ProbeResult | undefined): { ok: true; v: unknown } | { ok: false; error: string } {
  if (!r) return { ok: false, error: "not read" };
  return r.ok ? { ok: true, v: r.value } : { ok: false, error: r.error };
}

export function diffProbes(probes: Probe[], before: ProbeReadings, after: ProbeReadings, timing: Timing): DiffOutput {
  const changes: StateChange[] = [];
  const failed: DiffOutput["failed"] = [];

  for (const p of probes) {
    const key = probeKey(p);
    const b = value(before.get(key));
    const a = value(after.get(key));
    if (!b.ok || !a.ok) {
      failed.push({ probe: p, error: !b.ok ? `before: ${b.error}` : `after: ${(a as { error: string }).error}` });
      continue;
    }
    if (b.v === a.v || (typeof b.v === "string" && typeof a.v === "string" && sameAddress(b.v, a.v))) continue;

    switch (p.type) {
      case "native-balance": {
        const bv = b.v as bigint;
        const av = a.v as bigint;
        changes.push({ timing, kind: "native-balance", account: p.account, before: `${bv}`, after: `${av}`, delta: `${av - bv}`, excludesGas: true });
        break;
      }
      case "erc20-balance": {
        const bv = b.v as bigint;
        const av = a.v as bigint;
        changes.push({ timing, kind: "erc20-balance", token: p.token, account: p.account, before: `${bv}`, after: `${av}`, delta: `${av - bv}` });
        break;
      }
      case "erc20-allowance": {
        const bv = b.v as bigint;
        const av = a.v as bigint;
        changes.push({
          timing,
          kind: "erc20-allowance",
          token: p.token,
          owner: p.owner,
          spender: p.spender,
          before: `${bv}`,
          after: `${av}`,
          unlimitedBefore: isUnlimitedAmount(bv),
          unlimitedAfter: isUnlimitedAmount(av),
        });
        break;
      }
      case "erc721-owner":
        changes.push({ timing, kind: "erc721-owner", token: p.token, tokenId: `${p.tokenId}`, before: b.v as Address | null, after: a.v as Address | null });
        break;
      case "erc721-approved":
        changes.push({ timing, kind: "erc721-token-approval", token: p.token, tokenId: `${p.tokenId}`, before: b.v as Address | null, after: a.v as Address | null });
        break;
      case "operator-approval":
        changes.push({ timing, kind: "operator-approval", token: p.token, standard: p.standard, owner: p.owner, operator: p.operator, before: b.v as boolean, after: a.v as boolean });
        break;
      case "erc1155-balance": {
        const bv = b.v as bigint;
        const av = a.v as bigint;
        changes.push({ timing, kind: "erc1155-balance", token: p.token, tokenId: `${p.tokenId}`, account: p.account, before: `${bv}`, after: `${av}`, delta: `${av - bv}` });
        break;
      }
      case "erc721-count":
        // Derived from owner changes; used only for exposure sizing.
        break;
    }
  }
  return { changes, failed };
}

function readBig(r: ProbeReadings, p: Probe): bigint | undefined {
  const x = r.get(probeKey(p));
  return x?.ok && typeof x.value === "bigint" ? x.value : undefined;
}

export type ExposureContext = {
  after: ProbeReadings;
  probes: Probe[];
  tokens: Map<string, TokenInfo>;
  /** Token IDs held by an owner, when the collection could be enumerated. */
  ownedTokenIds: Map<string, bigint[]>;
  /** Spenders that actually pulled assets in this request (for "existing-used"). */
  pullers: Set<string>;
  basis: "granted" | "conditional-signature";
};

export function ownedKey(token: string, owner: string) {
  return `${token.toLowerCase()}:${owner.toLowerCase()}`;
}

/**
 * Authority held by someone other than the owner after the request: new or increased ERC-20
 * allowances, new operator approvals, new single-token approvals — plus pre-existing allowances
 * the request itself used, since those can be used again.
 */
export function computeExposures(changes: StateChange[], ctx: ExposureContext): Exposure[] {
  const out: Exposure[] = [];

  for (const c of changes) {
    if (c.kind === "erc20-allowance") {
      const before = BigInt(c.before);
      const after = BigInt(c.after);
      const info = ctx.tokens.get(c.token.toLowerCase());
      const supply = info?.totalSupply ? BigInt(info.totalSupply) : undefined;
      const balance = readBig(ctx.after, { type: "erc20-balance", token: c.token, account: c.owner });
      const common = {
        kind: "erc20-allowance" as const,
        token: c.token,
        standard: "erc20" as const,
        owner: c.owner,
        spender: c.spender,
        amount: c.after,
        unlimited: isUnlimitedAmount(after),
        exceedsTotalSupply: supply !== undefined && supply > 0n ? after >= supply : undefined,
        atRisk: { erc20Balance: balance?.toString() },
      };
      if (after > before) {
        out.push({ ...common, basis: ctx.basis, scope: isUnlimitedAmount(after) ? "Unlimited amount of this token, now and in future" : "Up to the approved amount of this token" });
      } else if (after > 0n && after < before && ctx.pullers.has(c.spender.toLowerCase())) {
        out.push({ ...common, basis: "existing-used", scope: "Remaining allowance that was already used in this request and can be used again" });
      }
    }

    if (c.kind === "operator-approval" && c.after && !c.before) {
      const count = readBig(ctx.after, { type: "erc721-count", token: c.token, account: c.owner });
      const ids = ctx.ownedTokenIds.get(ownedKey(c.token, c.owner));
      const balances1155 = ctx.probes
        .filter((p): p is Extract<Probe, { type: "erc1155-balance" }> => p.type === "erc1155-balance" && sameAddress(p.token, c.token) && sameAddress(p.account, c.owner))
        .map((p) => ({ tokenId: p.tokenId.toString(), balance: (readBig(ctx.after, p) ?? 0n).toString() }))
        .filter((x) => x.balance !== "0");
      out.push({
        kind: "operator-approval",
        basis: ctx.basis,
        token: c.token,
        standard: c.standard === "unknown" ? "unknown" : c.standard,
        owner: c.owner,
        spender: c.operator,
        unlimited: true,
        atRisk: {
          nftCount: count?.toString(),
          tokenIds: ids?.map(String),
          erc1155Balances: balances1155.length ? balances1155 : undefined,
        },
        scope: "Every current and future token in this collection, until the approval is revoked",
      });
    }

    if (c.kind === "erc721-token-approval" && c.after && !isZeroAddress(c.after) && !sameAddress(c.after, c.before)) {
      const owner = ctx.after.get(probeKey({ type: "erc721-owner", token: c.token, tokenId: BigInt(c.tokenId) }));
      const ownerAddr = owner?.ok && typeof owner.value === "string" ? (owner.value as Address) : undefined;
      if (!ownerAddr) continue;
      out.push({
        kind: "erc721-token-approval",
        basis: ctx.basis,
        token: c.token,
        standard: "erc721",
        owner: ownerAddr,
        spender: c.after,
        unlimited: false,
        tokenId: c.tokenId,
        atRisk: { tokenIds: [c.tokenId] },
        scope: `Token #${c.tokenId} of this collection`,
      });
    }
  }
  return out;
}

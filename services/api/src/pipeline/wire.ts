import type { Exposure, Finding, StateChange, TokenInfo } from "@cognitia/shared";
import { amount as fmtAmount, eth, tokenLabel } from "../engine/format";

/**
 * Fills the flat display fields the extension contract reads (`type`, `asset`, `from`, `to`,
 * `amount`, `spender`, `description`) without changing the typed `kind`-discriminated shape.
 */
export function wireChange(c: StateChange, tokens: TokenInfo[]): StateChange {
  const sym = (t: string) => tokenLabel(t, tokens);
  switch (c.kind) {
    case "native-balance":
      return { ...c, type: c.kind, asset: "ETH", amount: eth(c.delta) };
    case "erc20-balance":
      return { ...c, type: c.kind, asset: sym(c.token), amount: fmtAmount(c.delta.replace("-", ""), c.token, tokens).replace(/^/, c.delta.startsWith("-") ? "-" : "+") };
    case "erc20-allowance":
      return { ...c, type: c.kind, asset: sym(c.token), from: c.owner, amount: c.unlimitedAfter ? "unlimited" : fmtAmount(c.after, c.token, tokens) };
    case "erc721-owner":
      return { ...c, type: c.kind, asset: `${sym(c.token)} #${c.tokenId}`, from: c.before ?? undefined, to: c.after ?? undefined, amount: "1" };
    case "erc721-token-approval":
      return { ...c, type: c.kind, asset: `${sym(c.token)} #${c.tokenId}`, spender: c.after ?? undefined, amount: c.after ? "1 NFT" : "revoked" };
    case "operator-approval":
      return { ...c, type: c.kind, asset: sym(c.token), from: c.owner, spender: c.operator, amount: c.after ? "all tokens in collection" : "revoked" };
    case "erc1155-balance":
      return { ...c, type: c.kind, asset: `${sym(c.token)} #${c.tokenId}`, amount: c.delta.startsWith("-") ? c.delta : `+${c.delta}` };
  }
}

export function wireExposure(e: Exposure, tokens: TokenInfo[]): Exposure {
  const label = tokenLabel(e.token, tokens);
  const held =
    e.kind === "erc20-allowance" && e.atRisk.erc20Balance
      ? `You currently hold ${fmtAmount(e.atRisk.erc20Balance, e.token, tokens)}.`
      : e.kind === "operator-approval" && e.atRisk.nftCount
        ? `You currently hold ${e.atRisk.nftCount} ${label}.`
        : "";
  const limit = e.unlimited ? "an unlimited amount" : e.amount ? `up to ${fmtAmount(e.amount, e.token, tokens)}` : "the assets below";
  // `amount` stays the raw integer allowance (schema); the human-readable limit goes in description.
  return {
    ...e,
    asset: e.tokenId ? `${label} #${e.tokenId}` : label,
    description: `${e.spender} could take ${limit} — ${e.scope.charAt(0).toLowerCase()}${e.scope.slice(1)}. ${held}`.trim(),
  };
}

export function wireFinding(f: Finding): Finding {
  return { ...f, description: f.description ?? f.explanation };
}

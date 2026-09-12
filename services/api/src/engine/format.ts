import { formatUnits, maxUint256 } from "viem";
import type { TokenInfo } from "@cognitia/shared";
import { isUnlimitedAmount } from "@cognitia/simulator";

export function short(a: string | null | undefined): string {
  if (!a) return "nobody";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function tokenLabel(address: string, tokens: TokenInfo[]): string {
  const t = tokens.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (t?.symbol) return t.symbol;
  if (t?.name) return t.name;
  const standard = t?.standard && t.standard !== "unknown" && t.standard !== "native" ? t.standard.toUpperCase().replace("ERC", "ERC-") : "token";
  return `${standard} ${short(address)}`;
}

/** Human amount for display: "1,250.5 USDC", "unlimited USDC", "3 × TAPE". */
export function amount(raw: string | bigint, token: string, tokens: TokenInfo[]): string {
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const info = tokens.find((x) => x.address.toLowerCase() === token.toLowerCase());
  const label = tokenLabel(token, tokens);
  if (v === maxUint256 || isUnlimitedAmount(v)) return `unlimited ${label}`;
  if (info?.decimals !== undefined) return `${group(formatUnits(v, info.decimals))} ${label}`;
  return `${v.toString()} ${label}`;
}

export function eth(raw: string | bigint, symbol = "AUR"): string {
  return `${group(formatUnits(typeof raw === "bigint" ? raw : BigInt(raw), 18))} ${symbol}`;
}

function group(s: string): string {
  const [int, frac] = s.split(".");
  const neg = int!.startsWith("-");
  const digits = neg ? int!.slice(1) : int!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = frac ? `.${frac.slice(0, 6).replace(/0+$/, "")}` : "";
  return `${neg ? "-" : ""}${grouped}${f === "." ? "" : f}`;
}

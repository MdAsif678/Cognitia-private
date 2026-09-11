import { keccak256, stringToBytes } from "viem";
import { z } from "zod";
import { AddressSchema, type Hex } from "./primitives";

/** Frozen request contract between the extension (Atif) and the API (Asif). */
export const AnalyzeRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  origin: z.string().max(2048),
  chainId: z.number().int().positive(),
  account: AddressSchema,
  method: z.string().min(1).max(64),
  params: z.array(z.unknown()).max(16),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/** Wallet methods the pipeline understands. Anything else is reported as unsupported. */
export const TRANSACTION_METHODS = ["eth_sendTransaction"] as const;
export const SIGNATURE_METHODS = [
  "eth_signTypedData_v4",
  "eth_signTypedData_v3",
  "eth_signTypedData",
  "personal_sign",
  "eth_sign",
] as const;

/** JSON with object keys sorted recursively, so the same request always hashes the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/**
 * Binds a report to the exact request it analysed. The extension should recompute this before
 * forwarding to MetaMask and refuse to show a report whose hash does not match.
 */
export function computeRequestHash(req: Pick<AnalyzeRequest, "origin" | "chainId" | "account" | "method" | "params">): Hex {
  return keccak256(
    stringToBytes(
      canonicalJson({
        origin: req.origin,
        chainId: req.chainId,
        account: req.account.toLowerCase(),
        method: req.method,
        params: req.params,
      }),
    ),
  );
}

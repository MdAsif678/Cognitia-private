import { z } from "zod";

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

const HEX_RE = /^0x[0-9a-fA-F]*$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export const HexSchema = z.string().regex(HEX_RE, "expected 0x-prefixed hex") as unknown as z.ZodType<Hex>;
export const AddressSchema = z
  .string()
  .regex(ADDRESS_RE, "expected a 20-byte 0x address") as unknown as z.ZodType<Address>;
export const HashSchema = z.string().regex(HASH_RE, "expected a 32-byte 0x hash") as unknown as z.ZodType<Hex>;

/** Unsigned integer amounts travel as decimal strings so JSON never loses precision. */
export const UintStringSchema = z.string().regex(/^\d+$/, "expected an unsigned decimal string");
/** Signed deltas (after - before) as decimal strings. */
export const IntStringSchema = z.string().regex(/^-?\d+$/, "expected a signed decimal string");

export const SeveritySchema = z.enum(["critical", "high", "medium", "low", "unknown"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const TokenStandardSchema = z.enum(["native", "erc20", "erc721", "erc1155", "unknown"]);
export type TokenStandard = z.infer<typeof TokenStandardSchema>;

/** Highest first. Use for sorting findings and rolling up a report severity. */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "unknown", "low"];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(values: Severity[], fallback: Severity = "low"): Severity {
  if (values.length === 0) return fallback;
  return values.reduce((best, s) => (severityRank(s) < severityRank(best) ? s : best));
}

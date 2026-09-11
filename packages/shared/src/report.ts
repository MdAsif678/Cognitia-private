import { z } from "zod";
import { AddressSchema, ConfidenceSchema, HashSchema, HexSchema, SeveritySchema } from "./primitives";
import { GasInfoSchema, SignatureCheckSchema } from "./simulation";
import {
  AssetFlowSchema,
  CoverageSchema,
  ExposureSchema,
  ForkInfoSchema,
  StateChangeSchema,
  TokenInfoSchema,
} from "./state";

export const EvidenceSchema = z.object({
  kind: z.enum([
    "calldata",
    "state-change",
    "log",
    "trace",
    "threat-record",
    "bytecode",
    "signature",
    "domain",
    "simulation",
  ]),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  title: z.string(),
  /** One-line statement of the finding (extension contract field; defaults to `explanation`). */
  description: z.string().optional(),
  /** Plain-English explanation a non-expert can act on. */
  explanation: z.string(),
  confidence: ConfidenceSchema,
  /** Address match, bytecode match and heuristics are different kinds of proof — keep them apart. */
  evidenceType: z.enum([
    "threat-address",
    "threat-bytecode",
    "threat-domain",
    "behavioral",
    "simulated-state",
    "decoded-calldata",
    "signature",
    "analysis-gap",
  ]),
  evidence: z.array(EvidenceSchema),
});
export type Finding = z.infer<typeof FindingSchema>;

export const DecodedIntentSchema = z.object({
  kind: z.enum(["transaction", "typed-data", "personal-sign", "eth-sign", "unsupported"]),
  known: z.boolean(),
  summary: z.string(),
  target: AddressSchema.optional(),
  selector: HexSchema.optional(),
  functionName: z.string().optional(),
  signature: z.string().optional(),
  args: z.record(z.string(), z.string()).optional(),
  source: z.enum(["standard-abi", "verified-abi", "selector-db", "typed-data", "none"]).optional(),
  rawCalldata: HexSchema.optional(),
});
export type DecodedIntent = z.infer<typeof DecodedIntentSchema>;

export const AnalysisReportSchema = z.object({
  requestId: z.string(),
  requestHash: HashSchema,

  status: z.enum(["complete", "partial", "failed"]),
  severity: SeveritySchema,
  summary: z.string(),

  /** null only when analysis failed before a fork could be created. */
  fork: ForkInfoSchema.nullable(),

  simulation: z.object({
    mode: z.enum(["transaction", "conditional-signature", "unsupported"]),
    outcome: z.enum(["success", "revert", "not-executed"]),
    assumptions: z.array(z.string()),
    revertReason: z.string().optional(),
    error: z.string().optional(),
    gas: GasInfoSchema.optional(),
    signatureChecks: z.array(SignatureCheckSchema).optional(),
  }),

  intent: DecodedIntentSchema.optional(),
  findings: z.array(FindingSchema),
  /** What executing this request changes on-chain. Always timing "immediate". */
  immediateChanges: z.array(StateChangeSchema),
  /** What could happen afterwards if granted authority is used. Always timing "conditional". */
  conditionalChanges: z.array(StateChangeSchema),
  potentialExposure: z.array(ExposureSchema),
  assetFlows: z.array(AssetFlowSchema),
  /** Metadata for rendering amounts (symbol/decimals) of every token referenced above. */
  tokens: z.array(TokenInfoSchema),
  coverage: CoverageSchema,

  analyzedAt: z.string(),
  durationMs: z.number().nonnegative(),
  engine: z.object({ simulator: z.string(), riskEngine: z.string() }),
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

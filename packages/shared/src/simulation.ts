import { z } from "zod";
import { AddressSchema, HashSchema, HexSchema, TokenStandardSchema, UintStringSchema } from "./primitives";
import {
  AccountInfoSchema,
  AssetFlowSchema,
  CallFrameSummarySchema,
  CoverageSchema,
  ExposureSchema,
  ForkInfoSchema,
  StateChangeSchema,
  TokenInfoSchema,
} from "./state";

/**
 * Extra entities the decoder (risk engine) wants the simulator to read, on top of what the
 * simulator discovers itself from calldata, logs and the trace.
 */
export const SimulationHintsSchema = z.object({
  accounts: z.array(AddressSchema).optional(),
  tokens: z
    .array(z.object({ address: AddressSchema, standard: TokenStandardSchema.optional() }))
    .optional(),
  tokenIds: z.array(z.object({ token: AddressSchema, tokenId: UintStringSchema })).optional(),
  allowances: z
    .array(z.object({ token: AddressSchema, owner: AddressSchema, spender: AddressSchema }))
    .optional(),
  operators: z
    .array(z.object({ token: AddressSchema, owner: AddressSchema, operator: AddressSchema }))
    .optional(),
});
export type SimulationHints = z.infer<typeof SimulationHintsSchema>;

/** An unsigned transaction as the wallet would send it (fields already validated). */
export const TxRequestSchema = z.object({
  from: AddressSchema,
  to: AddressSchema.optional(),
  data: HexSchema.optional(),
  value: UintStringSchema.optional(),
  gas: UintStringSchema.optional(),
  gasPrice: UintStringSchema.optional(),
  maxFeePerGas: UintStringSchema.optional(),
  maxPriorityFeePerGas: UintStringSchema.optional(),
  nonce: z.number().int().nonnegative().optional(),
});
export type TxRequest = z.infer<typeof TxRequestSchema>;

/**
 * Authority a signature would grant if signed and submitted by someone else. Produced by the
 * signature adapter (ERC-2612 first, Permit2 next); executed by the simulator as a conditional
 * scenario.
 */
export const ConditionalAuthorizationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("erc20-allowance"),
    source: z.enum(["erc2612-permit", "dai-permit", "permit2", "other"]),
    token: AddressSchema,
    owner: AddressSchema,
    spender: AddressSchema,
    amount: UintStringSchema,
    nonce: UintStringSchema.optional(),
    deadline: UintStringSchema.optional(),
    domain: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        chainId: z.number().int().optional(),
        verifyingContract: AddressSchema.optional(),
        salt: HashSchema.optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("operator-approval"),
    source: z.enum(["other"]),
    token: AddressSchema,
    owner: AddressSchema,
    operator: AddressSchema,
  }),
]);
export type ConditionalAuthorization = z.infer<typeof ConditionalAuthorizationSchema>;

export const SignatureCheckSchema = z.object({
  name: z.enum(["nonce", "deadline", "chain-id", "verifying-contract", "domain-separator", "token-code"]),
  status: z.enum(["pass", "fail", "unavailable"]),
  detail: z.string(),
});
export type SignatureCheck = z.infer<typeof SignatureCheckSchema>;

export const StepResultSchema = z.object({
  label: z.string(),
  role: z.enum(["request", "setup", "follow-up"]),
  from: AddressSchema,
  to: AddressSchema.optional(),
  selector: HexSchema.optional(),
  outcome: z.enum(["success", "revert", "not-executed"]),
  revertReason: z.string().optional(),
  gasUsed: UintStringSchema.optional(),
  /** Hash on the private fork only — never broadcast. */
  forkTxHash: HashSchema.optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const GasInfoSchema = z.object({
  used: UintStringSchema,
  /** Gas limit supplied by the dapp, if any (execution otherwise ran with the block gas cap). */
  limit: UintStringSchema.optional(),
  /** gasUsed × expected effective gas price, from the upstream block's base fee. */
  estimatedFeeWei: UintStringSchema.optional(),
  effectiveGasPrice: UintStringSchema.optional(),
  /** Sender's native balance after the request still covers the estimated fee. */
  balanceCoversFee: z.boolean().optional(),
  /** Sender's real native balance on the upstream chain, before the request ran. */
  senderBalanceWei: UintStringSchema.optional(),
  /**
   * Set only when the sender's real balance could not cover the value this request sends, so the
   * fork balance was topped up by this many wei to let the request execute and be measured. On the
   * real chain the request would fail for insufficient funds; the effects shown assume it were funded.
   */
  fundedShortfallWei: UintStringSchema.optional(),
});
export type GasInfo = z.infer<typeof GasInfoSchema>;

export const ConditionalScenarioSchema = z.object({
  description: z.string(),
  steps: z.array(StepResultSchema),
  changes: z.array(StateChangeSchema),
  assetFlows: z.array(AssetFlowSchema),
  assumptions: z.array(z.string()),
});
export type ConditionalScenario = z.infer<typeof ConditionalScenarioSchema>;

/** Everything the simulator hands to the risk engine (Asif → Swastik). */
export const SimulationResultSchema = z.object({
  mode: z.enum(["transaction", "conditional-signature"]),
  fork: ForkInfoSchema,
  outcome: z.enum(["success", "revert", "not-executed"]),
  revertReason: z.string().optional(),
  error: z.string().optional(),
  gas: GasInfoSchema.optional(),
  steps: z.array(StepResultSchema),
  immediateChanges: z.array(StateChangeSchema),
  /** What a spender could do next with authority granted here (always labelled conditional). */
  conditional: ConditionalScenarioSchema.optional(),
  assetFlows: z.array(AssetFlowSchema),
  exposures: z.array(ExposureSchema),
  calls: z.array(CallFrameSummarySchema),
  accounts: z.array(AccountInfoSchema),
  tokens: z.array(TokenInfoSchema),
  signatureChecks: z.array(SignatureCheckSchema).optional(),
  assumptions: z.array(z.string()),
  coverage: CoverageSchema,
  durationMs: z.number().nonnegative(),
  /** Per-stage wall time, for diagnosing slow upstream RPCs. */
  timingsMs: z.record(z.string(), z.number()).optional(),
});
export type SimulationResult = z.infer<typeof SimulationResultSchema>;

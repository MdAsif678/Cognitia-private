import { z } from "zod";
import {
  AddressSchema,
  HashSchema,
  HexSchema,
  IntStringSchema,
  TokenStandardSchema,
  UintStringSchema,
} from "./primitives";

/** Whether a change happens when this request executes, or only if a later action happens. */
export const TimingSchema = z.enum(["immediate", "conditional"]);
export type Timing = z.infer<typeof TimingSchema>;

export const TokenInfoSchema = z.object({
  address: AddressSchema,
  standard: TokenStandardSchema,
  name: z.string().optional(),
  symbol: z.string().optional(),
  decimals: z.number().int().min(0).max(255).optional(),
  totalSupply: UintStringSchema.optional(),
});
export type TokenInfo = z.infer<typeof TokenInfoSchema>;

export const AccountInfoSchema = z.object({
  address: AddressSchema,
  isContract: z.boolean(),
  /** keccak256 of the runtime bytecode — what bytecode-hash threat records match against. */
  codeHash: HashSchema.optional(),
  codeSize: z.number().int().nonnegative(),
  /** No code at the fork block, but code after execution (deployed by this request). */
  createdDuringSimulation: z.boolean().optional(),
  /** EIP-1967 implementation, when the account is a recognised proxy. */
  proxyImplementation: AddressSchema.optional(),
});
export type AccountInfo = z.infer<typeof AccountInfoSchema>;

/**
 * Every change carries `kind` (discriminator) plus flat display fields the extension contract
 * reads: `type` (= kind), `asset`, `from`, `to`, `amount`, `spender`. The API fills them in.
 */
const base = {
  timing: TimingSchema,
  type: z.string().optional(),
  asset: z.string().optional(),
  from: AddressSchema.optional(),
  to: AddressSchema.optional(),
  amount: z.string().optional(),
  spender: AddressSchema.optional(),
};

export const NativeBalanceChangeSchema = z.object({
  ...base,
  kind: z.literal("native-balance"),
  account: AddressSchema,
  before: UintStringSchema,
  after: UintStringSchema,
  delta: IntStringSchema,
  /** Simulation runs at zero gas price, so native deltas never include the network fee. */
  excludesGas: z.literal(true),
});

export const Erc20BalanceChangeSchema = z.object({
  ...base,
  kind: z.literal("erc20-balance"),
  token: AddressSchema,
  account: AddressSchema,
  before: UintStringSchema,
  after: UintStringSchema,
  delta: IntStringSchema,
});

export const Erc20AllowanceChangeSchema = z.object({
  ...base,
  kind: z.literal("erc20-allowance"),
  token: AddressSchema,
  owner: AddressSchema,
  spender: AddressSchema,
  before: UintStringSchema,
  after: UintStringSchema,
  unlimitedBefore: z.boolean(),
  unlimitedAfter: z.boolean(),
});

export const Erc721OwnerChangeSchema = z.object({
  ...base,
  kind: z.literal("erc721-owner"),
  token: AddressSchema,
  tokenId: UintStringSchema,
  /** null = token did not exist (mint) / no longer exists (burn). */
  before: AddressSchema.nullable(),
  after: AddressSchema.nullable(),
});

export const Erc721TokenApprovalChangeSchema = z.object({
  ...base,
  kind: z.literal("erc721-token-approval"),
  token: AddressSchema,
  tokenId: UintStringSchema,
  before: AddressSchema.nullable(),
  after: AddressSchema.nullable(),
});

export const OperatorApprovalChangeSchema = z.object({
  ...base,
  kind: z.literal("operator-approval"),
  token: AddressSchema,
  standard: z.enum(["erc721", "erc1155", "unknown"]),
  owner: AddressSchema,
  operator: AddressSchema,
  before: z.boolean(),
  after: z.boolean(),
});

export const Erc1155BalanceChangeSchema = z.object({
  ...base,
  kind: z.literal("erc1155-balance"),
  token: AddressSchema,
  tokenId: UintStringSchema,
  account: AddressSchema,
  before: UintStringSchema,
  after: UintStringSchema,
  delta: IntStringSchema,
});

export const StateChangeSchema = z.discriminatedUnion("kind", [
  NativeBalanceChangeSchema,
  Erc20BalanceChangeSchema,
  Erc20AllowanceChangeSchema,
  Erc721OwnerChangeSchema,
  Erc721TokenApprovalChangeSchema,
  OperatorApprovalChangeSchema,
  Erc1155BalanceChangeSchema,
]);
export type StateChange = z.infer<typeof StateChangeSchema>;

/** A single movement of value, reconstructed from logs (or the trace for native currency). */
export const AssetFlowSchema = z.object({
  timing: TimingSchema,
  standard: TokenStandardSchema,
  /** Token contract; the zero address for native currency. */
  token: AddressSchema,
  from: AddressSchema,
  to: AddressSchema,
  amount: UintStringSchema,
  tokenId: UintStringSchema.optional(),
  operator: AddressSchema.optional(),
  source: z.enum(["log", "trace"]),
  /** Which simulated step produced it (e.g. "request", "follow-up: operator transfer"). */
  step: z.string(),
});
export type AssetFlow = z.infer<typeof AssetFlowSchema>;

/** Authority someone else holds over the user's assets once this request is accepted. */
export const ExposureSchema = z.object({
  kind: z.enum(["erc20-allowance", "operator-approval", "erc721-token-approval"]),
  basis: z.enum(["granted", "existing-used", "conditional-signature"]),
  token: AddressSchema,
  standard: TokenStandardSchema,
  owner: AddressSchema,
  spender: AddressSchema,
  /** ERC-20 allowance after the request. Absent for operator approvals (all-or-nothing). */
  amount: UintStringSchema.optional(),
  unlimited: z.boolean(),
  /** Allowance exceeds the token's total supply. */
  exceedsTotalSupply: z.boolean().optional(),
  tokenId: UintStringSchema.optional(),
  /** What the owner holds right now that the spender could take. */
  atRisk: z.object({
    erc20Balance: UintStringSchema.optional(),
    nftCount: UintStringSchema.optional(),
    tokenIds: z.array(UintStringSchema).optional(),
    erc1155Balances: z.array(z.object({ tokenId: UintStringSchema, balance: UintStringSchema })).optional(),
  }),
  scope: z.string(),
  /** Display fields for the extension UI (filled by the API). */
  asset: z.string().optional(),
  description: z.string().optional(),
});
export type Exposure = z.infer<typeof ExposureSchema>;

export const CallFrameSummarySchema = z.object({
  depth: z.number().int().nonnegative(),
  type: z.string(),
  from: AddressSchema,
  to: AddressSchema.optional(),
  value: UintStringSchema,
  selector: HexSchema.optional(),
  input: HexSchema.optional(),
  error: z.string().optional(),
  step: z.string(),
});
export type CallFrameSummary = z.infer<typeof CallFrameSummarySchema>;

export const ForkInfoSchema = z.object({
  chainId: z.number().int().positive(),
  blockNumber: UintStringSchema,
  blockHash: HashSchema,
  blockTimestamp: UintStringSchema.optional(),
  /** The local fork's pinned block hash equals the upstream block hash. */
  verified: z.boolean().optional(),
});
export type ForkInfo = z.infer<typeof ForkInfoSchema>;

export const CoverageSchema = z.object({
  checked: z.array(z.string()),
  missing: z.array(z.string()),
  /** False when a state read failed, a trace was unavailable or a token could not be identified. */
  complete: z.boolean().optional(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

import { z } from 'zod';
import { addressSchema, losslessDecimalStringSchema } from './request';
import { executionContextSchema } from './finding';
import { callTypeSchema } from './intent';

export const assetDeltaSchema = z.object({
  account: addressSchema,
  token: addressSchema,
  symbol: z.string().optional(),
  amountDelta: z.string().regex(/^-?\d+$/, { message: 'amountDelta must be a signed lossless integer string' }),
});

export const pinnedSnapshotSchema = z.object({
  chainId: z.number().int().positive(),
  blockNumber: losslessDecimalStringSchema,
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export const disclosedOverrideSchema = z.object({
  type: z.enum(['impersonation', 'funding', 'storage_override']),
  target: addressSchema,
  details: z.string().min(1),
});

export const callTraceNodeSchema: z.ZodType<CallTraceNodeInternal> = z.lazy(() =>
  z.object({
    from: addressSchema,
    to: addressSchema,
    value: losslessDecimalStringSchema,
    callType: callTypeSchema,
    depth: z.number().int().nonnegative(),
    gasUsed: losslessDecimalStringSchema.optional(),
    error: z.string().optional(),
    subcalls: z.array(callTraceNodeSchema).optional(),
  })
);

export interface CallTraceNodeInternal {
  from: string;
  to: string;
  value: string;
  callType: 'call' | 'delegatecall' | 'staticcall';
  depth: number;
  gasUsed?: string;
  error?: string;
  subcalls?: CallTraceNodeInternal[];
}

export const nativeBalanceChangeSchema = z.object({
  account: addressSchema,
  pre: losslessDecimalStringSchema,
  post: losslessDecimalStringSchema,
  delta: z.string().regex(/^-?\d+$/),
});

export const erc20BalanceChangeSchema = z.object({
  token: addressSchema,
  account: addressSchema,
  pre: losslessDecimalStringSchema,
  post: losslessDecimalStringSchema,
  delta: z.string().regex(/^-?\d+$/),
});

export const erc20AllowanceChangeSchema = z.object({
  token: addressSchema,
  owner: addressSchema,
  spender: addressSchema,
  pre: losslessDecimalStringSchema,
  post: losslessDecimalStringSchema,
  delta: z.string().regex(/^-?\d+$/),
});

export const erc721OwnershipChangeSchema = z.object({
  token: addressSchema,
  tokenId: losslessDecimalStringSchema,
  preOwner: addressSchema,
  postOwner: addressSchema,
});

export const erc721ApprovalChangeSchema = z.object({
  token: addressSchema,
  owner: addressSchema,
  operator: addressSchema,
  preApproved: z.boolean(),
  postApproved: z.boolean(),
});

export const erc1155BalanceChangeSchema = z.object({
  token: addressSchema,
  account: addressSchema,
  id: losslessDecimalStringSchema,
  pre: losslessDecimalStringSchema,
  post: losslessDecimalStringSchema,
  delta: z.string().regex(/^-?\d+$/),
});

export const erc1155ApprovalChangeSchema = z.object({
  token: addressSchema,
  owner: addressSchema,
  operator: addressSchema,
  preApproved: z.boolean(),
  postApproved: z.boolean(),
});

export const separatedEffectsSchema = z.object({
  decodedRequestedActions: z.array(z.string()),
  observedEffects: z.array(z.string()),
  unresolvedEffects: z.array(z.string()),
});

export const misleadingEventSchema = z.object({
  name: z.string(),
  reason: z.string(),
  logIndex: z.number().int().optional(),
});

export const simulationResultSchema = z.object({
  success: z.boolean(),
  executionContext: executionContextSchema.refine(
    (ctx) => ctx === 'observed_simulation' || ctx === 'conditional_modeling',
    { message: 'Simulation must be either observed_simulation or conditional_modeling' }
  ),
  conditionalLabel: z.string().optional(),
  assumptions: z.array(z.string()),
  assetDeltas: z.array(assetDeltaSchema),
  stateDiffs: z.record(z.unknown()).optional(),
  gasUsed: losslessDecimalStringSchema.optional(),
  revertReason: z.string().optional(),
  pinnedSnapshot: pinnedSnapshotSchema.optional(),
  disclosedOverrides: z.array(disclosedOverrideSchema).default([]),
  callTraces: z.array(callTraceNodeSchema).optional(),
  delegatecallTargets: z.array(addressSchema).default([]),
  stateChanges: z
    .object({
      nativeBalances: z.array(nativeBalanceChangeSchema).default([]),
      erc20Balances: z.array(erc20BalanceChangeSchema).default([]),
      erc20Allowances: z.array(erc20AllowanceChangeSchema).default([]),
      erc721Ownership: z.array(erc721OwnershipChangeSchema).default([]),
      erc721Approvals: z.array(erc721ApprovalChangeSchema).default([]),
      erc1155Balances: z.array(erc1155BalanceChangeSchema).default([]),
      erc1155Approvals: z.array(erc1155ApprovalChangeSchema).default([]),
    })
    .optional(),
  discoveryLimits: z.array(z.string()).default([]),
  separatedEffects: separatedEffectsSchema.optional(),
  misleadingEvents: z.array(misleadingEventSchema).default([]),
  coverageImpact: z
    .object({
      status: z.enum(['complete', 'partial', 'unsupported', 'failed']),
      reasons: z.array(z.string()),
    })
    .optional(),
  logs: z
    .array(
      z.object({
        address: addressSchema,
        topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
        data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/),
      })
    )
    .optional(),
});

export type AssetDelta = z.infer<typeof assetDeltaSchema>;
export type PinnedSnapshot = z.infer<typeof pinnedSnapshotSchema>;
export type DisclosedOverride = z.infer<typeof disclosedOverrideSchema>;
export type CallTraceNode = z.infer<typeof callTraceNodeSchema>;
export type SeparatedEffects = z.infer<typeof separatedEffectsSchema>;
export type MisleadingEvent = z.infer<typeof misleadingEventSchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;

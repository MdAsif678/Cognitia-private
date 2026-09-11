import { z } from 'zod';
import { addressSchema, hexCalldataSchema, losslessDecimalStringSchema } from './request';

export const parameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string(), // losslessly serialized string
  rawValue: z.unknown().optional(),
});

export const assetStandardSchema = z.enum([
  'ERC-20',
  'ERC-721',
  'ERC-1155',
  'ERC-2612',
  'ERC-20 | ERC-721 (ambiguous)',
  'ERC-721 | ERC-1155 (ambiguous)',
  'none',
  'unknown',
]);

export const abiProvenanceSchema = z.enum([
  'standard_abi',
  'verified_contract',
  'proxy_implementation',
  'candidate_database',
  'router_adapter',
  'unknown',
]);

export const callTypeSchema = z.enum(['call', 'delegatecall', 'staticcall']);

export const proxyInfoSchema = z.object({
  isProxy: z.boolean(),
  proxyStandard: z.string().optional(), // e.g. 'EIP-1967', 'EIP-1822', 'EIP-897'
  proxyAddress: addressSchema.optional(),
  implementationAddress: addressSchema.optional(),
  resolutionBlock: z.string().optional(),
});

export const truncationReportSchema = z.object({
  truncated: z.boolean(),
  reason: z.string().optional(),
  depth: z.number().optional(),
  totalSubcalls: z.number().optional(),
  bytesLimit: z.number().optional(),
});

// Recursive definition for DecodedIntent to support arbitrary nested calls
export const decodedIntentSchema: z.ZodType<DecodedIntentInternal> = z.lazy(() =>
  z.object({
    type: z.enum(['transaction', 'eip712', 'personal_sign']),
    target: addressSchema.optional(),
    targetContract: addressSchema.optional(), // Backward compatibility alias
    caller: addressSchema.optional(),
    callType: callTypeSchema.default('call'),
    selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/).optional(),
    functionName: z.string().optional(),
    decodedFunction: z.string().optional(),
    candidateFunction: z.string().optional(),
    signature: z.string().optional(),
    arguments: z.array(parameterSchema).optional(),
    parameters: z.array(parameterSchema).optional(), // Backward compatibility alias
    assetStandard: assetStandardSchema.default('none'),
    owner: addressSchema.optional(),
    spenderOrOperator: addressSchema.optional(),
    recipient: addressSchema.optional(),
    amount: losslessDecimalStringSchema.optional(),
    tokenIds: z.array(losslessDecimalStringSchema).optional(),
    nativeValue: losslessDecimalStringSchema.default('0'),
    abiProvenance: abiProvenanceSchema.default('unknown'),
    confidence: z.object({
      level: z.enum(['high', 'medium', 'low']),
      reason: z.string(),
    }).default({ level: 'medium', reason: 'Default unvalidated decode' }),
    unresolvedQuestions: z.array(z.string()).default([]),
    proxyInfo: proxyInfoSchema.optional(),
    nestedCalls: z.array(decodedIntentSchema).optional(),
    rawCalldata: hexCalldataSchema,
    isCandidate: z.boolean().optional(),
    candidateDisclaimer: z.string().optional(),
    isUnknownFunction: z.boolean(),
    truncationReport: truncationReportSchema.optional(),
    typedDataDetails: z
      .object({
        standard: z.enum(['ERC-2612', 'Permit2', 'DAI-Permit', 'Unsupported', 'Generic-EIP712', 'Unknown']),
        primaryType: z.string(),
        domain: z.record(z.unknown()).optional(),
        fields: z.record(z.unknown()),
        rawPayload: z.record(z.unknown()).optional(),
        extractedAddresses: z.array(addressSchema).optional(),
        extractedAmounts: z.array(z.object({ key: z.string(), value: z.string(), candidate: z.boolean() })).optional(),
        extractedTimestamps: z.array(z.object({ key: z.string(), value: z.string(), candidate: z.boolean() })).optional(),
        candidatePatterns: z.array(z.object({ field: z.string(), value: z.string(), role: z.string(), disclaimer: z.string() })).optional(),
        authorityStatus: z.enum(['verified', 'unresolved', 'unsupported']).optional(),
        inconsistencies: z.array(z.string()),
        isExpired: z.boolean().optional(),
        domainSeparatorMatches: z.boolean().optional(),
        reconstructedDomainSeparator: z.string().optional(),
        onChainDomainSeparator: z.string().nullable().optional(),
        nonceMatches: z.boolean().optional(),
        preState: z
          .object({
            tokenBalance: losslessDecimalStringSchema.optional(),
            tokenAllowance: losslessDecimalStringSchema.optional(),
            currentNonce: losslessDecimalStringSchema.optional(),
          })
          .optional(),
      })
      .optional(),
    personalSignDetails: z
      .object({
        isHex: z.boolean(),
        rawBytes: z.string().optional(),
        hexView: z.string().optional(),
        utf8View: z.string().optional(),
        isValidUtf8: z.boolean().optional(),
        requestedSigner: addressSchema.optional(),
        suppliedOrigin: z.string().optional(),
        originVerificationStatus: z.enum(['unverified', 'verified']).optional(),
        decodedAscii: z.string().optional(),
        isDisguisedTx: z.boolean(),
        uncertaintyReason: z.string(),
        downstreamEffectStatus: z.string().optional(),
      })
      .optional(),
  })
);

export interface DecodedIntentInternal {
  type: 'transaction' | 'eip712' | 'personal_sign';
  target?: string;
  targetContract?: string;
  caller?: string;
  callType?: 'call' | 'delegatecall' | 'staticcall';
  selector?: string;
  functionName?: string;
  decodedFunction?: string;
  candidateFunction?: string;
  signature?: string;
  arguments?: Array<{
    name: string;
    type: string;
    value: string;
    rawValue?: unknown;
  }>;
  parameters?: Array<{
    name: string;
    type: string;
    value: string;
    rawValue?: unknown;
  }>;
  assetStandard?:
    | 'ERC-20'
    | 'ERC-721'
    | 'ERC-1155'
    | 'ERC-2612'
    | 'ERC-20 | ERC-721 (ambiguous)'
    | 'ERC-721 | ERC-1155 (ambiguous)'
    | 'none'
    | 'unknown';
  owner?: string;
  spenderOrOperator?: string;
  recipient?: string;
  amount?: string;
  tokenIds?: string[];
  nativeValue?: string;
  abiProvenance?:
    | 'standard_abi'
    | 'verified_contract'
    | 'proxy_implementation'
    | 'candidate_database'
    | 'router_adapter'
    | 'unknown';
  confidence?: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  };
  unresolvedQuestions?: string[];
  proxyInfo?: {
    isProxy: boolean;
    proxyStandard?: string;
    proxyAddress?: string;
    implementationAddress?: string;
    resolutionBlock?: string;
  };
  nestedCalls?: DecodedIntentInternal[];
  rawCalldata: string;
  isCandidate?: boolean;
  candidateDisclaimer?: string;
  isUnknownFunction: boolean;
  truncationReport?: {
    truncated: boolean;
    reason?: string;
    depth?: number;
    totalSubcalls?: number;
    bytesLimit?: number;
  };
  typedDataDetails?: {
    standard: 'ERC-2612' | 'Permit2' | 'DAI-Permit' | 'Unsupported' | 'Generic-EIP712' | 'Unknown';
    primaryType: string;
    domain?: Record<string, unknown>;
    fields: Record<string, unknown>;
    rawPayload?: Record<string, unknown>;
    extractedAddresses?: string[];
    extractedAmounts?: Array<{ key: string; value: string; candidate: boolean }>;
    extractedTimestamps?: Array<{ key: string; value: string; candidate: boolean }>;
    candidatePatterns?: Array<{ field: string; value: string; role: string; disclaimer: string }>;
    authorityStatus?: 'verified' | 'unresolved' | 'unsupported';
    inconsistencies: string[];
    isExpired?: boolean;
    domainSeparatorMatches?: boolean;
    reconstructedDomainSeparator?: string;
    onChainDomainSeparator?: string | null;
    nonceMatches?: boolean;
    preState?: {
      tokenBalance?: string;
      tokenAllowance?: string;
      currentNonce?: string;
    };
  };
  personalSignDetails?: {
    isHex: boolean;
    rawBytes?: string;
    hexView?: string;
    utf8View?: string;
    isValidUtf8?: boolean;
    requestedSigner?: string;
    suppliedOrigin?: string;
    originVerificationStatus?: 'unverified' | 'verified';
    decodedAscii?: string;
    isDisguisedTx: boolean;
    uncertaintyReason: string;
    downstreamEffectStatus?: string;
  };
}

export type Parameter = z.infer<typeof parameterSchema>;
export type AssetStandard = z.infer<typeof assetStandardSchema>;
export type AbiProvenance = z.infer<typeof abiProvenanceSchema>;
export type ProxyInfo = z.infer<typeof proxyInfoSchema>;
export type TruncationReport = z.infer<typeof truncationReportSchema>;
export type DecodedIntent = z.infer<typeof decodedIntentSchema>;

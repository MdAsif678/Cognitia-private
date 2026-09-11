import { z } from 'zod';

// EVM Hex Address validator (strict 0x followed by 40 hex chars)
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, { message: 'Invalid EVM 20-byte hex address' });

// Hex Calldata validator (starts with 0x, even length or empty 0x)
export const hexCalldataSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, { message: 'Calldata must be a valid 0x-prefixed hex string' });

// Lossless Decimal String for large integers (wei, gas, token units)
// Never treat missing data as zero!
export const losslessDecimalStringSchema = z
  .string({ required_error: 'Integer value must be explicitly provided as a decimal string; missing values are never assumed zero.' })
  .regex(/^\d+$/, { message: 'Value must be a non-negative decimal string (lossless integer representation)' });

// 1. Transaction Request
export const transactionAnalysisRequestSchema = z.object({
  type: z.literal('transaction'),
  chainId: z.number().int().positive({ message: 'chainId must be a positive integer' }),
  from: addressSchema,
  to: addressSchema,
  value: losslessDecimalStringSchema,
  calldata: hexCalldataSchema,
  metadata: z.record(z.unknown()).optional(),
});

// 2. EIP-712 Request
export const eip712DomainSchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  chainId: z.union([z.number(), z.string().regex(/^\d+$/)]).optional(),
  verifyingContract: addressSchema.optional(),
  salt: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
}).passthrough();

export const eip712PayloadSchema = z.object({
  types: z.record(z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string().min(1, 'primaryType is required'),
  domain: eip712DomainSchema,
  message: z.record(z.unknown()),
});

export const eip712AnalysisRequestSchema = z.object({
  type: z.literal('eip712'),
  expectedSigner: addressSchema,
  selectedChainId: z.number().int().positive({ message: 'selectedChainId must be a positive integer' }),
  payload: eip712PayloadSchema,
  domainOrOrigin: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// 3. personal_sign Request
export const personalSignAnalysisRequestSchema = z.object({
  type: z.literal('personal_sign'),
  expectedSigner: addressSchema,
  rawMessage: z.string().min(1, 'rawMessage cannot be empty'),
  chainId: z.number().int().positive().optional(),
  domainOrOrigin: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Discriminated union of all supported request types
export const analysisRequestSchema = z.discriminatedUnion('type', [
  transactionAnalysisRequestSchema,
  eip712AnalysisRequestSchema,
  personalSignAnalysisRequestSchema,
]);

export type TransactionAnalysisRequest = z.infer<typeof transactionAnalysisRequestSchema>;
export type Eip712AnalysisRequest = z.infer<typeof eip712AnalysisRequestSchema>;
export type PersonalSignAnalysisRequest = z.infer<typeof personalSignAnalysisRequestSchema>;
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

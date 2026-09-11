import { z } from 'zod';
import { addressSchema } from './request';

export const evidenceTypeSchema = z.enum([
  'address_match',
  'codehash_match',
  'domain_match',
  'behavioral',
  'state_override_simulation',
  'ast_analysis',
  'rpc_trace',
]);

export const evidenceSchema = z.object({
  id: z.string().min(1),
  type: evidenceTypeSchema,
  provenance: z.string().min(1, { message: 'Provenance is required for auditability' }),
  relevantAddresses: z.array(addressSchema),
  chainId: z.number().int(),
  blockNumber: z.string().regex(/^\d+$/).optional(),
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  rawSupportingData: z.record(z.unknown()),
});

export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;

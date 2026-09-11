import { z } from 'zod';

export const coverageStatusSchema = z.enum([
  'complete',
  'partial',
  'unsupported',
  'failed',
]);

export const coverageSchema = z.object({
  status: coverageStatusSchema,
  reasons: z.array(z.string()),
  components: z.object({
    calldataDecoding: coverageStatusSchema,
    signatureAnalysis: coverageStatusSchema,
    simulation: coverageStatusSchema,
    threatMatching: coverageStatusSchema,
  }),
});

export type CoverageStatus = z.infer<typeof coverageStatusSchema>;
export type Coverage = z.infer<typeof coverageSchema>;

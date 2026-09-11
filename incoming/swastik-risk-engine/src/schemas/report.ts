import { z } from 'zod';
import { severitySchema, findingSchema } from './finding';
import { coverageSchema } from './coverage';
import { decodedIntentSchema } from './intent';
import { simulationResultSchema } from './simulation';
import { evidenceSchema } from './evidence';
import { analysisRequestSchema } from './request';

export const analysisReportSchema = z.object({
  requestId: z.string().min(1),
  timestamp: z.string().datetime(),
  overallSeverity: severitySchema,
  riskScore: z.number().min(0).max(100),
  summary: z.string().min(1),
  coverage: coverageSchema,
  decodedIntent: decodedIntentSchema,
  simulationResult: simulationResultSchema.optional(),
  findings: z.array(findingSchema),
  evidence: z.record(evidenceSchema),
  rawRequest: analysisRequestSchema,
}).refine(
  (report) => {
    // Critical safety rule: Never label a report "safe"
    const summaryLower = report.summary.toLowerCase();
    return !summaryLower.includes('is safe') && !summaryLower.includes('transaction is safe');
  },
  { message: 'Reports must never declare a transaction unconditionally "safe".' }
);

export type AnalysisReport = z.infer<typeof analysisReportSchema>;

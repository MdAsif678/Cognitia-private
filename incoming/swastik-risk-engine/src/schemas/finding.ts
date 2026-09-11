import { z } from 'zod';

export const severitySchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'unknown',
]);

export const confidenceSchema = z.object({
  level: z.enum(['high', 'medium', 'low']),
  reason: z.string().min(1, 'Confidence score must be grounded in an explicit reason'),
});

export const executionContextSchema = z.enum([
  'decoded_intent',
  'observed_simulation',
  'conditional_modeling',
]);

export const findingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  severity: severitySchema,
  title: z.string().min(1),
  plainEnglishExplanation: z.string().min(1),
  evidenceIds: z.array(z.string()),
  confidence: confidenceSchema,
  assumptions: z.array(z.string()),
  executionContext: executionContextSchema,
  remediation: z.string().optional(),
});

export type Severity = z.infer<typeof severitySchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type ExecutionContext = z.infer<typeof executionContextSchema>;
export type Finding = z.infer<typeof findingSchema>;

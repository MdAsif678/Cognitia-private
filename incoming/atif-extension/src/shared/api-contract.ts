/**
 * Shared API contract between the extension and the analysis backend.
 * Single source of truth for the POST {API_BASE_URL}/v1/analyze request and response.
 *
 * Runtime validation is enforced with Zod: malformed backend responses are REJECTED,
 * never partially trusted. Unknown extra fields are tolerated for forward compatibility,
 * but every field declared in the contract must be present and well-typed.
 */
import { z } from 'zod';

// ==========================================
// 1. Primitive formats
// ==========================================

/** EVM address: 0x followed by 40 hex characters. */
export type HexAddress = `0x${string}`;

const HEX_ADDRESS = 'an 0x-prefixed 20-byte EVM address';

const hexAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, HEX_ADDRESS);

const nonEmptyString = (label: string) => z.string().min(1, label);

// ==========================================
// 2. AnalyzeRequest (extension -> backend)
// ==========================================

/**
 * Exact intercepted request context.
 * `method` and `params` are forwarded EXACTLY as intercepted from the provider —
 * never normalized, reordered, or reconstructed.
 */
export interface AnalyzeRequest {
  readonly requestId: string;
  readonly origin: string;
  readonly chainId: number;
  readonly account: HexAddress;
  readonly method: string;
  readonly params: unknown[];
}

export const AnalyzeRequestSchema = z.looseObject({
  requestId: nonEmptyString('requestId is required'),
  origin: nonEmptyString('origin is required'),
  chainId: z.number().int().nonnegative(),
  account: hexAddressSchema,
  method: nonEmptyString('method is required'),
  params: z.array(z.unknown()),
});

// ==========================================
// 3. AnalysisReport (backend -> extension)
// ==========================================

export type ReportStatus = 'complete' | 'partial' | 'failed';

export type ReportSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

export type SimulationMode = 'transaction' | 'conditional-signature' | 'unsupported';

export type SimulationOutcome = 'success' | 'revert' | 'not-executed';

/**
 * A concrete asset movement or permission change observed in the fork simulation.
 * `type` identifies the change kind (e.g. "erc20_transfer", "erc20_approve", "native_transfer").
 */
export interface StateChange {
  readonly type: string;
  readonly asset?: string;
  readonly from?: HexAddress;
  readonly to?: HexAddress;
  /** Decimal or hex string amount — kept as string to avoid precision loss. */
  readonly amount?: string;
  /** Spender granted allowance, for approval-type changes. */
  readonly spender?: HexAddress;
}

/**
 * Risk that is not an immediate state change but could materialize later
 * (e.g. reusable signature, lingering allowance). `kind` identifies the exposure.
 */
export interface Exposure {
  readonly kind: string;
  readonly asset?: string;
  readonly amount?: string;
  readonly description?: string;
}

/**
 * Security finding produced by backend detectors.
 * Severity uses the same enum as the top-level report severity.
 */
export interface ReportFinding {
  readonly id?: string;
  readonly severity: ReportSeverity;
  readonly title: string;
  readonly description: string;
  readonly explanation?: string;
  readonly evidence?: string | Record<string, unknown> | readonly unknown[];
  readonly confidence?: string;
}

export interface AnalysisReport {
  readonly requestId: string;
  readonly requestHash: string;
  readonly status: ReportStatus;
  readonly severity: ReportSeverity;
  readonly summary: string;

  readonly fork: {
    readonly chainId: number;
    readonly blockNumber: string;
    readonly blockHash: string;
  } | null;

  readonly simulation: {
    readonly mode: SimulationMode;
    readonly outcome: SimulationOutcome;
    readonly assumptions: readonly string[];
  };

  readonly findings: readonly ReportFinding[];
  readonly immediateChanges: readonly StateChange[];
  readonly potentialExposure: readonly Exposure[];

  readonly coverage: {
    readonly checked: readonly string[];
    readonly missing: readonly string[];
  };

  readonly evidence?: unknown;
}

const reportSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'unknown']);

const reportFindingSchema = z.looseObject({
  id: z.string().min(1).optional(),
  severity: reportSeveritySchema,
  title: nonEmptyString('finding.title is required'),
  description: z.string(),
  explanation: z.string().optional(),
  evidence: z.unknown().optional(),
  confidence: z.string().optional(),
});

const stateChangeSchema = z.looseObject({
  type: nonEmptyString('stateChange.type is required'),
  asset: z.string().optional(),
  from: hexAddressSchema.optional(),
  to: hexAddressSchema.optional(),
  amount: z.string().optional(),
  spender: hexAddressSchema.optional(),
});

const exposureSchema = z.looseObject({
  kind: nonEmptyString('exposure.kind is required'),
  asset: z.string().optional(),
  amount: z.string().optional(),
  description: z.string().optional(),
});

export const AnalysisReportSchema = z.looseObject({
  requestId: nonEmptyString('requestId is required'),
  requestHash: nonEmptyString('requestHash is required'),
  status: z.enum(['complete', 'partial', 'failed']),
  severity: reportSeveritySchema,
  summary: nonEmptyString('summary is required'),

  // null when the analysis failed before a fork could be created (status "failed").
  fork: z.looseObject({
    chainId: z.number().int().nonnegative(),
    blockNumber: nonEmptyString('fork.blockNumber is required'),
    blockHash: nonEmptyString('fork.blockHash is required'),
  }).nullable(),

  simulation: z.looseObject({
    mode: z.enum(['transaction', 'conditional-signature', 'unsupported']),
    outcome: z.enum(['success', 'revert', 'not-executed']),
    assumptions: z.array(z.string()),
  }),

  findings: z.array(reportFindingSchema),
  immediateChanges: z.array(stateChangeSchema),
  potentialExposure: z.array(exposureSchema),

  coverage: z.looseObject({
    checked: z.array(z.string()),
    missing: z.array(z.string()),
  }),
});

// ==========================================
// 4. Validation entry points
// ==========================================

/**
 * Parses and validates an untrusted backend payload against the AnalysisReport contract.
 * Returns a deeply-validated report or a human-readable rejection reason.
 * Malformed payloads are rejected outright — callers must treat rejection as
 * "analysis unavailable", never as a safe result.
 */
export function parseAnalysisReport(data: unknown): { success: true; report: AnalysisReport } | { success: false; error: string } {
  const result = AnalysisReportSchema.safeParse(data);
  if (result.success) {
    return { success: true, report: result.data as AnalysisReport };
  }
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  return { success: false, error: `Response does not match the AnalysisReport contract: ${issues}` };
}

/**
 * Validates an outbound analyze request before it leaves the extension.
 * Guards against accidentally POSTing a contract-violating payload.
 */
export function validateAnalyzeRequest(request: AnalyzeRequest): string | null {
  const result = AnalyzeRequestSchema.safeParse(request);
  if (result.success) return null;
  const issues = result.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  return `Request does not match the AnalyzeRequest contract: ${issues}`;
}

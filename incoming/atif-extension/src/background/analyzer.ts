import {
  PendingRequestSnapshot,
  AnalysisResult,
  AnalysisStatus,
  Finding,
  RiskSeverity,
} from '../shared/types';
import {
  AnalyzeRequest,
  AnalysisReport,
  HexAddress,
  ReportSeverity,
} from '../shared/api-contract';
import { API_CONFIG } from '../shared/config';
import { AnalyzeApiClient, AnalyzeApiError } from './apiClient';

/**
 * Outcome handed to the background coordinator for lifecycle handling.
 * Any failure (timeout, HTTP error, network failure, malformed response, failed
 * backend analysis) resolves to kind: "unavailable" — a failed or unavailable
 * analysis is NEVER interpreted as a safe result.
 */
export type AnalyzerOutcome =
  | {
      readonly kind: 'ready';
      readonly analysis: AnalysisResult;
      readonly report: AnalysisReport;
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: string;
    };

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HEX_QUANTITY_PATTERN = /^0x[0-9a-fA-F]+$/;

/**
 * Converts a provider chainId string (EIP-1193 hex quantity, decimal tolerated)
 * into the contract's numeric chainId. Returns null when absent or malformed —
 * never fabricates a chain.
 */
export function parseChainIdToNumber(chainId: string | undefined): number | null {
  if (typeof chainId !== 'string' || chainId.trim().length === 0) return null;
  const trimmed = chainId.trim();
  if (HEX_QUANTITY_PATTERN.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 16);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/**
 * Normalizes a candidate account string into the contract's EVM address format.
 * Returns null when absent or malformed — never fabricates an account.
 */
export function parseAccountAddress(account: string | undefined): HexAddress | null {
  if (typeof account !== 'string') return null;
  const trimmed = account.trim();
  return EVM_ADDRESS_PATTERN.test(trimmed) ? (trimmed as HexAddress) : null;
}

/**
 * Builds the shared-contract AnalyzeRequest from the intercepted snapshot.
 * The exact intercepted method and params are forwarded untouched.
 * Returns null (with a reason) when the chain/account context cannot be established.
 */
export function buildAnalyzeRequest(
  snapshot: PendingRequestSnapshot
): { request: AnalyzeRequest } | { error: string } {
  const chainId = parseChainIdToNumber(snapshot.chainId);
  const account = parseAccountAddress(snapshot.account);

  if (chainId === null) {
    return { error: 'Current chain context is unavailable; request cannot be analyzed.' };
  }
  if (account === null) {
    return { error: 'Current wallet account context is unavailable; request cannot be analyzed.' };
  }

  return {
    request: {
      requestId: snapshot.requestId,
      origin: snapshot.origin,
      chainId,
      account,
      method: snapshot.method,
      // Exact intercepted params, never normalized or reconstructed
      params: snapshot.rawParams,
    },
  };
}

const UI_SEVERITY_BY_REPORT_SEVERITY: Record<ReportSeverity, RiskSeverity> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  unknown: 'UNKNOWN',
};

/**
 * Maps a contract-valid report onto the UI-facing AnalysisResult.
 *
 * Safety invariants (enforced here, not in the UI):
 * - "complete" + low severity is the ONLY mapping that yields the green "safe" state.
 * - "partial" analyses always map to at least caution — incomplete coverage is never safe.
 * - severity "unknown" always maps to at least caution.
 * - No numeric risk score is invented; the UI hides the score badge when absent.
 */
export function mapReportToAnalysisResult(report: AnalysisReport, requestId: string): AnalysisResult {
  const severity = UI_SEVERITY_BY_REPORT_SEVERITY[report.severity];

  let status: AnalysisStatus;
  if (report.severity === 'critical') {
    status = 'danger';
  } else if (report.status === 'partial' || severity === 'UNKNOWN' || severity === 'HIGH' || severity === 'MEDIUM') {
    status = 'warning';
  } else {
    // "complete" + low severity only
    status = 'safe';
  }

  const findings: Finding[] = report.findings.map((f) => ({
    ...(f.id !== undefined ? { id: f.id } : {}),
    severity: f.severity,
    title: f.title,
    description: f.description,
    ...(f.explanation !== undefined ? { explanation: f.explanation } : {}),
    ...(f.evidence !== undefined ? { evidence: f.evidence } : {}),
    ...(f.confidence !== undefined ? { confidence: f.confidence } : {}),
  }));

  return {
    requestId,
    status,
    severity,
    summary: report.summary,
    findings,
    warnings: [...report.coverage.missing],
    analyzedAt: Date.now(),
    report,
  };
}

/**
 * Coarse page-notification score derived from severity for the existing
 * ANALYSIS_RESULT message contract (informational only; the side panel does not
 * display it). Unknown/partial cases skew cautious rather than safe.
 */
export function coarseRiskScore(report: AnalysisReport): number {
  switch (report.severity) {
    case 'critical':
      return 90;
    case 'high':
      return 75;
    case 'medium':
      return 50;
    case 'low':
      return report.status === 'partial' ? 40 : 15;
    case 'unknown':
      return 50;
  }
}

/**
 * Analysis orchestrator for the /v1/analyze backend service.
 *
 * Wraps the single configurable API client: builds the contract request from the
 * intercepted snapshot, maps contract-valid reports into the UI lifecycle, and
 * converts every failure into an "unavailable" outcome that keeps the existing
 * non-bypassable AnalysisUnavailable flow.
 *
 * Guarantees at most one analysis request per requestId until explicitly
 * invalidated due to an account/chain change (see invalidateAnalysis).
 */
export class TransactionAnalyzer {
  private readonly client: AnalyzeApiClient;

  constructor(baseUrl: string = API_CONFIG.BASE_URL, timeoutMs: number = API_CONFIG.TIMEOUT_MS) {
    this.client = new AnalyzeApiClient({ baseUrl, timeoutMs });
  }

  public getEndpointUrl(): string {
    return this.client.getEndpointUrl();
  }

  public getTimeoutMs(): number {
    return this.client.getTimeoutMs();
  }

  /**
   * Explicitly invalidates the cached analysis for a requestId, re-enabling a
   * fresh analysis request. Call when a report is invalidated by an account or
   * chain change.
   */
  public invalidateAnalysis(requestId: string): void {
    this.client.invalidate(requestId);
  }

  /**
   * Analyzes an intercepted request. Never throws: resolves to a ready or
   * unavailable outcome.
   */
  public async analyze(snapshot: PendingRequestSnapshot): Promise<AnalyzerOutcome> {
    const built = buildAnalyzeRequest(snapshot);
    if ('error' in built) {
      return { kind: 'unavailable', reason: built.error };
    }

    let report: AnalysisReport;
    try {
      report = await this.client.analyze(built.request);
    } catch (err: unknown) {
      if (err instanceof AnalyzeApiError) {
        return { kind: 'unavailable', reason: err.message };
      }
      const detail = err instanceof Error ? err.message : 'Unknown analysis failure';
      return { kind: 'unavailable', reason: `Analysis unavailable: ${detail}` };
    }

    // A backend-reported failure is an unavailable analysis, never a safe result.
    if (report.status === 'failed') {
      return {
        kind: 'unavailable',
        reason: report.summary.trim().length > 0 ? report.summary : 'Analysis failed on the backend.',
      };
    }

    return { kind: 'ready', analysis: mapReportToAnalysisResult(report, snapshot.requestId), report };
  }
}

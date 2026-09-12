/**
 * The single configurable API client for the /v1/analyze backend.
 *
 * Responsibilities:
 * - POST the exact AnalyzeRequest (method & params forwarded untouched)
 * - Enforce the strict analysis timeout via AbortController
 * - Validate every response at runtime with the shared Zod contract; reject malformed ones
 * - Perform development-only logging (requestId, API URL, HTTP status, analysis status);
 *   never log signing payloads, in development or otherwise
 * - Guarantee at most one analysis request per requestId until the caller explicitly
 *   invalidates it (account/chain change), via a requestId-keyed cache of in-flight
 *   and settled analysis promises.
 */
import {
  AnalyzeRequest,
  AnalysisReport,
  parseAnalysisReport,
  validateAnalyzeRequest,
} from '../shared/api-contract';
import { API_CONFIG } from '../shared/config';
import { createDevLogger } from '../shared/logger';

const log = createDevLogger('AnalyzeApiClient');

export type ApiFailureReason =
  | 'invalid_request'
  | 'timeout'
  | 'network_error'
  | 'http_error'
  | 'malformed_response'
  | 'request_id_mismatch';

/**
 * Typed failure thrown by AnalyzeApiClient for any outcome that is not a
 * contract-valid report. Carries a user-safe message (no request payload content)
 * plus machine-readable reason and HTTP status where applicable.
 */
export class AnalyzeApiError extends Error {
  readonly reason: ApiFailureReason;
  readonly httpStatus?: number;

  constructor(reason: ApiFailureReason, message: string, httpStatus?: number) {
    super(message);
    this.name = 'AnalyzeApiError';
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

export interface AnalyzeApiClientOptions {
  /** Base URL without trailing slash. Defaults to the resolved API_BASE_URL config. */
  readonly baseUrl?: string;
  /** Strict analysis timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Injectable fetch for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface AnalyzeApiStats {
  readonly cacheSize: number;
}

export class AnalyzeApiClient {
  private readonly baseUrl: string;
  private readonly endpointUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  /**
   * requestId -> analysis promise. Holds both in-flight and settled analyses so a
   * duplicate trigger for the same requestId never issues a second HTTP request
   * unless invalidate() was called after an explicit account/chain change.
   */
  private readonly analysisCache = new Map<string, Promise<AnalysisReport>>();

  constructor(options: AnalyzeApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? API_CONFIG.BASE_URL).replace(/\/+$/, '');
    this.endpointUrl = `${this.baseUrl}/v1/analyze`;
    this.timeoutMs = options.timeoutMs ?? API_CONFIG.TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  public getEndpointUrl(): string {
    return this.endpointUrl;
  }

  public getTimeoutMs(): number {
    return this.timeoutMs;
  }

  public getStats(): AnalyzeApiStats {
    return { cacheSize: this.analysisCache.size };
  }

  /**
   * Explicitly invalidates the cached/in-flight analysis for a requestId.
   * Must be called when the report becomes stale due to an account or chain change,
   * re-enabling analysis for that requestId.
   */
  public invalidate(requestId: string): void {
    if (this.analysisCache.delete(requestId)) {
      log.debug(`Analysis cache invalidated for requestId=${requestId}`);
    }
  }

  /**
   * Analyzes a request under the single-request-per-requestId guarantee.
   * Resolves with a contract-valid AnalysisReport or rejects with AnalyzeApiError.
   */
  public analyze(request: AnalyzeRequest): Promise<AnalysisReport> {
    const cached = this.analysisCache.get(request.requestId);
    if (cached) {
      log.debug(`Reusing existing analysis for requestId=${request.requestId} (no second API request)`);
      return cached;
    }

    const analysis = this.executeAnalyze(request);
    this.analysisCache.set(request.requestId, analysis);
    return analysis;
  }

  private async executeAnalyze(request: AnalyzeRequest): Promise<AnalysisReport> {
    // Outbound contract check before anything leaves the extension
    const requestError = validateAnalyzeRequest(request);
    if (requestError) {
      throw new AnalyzeApiError('invalid_request', requestError);
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), this.timeoutMs);

    log.debug(`POST ${this.endpointUrl} requestId=${request.requestId}`);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Exact request object — method and params are serialized exactly as intercepted
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          throw new AnalyzeApiError('timeout', `Analysis request timed out after ${this.timeoutMs}ms`);
        }
        throw new AnalyzeApiError('network_error', `Cannot reach analysis API at ${this.endpointUrl}. Start the API and check the extension API_BASE_URL, then retry.`);
      }

      log.debug(`HTTP ${response.status} ${response.statusText} requestId=${request.requestId}`);

      if (!response.ok) {
        throw new AnalyzeApiError(
          'http_error',
          `Analysis backend returned HTTP error: ${response.status} ${response.statusText}`,
          response.status
        );
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new AnalyzeApiError('malformed_response', 'Analysis backend response was not valid JSON');
      }

      const parsed = parseAnalysisReport(data);
      if (!parsed.success) {
        log.warn(`Rejected malformed response for requestId=${request.requestId}: ${parsed.error}`);
        throw new AnalyzeApiError('malformed_response', 'Analysis backend returned a malformed response');
      }

      const report = parsed.report;
      if (report.requestId !== request.requestId) {
        throw new AnalyzeApiError(
          'request_id_mismatch',
          'Analysis backend returned a report for a different requestId'
        );
      }

      log.debug(`Analysis status="${report.status}" severity="${report.severity}" requestId=${report.requestId}`);
      return report;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }
}

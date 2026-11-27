import type { AnalysisReport } from '../../../../incoming/atif-extension/src/shared/api-contract';
import { parseAnalysisReport } from '../../../../incoming/atif-extension/src/shared/api-contract';
import { mapReportToAnalysisResult } from '../../../../incoming/atif-extension/src/background/analyzer';
import type { EthereumMethod, PendingRequestSnapshot } from '../../../../incoming/atif-extension/src/shared/types';
import { config } from '../config';

export type RunState =
  | { status: 'idle' }
  | { status: 'loading'; label: string; started: number }
  | { status: 'error'; label: string; message: string }
  | { status: 'ready'; label: string; expected?: string; report: AnalysisReport; snapshot: PendingRequestSnapshot; ms: number; request: unknown };

export type WalletRequest = { chainId: number; origin: string; account: string; method: string; params: unknown[] };

const TIMEOUT_MS = 60_000;

function snapshotFor(report: AnalysisReport, req: { origin: string; method: string; params: unknown[]; chainId: number; account: string }, providerName: string): PendingRequestSnapshot {
  return {
    requestId: report.requestId,
    timestamp: Date.now(),
    origin: req.origin,
    method: req.method as EthereumMethod,
    rawParams: req.params,
    chainId: `0x${req.chainId.toString(16)}`,
    account: req.account,
    providerInfo: { name: providerName },
    status: 'ANALYSIS_READY',
    analysis: mapReportToAnalysisResult(report, report.requestId),
  };
}

async function readError(res: Response) {
  const body = await res.json().catch(() => null) as { error?: string; message?: string } | null;
  return `The analysis API answered HTTP ${res.status}${body?.error || body?.message ? `: ${body.error ?? body.message}` : ''}`;
}

function networkError(err: unknown) {
  if (err instanceof DOMException && err.name === 'TimeoutError') return 'The analysis took longer than 60 seconds. Public RPCs may be slow; try again.';
  return `Could not reach the analysis API at ${config.apiBaseUrl}. It may be offline or blocking this site (CORS).`;
}

export async function analyze(label: string, req: WalletRequest, expected?: string): Promise<RunState> {
  const requestId = `site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = { requestId, origin: req.origin, chainId: req.chainId, account: req.account, method: req.method, params: req.params };
  const started = performance.now();
  try {
    const res = await fetch(`${config.apiBaseUrl}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'error', label, message: await readError(res) };
    const parsed = parseAnalysisReport(await res.json());
    if (!parsed.success) return { status: 'error', label, message: `The API returned a report the extension would reject: ${parsed.error}` };
    return { status: 'ready', label, expected, report: parsed.report, snapshot: snapshotFor(parsed.report, req, 'Playground'), ms: Math.round(performance.now() - started), request: body };
  } catch (err) {
    return { status: 'error', label, message: networkError(err) };
  }
}

/** Re-simulates a mined transaction as if it were still unsigned, at the state just before its block. */
export async function replay(label: string, chainId: number, txHash: string): Promise<RunState> {
  const started = performance.now();
  try {
    const res = await fetch(`${config.apiBaseUrl}/v1/replay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chainId, txHash }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: 'error', label, message: await readError(res) };
    const json = await res.json() as { report?: unknown };
    const parsed = parseAnalysisReport(json.report ?? json);
    if (!parsed.success) return { status: 'error', label, message: `The API returned a report the extension would reject: ${parsed.error}` };
    const report = parsed.report;
    const req = { origin: 'replay', method: 'eth_sendTransaction', params: [], chainId, account: '' };
    return { status: 'ready', label, report, snapshot: snapshotFor(report, req, 'Replay of a mined transaction'), ms: Math.round(performance.now() - started), request: { chainId, txHash } };
  } catch (err) {
    return { status: 'error', label, message: networkError(err) };
  }
}

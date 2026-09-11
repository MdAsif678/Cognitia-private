/**
 * Unit Test Suite for the real backend integration (src/background/analyzer.ts + apiClient.ts).
 *
 * All scenarios use mocked API responses (no network):
 * 1.  Benign transfer          -> complete/low report -> ANALYSIS_READY "safe"
 * 2.  High-risk approval       -> complete/high report -> ANALYSIS_READY "warning"
 * 3.  Critical malicious       -> complete/critical finding -> ANALYSIS_READY "danger"
 * 4.  Partial analysis         -> status "partial" is NEVER interpreted as safe
 * 5.  Failed analysis          -> status "failed" maps to the unavailable flow
 * 6.  Malformed response       -> rejected by Zod contract validation -> unavailable
 * 7.  Timeout                  -> strict AbortController timeout -> unavailable
 * 8.  HTTP 500                 -> backend error -> unavailable
 * plus: exact outbound contract payload, requestId mismatch rejection,
 *       single-request-per-requestId guarantee and explicit invalidation.
 */

import {
  TransactionAnalyzer,
  AnalyzerOutcome,
  buildAnalyzeRequest,
  parseChainIdToNumber,
  parseAccountAddress,
} from '../src/background/analyzer';
import { parseAnalysisReport } from '../src/shared/api-contract';
import { PendingRequestSnapshot } from '../src/shared/types';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ACCOUNT = ('0x' + 'aA'.repeat(20)) as string; // exactly 40 hex chars

// -------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------

function makeSnapshot(overrides: Partial<PendingRequestSnapshot> = {}): PendingRequestSnapshot {
  return {
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
    origin: 'https://app.uniswap.org',
    method: 'eth_sendTransaction',
    rawParams: [{ to: '0x1111111111111111111111111111111111111111', value: '0x10' }],
    chainId: '0x1',
    account: ACCOUNT,
    providerInfo: { name: 'MetaMask' },
    status: 'ANALYZING',
    ...overrides,
  };
}

function makeReport(requestId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId,
    requestHash: '0x' + 'ab'.repeat(32),
    status: 'complete',
    severity: 'low',
    summary: 'Transaction simulated cleanly in an isolated fork. No drain signatures detected.',
    fork: {
      chainId: 1,
      blockNumber: '0x12d4a8f',
      blockHash: '0x' + 'cd'.repeat(32),
    },
    simulation: {
      mode: 'transaction',
      outcome: 'success',
      assumptions: [],
    },
    findings: [],
    immediateChanges: [
      {
        type: 'native_transfer',
        asset: 'ETH',
        from: ACCOUNT,
        to: '0x1111111111111111111111111111111111111111',
        amount: '0x10',
      },
    ],
    potentialExposure: [],
    coverage: {
      checked: ['balance_solvency', 'known_drainer_addresses', 'token_allowances'],
      missing: [],
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchRecorder {
  callCount: number;
  urls: string[];
  bodies: Array<Record<string, unknown> | undefined>;
}

const originalGlobalFetch = globalThis.fetch;

function installFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): FetchRecorder {
  const recorder: FetchRecorder = { callCount: 0, urls: [], bodies: [] };
  const wrapped = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    recorder.callCount += 1;
    recorder.urls.push(String(url));
    try {
      recorder.bodies.push(init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined);
    } catch {
      recorder.bodies.push(undefined);
    }
    return handler(String(url), init);
  };
  globalThis.fetch = wrapped as unknown as typeof fetch;
  return recorder;
}

function restoreFetch(): void {
  globalThis.fetch = originalGlobalFetch;
}

export async function runAnalyzerTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const assert = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  };

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err: unknown) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const expectUnavailable = (outcome: AnalyzerOutcome): string => {
    if (outcome.kind !== 'unavailable') {
      throw new Error(`Expected outcome "unavailable", got "${outcome.kind}"`);
    }
    return outcome.reason;
  };

  const expectReady = (outcome: AnalyzerOutcome): Extract<AnalyzerOutcome, { kind: 'ready' }> => {
    if (outcome.kind !== 'ready') {
      throw new Error(`Expected outcome "ready", got "${outcome.kind}" (${'reason' in outcome ? outcome.reason : ''})`);
    }
    return outcome;
  };

  // -------------------------------------------------------------
  // Test 1: Benign transfer -> complete / low -> safe
  // -------------------------------------------------------------
  await test('1. Benign transfer: complete/low report maps to ready + "safe"', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () => jsonResponse(makeReport(snapshot.requestId)));

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const ready = expectReady(outcome);

      assert(ready.analysis.status === 'safe', `Expected UI status "safe", got "${ready.analysis.status}"`);
      assert(ready.analysis.severity === 'LOW', `Expected severity LOW, got "${ready.analysis.severity}"`);
      assert(ready.report.status === 'complete', `Expected report status complete, got "${ready.report.status}"`);
      assert(ready.report.severity === 'low', `Expected report severity low, got "${ready.report.severity}"`);
      assert(ready.analysis.riskScore === undefined, 'No numeric risk score should be fabricated');
      assert(ready.analysis.findings.length === 0, 'Benign report should have no findings');
      assert(recorder.callCount === 1, `Expected exactly 1 API call, got ${recorder.callCount}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 1b: Outbound payload exactly matches the shared contract
  // -------------------------------------------------------------
  await test('1b. Outbound request carries requestId, origin, numeric chainId, account, exact method & params', async () => {
    const params = [{ to: '0x1111111111111111111111111111111111111111', value: '0x10', data: '0xa9059cbb' }];
    const snapshot = makeSnapshot({ rawParams: params, chainId: '0xaa36a7' });
    const recorder = installFetch(async () => jsonResponse(makeReport(snapshot.requestId)));

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      await analyzer.analyze(snapshot);

      assert(recorder.callCount === 1, `Expected exactly 1 API call, got ${recorder.callCount}`);
      assert(recorder.urls[0] === 'http://localhost:3000/v1/analyze', `Unexpected URL: ${recorder.urls[0]}`);

      const body = recorder.bodies[0];
      assert(Boolean(body), 'Request body was not valid JSON');
      assert(body!.requestId === snapshot.requestId, 'requestId missing from payload');
      assert(body!.origin === 'https://app.uniswap.org', 'origin missing from payload');
      assert(body!.chainId === 11155111, `chainId must be numeric 11155111, got ${JSON.stringify(body!.chainId)}`);
      assert(body!.account === ACCOUNT, 'account missing from payload');
      assert(body!.method === 'eth_sendTransaction', 'method missing from payload');
      assert(
        JSON.stringify(body!.params) === JSON.stringify(params),
        `Params were not forwarded exactly: ${JSON.stringify(body!.params)}`
      );
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 2: High-risk approval -> complete / high -> warning
  // -------------------------------------------------------------
  await test('2. High-risk approval: complete/high report maps to ready + "warning"', async () => {
    const snapshot = makeSnapshot({ method: 'eth_signTypedData_v4' });
    const recorder = installFetch(async () =>
      jsonResponse(
        makeReport(snapshot.requestId, {
          severity: 'high',
          summary: 'EIP-712 permit signature grants a token spending allowance without an on-chain transaction.',
          simulation: { mode: 'conditional-signature', outcome: 'success', assumptions: ['permit is redeemable by spender'] },
          findings: [
            {
              id: 'gasless-permit',
              severity: 'high',
              title: 'Gasless Permit Signature',
              description: 'Permit signatures can be executed by third parties to transfer tokens.',
            },
          ],
          potentialExposure: [
            { kind: 'token_allowance', asset: 'USDC', description: 'Unlimited allowance redeemable by spender.' },
          ],
        })
      )
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const ready = expectReady(outcome);

      assert(ready.analysis.status === 'warning', `Expected UI status "warning", got "${ready.analysis.status}"`);
      assert(ready.analysis.severity === 'HIGH', `Expected severity HIGH, got "${ready.analysis.severity}"`);
      assert(ready.analysis.findings.length === 1, 'Expected 1 finding');
      assert(ready.analysis.findings[0].severity === 'high', 'Finding severity mismatch');
      assert(ready.analysis.findings[0].title === 'Gasless Permit Signature', 'Finding title mismatch');
      assert(ready.analysis.warnings.length === 0, 'No coverage gaps expected');
      assert(ready.report.potentialExposure.length === 1, 'Potential exposure should be preserved on the report');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 3: Critical malicious finding -> danger
  // -------------------------------------------------------------
  await test('3. Critical malicious finding maps to ready + "danger"', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () =>
      jsonResponse(
        makeReport(snapshot.requestId, {
          severity: 'critical',
          summary: 'CRITICAL: known drainer pattern — unlimited allowance to a flagged phishing spender.',
          findings: [
            {
              id: 'drainer-pattern',
              severity: 'critical',
              title: 'Token Drainer Detected',
              description: 'The simulation grants setApprovalForAll to a known drainer contract.',
            },
          ],
          immediateChanges: [
            {
              type: 'erc20_approve',
              asset: 'TOKEN',
              from: ACCOUNT,
              spender: '0x2222222222222222222222222222222222222222',
              amount: 'unlimited',
            },
          ],
        })
      )
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const ready = expectReady(outcome);

      assert(ready.analysis.status === 'danger', `Expected UI status "danger", got "${ready.analysis.status}"`);
      assert(ready.analysis.severity === 'CRITICAL', `Expected severity CRITICAL, got "${ready.analysis.severity}"`);
      assert(ready.analysis.findings[0].severity === 'critical', 'Expected critical finding severity');
      assert(ready.analysis.report?.immediateChanges.length === 1, 'Immediate changes should be preserved');
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 4: Partial analysis is never interpreted as safe
  // -------------------------------------------------------------
  await test('4. Partial analysis: status "partial" maps to caution, never "safe"', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () =>
      jsonResponse(
        makeReport(snapshot.requestId, {
          status: 'partial',
          severity: 'low',
          summary: 'Simulation completed but the drainer intelligence feed could not be reached.',
          coverage: {
            checked: ['balance_solvency'],
            missing: ['known_drainer_addresses', 'signature_replay'],
          },
        })
      )
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const ready = expectReady(outcome);

      assert(ready.report.status === 'partial', `Expected report status partial, got "${ready.report.status}"`);
      assert(
        ready.analysis.status === 'warning',
        `Partial analysis must not map to "safe", got "${ready.analysis.status}"`
      );
      assert(
        ready.analysis.warnings.includes('known_drainer_addresses'),
        'Coverage gaps should be surfaced as warnings'
      );
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 5: Backend-reported failed analysis -> unavailable flow
  // -------------------------------------------------------------
  await test('5. Failed analysis: status "failed" routes to the unavailable flow, never safe', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () =>
      jsonResponse(
        makeReport(snapshot.requestId, {
          status: 'failed',
          severity: 'unknown',
          summary: 'Fork provider could not be reached; no simulation was executed.',
          simulation: { mode: 'transaction', outcome: 'not-executed', assumptions: [] },
          findings: [],
          immediateChanges: [],
          potentialExposure: [],
          coverage: { checked: [], missing: ['simulation'] },
        })
      )
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const reason = expectUnavailable(outcome);

      assert(reason.includes('Fork provider'), `Reason should carry backend summary, got: ${reason}`);
      assert(recorder.callCount === 1, `Expected exactly 1 API call, got ${recorder.callCount}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 6: Malformed response is rejected by contract validation
  // -------------------------------------------------------------
  await test('6. Malformed response: rejected by Zod, maps to unavailable', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () =>
      // Missing fork/coverage, invalid severity enum, findings not an array
      jsonResponse({
        requestId: snapshot.requestId,
        requestHash: '0xdeadbeef',
        status: 'complete',
        severity: 'CATASTROPHIC',
        summary: 'looks fine but is not',
        findings: 'not-an-array',
      })
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      expectUnavailable(outcome);
      assert(recorder.callCount === 1, 'Malformed response must not trigger a second request');
    } finally {
      restoreFetch();
    }

    // Direct contract-validation checks
    const missingFork = parseAnalysisReport(makeReport('req_x', { fork: undefined }));
    assert(!missingFork.success, 'Report missing fork must be rejected');

    const badSeverity = parseAnalysisReport(makeReport('req_x', { severity: 'apocalyptic' }));
    assert(!badSeverity.success, 'Report with invalid severity enum must be rejected');

    const badStatus = parseAnalysisReport(makeReport('req_x', { status: 'maybe' }));
    assert(!badStatus.success, 'Report with invalid status enum must be rejected');

    const notAnObject = parseAnalysisReport('nope');
    assert(!notAnObject.success, 'Non-object payload must be rejected');

    const valid = parseAnalysisReport(makeReport('req_x'));
    assert(valid.success, 'A contract-conformant report must validate');
  });

  // -------------------------------------------------------------
  // Test 7: Timeout -> unavailable
  // -------------------------------------------------------------
  await test('7. Timeout: strict AbortController timeout maps to unavailable', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      });
    });

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 60);
      const outcome = await analyzer.analyze(snapshot);
      const reason = expectUnavailable(outcome);

      assert(reason.includes('timed out'), `Reason should mention the timeout, got: ${reason}`);
      assert(recorder.callCount === 1, `Expected exactly 1 API call, got ${recorder.callCount}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 8: HTTP 500 -> unavailable
  // -------------------------------------------------------------
  await test('8. HTTP 500: backend error maps to unavailable with status detail', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () =>
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const reason = expectUnavailable(outcome);

      assert(reason.includes('500'), `Reason should mention HTTP 500, got: ${reason}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 9: requestId mismatch is rejected
  // -------------------------------------------------------------
  await test('9. Report for a different requestId is rejected as unavailable', async () => {
    const snapshot = makeSnapshot();
    installFetch(async () => jsonResponse(makeReport('req_someone_else')));

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      const outcome = await analyzer.analyze(snapshot);
      const reason = expectUnavailable(outcome);
      assert(reason.toLowerCase().includes('requestid'), `Reason should mention requestId, got: ${reason}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 10: No second analysis request for the same requestId unless invalidated
  // -------------------------------------------------------------
  await test('10. Dedup: same requestId is analyzed once; only explicit invalidation re-requests', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () => jsonResponse(makeReport(snapshot.requestId)));

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);

      // Concurrent duplicate triggers (e.g. relayed message replay)
      const [a, b] = await Promise.all([analyzer.analyze(snapshot), analyzer.analyze(snapshot)]);
      expectReady(a);
      expectReady(b);
      assert(recorder.callCount === 1, `Expected 1 API call for concurrent duplicates, got ${recorder.callCount}`);

      // Late duplicate after completion (e.g. service worker wake-up replay)
      const c = await analyzer.analyze(snapshot);
      expectReady(c);
      assert(recorder.callCount === 1, `Expected still 1 API call after completion, got ${recorder.callCount}`);

      // Explicit invalidation due to account/chain change re-enables analysis
      analyzer.invalidateAnalysis(snapshot.requestId);
      await analyzer.analyze(snapshot);
      assert(recorder.callCount === 2, `Expected a fresh request after invalidation, got ${recorder.callCount}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 11: Missing chain/account context never reaches the API
  // -------------------------------------------------------------
  await test('11. Missing chain or account context maps to unavailable without any API call', async () => {
    const recorder = installFetch(async () => jsonResponse(makeReport('should_not_be_called')));

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);

      const noChain = await analyzer.analyze(makeSnapshot({ chainId: undefined }));
      expectUnavailable(noChain);

      const badChain = await analyzer.analyze(makeSnapshot({ chainId: 'not-a-chain' }));
      expectUnavailable(badChain);

      const noAccount = await analyzer.analyze(makeSnapshot({ account: undefined }));
      expectUnavailable(noAccount);

      const badAccount = await analyzer.analyze(makeSnapshot({ account: '0x123' }));
      expectUnavailable(badAccount);

      assert(recorder.callCount === 0, `No API call may be made without contract-valid context, got ${recorder.callCount}`);
    } finally {
      restoreFetch();
    }
  });

  // -------------------------------------------------------------
  // Test 12: Context parsing helpers
  // -------------------------------------------------------------
  await test('12. Chain/account context parsers are strict and never fabricate values', () => {
    assert(parseChainIdToNumber('0x1') === 1, 'hex 0x1 should parse to 1');
    assert(parseChainIdToNumber('0xaa36a7') === 11155111, 'hex 0xaa36a7 should parse to 11155111');
    assert(parseChainIdToNumber('137') === 137, 'decimal string should parse');
    assert(parseChainIdToNumber(undefined) === null, 'undefined chainId must yield null');
    assert(parseChainIdToNumber('latest') === null, 'non-numeric chainId must yield null');

    assert(parseAccountAddress(ACCOUNT) === ACCOUNT, 'valid address should pass through');
    assert(parseAccountAddress('0x1234') === null, 'short address must yield null');
    assert(parseAccountAddress('not-an-address') === null, 'non-address must yield null');
    assert(parseAccountAddress(undefined) === null, 'undefined account must yield null');

    const built = buildAnalyzeRequest(makeSnapshot());
    assert('request' in built && built.request.chainId === 1, 'Built request should carry numeric chainId');
    assert('request' in built && built.request.account === ACCOUNT, 'Built request should carry the account');

    const unbuilt = buildAnalyzeRequest(makeSnapshot({ chainId: undefined }));
    assert('error' in unbuilt, 'Snapshot without chain must not build a request');
  });

  // -------------------------------------------------------------
  // Test 13: Development logging emits requestId, URL, HTTP status, analysis status
  // -------------------------------------------------------------
  await test('13. Dev logging reports requestId, API URL, HTTP status and analysis status (no payloads)', async () => {
    const snapshot = makeSnapshot();
    const recorder = installFetch(async () => jsonResponse(makeReport(snapshot.requestId)));

    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map((a) => String(a)).join(' '));
    };

    try {
      const analyzer = new TransactionAnalyzer('http://localhost:3000', 3000);
      await analyzer.analyze(snapshot);
    } finally {
      console.log = originalLog;
      restoreFetch();
    }

    const combined = logged.join('\n');
    assert(combined.includes(snapshot.requestId), 'Dev logs should include the requestId');
    assert(combined.includes('/v1/analyze'), 'Dev logs should include the API URL');
    assert(combined.includes('HTTP 200'), 'Dev logs should include the HTTP status');
    assert(combined.includes('status="complete"'), 'Dev logs should include the analysis status');
    assert(
      !combined.includes('0x1111111111111111111111111111111111111111'),
      'Dev logs must never include signing payload contents'
    );
  });

  return results;
}

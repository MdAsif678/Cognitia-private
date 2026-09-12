import { AnalyzeApiClient, AnalyzeApiError } from '../src/background/apiClient';
import { PendingRequestManager } from '../src/background/pendingRequests';
import { ProviderInterceptor } from '../src/page/provider-interceptor';
import { ProviderDiscovery } from '../src/page/provider-discovery';
import { API_CONFIG } from '../src/shared/config';
import type { EIP1193Provider, PendingRequestSnapshot } from '../src/shared/types';
export async function runRegressionTests() {
  const results: { name: string; passed: boolean; error?: string }[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: String(e) }); } }
  await test('Network failure never fabricates a successful report', async () => {
    const client = new AnalyzeApiClient({ fetchImpl: async () => { throw new TypeError('offline'); } });
    let error: unknown;
    try { await client.analyze({ requestId: 'offline', origin: 'http://localhost:3000', chainId: 31337, account: '0x1111111111111111111111111111111111111111', method: 'eth_sendTransaction', params: [] }); } catch (e) { error = e; }
    assert(error instanceof AnalyzeApiError && error.reason === 'network_error', 'Offline backend was treated as analyzed');
    assert(API_CONFIG.TIMEOUT_MS > 45000, 'Client timeout must exceed API budget');
  });
  await test('Missing wallet is never impersonated', async () => {
    const win = window as unknown as { ethereum?: EIP1193Provider };
    const saved = win.ethereum; delete win.ethereum;
    new ProviderDiscovery(p => p).initialize();
    assert(win.ethereum === undefined, 'Discovery fabricated a wallet');
    win.ethereum = saved;
  });
  await test('Frozen provider is intercepted and method binding preserved', async () => {
    let calls = 0;
    const provider = Object.freeze({ request: async function () { assert(this === provider, 'Wrong provider binding'); calls++; return 'ok'; } }) as EIP1193Provider;
    const interceptor = new ProviderInterceptor();
    const wrapped = interceptor.wrapProvider(provider, { name: 'Frozen wallet' });
    const pending = wrapped.request({ method: 'eth_sendTransaction', params: [{}] });
    assert(calls === 0, 'Signing reached wallet before review');
    await interceptor.executeContinue((interceptor as any).pendingRequests.keys().next().value);
    assert(await pending === 'ok' && calls === 1, 'Forwarding was not exactly once');
  });
  await test('Mutation after interception cannot change the reviewed request', async () => {
    let sent: unknown;
    const provider = { request: async (args: unknown) => { sent = args; return 'ok'; } } as EIP1193Provider;
    const interceptor = new ProviderInterceptor(); interceptor.wrapProvider(provider, { name: 'Test' });
    const args = { method: 'eth_sendTransaction', params: [{ value: '0x1' }] };
    const pending = provider.request(args); args.params[0].value = '0xffff';
    await interceptor.executeContinue((interceptor as any).pendingRequests.keys().next().value); await pending;
    assert((sent as typeof args).params[0].value === '0x1', 'Unreviewed payload reached wallet');
  });
  await test('A provider TypeError must not cause a second signing attempt', async () => {
    let calls = 0;
    const original = async () => { calls++; throw new TypeError('Wallet failure'); };
    const provider = { request: original } as EIP1193Provider;
    const interceptor = new ProviderInterceptor();
    const pending = interceptor.handleRequest(provider, original, { method: 'personal_sign', params: [] }, { name: 'Test' }, {}).catch(e => e);
    await interceptor.executeContinue((interceptor as any).pendingRequests.keys().next().value); await pending;
    assert(calls === 1, 'Retried a signing request');
  });
  await test('Concurrent reviews cannot overwrite the active request', async () => {
    const oldChrome = globalThis.chrome;
    const data: Record<string, unknown> = {};
    globalThis.chrome = { storage: { session: { get: async () => ({ ...data }), set: async (value: Record<string, unknown>) => { Object.assign(data, value); }, remove: async (key: string) => { delete data[key]; } } } } as unknown as typeof chrome;
    try {
      const manager = new PendingRequestManager();
      const snapshot = { requestId: 'first', timestamp: Date.now(), origin: 'http://localhost', method: 'personal_sign', rawParams: [], providerInfo: { name: 'test' }, status: 'INTERCEPTED' } as PendingRequestSnapshot;
      const outcomes = await Promise.all([manager.registerRequest(snapshot), manager.registerRequest({ ...snapshot, requestId: 'second' })]);
      assert(outcomes[0] && !outcomes[1], 'Second review overwrote first');
      await manager.setAnalyzing('first'); await manager.markRejected('first');
      assert(!await manager.setAnalysisUnavailable('first', 'late error'), 'Late response resurrected rejected request');
    } finally { globalThis.chrome = oldChrome; }
  });
  return results;
}

/**
 * Unit Test Suite for Page-Context Provider Interception Layer.
 * Tests all 10 required behaviors:
 * 1. eth_sendTransaction gets intercepted
 * 2. personal_sign gets intercepted
 * 3. eth_signTypedData_v4 gets intercepted
 * 4. eth_call bypasses interception
 * 5. Reject returns error 4001
 * 6. Continue forwards exactly once
 * 7. double Continue cannot create two provider calls
 * 8. account change invalidates pending request
 * 9. chain change invalidates pending request
 * 10. provider request errors propagate correctly
 */

import { ProviderInterceptor } from '../src/page/provider-interceptor';
import { EIP1193Provider, EIP1193RequestArguments } from '../src/shared/types';

// Mock EIP-1193 Provider
class MockEthereumProvider implements EIP1193Provider {
  public callCount = 0;
  public lastMethod?: string;
  public lastParams?: unknown;
  public listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  public shouldFail = false;
  public failureError: unknown = new Error('RPC Failure');

  public async request(args: EIP1193RequestArguments): Promise<unknown> {
    this.callCount++;
    this.lastMethod = args.method;
    this.lastParams = args.params;

    if (this.shouldFail) {
      throw this.failureError;
    }

    switch (args.method) {
      case 'eth_call':
        return '0x0000000000000000000000000000000000000000000000000000000000000020';
      case 'eth_sendTransaction':
        return '0x9999999999999999999999999999999999999999999999999999999999999999';
      case 'personal_sign':
        return '0xsignature_personal_sign_mock_result';
      case 'eth_signTypedData_v4':
        return '0xsignature_typed_data_mock_result';
      default:
        return '0xok';
    }
  }

  public on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
  }

  public removeListener(event: string, listener: (...args: unknown[]) => void): void {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((l) => l !== listener);
    }
  }

  public emit(event: string, ...args: unknown[]): void {
    const list = this.listeners[event] || [];
    for (const l of list) {
      l(...args);
    }
  }
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runAllTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const assert = (condition: boolean, message: string) => {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  };

  // Helper to run a test case
  async function test(name: string, fn: () => Promise<void>) {
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

  // -------------------------------------------------------------
  // Test 1: eth_sendTransaction gets intercepted
  // -------------------------------------------------------------
  await test('1. eth_sendTransaction gets intercepted', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    let promiseResolved = false;
    const pendingPromise = mock
      .request({
        method: 'eth_sendTransaction',
        params: [{ to: '0x1111111111111111111111111111111111111111', value: '0x1000' }],
      })
      .then(() => {
        promiseResolved = true;
      });

    // Verify: Original provider was NOT called yet
    assert(mock.callCount === 0, 'Original provider.request() was called prematurely');
    assert(interceptor.getPendingRequestsCount() === 1, 'Interceptor does not have 1 pending request');
    assert(!promiseResolved, 'Promise was resolved before bridge decision');
  });

  // -------------------------------------------------------------
  // Test 2: personal_sign gets intercepted
  // -------------------------------------------------------------
  await test('2. personal_sign gets intercepted', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    mock.request({
      method: 'personal_sign',
      params: ['0x48656c6c6f', '0x2222222222222222222222222222222222222222'],
    });

    assert(mock.callCount === 0, 'Original provider was called on personal_sign');
    assert(interceptor.getPendingRequestsCount() === 1, 'personal_sign request was not captured');
  });

  // -------------------------------------------------------------
  // Test 3: eth_signTypedData_v4 gets intercepted
  // -------------------------------------------------------------
  await test('3. eth_signTypedData_v4 gets intercepted', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    mock.request({
      method: 'eth_signTypedData_v4',
      params: ['0x2222222222222222222222222222222222222222', '{"domain":{}}'],
    });

    assert(mock.callCount === 0, 'Original provider was called on eth_signTypedData_v4');
    assert(interceptor.getPendingRequestsCount() === 1, 'eth_signTypedData_v4 was not captured');
  });

  // -------------------------------------------------------------
  // Test 4: eth_call bypasses interception
  // -------------------------------------------------------------
  await test('4. eth_call bypasses interception', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const result = await mock.request({
      method: 'eth_call',
      params: [{ to: '0xContract', data: '0xabcdef' }, 'latest'],
    });

    assert(mock.callCount === 1, 'eth_call did not immediately call original provider');
    assert(typeof result === 'string', 'eth_call did not return provider response');
    assert(interceptor.getPendingRequestsCount() === 0, 'eth_call was incorrectly queued as pending');
  });

  // -------------------------------------------------------------
  // Test 5: Reject returns error 4001
  // -------------------------------------------------------------
  await test('5. Reject returns error 4001', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const reqPromise = mock.request({
      method: 'eth_sendTransaction',
      params: [{ to: '0xTarget' }],
    });

    // Find the generated requestId from internal records
    const record = Array.from((interceptor as any).pendingRequests.values())[0] as any;
    assert(Boolean(record), 'Could not locate pending record');

    // Bridge dispatches reject
    interceptor.executeReject(record.requestId);

    let caughtError: any;
    try {
      await reqPromise;
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Promise did not reject');
    assert(caughtError.code === 4001, `Expected error code 4001, got ${caughtError?.code}`);
    assert(
      caughtError.message === 'User rejected the request',
      `Expected message "User rejected the request", got "${caughtError?.message}"`
    );
    assert(mock.callCount === 0, 'Original provider was called after Reject');
  });

  // -------------------------------------------------------------
  // Test 6: Continue forwards exactly once
  // -------------------------------------------------------------
  await test('6. Continue forwards exactly once', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const originalParams = [{ to: '0xTarget', value: '0x50' }];
    const reqPromise = mock.request({
      method: 'eth_sendTransaction',
      params: originalParams,
    });

    const record = Array.from((interceptor as any).pendingRequests.values())[0] as any;
    assert(Boolean(record), 'Could not locate pending record');

    // Bridge dispatches continue
    await interceptor.executeContinue(record.requestId);
    const result = await reqPromise;

    assert(mock.callCount === 1, `Expected provider to be called exactly once, called ${mock.callCount} times`);
    assert(mock.lastMethod === 'eth_sendTransaction', 'Original method was not passed correctly');
    // Ensure original params reference was preserved without reconstruction
    assert(mock.lastParams === originalParams, 'Original params reference was mutated or reconstructed');
    assert(typeof result === 'string' && result.startsWith('0x'), 'Transaction hash not returned');
  });

  // -------------------------------------------------------------
  // Test 7: double Continue cannot create two provider calls
  // -------------------------------------------------------------
  await test('7. double Continue cannot create two provider calls', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const reqPromise = mock.request({
      method: 'personal_sign',
      params: ['0x1234', '0xAddress'],
    });

    const record = Array.from((interceptor as any).pendingRequests.values())[0] as any;
    const requestId = record.requestId;

    // Simulate rapid double Continue invocation (e.g. rapid double click or bridge repeat)
    const firstContinue = interceptor.executeContinue(requestId);
    const secondContinue = interceptor.executeContinue(requestId);

    await Promise.all([firstContinue, secondContinue]);
    await reqPromise;

    assert(mock.callCount === 1, `Double continue produced ${mock.callCount} calls (expected exactly 1)`);
  });

  // -------------------------------------------------------------
  // Test 8: account change invalidates pending request
  // -------------------------------------------------------------
  await test('8. account change invalidates pending request', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const reqPromise = mock.request({
      method: 'eth_sendTransaction',
      params: [{ to: '0xTarget' }],
    });

    assert(interceptor.getPendingRequestsCount() === 1, 'Request not registered');

    // Wallet switches account
    mock.emit('accountsChanged', ['0xNewAccountAddress']);

    let caughtError: any;
    try {
      await reqPromise;
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Account change did not reject pending request');
    assert(caughtError.code === 4001, `Expected 4001 on account change, got ${caughtError?.code}`);
    assert(interceptor.getPendingRequestsCount() === 0, 'Pending request was not cleared after account change');
  });

  // -------------------------------------------------------------
  // Test 9: chain change invalidates pending request
  // -------------------------------------------------------------
  await test('9. chain change invalidates pending request', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const reqPromise = mock.request({
      method: 'eth_signTypedData_v4',
      params: ['0xAccount', '{}'],
    });

    assert(interceptor.getPendingRequestsCount() === 1, 'Request not registered');

    // Wallet switches chain
    mock.emit('chainChanged', '0x89');

    let caughtError: any;
    try {
      await reqPromise;
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Chain change did not reject pending request');
    assert(caughtError.code === 4001, `Expected 4001 on chain change, got ${caughtError?.code}`);
    assert(interceptor.getPendingRequestsCount() === 0, 'Pending request was not cleared after chain change');
  });

  // -------------------------------------------------------------
  // Test 10: provider request errors propagate correctly
  // -------------------------------------------------------------
  await test('10. provider request errors propagate correctly', async () => {
    const interceptor = new ProviderInterceptor();
    const mock = new MockEthereumProvider();
    // Configure mock to fail with custom RPC error
    mock.shouldFail = true;
    mock.failureError = { code: -32000, message: 'execution reverted: insufficient allowance' };

    interceptor.wrapProvider(mock, { name: 'MockProvider' });

    const reqPromise = mock.request({
      method: 'eth_sendTransaction',
      params: [{ to: '0xTarget' }],
    });

    const record = Array.from((interceptor as any).pendingRequests.values())[0] as any;
    assert(Boolean(record), 'Record not found');

    // Bridge dispatches continue
    await interceptor.executeContinue(record.requestId);

    let caughtError: any;
    try {
      await reqPromise;
    } catch (err) {
      caughtError = err;
    }

    assert(Boolean(caughtError), 'Provider error was swallowed');
    assert(caughtError.code === -32000, `Expected code -32000, got ${caughtError?.code}`);
    assert(
      caughtError.message === 'execution reverted: insufficient allowance',
      `Error message mismatch: ${caughtError?.message}`
    );
  });

  return results;
}

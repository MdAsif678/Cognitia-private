/**
 * Unit Test Suite for Content Script Bridge & Trust Boundary Validation.
 * Validates:
 * - Application namespace enforcement ("wallet-interceptor")
 * - Rejection of malformed messages (missing fields, wrong types, empty strings, non-arrays)
 * - Rejection of unexpected / unknown message types
 * - Prevention of prototype pollution
 * - Strict discriminated union validation for all PAGE -> EXTENSION and EXTENSION -> PAGE messages
 */

import { validatePageMessage, validateExtensionMessage } from '../src/shared/validation';
import { APPLICATION_NAMESPACE } from '../src/shared/constants';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export async function runBridgeTests(): Promise<TestResult[]> {
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

  // -------------------------------------------------------------
  // Test 1: Messages without valid source namespace are rejected
  // -------------------------------------------------------------
  test('1. Reject messages lacking "wallet-interceptor" source namespace', () => {
    const res1 = validatePageMessage({
      source: 'malicious-script',
      direction: 'PAGE_TO_EXTENSION',
      type: 'INTERCEPTED_REQUEST',
      requestId: 'req_1',
      method: 'eth_sendTransaction',
      params: [],
    });
    assert(!res1.success, 'Message with wrong source was accepted');
    assert(res1.error.includes('Invalid message source'), 'Error message mismatch');

    const res2 = validatePageMessage({
      direction: 'PAGE_TO_EXTENSION',
      type: 'INTERCEPTED_REQUEST',
      requestId: 'req_1',
      method: 'eth_sendTransaction',
      params: [],
    });
    assert(!res2.success, 'Message missing source was accepted');
  });

  // -------------------------------------------------------------
  // Test 2: Messages with invalid direction are rejected
  // -------------------------------------------------------------
  test('2. Reject messages with invalid direction', () => {
    const res = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE', // Invalid for page messages
      type: 'INTERCEPTED_REQUEST',
      requestId: 'req_1',
      method: 'eth_sendTransaction',
      params: [],
    });
    assert(!res.success, 'Page message with invalid direction was accepted');
    assert(res.error.includes('Invalid message direction'), 'Error message mismatch');
  });

  // -------------------------------------------------------------
  // Test 3: Unexpected message types are rejected
  // -------------------------------------------------------------
  test('3. Reject unexpected or unapproved message types', () => {
    const unexpectedTypes = [
      'EXECUTE_CODE',
      'BYPASS_SECURITY',
      'ARBITRARY_ACTION',
      '',
      null,
      1234,
      'window.postMessage',
    ];

    for (const badType of unexpectedTypes) {
      const res = validatePageMessage({
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: badType,
        requestId: 'req_1',
      });
      assert(!res.success, `Unexpected message type "${String(badType)}" was accepted`);
      assert(res.error.includes('Unexpected message type'), 'Error message mismatch');
    }
  });

  // -------------------------------------------------------------
  // Test 4: Malformed requestId in INTERCEPTED_REQUEST
  // -------------------------------------------------------------
  test('4. Reject INTERCEPTED_REQUEST with malformed requestId', () => {
    const invalidRequestIds = ['', '   ', null, undefined, 12345, {}, []];

    for (const badId of invalidRequestIds) {
      const res = validatePageMessage({
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'INTERCEPTED_REQUEST',
        requestId: badId,
        method: 'eth_sendTransaction',
        params: [],
      });
      assert(!res.success, `Invalid requestId "${String(badId)}" was accepted`);
      assert(res.error.includes('requestId'), 'Error did not mention requestId');
    }
  });

  // -------------------------------------------------------------
  // Test 5: Malformed method in INTERCEPTED_REQUEST
  // -------------------------------------------------------------
  test('5. Reject INTERCEPTED_REQUEST with malformed method', () => {
    const invalidMethods = ['', '  ', null, undefined, 999, {}, []];

    for (const badMethod of invalidMethods) {
      const res = validatePageMessage({
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'INTERCEPTED_REQUEST',
        requestId: 'req_123',
        method: badMethod,
        params: [],
      });
      assert(!res.success, `Invalid method "${String(badMethod)}" was accepted`);
      assert(res.error.includes('method'), 'Error did not mention method');
    }
  });

  // -------------------------------------------------------------
  // Test 6: Malformed params in INTERCEPTED_REQUEST
  // -------------------------------------------------------------
  test('6. Reject INTERCEPTED_REQUEST with non-array params', () => {
    const invalidParams = [null, undefined, 'not-an-array', 1234, { foo: 'bar' }];

    for (const badParams of invalidParams) {
      const res = validatePageMessage({
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'INTERCEPTED_REQUEST',
        requestId: 'req_123',
        method: 'eth_sendTransaction',
        params: badParams,
      });
      assert(!res.success, `Non-array params "${String(badParams)}" was accepted`);
      assert(res.error.includes('params'), 'Error did not mention params');
    }
  });

  // -------------------------------------------------------------
  // Test 7: Valid INTERCEPTED_REQUEST passes and freezes references
  // -------------------------------------------------------------
  test('7. Valid INTERCEPTED_REQUEST passes validation and freezes data', () => {
    const rawParams = [{ to: '0x123', value: '0x10' }];
    const res = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'INTERCEPTED_REQUEST',
      requestId: 'req_abc_123',
      method: 'eth_sendTransaction',
      params: rawParams,
      providerId: 'MetaMask',
      origin: 'https://app.lumaswap.io',
    });

    assert(res.success, 'Valid INTERCEPTED_REQUEST was rejected');
    if (res.success) {
      assert(res.data.type === 'INTERCEPTED_REQUEST', 'Type mismatch');
      assert(res.data.requestId === 'req_abc_123', 'requestId mismatch');
      assert(Object.isFrozen(res.data), 'Resulting message was not frozen');
      assert(Object.isFrozen(res.data.params), 'Resulting params were not frozen');
      // Ensure params was deep cloned to prevent mutable reference poisoning
      assert(res.data.params !== rawParams, 'Params reference was not severed');
    }
  });

  // -------------------------------------------------------------
  // Test 8: Malformed ACCOUNT_CHANGED messages
  // -------------------------------------------------------------
  test('8. Reject malformed ACCOUNT_CHANGED messages', () => {
    // Non-array accounts
    const res1 = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'ACCOUNT_CHANGED',
      accounts: '0x1234',
    });
    assert(!res1.success, 'Non-array accounts was accepted');

    // Array with non-string elements
    const res2 = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'ACCOUNT_CHANGED',
      accounts: ['0xValid', 12345, null],
    });
    assert(!res2.success, 'Accounts array with numbers was accepted');
  });

  // -------------------------------------------------------------
  // Test 9: Valid ACCOUNT_CHANGED message
  // -------------------------------------------------------------
  test('9. Valid ACCOUNT_CHANGED message passes validation', () => {
    const res = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'ACCOUNT_CHANGED',
      accounts: ['0x1111111111111111111111111111111111111111'],
      origin: 'https://app.lumaswap.io',
    });

    assert(res.success, 'Valid ACCOUNT_CHANGED was rejected');
    if (res.success) {
      assert(res.data.type === 'ACCOUNT_CHANGED', 'Type mismatch');
      assert(res.data.accounts.length === 1, 'Accounts length mismatch');
      assert(Object.isFrozen(res.data.accounts), 'Accounts array was not frozen');
    }
  });

  // -------------------------------------------------------------
  // Test 10: Malformed and valid CHAIN_CHANGED messages
  // -------------------------------------------------------------
  test('10. Validate CHAIN_CHANGED schema strictly', () => {
    // Malformed: non-string chainId
    const badRes = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'CHAIN_CHANGED',
      chainId: 1, // Must be hex string (e.g. "0x1")
    });
    assert(!badRes.success, 'Non-string chainId was accepted');

    // Valid: hex string
    const goodRes = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'CHAIN_CHANGED',
      chainId: '0x1',
    });
    assert(goodRes.success, 'Valid CHAIN_CHANGED was rejected');
  });

  // -------------------------------------------------------------
  // Test 11: Valid PROVIDER_DISCOVERED messages
  // -------------------------------------------------------------
  test('11. Validate PROVIDER_DISCOVERED schema', () => {
    const bad = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'PROVIDER_DISCOVERED',
      providerId: '',
    });
    assert(!bad.success, 'Missing name was accepted');

    const good = validatePageMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'PROVIDER_DISCOVERED',
      providerId: 'metamask-io',
      name: 'MetaMask',
      rdns: 'io.metamask',
      isMetaMask: true,
    });
    assert(good.success, 'Valid PROVIDER_DISCOVERED was rejected');
  });

  // -------------------------------------------------------------
  // Test 12: Prototype pollution resistance
  // -------------------------------------------------------------
  test('12. Prototype pollution attempts do not pollute Object prototype', () => {
    const maliciousPayload = JSON.parse(
      '{"source":"wallet-interceptor","direction":"PAGE_TO_EXTENSION","type":"INTERCEPTED_REQUEST","requestId":"req_safe","method":"eth_sendTransaction","params":[],"__proto__":{"polluted":true}}'
    );

    const res = validatePageMessage(maliciousPayload);
    assert(res.success, 'Safe message parts should pass');
    // Verify prototype was not polluted
    const testObj = {};
    assert((testObj as any).polluted === undefined, 'Prototype pollution succeeded!');
  });

  // -------------------------------------------------------------
  // Test 13: EXTENSION -> PAGE message validation
  // -------------------------------------------------------------
  test('13. Validate EXTENSION -> PAGE control messages', () => {
    // Valid USER_CONTINUE
    const contRes = validateExtensionMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'USER_CONTINUE',
      requestId: 'req_123',
    });
    assert(contRes.success, 'Valid USER_CONTINUE was rejected');

    // Valid USER_REJECT
    const rejRes = validateExtensionMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'USER_REJECT',
      requestId: 'req_123',
      reason: 'User cancelled',
    });
    assert(rejRes.success, 'Valid USER_REJECT was rejected');

    // Valid ANALYSIS_RESULT
    const analysisRes = validateExtensionMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'ANALYSIS_RESULT',
      requestId: 'req_123',
      severity: 'HIGH',
      riskScore: 85,
      summary: 'High risk drain detected',
    });
    assert(analysisRes.success, 'Valid ANALYSIS_RESULT was rejected');

    // Invalid: missing requestId
    const badExt = validateExtensionMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'USER_CONTINUE',
      requestId: '',
    });
    assert(!badExt.success, 'Extension message with empty requestId was accepted');

    // Invalid: unexpected type
    const badType = validateExtensionMessage({
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'INJECT_SCRIPT',
      requestId: 'req_123',
    });
    assert(!badType.success, 'Unexpected extension message type was accepted');
  });

  return results;
}

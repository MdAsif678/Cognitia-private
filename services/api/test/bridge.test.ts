import { expect, it } from 'vitest';
import type { AnalyzeRequest, SimulationResult } from '@cognitia/shared';
import { createSwastikEngine } from '../../../incoming/integration/swastik-bridge';
import { normalizeRequest } from '../src/pipeline/normalize';
const target = '0x1111111111111111111111111111111111111111';
const codeHash = `0x${'ab'.repeat(32)}` as const;
const request: AnalyzeRequest = { requestId: 'codehash-test', origin: 'https://example.com', chainId: 31337, account: '0x2222222222222222222222222222222222222222', method: 'eth_sendTransaction', params: [{ from: '0x2222222222222222222222222222222222222222', to: target, data: '0xdeadbeef', value: '0x0' }] };
const simulation: SimulationResult = { mode: 'transaction', fork: { chainId: 31337, blockNumber: '10', blockHash: `0x${'cd'.repeat(32)}`, verified: true }, outcome: 'success', steps: [], immediateChanges: [], assetFlows: [], exposures: [], calls: [], accounts: [{ address: target, isContract: true, codeHash, codeSize: 100 }], tokens: [], assumptions: [], coverage: { checked: ['runtime bytecode'], missing: [], complete: true }, durationMs: 1 };
it('matches fork-observed runtime hashes with chain-scoped, explicitly demo-only evidence', async () => {
  const record = { id: 'local-test-code', chainId: 31337, matchType: 'codehash' as const, matchValue: codeHash, label: 'Local fixture bytecode', sourceUrl: 'https://example.com/fixture', confidence: 'high' as const, updatedAt: '2026-09-12T00:00:00Z', demoOnly: true, entityRole: 'target' as const };
  for (const chainId of [31337, 1]) {
    const engine = createSwastikEngine({ chains: [], includeDemo: true, threatRecords: [{ ...record, chainId }] });
    const normalized = normalizeRequest(request);
    const decoded = await engine.decode(request, normalized);
    const result = await engine.assess({ request, normalized, decoded, simulation });
    const match = result.findings.find(f => f.ruleId === 'threat.runtime-bytecode');
    if (chainId === 31337) { expect(match?.severity).toBe('critical'); expect(match?.title).toContain('[DEMO ONLY]'); expect(match?.explanation).toContain('fork block 10'); }
    else expect(match).toBeUndefined();
  }
});

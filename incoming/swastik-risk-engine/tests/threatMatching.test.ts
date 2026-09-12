import { describe, it, expect } from 'vitest';
import {
  defaultThreatProvider,
  VersionedThreatStore,
  PRODUCTION_THREAT_DATABASE,
  DEMO_THREAT_DATABASE,
  EMPTY_CODE_HASH,
  normalizeHostname,
  calculateFreshness,
} from '../src/providers/threatProvider';
import { keccak256, toHex } from 'viem';

describe('Versioned Threat Indicator Store', () => {
  describe('Chain-Specific Exact Address Matches & Entity Roles', () => {
    it('matches documented Inferno Drainer address on Ethereum Mainnet with spender role', () => {
      const infernoSpender = '0x0000db5c8B030ae5034102f866416f8B25530182';
      const matches = defaultThreatProvider.matchAddress(infernoSpender, 1, 'spender');

      expect(matches.length).toBe(1);
      const ev = matches[0];
      expect(ev.id).toBe('threat-addr-inferno-drainer');
      expect(ev.matchType).toBe('address');
      expect(ev.evidenceType).toBe('address_match');
      expect(ev.entityRole).toBe('spender');
      expect(ev.confidence).toBe('high');
      expect(ev.demoOnly).toBe(false);
      expect(ev.source).toContain('etherscan.io');
      expect(ev.freshness).toBeDefined();
      expect(ev.freshness.updatedAt).toBe('2024-03-15T00:00:00Z');
    });

    it('matches documented PinkDrainer with operator role', () => {
      const pinkOperator = '0x000000000000543666fe5bc9635f793b82141505';
      const matches = defaultThreatProvider.matchAddress(pinkOperator, 1, 'operator');

      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('threat-addr-pinkdrainer');
      expect(matches[0].entityRole).toBe('operator');
      expect(matches[0].sourceUrl).toContain('etherscan.io');
    });

    it('matches Tornado Cash Governance Exploiter with recipient role', () => {
      const exploiterRecipient = '0x592340957ebc9e4afb0e9af221d06fdddf789de9';
      const matches = defaultThreatProvider.matchAddress(exploiterRecipient, 1, 'recipient');

      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('threat-addr-tornado-gov-exploiter');
      expect(matches[0].entityRole).toBe('recipient');
    });

    it('does not equate a sanctions record with a drainer signature', () => {
      expect(defaultThreatProvider.matchAddress('0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', 1)).toEqual([]);
    });

    it('enforces cross-chain address mismatch (Ethereum indicator does NOT match on Polygon)', () => {
      const infernoSpender = '0x0000db5c8B030ae5034102f866416f8B25530182';
      // Query on Polygon (chainId: 137)
      const matchesOnPolygon = defaultThreatProvider.matchAddress(infernoSpender, 137);
      expect(matchesOnPolygon.length).toBe(0);

      // Query on Arbitrum (chainId: 42161)
      const matchesOnArbitrum = defaultThreatProvider.matchAddress(infernoSpender, 42161);
      expect(matchesOnArbitrum.length).toBe(0);

      // Confirm explanation explicitly notes no match in this dataset
      expect(defaultThreatProvider.explainNoMatch()).toContain('No match in this dataset');
    });
  });

  describe('Exact Runtime Bytecode Hash Matching & Empty-Code Rejection', () => {
    it('does not ship a fabricated production codehash', () => {
      expect(defaultThreatProvider.matchBytecodeHash('0x12a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3')).toEqual([]);
    });

    it('matches runtime bytecode directly using keccak256 without metadata normalization', () => {
      // Create custom store with a known runtime bytecode hash
      const dummyRuntimeCode = '0x608060405234801561001057600080fd5b506004361061002b57' as const;
      const expectedHash = keccak256(dummyRuntimeCode).toLowerCase();

      const store = new VersionedThreatStore({
        customRecords: [
          {
            id: 'test-codehash',
            chainId: 1,
            matchType: 'codehash',
            matchValue: expectedHash,
            label: 'Test Malicious Runtime Bytecode',
            sourceUrl: 'https://example.com/advisory',
            confidence: 'high',
            updatedAt: '2024-01-01T00:00:00Z',
            demoOnly: false,
            entityRole: 'implementation',
          },
        ],
      });

      const matches = store.matchBytecode(dummyRuntimeCode, 'implementation');
      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('test-codehash');
      expect(matches[0].matchedValue).toBe(expectedHash);
    });

    it('rejects empty code (0x / empty string) as meaningful contract threat indicators', () => {
      // 0x bytecode query
      expect(defaultThreatProvider.matchBytecode('0x').length).toBe(0);
      expect(defaultThreatProvider.matchBytecode('').length).toBe(0);
      expect(defaultThreatProvider.matchBytecode('0x0').length).toBe(0);
    });

    it('rejects empty-code hash (0xc5d2...a470) as a contract threat indicator', () => {
      // Querying the keccak256 hash of empty code must return zero matches
      expect(defaultThreatProvider.matchBytecodeHash(EMPTY_CODE_HASH).length).toBe(0);
      expect(defaultThreatProvider.matchBytecodeHash('0x').length).toBe(0);
    });

    it('rejects registration of empty-code hash or missing chainId on on-chain records', () => {
      // Attempt to register EMPTY_CODE_HASH
      expect(() => {
        new VersionedThreatStore({
          customRecords: [
            {
              id: 'bad-empty-code',
              chainId: 1,
              matchType: 'codehash',
              matchValue: EMPTY_CODE_HASH,
              label: 'Invalid empty code record',
              sourceUrl: 'https://example.com',
              confidence: 'high',
              updatedAt: '2024-01-01T00:00:00Z',
              demoOnly: false,
            },
          ],
        });
      }).toThrow(/Cannot register empty-code hash/);

      // Attempt to register address indicator with null chainId
      expect(() => {
        new VersionedThreatStore({
          customRecords: [
            {
              id: 'bad-null-chain',
              chainId: null,
              matchType: 'address',
              matchValue: '0x0000db5c8b030ae5034102f866416f8b25530182',
              label: 'Invalid address with null chainId',
              sourceUrl: 'https://example.com',
              confidence: 'high',
              updatedAt: '2024-01-01T00:00:00Z',
              demoOnly: false,
            },
          ],
        });
      }).toThrow(/must specify an explicit chainId/);
    });
  });

  describe('Proxy and Implementation Distinction', () => {
    it('keeps fixture implementation and target evidence separate', () => {
      const runtime = '0x60006000fd' as const;
      const hash = keccak256(runtime);
      const address = '0x1111111111111111111111111111111111111111';
      const base = { chainId: 1, label: 'Test-only indicator', sourceUrl: 'https://example.com/test', confidence: 'high' as const, updatedAt: '2026-09-12T00:00:00Z', demoOnly: true };
      const store = new VersionedThreatStore({ includeDemo: true, customRecords: [
        { ...base, id: 'fixture-target', matchType: 'address', matchValue: address, entityRole: 'target' },
        { ...base, id: 'fixture-implementation', matchType: 'codehash', matchValue: hash, entityRole: 'implementation' },
      ] });
      const matches = store.matchAll({ chainId: 1, entities: [{ address, role: 'target' }, { bytecodeHash: hash, role: 'implementation' }] });
      expect(matches.map(m => m.evidenceType).sort()).toEqual(['address_match', 'codehash_match']);
    });
  });

  describe('Stale Indicator Detection & Freshness Calculation', () => {
    it('calculates freshness and flags indicators older than threshold as stale', () => {
      const fixedNow = new Date('2025-01-01T00:00:00Z');

      // Indicator from 2022 (Tornado Router: 2022-08-08) -> > 800 days old -> Stale
      const freshnessOld = calculateFreshness('2022-08-08T00:00:00Z', fixedNow, 180);
      expect(freshnessOld.isStale).toBe(true);
      expect(freshnessOld.status).toBe('stale');
      expect(freshnessOld.ageDays).toBeGreaterThan(800);

      // Fresh indicator updated 30 days prior
      const freshnessFresh = calculateFreshness('2024-12-01T00:00:00Z', fixedNow, 180);
      expect(freshnessFresh.isStale).toBe(false);
      expect(freshnessFresh.status).toBe('fresh');
      expect(freshnessFresh.ageDays).toBe(31);
    });
  });

  describe('Demo Indicators Isolation', () => {
    it('does not include demo indicators by default in production store', () => {
      const demoSpender = '0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001';
      const matches = defaultThreatProvider.matchAddress(demoSpender, 1);
      expect(matches.length).toBe(0);

      const demoDomain = 'drainer-demo-test.io';
      expect(defaultThreatProvider.matchDomain(demoDomain).length).toBe(0);
    });

    it('includes demo indicators when explicitly enabled, labeling demoOnly: true', () => {
      const sandboxStore = new VersionedThreatStore({ includeDemo: true });
      const demoSpender = '0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001';

      const matches = sandboxStore.matchAddress(demoSpender, 1);
      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('demo-threat-addr-scam-vault');
      expect(matches[0].demoOnly).toBe(true);
      expect(matches[0].isDemo).toBe(true);
      expect(matches[0].label).toContain('[DEMO ONLY]');
    });
  });

  describe('Domain Normalization, Label Matching vs Substring Matching', () => {
    it('matches exact domain and subdomain from MetaMask eth-phishing-detect catalog', () => {
      // Subdomain match
      const sub = 'claim.uniswap-airdrop-claim.com';
      const matches = defaultThreatProvider.matchDomain(sub);
      expect(matches.length).toBe(1);
      expect(matches[0].sourceUrl).toContain('MetaMask/eth-phishing-detect');
      expect(matches[0].originalInput).toBe(sub);

      // Exact domain match
      const exact = 'uniswap-airdrop-claim.com';
      expect(defaultThreatProvider.matchDomain(exact).length).toBe(1);
    });

    it('normalizes full URLs with ports, paths, queries, and trailing dots while retaining original input', () => {
      const rawUrl = 'https://uniswap-airdrop-claim.com:8443/airdrop/claim?ref=123#modal';
      const matches = defaultThreatProvider.matchDomain(rawUrl);

      expect(matches.length).toBe(1);
      expect(matches[0].matchedValue).toBe('uniswap-airdrop-claim.com');
      expect(matches[0].originalInput).toBe(rawUrl);

      // Normalization utility check
      const norm = normalizeHostname('https://sub.domain.com:9000/path.');
      expect(norm.normalizedHostname).toBe('sub.domain.com');
      expect(norm.isValid).toBe(true);
    });

    it('strictly avoids substring matches (does NOT false positive on legitimate prefixes or suffixes)', () => {
      // Prefix extension: e.g. legitimate-uniswap-airdrop-claim.com
      expect(defaultThreatProvider.matchDomain('legitimate-uniswap-airdrop-claim.com').length).toBe(0);

      // Suffix extension: e.g. uniswap-airdrop-claim.com.attacker.org (attacker subdomain)
      expect(defaultThreatProvider.matchDomain('uniswap-airdrop-claim.com.attacker.org').length).toBe(0);

      // Embedded substring: e.g. notuniswap-airdrop-claim.com
      expect(defaultThreatProvider.matchDomain('notuniswap-airdrop-claim.com').length).toBe(0);

      // Different TLD
      expect(defaultThreatProvider.matchDomain('uniswap-airdrop-claim.org').length).toBe(0);
    });
  });

  describe('Nonmatching Records & Dataset Disclaimer', () => {
    it('returns empty matches for benign address and confirms "no match in this dataset"', () => {
      const benignVitalik = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      const matches = defaultThreatProvider.matchAddress(benignVitalik, 1);

      expect(matches.length).toBe(0);

      const explanation = defaultThreatProvider.explainNoMatch();
      expect(explanation).toContain('No match in this dataset');
      expect(explanation).toContain('does not prove that an address, contract, or domain is benign');
    });
  });
});

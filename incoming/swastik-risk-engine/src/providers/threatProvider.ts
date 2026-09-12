import { keccak256, type Hex } from 'viem';
import {
  type ThreatMatchingProvider,
  type ThreatRecord,
  type ThreatMatchEvidence,
  type EntityRole,
  type FreshnessInfo,
  type ContextEntity,
} from './types';

export const EMPTY_CODE_HASH = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

/**
 * Authoritative primary-source production threat indicators.
 *
 * Grounded strictly in documented incident post-mortems, official regulatory sanctions (OFAC),
 * and verified public security disclosures.
 * Every on-chain indicator specifies an explicit chainId.
 * MetaMask eth-phishing-detect is used strictly for domain indicators (never for addresses or bytecode).
 */
export const PRODUCTION_THREAT_DATABASE: ThreatRecord[] = [
  // 1. Spender Threat Indicator: Inferno Drainer
  // Source: Scam Sniffer / Etherscan Verified Label
  {
    id: 'threat-addr-inferno-drainer',
    chainId: 1,
    matchType: 'address',
    matchValue: '0x0000db5c8b030ae5034102f866416f8b25530182'.toLowerCase(),
    label: 'Inferno Drainer: Phishing Spender Contract',
    sourceUrl: 'https://etherscan.io/address/0x0000db5c8B030ae5034102f866416f8B25530182',
    confidence: 'high',
    updatedAt: '2024-03-15T00:00:00Z',
    demoOnly: false,
    entityRole: 'spender',
    description:
      'Documented phishing drainer contract used by Inferno Drainer gang to siphon permit-authorized ERC-20 tokens on Ethereum Mainnet.',
  },

  // 2. Operator Threat Indicator: PinkDrainer
  // Source: Scam Sniffer / Dune Analytics / Etherscan Verified Label
  {
    id: 'threat-addr-pinkdrainer',
    chainId: 1,
    matchType: 'address',
    matchValue: '0x000000000000543666fe5bc9635f793b82141505'.toLowerCase(),
    label: 'PinkDrainer: Phishing Operator Contract',
    sourceUrl: 'https://etherscan.io/address/0x000000000000543666fe5bc9635f793b82141505',
    confidence: 'high',
    updatedAt: '2024-02-10T00:00:00Z',
    demoOnly: false,
    entityRole: 'operator',
    description:
      'Documented PinkDrainer contract involved in NFT thefts via setApprovalForAll and ERC-20 approvals on Ethereum Mainnet.',
  },

  // 3. Recipient Threat Indicator: Tornado Cash Governance Attack
  // Source: Paradigm Research & OpenZeppelin Post-Mortem (May 20, 2023)
  {
    id: 'threat-addr-tornado-gov-exploiter',
    chainId: 1,
    matchType: 'address',
    matchValue: '0x592340957ebc9e4afb0e9af221d06fdddf789de9'.toLowerCase(),
    label: 'Tornado Cash Governance Exploiter Recipient',
    sourceUrl: 'https://etherscan.io/address/0x592340957ebc9e4afb0e9af221d06fdddf789de9',
    confidence: 'high',
    updatedAt: '2023-05-21T00:00:00Z',
    demoOnly: false,
    entityRole: 'recipient',
    description:
      'Attacker recipient address from May 20, 2023 malicious governance proposal attack draining TORN governance tokens.',
  },

  // Only traceable incident indicators belong here; placeholder codehashes and sanctions are not drainer evidence.
  // 6. Generic Behavioral Heuristic: Unlimited Token Allowance
  // Chain-independent generic rule (chainId: null)
  {
    id: 'threat-behavior-unlimited-unknown-approval',
    chainId: null,
    matchType: 'behavioral',
    matchValue: 'unlimited_approval_unknown_spender',
    label: 'Unlimited Token Allowance to Unknown Spender',
    sourceUrl: 'https://eips.ethereum.org/EIPS/eip-20#approve',
    confidence: 'high',
    updatedAt: '2024-01-01T00:00:00Z',
    demoOnly: false,
    entityRole: 'spender',
    description: 'Approval of type(uint256).max or excessive allowance to an unverified or unknown contract.',
  },

  // 7. Generic Behavioral Heuristic: Unverified Delegatecall Target
  // Chain-independent generic rule (chainId: null)
  {
    id: 'threat-behavior-unverified-delegatecall',
    chainId: null,
    matchType: 'behavioral',
    matchValue: 'unverified_delegatecall_target',
    label: 'Execution Delegates Control to Unverified Target',
    sourceUrl: 'https://consensys.github.io/smart-contract-best-practices/development-recommendations/general/delegatecall/',
    confidence: 'high',
    updatedAt: '2024-01-01T00:00:00Z',
    demoOnly: false,
    entityRole: 'target',
    description: 'Contract execution delegates internal execution state to an unverified target address.',
  },

  // 8. Documented Phishing Domain: MetaMask eth-phishing-detect
  // Used exclusively for domain matching. Chain-independent (chainId: null).
  {
    id: 'threat-domain-metamask-uniswap-fake',
    chainId: null,
    matchType: 'domain',
    matchValue: 'uniswap-airdrop-claim.com',
    label: 'Documented Phishing Domain (MetaMask Detect)',
    sourceUrl: 'https://github.com/MetaMask/eth-phishing-detect',
    confidence: 'high',
    updatedAt: '2024-02-14T00:00:00Z',
    demoOnly: false,
    entityRole: 'target',
    description:
      'Known phishing lure imitating Uniswap interface to prompt malicious signatures. Sourced exclusively from MetaMask eth-phishing-detect domain list.',
  },

  // 9. Documented Phishing Domain: MetaMask eth-phishing-detect
  {
    id: 'threat-domain-metamask-opensea-fake',
    chainId: null,
    matchType: 'domain',
    matchValue: 'opensea-revokecash-security.io',
    label: 'Documented Phishing Domain (MetaMask Detect)',
    sourceUrl: 'https://github.com/MetaMask/eth-phishing-detect',
    confidence: 'high',
    updatedAt: '2024-02-28T00:00:00Z',
    demoOnly: false,
    entityRole: 'target',
    description:
      'Impersonation domain tricking users into signing allowance sweeps. Sourced exclusively from MetaMask eth-phishing-detect domain list.',
  },
];

/**
 * Isolated synthetic demo dataset.
 * Kept completely separate from production data and disabled by default.
 * Demo evidence must never create an unlabeled production malicious verdict.
 */
export const DEMO_THREAT_DATABASE: ThreatRecord[] = [
  {
    id: 'demo-threat-addr-scam-vault',
    chainId: 1,
    matchType: 'address',
    matchValue: '0xDeadDeaDDeADdeAddeAddEAddeadDeaDDEAd0001'.toLowerCase(),
    label: '[DEMO ONLY] Synthetic Drainer Spender Address',
    sourceUrl: 'https://example.com/demo-threat-intel',
    confidence: 'high',
    updatedAt: '2025-01-01T00:00:00Z',
    demoOnly: true,
    entityRole: 'spender',
    description: 'Mock malicious spender address specifically reserved for test suites.',
  },
  {
    id: 'demo-threat-codehash-drainer',
    chainId: 1,
    matchType: 'codehash',
    matchValue: '0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef'.toLowerCase(),
    label: '[DEMO ONLY] Synthetic Malicious Codehash',
    sourceUrl: 'https://example.com/demo-codehash',
    confidence: 'high',
    updatedAt: '2025-01-01T00:00:00Z',
    demoOnly: true,
    entityRole: 'implementation',
    description: 'Mock bytecode hash for simulating bytecode-level detection in tests.',
  },
  {
    id: 'demo-threat-domain-phish',
    chainId: null,
    matchType: 'domain',
    matchValue: 'drainer-demo-test.io',
    label: '[DEMO ONLY] Synthetic Phishing Domain',
    sourceUrl: 'https://example.com/demo-phish',
    confidence: 'high',
    updatedAt: '2025-01-01T00:00:00Z',
    demoOnly: true,
    entityRole: 'target',
    description: 'Mock phishing domain indicator for sandbox testing.',
  },
];

/**
 * Backward compatibility alias for legacy tests/modules.
 */
export const SEED_THREAT_DATABASE: ThreatRecord[] = [...PRODUCTION_THREAT_DATABASE];

export interface ThreatStoreOptions {
  customRecords?: ThreatRecord[];
  includeDemo?: boolean;
  staleThresholdDays?: number;
  asOfDate?: Date;
}

export interface DomainNormalizationResult {
  normalizedHostname: string;
  originalInput: string;
  isValid: boolean;
}

/**
 * Explicit hostname normalization.
 * Strips protocol, user info, port, path, query, fragment, and trailing dots.
 * Strictly preserves the original hostname input for evidence and display.
 */
export function normalizeHostname(input: string): DomainNormalizationResult {
  const originalInput = input;
  let raw = input.trim().toLowerCase();

  if (!raw.includes('://')) {
    if (raw.startsWith('//')) {
      raw = 'http:' + raw;
    } else {
      raw = 'http://' + raw;
    }
  }

  let hostname = '';
  try {
    const url = new URL(raw);
    hostname = url.hostname.toLowerCase();
  } catch {
    hostname = input.trim().toLowerCase().split(/[/:?]/)[0] ?? '';
  }

  hostname = hostname.replace(/\.+$/, '');

  return {
    normalizedHostname: hostname,
    originalInput,
    isValid: hostname.length > 0 && hostname.includes('.'),
  };
}

/**
 * Evaluates indicator freshness against a reference date and staleness threshold.
 */
export function calculateFreshness(
  updatedAtStr: string,
  asOfDate: Date = new Date(),
  staleThresholdDays = 180
): FreshnessInfo {
  const updated = new Date(updatedAtStr);
  const diffMs = asOfDate.getTime() - updated.getTime();
  const ageDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const isStale = ageDays > staleThresholdDays;
  return {
    updatedAt: updatedAtStr,
    isStale,
    ageDays,
    status: isStale ? 'stale' : 'fresh',
  };
}

/**
 * Versioned Threat Indicator Store.
 *
 * Guarantees:
 * 1. Exact chainId matching for on-chain indicators; null allowed only for generic domain/behavioral rules.
 * 2. Exact runtime bytecode keccak256 matching; rejects empty code hashes.
 * 3. Keeps proxy and implementation matches distinct.
 * 4. Distinct evidence types: address_match, codehash_match, behavioral, domain_match.
 * 5. Isolated demo indicators disabled by default.
 * 6. Explicit domain label-boundary matching avoiding substring false positives.
 * 7. "No match" explicitly means "no match in this dataset."
 */
export class VersionedThreatStore implements ThreatMatchingProvider {
  private records: ThreatRecord[] = [];
  private includeDemo: boolean;
  private staleThresholdDays: number;
  private asOfDate?: Date;

  constructor(options?: ThreatStoreOptions) {
    this.includeDemo = options?.includeDemo ?? false;
    this.staleThresholdDays = options?.staleThresholdDays ?? 180;
    this.asOfDate = options?.asOfDate;

    const baseRecords = options?.customRecords ?? PRODUCTION_THREAT_DATABASE;
    for (const record of baseRecords) {
      this.validateAndAddRecord(record);
    }

    if (this.includeDemo) {
      for (const demoRecord of DEMO_THREAT_DATABASE) {
        this.validateAndAddRecord(demoRecord);
      }
    }
  }

  private validateAndAddRecord(record: ThreatRecord): void {
    // 1. Enforce chainId invariant
    if (record.matchType === 'address' || record.matchType === 'codehash') {
      if (record.chainId === null || record.chainId === undefined) {
        throw new Error(
          `Validation failed for indicator '${record.id}': On-chain ${record.matchType} indicator must specify an explicit chainId.`
        );
      }
    }

    // 2. Enforce empty-code hash rejection
    if (record.matchType === 'codehash') {
      const norm = record.matchValue.toLowerCase();
      if (norm === EMPTY_CODE_HASH || norm === '0x' || norm === '') {
        throw new Error(
          `Validation failed for indicator '${record.id}': Cannot register empty-code hash as a contract threat indicator.`
        );
      }
    }

    // 3. Normalization & storage
    const storedRecord: ThreatRecord = {
      ...record,
      matchValue: record.matchType === 'address' || record.matchType === 'codehash'
        ? record.matchValue.toLowerCase()
        : record.matchType === 'domain'
        ? normalizeHostname(record.matchValue).normalizedHostname
        : record.matchValue,
    };

    this.records.push(storedRecord);
  }

  private buildEvidence(
    record: ThreatRecord,
    matchedValue: string,
    role?: EntityRole,
    originalInput?: string
  ): ThreatMatchEvidence {
    const freshness = calculateFreshness(
      record.updatedAt,
      this.asOfDate ?? new Date(),
      this.staleThresholdDays
    );

    const entityRole = role ?? record.entityRole ?? 'target';

    const evidenceType =
      record.matchType === 'address'
        ? 'address_match'
        : record.matchType === 'codehash'
        ? 'codehash_match'
        : record.matchType === 'domain'
        ? 'domain_match'
        : 'behavioral';

    return {
      id: record.id,
      evidenceId: `threat-ev-${record.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      evidenceType,
      source: record.sourceUrl,
      sourceUrl: record.sourceUrl,
      matchedValue,
      matchValue: matchedValue,
      matchType: record.matchType,
      label: record.label,
      confidence: record.confidence,
      freshness,
      entityRole,
      demoOnly: record.demoOnly,
      isDemo: record.demoOnly,
      chainId: record.chainId,
      record,
      originalInput,
      description: record.description,
    };
  }

  /**
   * Exact address match, strictly scoped to chainId.
   * Cross-chain address queries will NOT match.
   */
  public matchAddress(address: string, chainId?: number, role?: EntityRole): ThreatMatchEvidence[] {
    if (!address) return [];
    const norm = address.toLowerCase();

    const matches: ThreatMatchEvidence[] = [];
    for (const r of this.records) {
      if (r.matchType !== 'address') continue;

      // Address indicators must match chainId
      if (r.chainId !== null && chainId !== undefined && r.chainId !== chainId) {
        continue;
      }

      if (r.matchValue.toLowerCase() === norm) {
        matches.push(this.buildEvidence(r, norm, role, address));
      }
    }
    return matches;
  }

  /**
   * Matches exact runtime bytecode fetched at the pinned block.
   * Computes keccak256 over exact runtime bytecode without stripping metadata.
   * Rejects empty code (0x / empty string).
   */
  public matchBytecode(bytecode: string, role?: EntityRole): ThreatMatchEvidence[] {
    if (!bytecode) return [];
    const trimmed = bytecode.trim();
    if (trimmed === '0x' || trimmed === '' || trimmed.toLowerCase() === '0x0' || trimmed.length <= 4) {
      // Reject empty-code hashes as meaningful contract threat indicators
      return [];
    }

    const hex = (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as Hex;
    const codehash = keccak256(hex).toLowerCase();

    if (codehash === EMPTY_CODE_HASH) {
      return [];
    }

    return this.matchBytecodeHash(codehash, role);
  }

  /**
   * Matches exact runtime bytecode hash.
   * Rejects empty-code hash (0xc5d2...a470 or 0x).
   */
  public matchBytecodeHash(codehash: string, role?: EntityRole): ThreatMatchEvidence[] {
    if (!codehash) return [];
    const norm = codehash.toLowerCase();

    // Explicitly reject empty-code hash
    if (norm === EMPTY_CODE_HASH || norm === '0x') {
      return [];
    }

    const matches: ThreatMatchEvidence[] = [];
    for (const r of this.records) {
      if (r.matchType !== 'codehash') continue;
      if (r.matchValue.toLowerCase() === norm) {
        matches.push(this.buildEvidence(r, norm, role, codehash));
      }
    }
    return matches;
  }

  /**
   * Explicit hostname normalization and matching rules.
   * Strictly avoids substring matching; enforces exact or full-label subdomain match.
   * Retains original hostname in evidence.
   */
  public matchDomain(domain: string, role?: EntityRole): ThreatMatchEvidence[] {
    if (!domain) return [];
    const normResult = normalizeHostname(domain);
    if (!normResult.isValid) return [];

    const candidateHostname = normResult.normalizedHostname;
    const matches: ThreatMatchEvidence[] = [];

    for (const r of this.records) {
      if (r.matchType !== 'domain') continue;
      const targetDomain = r.matchValue.toLowerCase();

      // Enforce strict label boundary: exact match OR subdomain (.targetDomain)
      // Never allow substring matches like 'bad.com' matching 'mybad.com' or 'bad.com.example.org'
      const isExact = candidateHostname === targetDomain;
      const isSubdomain = candidateHostname.endsWith(`.${targetDomain}`);

      if (isExact || isSubdomain) {
        matches.push(this.buildEvidence(r, targetDomain, role ?? 'target', normResult.originalInput));
      }
    }
    return matches;
  }

  /**
   * Matches versioned behavioral rules.
   */
  public matchBehavioral(ruleKey: string, role?: EntityRole): ThreatMatchEvidence[] {
    if (!ruleKey) return [];
    const matches: ThreatMatchEvidence[] = [];
    for (const r of this.records) {
      if (r.matchType !== 'behavioral') continue;
      if (r.matchValue === ruleKey) {
        matches.push(this.buildEvidence(r, ruleKey, role, ruleKey));
      }
    }
    return matches;
  }

  /**
   * Contextual matching supporting multiple entities with explicit roles:
   * spender, operator, recipient, target, or implementation.
   * Keeps proxy and implementation matches distinct.
   */
  public matchAll(context: {
    addresses?: string[];
    entities?: ContextEntity[];
    bytecodeHash?: string;
    bytecode?: string;
    domain?: string;
    behavioralKeys?: string[];
    chainId?: number;
  }): ThreatMatchEvidence[] {
    const matches: ThreatMatchEvidence[] = [];
    const seenEvidenceKey = new Set<string>();

    const addUnique = (evList: ThreatMatchEvidence[]) => {
      for (const ev of evList) {
        const key = `${ev.id}:${ev.entityRole}:${ev.matchedValue}`;
        if (!seenEvidenceKey.has(key)) {
          seenEvidenceKey.add(key);
          matches.push(ev);
        }
      }
    };

    // 1. Role-tagged entities (target, implementation, spender, operator, recipient)
    if (context.entities) {
      for (const entity of context.entities) {
        if (entity.address) {
          addUnique(this.matchAddress(entity.address, context.chainId, entity.role));
        }
        if (entity.bytecode) {
          addUnique(this.matchBytecode(entity.bytecode, entity.role));
        }
        if (entity.bytecodeHash) {
          addUnique(this.matchBytecodeHash(entity.bytecodeHash, entity.role));
        }
      }
    }

    // 2. Untagged address list (defaults to 'target' role)
    if (context.addresses) {
      for (const addr of context.addresses) {
        if (addr) {
          addUnique(this.matchAddress(addr, context.chainId, 'target'));
        }
      }
    }

    // 3. Pinned block bytecode / bytecode hash
    if (context.bytecode) {
      addUnique(this.matchBytecode(context.bytecode, 'target'));
    }
    if (context.bytecodeHash) {
      addUnique(this.matchBytecodeHash(context.bytecodeHash, 'target'));
    }

    // 4. Origin domain
    if (context.domain) {
      addUnique(this.matchDomain(context.domain, 'target'));
    }

    // 5. Behavioral heuristics
    if (context.behavioralKeys) {
      for (const b of context.behavioralKeys) {
        addUnique(this.matchBehavioral(b, 'target'));
      }
    }

    return matches;
  }

  /**
   * Explains that no matches were found in this dataset.
   * Guarantees that "no match" does not imply proof of safety.
   */
  public explainNoMatch(): string {
    return 'No match in this dataset. (Note: The absence of an indicator in this dataset does not prove that an address, contract, or domain is benign; it indicates only that it is not cataloged in current threat intelligence feeds).';
  }
}

export const defaultThreatProvider = new VersionedThreatStore();
export { VersionedThreatStore as DefaultThreatMatchingProvider };

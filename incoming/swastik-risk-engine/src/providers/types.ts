import { type DecodedIntent } from '../schemas/intent';
import { type Evidence } from '../schemas/evidence';
import { type Finding } from '../schemas/finding';
import { type SimulationResult } from '../schemas/simulation';
import { type AnalysisRequest } from '../schemas/request';

export type EntityRole = 'spender' | 'operator' | 'recipient' | 'target' | 'implementation';

export type ThreatMatchType = 'address' | 'codehash' | 'behavioral' | 'domain';

export type ThreatConfidence = 'high' | 'medium' | 'low';

export interface FreshnessInfo {
  updatedAt: string;
  isStale: boolean;
  ageDays: number;
  status: 'fresh' | 'stale';
}

export interface ThreatRecord {
  id: string;
  chainId: number | null;
  matchType: ThreatMatchType;
  matchValue: string;
  label: string;
  sourceUrl: string;
  confidence: ThreatConfidence;
  updatedAt: string;
  demoOnly: boolean;
  entityRole?: EntityRole;
  description?: string;
  version?: string;
}

export interface ThreatMatchEvidence {
  id: string;
  evidenceId: string;
  evidenceType: 'address_match' | 'codehash_match' | 'behavioral' | 'domain_match';
  source: string;
  sourceUrl: string;
  matchedValue: string;
  matchValue: string;
  matchType: ThreatMatchType;
  label: string;
  confidence: ThreatConfidence;
  freshness: FreshnessInfo;
  entityRole: EntityRole;
  demoOnly: boolean;
  isDemo: boolean;
  chainId: number | null;
  record: ThreatRecord;
  originalInput?: string;
  description?: string;
}

export interface ContextEntity {
  address?: string;
  bytecode?: string;
  bytecodeHash?: string;
  role: EntityRole;
}

export interface AbiLookupResult {
  signature: string;
  functionName: string;
  isCandidate: boolean;
  disclaimer?: string;
  abi?: unknown[];
}

export interface AbiLookupProvider {
  getAbi(address: string, chainId: number): Promise<unknown[] | null>;
  lookupSelector(selector: string): Promise<AbiLookupResult | null>;
  registerVerifiedAbi(address: string, chainId: number, abi: unknown[]): void;
}

export interface ChainReadProvider {
  readonly chainId: number;
  getBalance(account: string, blockNumber?: bigint): Promise<bigint>;
  getTokenBalance(token: string, account: string, blockNumber?: bigint): Promise<bigint>;
  getTokenAllowance(token: string, owner: string, spender: string, blockNumber?: bigint): Promise<bigint>;
  getTokenNonce(token: string, owner: string, blockNumber?: bigint): Promise<bigint>;
  getDomainSeparator(token: string, blockNumber?: bigint): Promise<string | null>;
  getBlockTimestamp(blockNumber?: bigint): Promise<bigint>;
  getBytecode(address: string): Promise<string | null>;
  getBlockNumber(): Promise<bigint>;
}

export interface SimulationProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  simulateTransaction(params: {
    from: string;
    to: string;
    value: bigint;
    calldata: string;
    chainId: number;
  }): Promise<SimulationResult>;
  simulateConditionalPermit(params: {
    token: string;
    owner: string;
    spender: string;
    value: bigint;
    chainId: number;
    pinnedBlockNumber?: string;
    isContractSpender?: boolean;
    preBalance?: bigint;
    preAllowance?: bigint;
    hypotheticalRecipient?: string;
  }): Promise<SimulationResult>;
}

export interface ThreatMatchingProvider {
  matchAddress(address: string, chainId?: number, role?: EntityRole): ThreatMatchEvidence[];
  matchBytecode(bytecode: string, role?: EntityRole): ThreatMatchEvidence[];
  matchBytecodeHash(codehash: string, role?: EntityRole): ThreatMatchEvidence[];
  matchDomain(domain: string, role?: EntityRole): ThreatMatchEvidence[];
  matchBehavioral(ruleKey: string, role?: EntityRole): ThreatMatchEvidence[];
  matchAll(context: {
    addresses?: string[];
    entities?: ContextEntity[];
    bytecodeHash?: string;
    bytecode?: string;
    domain?: string;
    behavioralKeys?: string[];
    chainId?: number;
  }): ThreatMatchEvidence[];
  explainNoMatch(): string;
}

export interface SignatureAdapterProvider {
  readonly id: string;
  canHandle(request: AnalysisRequest): boolean;
  analyze(request: AnalysisRequest): Promise<{
    intent: DecodedIntent;
    findings: Finding[];
    evidence: Evidence[];
    coverage: 'complete' | 'partial' | 'unsupported';
    reasons: string[];
    simulatedPermitTarget?: {
      token: string;
      owner: string;
      spender: string;
      value: bigint;
      isContractSpender?: boolean;
      preBalance?: bigint;
      preAllowance?: bigint;
      hypotheticalRecipient?: string;
    };
  }>;
}

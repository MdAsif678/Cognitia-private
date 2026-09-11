import {
  analysisRequestSchema,
  type AnalysisRequest,
  type TransactionAnalysisRequest,
  type Eip712AnalysisRequest,
  type PersonalSignAnalysisRequest,
} from '../schemas/request';
import { type DecodedIntent } from '../schemas/intent';
import { type Finding, type Severity } from '../schemas/finding';
import { type Evidence } from '../schemas/evidence';
import { type Coverage, type CoverageStatus } from '../schemas/coverage';
import { type SimulationResult } from '../schemas/simulation';
import { analysisReportSchema, type AnalysisReport } from '../schemas/report';
import { IntentDecoder, defaultIntentDecoder } from './intentDecoder';
import { evaluateDeterministicRules } from './deterministicRules';
import {
  type ThreatMatchingProvider,
  type SimulationProvider,
  type SignatureAdapterProvider,
  type ChainReadProvider,
  type ContextEntity,
  type EntityRole,
} from '../providers/types';
import { defaultThreatProvider, VersionedThreatStore } from '../providers/threatProvider';
import { defaultTrustRegistry, type TrustRegistryProvider } from '../providers/trustRegistry';
import { defaultAnvilSimulator } from '../simulator/anvilSimulator';
import { Erc2612SignatureAdapter } from '../providers/signatureAdapters/erc2612Adapter';
import { Permit2SignatureAdapter } from '../providers/signatureAdapters/permit2Adapter';
import { PersonalSignSignatureAdapter } from '../providers/signatureAdapters/personalSignAdapter';
import { GenericEip712Adapter } from '../providers/signatureAdapters/genericEip712Adapter';

export interface RiskEngineOptions {
  intentDecoder?: IntentDecoder;
  threatProvider?: ThreatMatchingProvider;
  trustRegistry?: TrustRegistryProvider;
  simulationProvider?: SimulationProvider;
  signatureAdapters?: SignatureAdapterProvider[];
  chainProvider?: ChainReadProvider;
  includeDemo?: boolean;
}

export class RiskEngine {
  private intentDecoder: IntentDecoder;
  private threatProvider: ThreatMatchingProvider;
  private trustRegistry: TrustRegistryProvider;
  private simulationProvider: SimulationProvider;
  private signatureAdapters: SignatureAdapterProvider[];
  private chainProvider?: ChainReadProvider;

  constructor(options?: RiskEngineOptions) {
    this.intentDecoder = options?.intentDecoder || defaultIntentDecoder;
    this.threatProvider =
      options?.threatProvider ||
      (options?.includeDemo ? new VersionedThreatStore({ includeDemo: true }) : defaultThreatProvider);
    this.trustRegistry = options?.trustRegistry || defaultTrustRegistry;
    this.simulationProvider = options?.simulationProvider || defaultAnvilSimulator;
    this.chainProvider = options?.chainProvider;
    this.signatureAdapters = options?.signatureAdapters || [
      new Erc2612SignatureAdapter({ chainProvider: this.chainProvider }),
      new Permit2SignatureAdapter(),
      new PersonalSignSignatureAdapter(),
      new GenericEip712Adapter(),
    ];
  }

  public async analyze(rawInput: unknown): Promise<AnalysisReport> {
    // 1. Strict Request Validation
    const parsedRequest = analysisRequestSchema.safeParse(rawInput);
    if (!parsedRequest.success) {
      throw new Error(`Invalid AnalysisRequest: ${parsedRequest.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
    }

    const request = parsedRequest.data;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();

    const evidenceMap: Record<string, Evidence> = {};
    let decodedIntent: DecodedIntent;
    let simulationResult: SimulationResult | undefined;
    const initialFindings: Finding[] = [];
    const coverageReasons: string[] = [];

    let calldataCoverage: CoverageStatus = 'complete';
    let signatureCoverage: CoverageStatus = 'complete';
    let simCoverage: CoverageStatus = 'complete';
    const threatCoverage: CoverageStatus = 'complete';

    let chainId = 1;
    let originDomain: string | undefined;

    // 2. Process based on request type
    if (request.type === 'transaction') {
      const txReq = request as TransactionAnalysisRequest;
      chainId = txReq.chainId;

      // Intent decoding
      decodedIntent = await this.intentDecoder.decode(txReq.calldata, txReq.to, txReq.value, txReq.chainId);
      if (decodedIntent.isUnknownFunction) {
        calldataCoverage = 'partial';
        coverageReasons.push(`Unverified function selector (${decodedIntent.selector || 'raw calldata'})`);
      }

      // Simulation
      try {
        simulationResult = await this.simulationProvider.simulateTransaction({
          from: txReq.from,
          to: txReq.to,
          value: BigInt(txReq.value),
          calldata: txReq.calldata,
          chainId: txReq.chainId,
        });
      } catch (err) {
        simCoverage = 'failed';
        coverageReasons.push(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (request.type === 'eip712') {
      const eipReq = request as Eip712AnalysisRequest;
      chainId = eipReq.selectedChainId;
      originDomain = eipReq.domainOrOrigin;

      const adapter = this.signatureAdapters.find((a) => a.canHandle(request));
      if (!adapter) {
        signatureCoverage = 'unsupported';
        coverageReasons.push(`Unsupported EIP-712 schema for primaryType: ${eipReq.payload.primaryType}`);
        decodedIntent = {
          type: 'eip712',
          functionName: eipReq.payload.primaryType,
          rawCalldata: '0x',
          isUnknownFunction: true,
          typedDataDetails: {
            standard: 'Unknown',
            primaryType: eipReq.payload.primaryType,
            fields: eipReq.payload.message,
            inconsistencies: ['No specialized adapter registered for this EIP-712 schema'],
          },
        };
      } else {
        const res = await adapter.analyze(request);
        decodedIntent = res.intent;
        initialFindings.push(...res.findings);
        res.evidence.forEach((e) => (evidenceMap[e.id] = e));
        signatureCoverage = res.coverage;
        coverageReasons.push(...res.reasons);

        // Conditional simulation if adapter recognized a permit structure
        if (res.simulatedPermitTarget) {
          try {
            simulationResult = await this.simulationProvider.simulateConditionalPermit({
              token: res.simulatedPermitTarget.token,
              owner: res.simulatedPermitTarget.owner,
              spender: res.simulatedPermitTarget.spender,
              value: res.simulatedPermitTarget.value,
              chainId,
              isContractSpender: res.simulatedPermitTarget.isContractSpender,
              preBalance: res.simulatedPermitTarget.preBalance,
              preAllowance: res.simulatedPermitTarget.preAllowance,
              hypotheticalRecipient: res.simulatedPermitTarget.hypotheticalRecipient,
            });
          } catch (err) {
            simCoverage = 'failed';
            coverageReasons.push(`Conditional permit simulation failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } else {
      // personal_sign
      const psReq = request as PersonalSignAnalysisRequest;
      chainId = psReq.chainId || 1;
      originDomain = psReq.domainOrOrigin;

      const adapter = this.signatureAdapters.find((a) => a.canHandle(request));
      if (adapter) {
        const res = await adapter.analyze(request);
        decodedIntent = res.intent;
        initialFindings.push(...res.findings);
        res.evidence.forEach((e) => (evidenceMap[e.id] = e));
        signatureCoverage = res.coverage;
        coverageReasons.push(...res.reasons);
      } else {
        decodedIntent = {
          type: 'personal_sign',
          functionName: 'personal_sign',
          rawCalldata: '0x',
          isUnknownFunction: true,
        };
      }
    }

    // 3. Threat Matching with Explicit Entity Roles
    const entities: ContextEntity[] = [];

    // Target contract -> role: 'target'
    if (decodedIntent.targetContract) {
      entities.push({ address: decodedIntent.targetContract, role: 'target' });
    }

    // Proxy implementation contract -> role: 'implementation'
    if (decodedIntent.proxyInfo?.implementationAddress) {
      entities.push({ address: decodedIntent.proxyInfo.implementationAddress, role: 'implementation' });
    }

    // Parameters with explicit roles (spender, operator, recipient)
    if (decodedIntent.parameters) {
      for (const p of decodedIntent.parameters) {
        if (p.type === 'address' && p.value) {
          let role: EntityRole = 'target';
          if (p.name === 'spender') role = 'spender';
          else if (p.name === 'operator') role = 'operator';
          else if (p.name === 'to' || p.name === 'recipient' || p.name === 'dst') role = 'recipient';
          entities.push({ address: p.value, role });
        }
      }
    }

    // Simulation asset deltas -> role: 'recipient' (for receiving accounts)
    if (simulationResult?.assetDeltas) {
      for (const d of simulationResult.assetDeltas) {
        const deltaVal = BigInt(d.amountDelta);
        if (deltaVal > 0n) {
          entities.push({ address: d.account, role: 'recipient' });
        } else {
          entities.push({ address: d.account, role: 'target' });
        }
        entities.push({ address: d.token, role: 'target' });
      }
    }

    const threatMatches = this.threatProvider.matchAll({
      entities,
      domain: originDomain,
      chainId,
    });

    // 4. Deterministic Rule Evaluation
    const ruleFindings = evaluateDeterministicRules({
      intent: decodedIntent,
      threatMatches,
      simulationResult,
      evidenceMap,
      originDomain,
      chainId,
      trustRegistry: this.trustRegistry,
      calldataCoverage,
      simulationCoverage: simCoverage,
      caller: request.type === 'transaction' ? request.from : undefined,
    });

    const allFindings = [...initialFindings, ...ruleFindings];

    // 5. Calculate Overall Severity and Risk Score
    const hasCritical = allFindings.some((f) => f.severity === 'critical');
    const hasHigh = allFindings.some((f) => f.severity === 'high');
    const hasMedium = allFindings.some((f) => f.severity === 'medium');
    const hasUnknown = allFindings.some((f) => f.severity === 'unknown');

    let overallSeverity: Severity = 'low';
    let riskScore = 10;

    if (hasCritical) {
      overallSeverity = 'critical';
      riskScore = 95;
    } else if (hasHigh) {
      overallSeverity = 'high';
      riskScore = 75;
    } else if (hasMedium) {
      overallSeverity = 'medium';
      riskScore = 50;
    } else if (hasUnknown) {
      overallSeverity = 'unknown';
      riskScore = 40;
    } else if (
      signatureCoverage !== 'complete' ||
      calldataCoverage !== 'complete' ||
      simCoverage !== 'complete' ||
      Boolean(decodedIntent.isUnknownFunction)
    ) {
      // Invariant: Return partial or unsupported coverage, not a low-risk verdict
      overallSeverity = 'unknown';
      riskScore = 40;
    } else {
      overallSeverity = 'low';
      riskScore = 15;
    }

    // 6. Overall Coverage Status
    let overallCoverageStatus: Coverage['status'] = 'complete';
    const componentsList: CoverageStatus[] = [calldataCoverage, signatureCoverage, simCoverage, threatCoverage];

    if (componentsList.includes('failed')) {
      overallCoverageStatus = 'failed';
    } else if (componentsList.includes('unsupported')) {
      overallCoverageStatus = 'unsupported';
    } else if (componentsList.includes('partial')) {
      overallCoverageStatus = 'partial';
    }

    const coverage: Coverage = {
      status: overallCoverageStatus,
      reasons: coverageReasons,
      components: {
        calldataDecoding: calldataCoverage,
        signatureAnalysis: signatureCoverage,
        simulation: simCoverage,
        threatMatching: threatCoverage,
      },
    };

    // 7. Plain-English Summary (Strictly avoid stating "safe")
    let summary = '';
    if (overallSeverity === 'critical') {
      summary = `CRITICAL ALERT: Detected verified threat matches or malicious asset transfers in this ${request.type}. Do NOT proceed.`;
    } else if (overallSeverity === 'high') {
      summary = `HIGH RISK: Identified high-exposure permissions (such as unlimited allowances or collection-wide NFT access) or significant signature discrepancies.`;
    } else if (overallSeverity === 'medium') {
      summary = `MEDIUM RISK: Analysis detected unverified candidate selectors or non-standard permissions that require user verification.`;
    } else if (overallSeverity === 'unknown') {
      summary = `UNKNOWN COVERAGE: Transaction invokes unverified function selectors whose on-chain effects cannot be deterministically proven. Exercise caution.`;
    } else {
      summary = `LOW OBSERVED RISK: No known threat indicators, excessive allowances, or suspicious patterns were detected in the decoded intent and simulation for this dataset. Always verify destination addresses before confirming.`;
    }

    const report: AnalysisReport = {
      requestId,
      timestamp,
      overallSeverity,
      riskScore,
      summary,
      coverage,
      decodedIntent,
      simulationResult,
      findings: allFindings,
      evidence: evidenceMap,
      rawRequest: request,
    };

    // Validate with Zod before returning to ensure complete schema compliance
    return analysisReportSchema.parse(report);
  }
}

export const defaultRiskEngine = new RiskEngine();

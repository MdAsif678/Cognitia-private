import { isAddress } from 'viem';
import { type SignatureAdapterProvider } from '../types';
import { type AnalysisRequest, type PersonalSignAnalysisRequest } from '../../schemas/request';
import { type DecodedIntent } from '../../schemas/intent';
import { type Finding } from '../../schemas/finding';
import { type Evidence } from '../../schemas/evidence';

export class PersonalSignSignatureAdapter implements SignatureAdapterProvider {
  public readonly id = 'personal_sign_adapter';

  public canHandle(request: AnalysisRequest): boolean {
    return request.type === 'personal_sign';
  }

  public async analyze(request: AnalysisRequest): Promise<{
    intent: DecodedIntent;
    findings: Finding[];
    evidence: Evidence[];
    coverage: 'partial' | 'unsupported';
    reasons: string[];
    simulatedPermitTarget: undefined;
  }> {
    const req = request as PersonalSignAnalysisRequest;
    const rawMsg = req.rawMessage;
    const isHex = /^0x[0-9a-fA-F]*$/.test(rawMsg.trim());

    let hexView = '0x';
    let utf8View: string | undefined = undefined;
    let isValidUtf8 = false;
    let isDisguisedTx = false;

    // 1. Preserve original bytes & compute Hex View vs UTF-8 View
    if (isHex) {
      hexView = rawMsg.trim();
      try {
        const cleanHex = hexView.slice(2);
        if (cleanHex.length % 2 === 0 && cleanHex.length > 0) {
          const bytes = new Uint8Array(cleanHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
          // Strict UTF-8 decoding
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          // Check for printable ASCII + standard whitespace
          if (/^[\x20-\x7E\r\n\t]+$/.test(decoded)) {
            utf8View = decoded;
            isValidUtf8 = true;
          }
        }
      } catch {
        isValidUtf8 = false;
        utf8View = undefined;
      }

      // 32-byte hash (66 chars with 0x) in personal_sign is often an eth_sign bypass
      if (hexView.length === 66) {
        isDisguisedTx = true;
      }
    } else {
      utf8View = rawMsg;
      isValidUtf8 = true;
      try {
        hexView = '0x' + Buffer.from(rawMsg, 'utf-8').toString('hex');
      } catch {
        hexView = '0x';
      }
    }

    // Check for disguised approval/transfer keywords in text or hex
    const checkText = (utf8View || rawMsg).toLowerCase();
    if (
      checkText.includes('permit') ||
      checkText.includes('transfer(') ||
      checkText.includes('setapprovalforall') ||
      checkText.includes('approve(') ||
      checkText.includes('transferfrom')
    ) {
      isDisguisedTx = true;
    }

    // 2. Display requested signer and supplied origin metadata
    const requestedSigner = req.expectedSigner;
    const suppliedOrigin = req.domainOrOrigin || undefined;

    const downstreamUninferableReason =
      'Downstream use, authorization scope, and replay capacity of this personal_sign payload cannot be inferred from the message text alone. Web3 applications and backend APIs can interpret signature bytes to authorize account changes, mint assets, authenticate logins, or relay orders.';

    const parameters: Array<{ name: string; type: string; value: string }> = [
      { name: 'requestedSigner', type: 'address', value: requestedSigner },
      { name: 'suppliedOrigin', type: 'string', value: suppliedOrigin || 'unspecified' },
      { name: 'originVerificationStatus', type: 'string', value: suppliedOrigin ? 'unverified' : 'unspecified' },
      { name: 'encodingType', type: 'string', value: isHex ? (isValidUtf8 ? 'hex_encoded_utf8' : 'raw_hex_binary') : 'utf8_text' },
      { name: 'hexView', type: 'hex', value: hexView },
    ];

    if (utf8View !== undefined) {
      parameters.push({ name: 'utf8View', type: 'string', value: utf8View });
    }

    const intent: DecodedIntent = {
      type: 'personal_sign',
      functionName: 'personal_sign',
      candidateFunction: 'personal_sign',
      isCandidate: true,
      candidateDisclaimer: 'A message payload does not prove downstream authentication or execution semantics.',
      rawCalldata: isHex ? hexView : '0x',
      arguments: parameters,
      parameters,
      isUnknownFunction: false,
      assetStandard: 'none',
      nativeValue: '0',
      abiProvenance: 'unknown',
      confidence: {
        level: isDisguisedTx ? 'high' : 'low',
        reason: isDisguisedTx
          ? 'Matched raw 32-byte cryptographic hash or token approval keywords'
          : 'personal_sign payload lacks deterministic on-chain execution traces',
      },
      unresolvedQuestions: [
        downstreamUninferableReason,
        ...(suppliedOrigin ? [`Origin metadata '${suppliedOrigin}' is client-supplied and unverified.`] : []),
      ],
      personalSignDetails: {
        isHex,
        rawBytes: rawMsg,
        hexView,
        utf8View,
        isValidUtf8,
        requestedSigner,
        suppliedOrigin,
        originVerificationStatus: suppliedOrigin ? 'unverified' : undefined,
        decodedAscii: utf8View,
        isDisguisedTx,
        uncertaintyReason: downstreamUninferableReason,
        downstreamEffectStatus: 'uninferable',
      },
    };

    const evidenceId = `ev-personal-sign-${Date.now()}`;
    const evidenceList: Evidence[] = [
      {
        id: evidenceId,
        type: 'ast_analysis',
        provenance: 'PersonalSignSignatureAdapter',
        relevantAddresses: [requestedSigner].filter((a) => isAddress(a, { strict: false })),
        chainId: req.chainId || 1,
        rawSupportingData: {
          rawBytes: rawMsg,
          hexView,
          utf8View,
          isValidUtf8,
          requestedSigner,
          suppliedOrigin,
          originVerificationStatus: suppliedOrigin ? 'unverified' : 'unspecified',
          isDisguisedTx,
        },
      },
    ];

    const findings: Finding[] = [];

    // 3. Origin unverified finding
    if (suppliedOrigin) {
      findings.push({
        id: `finding-personal-sign-origin-${Date.now()}`,
        ruleId: 'personal_sign_unverified_origin',
        severity: 'low',
        title: 'Supplied Origin Metadata Unverified',
        plainEnglishExplanation:
          `The origin metadata ('${suppliedOrigin}') was supplied by the client caller and is unverified. EIP-191 personal_sign does not cryptographically bind domain origins inside the signed payload. A malicious website could prompt signatures with spoofed origin context.`,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'EIP-191 specification omits cryptographic origin binding' },
        assumptions: ['Origin domain could be spoofed by a malicious frontend or relayer'],
        executionContext: 'decoded_intent',
        remediation: 'Ensure the signing request originates from the trusted URL displayed in your browser address bar.',
      });
    }

    // 4. Downstream use uninferable & disguised tx finding
    if (isDisguisedTx) {
      findings.push({
        id: `finding-personal-sign-disguised-${Date.now()}`,
        ruleId: 'personal_sign_disguised_transaction',
        severity: 'high',
        title: 'Suspicious Disguised Transaction in personal_sign',
        plainEnglishExplanation:
          'This personal_sign message appears to encode an EVM transaction, approval phrase, or raw 32-byte cryptographic digest. Phishing websites use this technique to bypass wallet transaction warnings.',
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Payload matched raw 32-byte hash format or token authorization keywords' },
        assumptions: ['Off-chain protocol or relayer may execute transactions using this signature'],
        executionContext: 'decoded_intent',
        remediation: 'Do NOT sign this message unless you are completely confident in the verifying protocol.',
      });
    } else {
      findings.push({
        id: `finding-personal-sign-uninferable-${Date.now()}`,
        ruleId: 'personal_sign_uninferable_downstream_use',
        severity: 'unknown',
        title: 'personal_sign Downstream Use Uninferable',
        plainEnglishExplanation: downstreamUninferableReason,
        evidenceIds: [evidenceId],
        confidence: { level: 'high', reason: 'Plain text personal_sign payloads lack deterministic execution traces' },
        assumptions: ['Message will be evaluated off-chain or by a custom verification contract'],
        executionContext: 'decoded_intent',
        remediation: 'Only sign messages from applications you trust, and verify that the message text describes your intended action.',
      });
    }

    return {
      intent,
      findings,
      evidence: evidenceList,
      coverage: 'partial',
      reasons: [
        downstreamUninferableReason,
        ...(suppliedOrigin ? ['Origin metadata is client-supplied and unverified.'] : []),
      ],
      simulatedPermitTarget: undefined,
    };
  }
}

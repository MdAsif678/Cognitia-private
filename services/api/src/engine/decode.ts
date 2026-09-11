import { decodeFunctionData, getAddress, hexToString, isAddress, maxUint256, parseAbi, type Hex } from "viem";
import type { AnalyzeRequest, ConditionalAuthorization, DecodeResult, Finding, NormalizedRequest, SimulationHints } from "@cognitia/shared";
import { short } from "./format";

/** Standard ABIs the baseline decoder recognises. Unknown selectors stay unknown. */
const STANDARD_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amountOrTokenId)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function decreaseAllowance(address spender, uint256 subtractedValue)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function deposit()",
  "function withdraw(uint256 wad)",
  "function multicall(bytes[] data)",
]);

function stringifyArgs(inputs: readonly { name?: string; type: string }[], args: readonly unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  inputs.forEach((input, i) => {
    const v = args[i];
    const key = input.name || `arg${i}`;
    out[key] = Array.isArray(v) ? `[${v.map(String).join(", ")}]` : typeof v === "bigint" && v === maxUint256 ? `${v} (max uint256)` : String(v);
  });
  return out;
}

function decodeTransaction(n: Extract<NormalizedRequest, { kind: "transaction" }>): DecodeResult {
  const { tx } = n;
  const findings: Finding[] = [];
  const hints: SimulationHints = {};
  if (!tx.to) {
    return { intent: { kind: "transaction", known: true, summary: "Deploy a new contract", source: "none", rawCalldata: tx.data }, hints, findings };
  }
  if (!tx.data || tx.data === "0x") {
    return {
      intent: { kind: "transaction", known: true, summary: `Send native currency to ${short(tx.to)}`, target: tx.to, source: "none" },
      hints,
      findings,
    };
  }
  const selector = tx.data.slice(0, 10) as Hex;
  try {
    const d = decodeFunctionData({ abi: STANDARD_ABI, data: tx.data });
    const fn = STANDARD_ABI.find(
      (f) => f.type === "function" && f.name === d.functionName && f.inputs.length === (d.args?.length ?? 0),
    ) as { name: string; inputs: readonly { name?: string; type: string }[] } | undefined;
    const signature = fn ? `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})` : d.functionName;
    const args = fn ? stringifyArgs(fn.inputs, d.args ?? []) : {};
    return {
      intent: {
        kind: "transaction",
        known: true,
        summary: `${signature} on ${short(tx.to)}`,
        target: tx.to,
        selector,
        functionName: d.functionName,
        signature,
        args,
        source: "standard-abi",
        rawCalldata: tx.data,
      },
      hints,
      findings,
    };
  } catch {
    return {
      intent: {
        kind: "transaction",
        known: false,
        summary: `Unrecognised function ${selector} on ${short(tx.to)} — effects taken from simulation only`,
        target: tx.to,
        selector,
        source: "none",
        rawCalldata: tx.data,
      },
      hints,
      findings,
    };
  }
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? String(v) : undefined);

function decodeTypedData(req: AnalyzeRequest, n: Extract<NormalizedRequest, { kind: "typed-data" }>): DecodeResult {
  const { typedData, signer } = n;
  const m = typedData.message;
  const d = typedData.domain;
  const domain = {
    name: str(d.name),
    version: str(d.version),
    chainId: d.chainId !== undefined ? Number(d.chainId) : undefined,
    verifyingContract: typeof d.verifyingContract === "string" && isAddress(d.verifyingContract) ? getAddress(d.verifyingContract) : undefined,
    salt: typeof d.salt === "string" && /^0x[0-9a-fA-F]{64}$/.test(d.salt) ? (d.salt as Hex) : undefined,
  };
  const findings: Finding[] = [];
  const token = domain.verifyingContract;
  const base = { kind: "typed-data" as const, target: token, source: "typed-data" as const };

  // ERC-2612: Permit(owner, spender, value, nonce, deadline)
  if (typedData.primaryType === "Permit" && token && isAddress(String(m.spender)) && m.value !== undefined && m.owner !== undefined) {
    const conditional: ConditionalAuthorization = {
      kind: "erc20-allowance",
      source: "erc2612-permit",
      token,
      owner: getAddress(String(m.owner)),
      spender: getAddress(String(m.spender)),
      amount: BigInt(String(m.value)).toString(),
      nonce: str(m.nonce),
      deadline: str(m.deadline),
      domain,
    };
    if (conditional.owner.toLowerCase() !== signer.toLowerCase()) {
      findings.push({
        id: "permit-owner-mismatch",
        ruleId: "signature.permit-owner-mismatch",
        severity: "medium",
        title: "Permit owner is not the signing account",
        explanation: `The permit names ${conditional.owner} as owner, but ${signer} is asked to sign. The token would reject it, which suggests a malformed or deceptive request.`,
        confidence: "high",
        evidenceType: "signature",
        evidence: [{ kind: "signature", summary: "message.owner ≠ signer", data: { owner: conditional.owner, signer } }],
      });
    }
    return {
      intent: { ...base, known: true, summary: `ERC-2612 permit: let ${short(conditional.spender)} spend tokens of ${short(token)}`, functionName: "Permit", args: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) },
      hints: {},
      conditional,
      findings,
    };
  }

  // DAI-style: Permit(holder, spender, nonce, expiry, allowed)
  if (typedData.primaryType === "Permit" && token && m.holder !== undefined && m.allowed !== undefined && isAddress(String(m.spender))) {
    const allowed = m.allowed === true || m.allowed === "true";
    const conditional: ConditionalAuthorization = {
      kind: "erc20-allowance",
      source: "dai-permit",
      token,
      owner: getAddress(String(m.holder)),
      spender: getAddress(String(m.spender)),
      amount: allowed ? maxUint256.toString() : "0",
      nonce: str(m.nonce),
      deadline: m.expiry !== undefined && String(m.expiry) !== "0" ? String(m.expiry) : undefined,
      domain,
    };
    return {
      intent: { ...base, known: true, summary: `DAI-style permit: ${allowed ? "unlimited" : "revoke"} allowance for ${short(conditional.spender)}`, functionName: "Permit", args: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) },
      hints: {},
      conditional,
      findings,
    };
  }

  const isPermit2 = domain.name === "Permit2" || /^Permit(Single|Batch|TransferFrom|BatchTransferFrom|WitnessTransferFrom)$/.test(typedData.primaryType);
  if (isPermit2) {
    findings.push({
      id: "permit2-unmodeled",
      ruleId: "signature.permit2",
      severity: "high",
      title: "Permit2 signature grants token spending rights",
      explanation:
        "This Permit2 signature would let the named spender move your tokens through the Permit2 contract. The conditional outcome is not simulated yet, so review the spender and amount carefully.",
      confidence: "medium",
      evidenceType: "signature",
      evidence: [{ kind: "signature", summary: `primaryType ${typedData.primaryType}, domain ${domain.name ?? "?"}`, data: { message: m } }],
    });
  }

  return {
    intent: {
      ...base,
      known: isPermit2,
      summary: `Sign structured data "${typedData.primaryType}" for ${domain.name ?? "an unnamed app"}${token ? ` (${short(token)})` : ""}`,
      functionName: typedData.primaryType,
      args: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])),
    },
    hints: {},
    findings,
  };
}

function decodeMessage(hex: Hex): string {
  try {
    const text = hexToString(hex);
    // eslint-disable-next-line no-control-regex
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text) ? hex : text;
  } catch {
    return hex;
  }
}

/** Stage 2 (baseline): decoded intent, simulation hints and pre-simulation findings. */
export function baselineDecode(req: AnalyzeRequest, n: NormalizedRequest): DecodeResult {
  switch (n.kind) {
    case "transaction":
      return decodeTransaction(n);
    case "typed-data":
      return decodeTypedData(req, n);
    case "personal-sign": {
      const text = decodeMessage(n.message);
      return {
        intent: { kind: "personal-sign", known: text !== n.message, summary: `Sign a message: "${text.slice(0, 140)}${text.length > 140 ? "…" : ""}"`, source: "none" },
        hints: {},
        findings: [],
      };
    }
    case "eth-sign":
      return {
        intent: { kind: "eth-sign", known: false, summary: `Blind-sign a raw 32-byte hash ${short(n.hash)}`, source: "none" },
        hints: {},
        findings: [
          {
            id: "eth-sign",
            ruleId: "signature.eth-sign",
            severity: "high",
            title: "Blind signature of a raw hash",
            explanation:
              "eth_sign signs an opaque hash. It can be the hash of a transaction or permit that moves your assets, and nothing about it can be decoded or simulated. Legitimate apps almost never need this.",
            confidence: "high",
            evidenceType: "signature",
            evidence: [{ kind: "signature", summary: `eth_sign(${n.hash})` }],
          },
        ],
      };
    case "unsupported":
      return { intent: { kind: "unsupported", known: false, summary: n.reason, source: "none" }, hints: {}, findings: [] };
  }
}

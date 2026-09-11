import { getAddress, hexToBigInt, isAddress, isHex, stringToHex, type Hex } from "viem";
import type { AnalyzeRequest, NormalizedRequest, TxRequest, TypedDataPayload } from "@cognitia/shared";

/** Stage 1: turn the raw wallet request into a validated, method-specific shape. */
export function normalizeRequest(req: AnalyzeRequest): NormalizedRequest {
  try {
    switch (req.method) {
      case "eth_sendTransaction":
        return normalizeTransaction(req);
      case "eth_signTypedData_v4":
      case "eth_signTypedData_v3":
        return normalizeTypedData(req);
      case "eth_signTypedData":
        return { kind: "unsupported", reason: "Legacy eth_signTypedData (v1) payloads are not decoded", warnings: [] };
      case "personal_sign":
        return normalizePersonalSign(req);
      case "eth_sign": {
        const [a, h] = req.params;
        if (typeof a !== "string" || !isAddress(a) || typeof h !== "string" || !isHex(h)) throw new Error("eth_sign expects [address, hash]");
        return { kind: "eth-sign", signer: getAddress(a), hash: h as Hex, warnings: signerWarning(req, a) };
      }
      default:
        return { kind: "unsupported", reason: `Wallet method ${req.method} is not supported by the analyzer`, warnings: [] };
    }
  } catch (err) {
    return { kind: "unsupported", reason: `Malformed ${req.method} request: ${(err as Error).message}`, warnings: [] };
  }
}

function quantity(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "string" && isHex(v)) return v === "0x" ? "0" : hexToBigInt(v).toString();
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  throw new Error(`${field} must be a hex quantity`);
}

function normalizeTransaction(req: AnalyzeRequest): NormalizedRequest {
  const raw = req.params[0];
  if (!raw || typeof raw !== "object") throw new Error("params[0] must be a transaction object");
  const t = raw as Record<string, unknown>;
  const warnings: string[] = [];

  const fromRaw = (t.from as string | undefined) ?? req.account;
  if (typeof fromRaw !== "string" || !isAddress(fromRaw)) throw new Error("from must be an address");
  const from = getAddress(fromRaw);
  if (from.toLowerCase() !== req.account.toLowerCase()) {
    warnings.push(`Transaction "from" (${from}) differs from the connected account (${req.account}); simulated as ${from}.`);
  }

  let to: `0x${string}` | undefined;
  if (t.to !== undefined && t.to !== null && t.to !== "") {
    if (typeof t.to !== "string" || !isAddress(t.to)) throw new Error("to must be an address");
    to = getAddress(t.to);
  }

  const data = (t.data ?? t.input) as unknown;
  if (t.data !== undefined && t.input !== undefined && t.data !== t.input) throw new Error("data and input disagree");
  if (data !== undefined && data !== null && (typeof data !== "string" || !isHex(data) || data.length % 2 !== 0)) {
    throw new Error("data must be even-length hex");
  }
  if (!to && (!data || data === "0x")) throw new Error("a transaction needs a recipient or contract creation code");

  const chainId = quantity(t.chainId, "chainId");
  if (chainId !== undefined && Number(chainId) !== req.chainId) {
    throw new Error(`transaction chainId ${chainId} does not match the wallet chain ${req.chainId}`);
  }

  const nonce = quantity(t.nonce, "nonce");
  const tx: TxRequest = {
    from,
    to,
    data: (data as Hex | undefined) || undefined,
    value: quantity(t.value, "value"),
    gas: quantity(t.gas ?? t.gasLimit, "gas"),
    gasPrice: quantity(t.gasPrice, "gasPrice"),
    maxFeePerGas: quantity(t.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: quantity(t.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    nonce: nonce !== undefined ? Number(nonce) : undefined,
  };
  return { kind: "transaction", tx, warnings };
}

function pickSigner(params: unknown[]): { signer: string; payload: unknown } {
  const [a, b] = params;
  // MetaMask order is [address, data]; tolerate the reversed order some dapps send.
  if (typeof a === "string" && isAddress(a)) return { signer: a, payload: b };
  if (typeof b === "string" && isAddress(b)) return { signer: b, payload: a };
  throw new Error("no signer address in params");
}

function signerWarning(req: AnalyzeRequest, signer: string): string[] {
  return signer.toLowerCase() === req.account.toLowerCase() ? [] : [`Signer ${signer} differs from the connected account ${req.account}.`];
}

function normalizeTypedData(req: AnalyzeRequest): NormalizedRequest {
  const { signer, payload } = pickSigner(req.params);
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!parsed || typeof parsed !== "object") throw new Error("typed data must be a JSON object");
  const td = parsed as Partial<TypedDataPayload>;
  if (!td.types || typeof td.types !== "object" || typeof td.primaryType !== "string" || !td.message || typeof td.message !== "object") {
    throw new Error("typed data needs types, primaryType and message");
  }
  return {
    kind: "typed-data",
    signer: getAddress(signer),
    typedData: { types: td.types, primaryType: td.primaryType, domain: (td.domain ?? {}) as Record<string, unknown>, message: td.message },
    warnings: signerWarning(req, signer),
  };
}

function normalizePersonalSign(req: AnalyzeRequest): NormalizedRequest {
  const { signer, payload } = pickSigner(req.params);
  if (typeof payload !== "string") throw new Error("message must be a string");
  const message = isHex(payload) ? (payload as Hex) : stringToHex(payload);
  return { kind: "personal-sign", signer: getAddress(signer), message, warnings: signerWarning(req, signer) };
}

import type { Severity } from "./primitives";
import type { DecodedIntent, Finding } from "./report";
import type { AnalyzeRequest } from "./request";
import type { ConditionalAuthorization, SimulationHints, SimulationResult, TxRequest } from "./simulation";

/** The request after method-specific parsing (API pipeline "normalize" stage). */
export type NormalizedRequest =
  | { kind: "transaction"; tx: TxRequest; warnings: string[] }
  | { kind: "typed-data"; signer: `0x${string}`; typedData: TypedDataPayload; warnings: string[] }
  | { kind: "personal-sign"; signer: `0x${string}`; message: `0x${string}`; warnings: string[] }
  | { kind: "eth-sign"; signer: `0x${string}`; hash: `0x${string}`; warnings: string[] }
  | { kind: "unsupported"; reason: string; warnings: string[] };

export type TypedDataPayload = {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
};

export type DecodeResult = {
  intent: DecodedIntent;
  /** Entities to read on the fork in addition to what the simulator discovers. */
  hints: SimulationHints;
  /** For signatures: the authority it would grant, simulated as a conditional scenario. */
  conditional?: ConditionalAuthorization;
  /** Findings that need no simulation (e.g. blind eth_sign, malformed permit). */
  findings: Finding[];
};

export type AssessInput = {
  request: AnalyzeRequest;
  normalized: NormalizedRequest;
  decoded: DecodeResult;
  /** Undefined when simulation could not run. */
  simulation?: SimulationResult;
  simulationError?: string;
};

export type Assessment = {
  severity: Severity;
  summary: string;
  findings: Finding[];
};

/**
 * Contract between the API pipeline (Asif) and the risk engine (Swastik).
 * The API ships a baseline implementation so the pipeline works end to end; swap in
 * `@cognitia/risk-engine` by implementing this interface.
 */
export interface RiskEngine {
  readonly name: string;
  readonly version: string;
  decode(request: AnalyzeRequest, normalized: NormalizedRequest): Promise<DecodeResult>;
  assess(input: AssessInput): Promise<Assessment>;
}

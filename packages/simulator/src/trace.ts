import { decodeErrorResult, hexToBigInt, parseAbi, type Hex } from "viem";
import type { ForkRpc } from "./rpc";
import { addr } from "./util";

type CallTracerFrame = {
  type: string;
  from: string;
  to?: string;
  value?: string;
  input?: string;
  output?: string;
  error?: string;
  revertReason?: string;
  calls?: CallTracerFrame[];
};

export type FlatFrame = {
  depth: number;
  type: string;
  from: `0x${string}`;
  to?: `0x${string}`;
  value: bigint;
  input: Hex;
  output?: Hex;
  error?: string;
  /** This frame or an ancestor reverted, so its effects were rolled back. */
  reverted: boolean;
};

export type TraceResult = { frames: FlatFrame[]; root?: CallTracerFrame };

export async function fetchCallTrace(rpc: ForkRpc, txHash: Hex): Promise<TraceResult> {
  const root = await rpc.request<CallTracerFrame>("debug_traceTransaction", [txHash, { tracer: "callTracer" }]);
  const frames: FlatFrame[] = [];
  flatten(root, 0, false, frames);
  return { frames, root };
}

function flatten(frame: CallTracerFrame, depth: number, parentReverted: boolean, out: FlatFrame[]) {
  const reverted = parentReverted || !!frame.error;
  out.push({
    depth,
    type: frame.type.toUpperCase(),
    from: addr(frame.from),
    to: frame.to ? addr(frame.to) : undefined,
    value: frame.value ? hexToBigInt(frame.value as Hex) : 0n,
    input: (frame.input ?? "0x") as Hex,
    output: frame.output as Hex | undefined,
    error: frame.error,
    reverted,
  });
  for (const child of frame.calls ?? []) flatten(child, depth + 1, reverted, out);
}

const REVERT_ABI = parseAbi(["error Error(string reason)", "error Panic(uint256 code)"]);

const PANIC_CODES: Record<string, string> = {
  "1": "assertion failed",
  "17": "arithmetic overflow/underflow",
  "18": "division by zero",
  "33": "invalid enum value",
  "34": "invalid storage byte array",
  "49": "pop on empty array",
  "50": "array index out of bounds",
  "65": "out of memory",
  "81": "call to uninitialised function",
};

/** Human-readable revert reason from return data (Error(string), Panic(uint256) or custom error). */
export function decodeRevertReason(output: Hex | undefined, fallback?: string): string | undefined {
  if (output && output !== "0x" && output.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi: REVERT_ABI, data: output });
      if (decoded.errorName === "Error") return String(decoded.args[0]);
      const code = String(decoded.args[0]);
      return `panic: ${PANIC_CODES[code] ?? `code ${code}`}`;
    } catch {
      return `custom error ${output.slice(0, 10)}${fallback ? ` (${fallback})` : ""}`;
    }
  }
  return fallback;
}

export type SimulationErrorCode =
  | "UNSUPPORTED_CHAIN"
  | "UPSTREAM_UNAVAILABLE"
  | "CHAIN_MISMATCH"
  | "ANVIL_NOT_FOUND"
  | "FORK_FAILED"
  | "BUSY"
  | "ABORTED"
  | "INVALID_INPUT";

export class SimulationError extends Error {
  constructor(
    readonly code: SimulationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}

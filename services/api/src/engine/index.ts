import type { RiskEngine } from "@cognitia/shared";
import { baselineAssess } from "./assess";
import { baselineDecode } from "./decode";

/**
 * Baseline engine so the pipeline runs end to end today. Swastik's @cognitia/risk-engine
 * (threat database, full severity rules, Permit2) replaces it by implementing the same
 * RiskEngine interface — see createEngine() in src/server.ts.
 */
export const baselineEngine: RiskEngine = {
  name: "baseline",
  version: "0.1.0",
  decode: async (request, normalized) => baselineDecode(request, normalized),
  assess: async (input) => baselineAssess(input),
};

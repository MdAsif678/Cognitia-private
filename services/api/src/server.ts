import type { RiskEngine } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { baselineEngine } from "./engine";

/** Swap point for Swastik's engine: `return riskEngine` once @cognitia/risk-engine exists. */
function createEngine(): RiskEngine {
  return baselineEngine;
}

const config = loadConfig();
const simulator = new Simulator({
  chains: config.chains,
  anvilPath: config.anvilPath,
  maxConcurrentForks: config.maxConcurrentForks,
  warmForksPerChain: config.warmForksPerChain,
  warmForkMaxAgeMs: config.warmForkMaxAgeMs,
});
const app = await buildApp({ config, simulator, engine: createEngine() });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await app.close().catch(() => undefined);
  await simulator.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
simulator.prewarm();
app.log.info({ chains: config.chains.map((c) => `${c.name}:${c.chainId}`), warmForks: config.warmForksPerChain }, "simulator ready");

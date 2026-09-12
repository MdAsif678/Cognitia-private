import { existsSync, readFileSync } from 'node:fs';
// Native env loader supports quoted values and inline comments without exposing secrets.
for (const file of ['.env', 'services/api/.env']) if (existsSync(file)) process.loadEnvFile(file);
import type { RiskEngine } from "@cognitia/shared";
import { Simulator } from "@cognitia/simulator";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createSwastikEngine } from "../../../incoming/integration/swastik-bridge";

/** Full deterministic threat assessment over genuine fork state. */
function createEngine(): RiskEngine {
  return createSwastikEngine({ chains: config.chains, includeDemo: process.env.THREAT_INCLUDE_DEMO === "true", threatRecords: process.env.THREAT_DB_FILE ? JSON.parse(readFileSync(process.env.THREAT_DB_FILE, "utf8")) : undefined });
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

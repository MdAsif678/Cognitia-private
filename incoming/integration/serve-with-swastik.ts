/**
 * The analysis API with Swastik's risk engine bridged onto the fork simulator.
 *   npx tsx incoming/integration/serve-with-swastik.ts      → http://localhost:8081
 * Adds the local demo chain (31337 @ 127.0.0.1:8545) to the configured chains.
 */
import { Simulator } from "@cognitia/simulator";
import { buildApp } from "../../services/api/src/app";
import { loadConfig } from "../../services/api/src/config";
import { createSwastikEngine } from "./swastik-bridge";

process.env.RPC_URL_31337 ??= "http://127.0.0.1:8545";
process.env.CHAIN_NAME_31337 ??= "Local demo chain";
process.env.BLOCK_LAG_31337 ??= "0";
process.env.PORT ??= "8081";

const config = loadConfig();
const simulator = new Simulator({ chains: config.chains, anvilPath: config.anvilPath, maxConcurrentForks: config.maxConcurrentForks, warmForksPerChain: config.warmForksPerChain });
const app = await buildApp({ config, simulator, engine: createSwastikEngine({ chains: config.chains, includeDemo: process.env.THREAT_INCLUDE_DEMO === "true" }) });
await app.listen({ host: config.host, port: config.port });
simulator.prewarm();
app.log.info({ chains: config.chains.map((c) => c.chainId) }, "API with Swastik engine ready");

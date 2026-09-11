import { chainsFromEnv, type ChainConfig } from "@cognitia/simulator";

export type ApiConfig = {
  host: string;
  port: number;
  logLevel: string;
  /** Hard ceiling for one analysis; the extension should show "Analysis unavailable" after it. */
  analysisTimeoutMs: number;
  corsOrigins: string[] | "*";
  rateLimitPerMinute: number;
  enableDebugRoutes: boolean;
  chains: ChainConfig[];
  anvilPath?: string;
  maxConcurrentForks: number;
  warmForksPerChain: number;
  warmForkMaxAgeMs: number;
};

const num = (v: string | undefined, fallback: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : fallback);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const origins = env.CORS_ORIGINS?.trim();
  return {
    host: env.HOST ?? "0.0.0.0",
    port: num(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? "info",
    analysisTimeoutMs: num(env.ANALYSIS_TIMEOUT_MS, 45_000),
    corsOrigins: !origins || origins === "*" ? "*" : origins.split(",").map((s) => s.trim()).filter(Boolean),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 60),
    enableDebugRoutes: (env.ENABLE_DEBUG_ROUTES ?? "true") !== "false",
    chains: chainsFromEnv(env),
    anvilPath: env.ANVIL_PATH,
    maxConcurrentForks: num(env.MAX_CONCURRENT_FORKS, 4),
    warmForksPerChain: num(env.WARM_FORKS_PER_CHAIN, 1),
    warmForkMaxAgeMs: num(env.WARM_FORK_MAX_AGE_MS, 30_000),
  };
}

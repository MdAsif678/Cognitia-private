import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { createPublicClient, http, isHash, toHex, type Hex } from "viem";
import { z } from "zod";
import {
  AnalyzeRequestSchema,
  SimulationHintsSchema,
  TxRequestSchema,
  type RiskEngine,
} from "@cognitia/shared";
import { SIMULATOR_VERSION, type Simulator } from "@cognitia/simulator";
import type { ApiConfig } from "./config";
import { analyze } from "./pipeline/analyze";

export type AppDeps = {
  config: ApiConfig;
  simulator: Simulator;
  engine: RiskEngine;
};

const BlockQuery = z.object({ blockNumber: z.string().regex(/^\d+$/).optional() });

const SimulateBody = z.object({
  chainId: z.number().int().positive(),
  tx: TxRequestSchema,
  blockNumber: z.string().regex(/^\d+$/).optional(),
  hints: SimulationHintsSchema.optional(),
});

const ReplayBody = z.object({
  chainId: z.number().int().positive(),
  txHash: z.string().refine((h) => isHash(h), "expected a 32-byte transaction hash"),
});

function badRequest(issues: z.core.$ZodIssue[]) {
  return { error: "invalid request", issues: issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export async function buildApp({ config, simulator, engine }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, bodyLimit: 256 * 1024, trustProxy: true });

  await app.register(cors, {
    // The extension calls from chrome-extension://<id>; web origins must be allow-listed.
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins === "*" || origin.startsWith("chrome-extension://") || config.corsOrigins.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(rateLimit, { max: config.rateLimitPerMinute, timeWindow: "1 minute" });

  const deps = { simulator, engine, timeoutMs: config.analysisTimeoutMs };

  app.get("/health", async () => ({
    status: "ok",
    version: { api: "0.1.0", simulator: SIMULATOR_VERSION, riskEngine: `${engine.name}@${engine.version}` },
    chains: simulator.supportedChains.map((c) => ({ chainId: c.chainId, name: c.name })),
    forks: simulator.poolStats,
  }));

  app.get("/ready", async (_req, reply) => {
    const checks = await Promise.all(simulator.supportedChains.map(async (c) => ({ chainId: c.chainId, name: c.name, ...(await simulator.checkUpstream(c.chainId)) })));
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    return reply.code(ok ? 200 : 503).send({ ready: ok, upstreams: checks });
  });

  app.get("/v1/chains", async () => simulator.supportedChains.map((c) => ({ chainId: c.chainId, name: c.name })));

  /** The extension's endpoint: always answers with an AnalysisReport (failed ones included). */
  app.post("/v1/analyze", async (request, reply) => {
    const body = AnalyzeRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(badRequest(body.error.issues));
    const query = BlockQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send(badRequest(query.error.issues));

    const report = await analyze(body.data, deps, { blockNumber: query.data.blockNumber ? BigInt(query.data.blockNumber) : undefined });
    request.log.info(
      { requestId: report.requestId, method: body.data.method, chainId: body.data.chainId, status: report.status, severity: report.severity, ms: report.durationMs },
      "analysis complete",
    );
    return report;
  });

  /**
   * Replay a mined transaction as if it were still unsigned: fork at the block before it and run
   * the full pipeline. Demonstrates detection on real, documented attack transactions.
   * Old blocks need an archive-capable upstream RPC.
   */
  app.post("/v1/replay", async (request, reply) => {
    const body = ReplayBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(badRequest(body.error.issues));
    const chain = simulator.supportedChains.find((c) => c.chainId === body.data.chainId);
    if (!chain) return reply.code(400).send({ error: `chain ${body.data.chainId} is not configured` });

    const upstream = createPublicClient({ transport: http(chain.rpcUrl, { timeout: 15_000 }) });
    const tx = await upstream.getTransaction({ hash: body.data.txHash as Hex }).catch(() => undefined);
    if (!tx || tx.blockNumber === null || tx.blockNumber === undefined) return reply.code(404).send({ error: "transaction not found or not mined" });

    const report = await analyze(
      {
        requestId: `replay-${body.data.txHash}`,
        origin: "replay",
        chainId: chain.chainId,
        account: tx.from,
        method: "eth_sendTransaction",
        params: [{ from: tx.from, to: tx.to ?? undefined, data: tx.input, value: toHex(tx.value), gas: toHex(tx.gas) }],
      },
      deps,
      {
        blockNumber: tx.blockNumber - 1n,
        extraAssumptions: [
          `Replay of mined transaction ${body.data.txHash} (block #${tx.blockNumber}) against the state at the end of block #${tx.blockNumber - 1n}; transactions earlier in its own block are not applied.`,
        ],
      },
    );
    return { replayOf: { txHash: body.data.txHash, blockNumber: tx.blockNumber.toString() }, report };
  });

  if (config.enableDebugRoutes) {
    /** Raw simulator output (no risk assessment) — for debugging and for the risk-engine team. */
    app.post("/v1/simulate", async (request, reply) => {
      const body = SimulateBody.safeParse(request.body);
      if (!body.success) return reply.code(400).send(badRequest(body.error.issues));
      try {
        return await simulator.simulateTransaction({
          chainId: body.data.chainId,
          tx: body.data.tx,
          blockNumber: body.data.blockNumber ? BigInt(body.data.blockNumber) : undefined,
          hints: body.data.hints,
          signal: AbortSignal.timeout(config.analysisTimeoutMs),
        });
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    });
  }

  return app;
}

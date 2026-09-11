import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { SimulationError } from "./errors";

/** A specific block, or N blocks behind the upstream head at the moment anvil starts. */
export type ForkBlock = { number: bigint } | { behindHead: number };

export type AnvilForkOptions = {
  anvilPath: string;
  forkUrl: string;
  forkBlock: ForkBlock;
  startupTimeoutMs: number;
  extraArgs?: string[];
};

function forkBlockArgs(b: ForkBlock): string[] {
  if ("number" in b) return ["--fork-block-number", b.number.toString()];
  // anvil treats a negative block as "latest minus N"; `=` keeps the minus from parsing as a flag.
  return b.behindHead > 0 ? [`--fork-block-number=-${b.behindHead}`] : [];
}

export type AnvilInstance = {
  /** Loopback-only RPC endpoint of this private fork. */
  rpcUrl: string;
  port: number;
  pid: number | undefined;
  stop(): void;
  readonly exited: boolean;
};

const live = new Set<ChildProcess>();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const killAll = () => {
    for (const child of live) child.kill();
  };
  process.once("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      killAll();
      // Only exit if nobody else (e.g. the API's graceful shutdown) is handling the signal.
      if (process.listenerCount(sig) === 0) process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

/** ANVIL_PATH, then ~/.foundry/bin, then PATH. */
export function resolveAnvilPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.ANVIL_PATH) return process.env.ANVIL_PATH;
  const exe = process.platform === "win32" ? "anvil.exe" : "anvil";
  const foundry = join(homedir(), ".foundry", "bin", exe);
  return existsSync(foundry) ? foundry : exe;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function rpcReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts a private anvil fork pinned to one upstream block. It binds to 127.0.0.1 only, so the
 * fork is never reachable from outside the host/container. Gas is free on the fork so native
 * balance diffs show transferred value only (fees are estimated separately).
 */
export async function spawnAnvilFork(opts: AnvilForkOptions): Promise<AnvilInstance> {
  installExitHook();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await spawnOnce(opts);
    } catch (err) {
      lastError = err;
      if (err instanceof SimulationError && err.code === "ANVIL_NOT_FOUND") throw err;
    }
  }
  throw lastError;
}

async function spawnOnce(opts: AnvilForkOptions): Promise<AnvilInstance> {
  const port = await freePort();
  const args = [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--fork-url", opts.forkUrl,
    ...forkBlockArgs(opts.forkBlock),
    "--auto-impersonate",
    "--block-base-fee-per-gas", "0",
    "--gas-price", "0",
    "--accounts", "0",
    "--no-storage-caching",
    "--timeout", "20000",
    "--retries", "3",
    "--silent",
    ...(opts.extraArgs ?? []),
  ];

  const child = spawn(opts.anvilPath, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  live.add(child);

  let stderr = "";
  let exited = false;
  let spawnError: Error | undefined;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  child.on("error", (err) => {
    spawnError = err;
  });
  child.on("exit", () => {
    exited = true;
    live.delete(child);
  });

  const stop = () => {
    if (!exited) child.kill();
    live.delete(child);
  };
  const rpcUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + opts.startupTimeoutMs;

  while (Date.now() < deadline) {
    if (spawnError) {
      stop();
      const code = (spawnError as NodeJS.ErrnoException).code;
      throw new SimulationError(
        code === "ENOENT" ? "ANVIL_NOT_FOUND" : "FORK_FAILED",
        code === "ENOENT"
          ? `anvil binary not found at "${opts.anvilPath}" — install Foundry or set ANVIL_PATH`
          : `failed to start anvil: ${spawnError.message}`,
      );
    }
    if (exited) {
      throw new SimulationError("FORK_FAILED", `anvil exited during startup: ${stderr.trim() || "no output"}`);
    }
    if (await rpcReady(rpcUrl)) {
      return {
        rpcUrl,
        port,
        pid: child.pid,
        stop,
        get exited() {
          return exited;
        },
      };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop();
  throw new SimulationError(
    "FORK_FAILED",
    `anvil fork did not become ready within ${opts.startupTimeoutMs}ms${stderr ? `: ${stderr.trim()}` : ""}`,
  );
}

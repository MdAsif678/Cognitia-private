import { spawnAnvilFork, type AnvilInstance, type ForkBlock } from "./anvil";
import { SimulationError } from "./errors";

export type ForkPoolOptions = {
  anvilPath: string;
  maxConcurrent: number;
  maxQueue: number;
  startupTimeoutMs: number;
  extraArgs?: string[];
  /** Pre-started forks kept per upstream (only used for "latest − lag" requests). */
  warmPerUpstream?: number;
  /** Warm forks older than this are recycled so pinned state stays recent. */
  warmMaxAgeMs?: number;
  /** Runs on each warm fork after start-up (e.g. cache prefetch) before it is handed out. */
  prepareWarm?: (instance: AnvilInstance) => Promise<void>;
};

export type ForkTarget = { forkUrl: string; forkBlock: ForkBlock };

type Warm = { instance: AnvilInstance; createdAt: number; target: ForkTarget };

/**
 * Hands out one private anvil process per analysis. Nothing is shared between leases, so
 * concurrent requests cannot see each other's state; every lease is killed when it ends.
 * Optionally keeps a few idle forks pre-started so requests skip the fork start-up cost.
 */
export class ForkPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly leased = new Set<AnvilInstance>();
  private readonly idle = new Map<string, Warm[]>();
  private readonly warming = new Map<string, number>();
  private readonly warmTargets = new Map<string, ForkTarget>();
  private recycleTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly opts: ForkPoolOptions) {}

  get stats() {
    return {
      active: this.active,
      queued: this.waiters.length,
      maxConcurrent: this.opts.maxConcurrent,
      warm: [...this.idle.values()].reduce((n, list) => n + list.length, 0),
    };
  }

  /** Keep `warmPerUpstream` idle forks of `target` ready (relative targets only). */
  keepWarm(target: ForkTarget) {
    if (!this.opts.warmPerUpstream || "number" in target.forkBlock || this.closed) return;
    const key = warmKey(target);
    this.warmTargets.set(key, target);
    this.topUp(key);
    if (!this.recycleTimer) {
      const every = Math.max(5_000, Math.floor((this.opts.warmMaxAgeMs ?? 30_000) / 2));
      this.recycleTimer = setInterval(() => this.recycle(), every);
      this.recycleTimer.unref();
    }
  }

  async withFork<T>(target: ForkTarget, fn: (instance: AnvilInstance) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new SimulationError("FORK_FAILED", "fork pool is closed");
    await this.acquire(signal);
    let instance: AnvilInstance | undefined;
    const onAbort = () => instance?.stop();
    try {
      if (signal?.aborted) throw new SimulationError("ABORTED", "analysis aborted");
      instance = this.takeWarm(target) ?? (await this.spawn(target));
      this.leased.add(instance);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) throw new SimulationError("ABORTED", "analysis aborted");
      return await fn(instance);
    } catch (err) {
      if (signal?.aborted && !(err instanceof SimulationError && err.code === "ABORTED")) {
        throw new SimulationError("ABORTED", "analysis aborted (timeout)");
      }
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (instance) {
        instance.stop();
        this.leased.delete(instance);
      }
      this.release();
    }
  }

  private spawn(target: ForkTarget): Promise<AnvilInstance> {
    return spawnAnvilFork({
      anvilPath: this.opts.anvilPath,
      forkUrl: target.forkUrl,
      forkBlock: target.forkBlock,
      startupTimeoutMs: this.opts.startupTimeoutMs,
      extraArgs: this.opts.extraArgs,
    });
  }

  private takeWarm(target: ForkTarget): AnvilInstance | undefined {
    if ("number" in target.forkBlock) return undefined;
    const key = warmKey(target);
    const list = this.idle.get(key);
    const maxAge = this.opts.warmMaxAgeMs ?? 30_000;
    let found: AnvilInstance | undefined;
    while (list?.length && !found) {
      const w = list.shift()!;
      if (!w.instance.exited && Date.now() - w.createdAt <= maxAge) found = w.instance;
      else w.instance.stop();
    }
    this.topUp(key);
    return found;
  }

  private topUp(key: string) {
    const target = this.warmTargets.get(key);
    const want = this.opts.warmPerUpstream ?? 0;
    if (!target || this.closed) return;
    const have = (this.idle.get(key)?.length ?? 0) + (this.warming.get(key) ?? 0);
    for (let i = have; i < want; i++) {
      this.warming.set(key, (this.warming.get(key) ?? 0) + 1);
      this.spawn(target)
        .then(async (instance) => {
          const createdAt = Date.now();
          await this.opts.prepareWarm?.(instance).catch(() => undefined);
          if (this.closed) return instance.stop();
          const list = this.idle.get(key) ?? [];
          list.push({ instance, createdAt, target });
          this.idle.set(key, list);
        })
        .catch(() => undefined) // a failed warm-up just means the next request spawns on demand
        .finally(() => this.warming.set(key, (this.warming.get(key) ?? 1) - 1));
    }
  }

  private recycle() {
    const maxAge = this.opts.warmMaxAgeMs ?? 30_000;
    for (const [key, list] of this.idle) {
      const keep = list.filter((w) => {
        const fresh = !w.instance.exited && Date.now() - w.createdAt <= maxAge;
        if (!fresh) w.instance.stop();
        return fresh;
      });
      this.idle.set(key, keep);
      this.topUp(key);
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.opts.maxQueue) {
      return Promise.reject(new SimulationError("BUSY", "simulator is at capacity, try again shortly"));
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.active++;
        resolve();
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(grant);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new SimulationError("ABORTED", "analysis aborted while queued"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(grant);
    });
  }

  private release() {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  async close() {
    this.closed = true;
    if (this.recycleTimer) clearInterval(this.recycleTimer);
    for (const instance of this.leased) instance.stop();
    for (const list of this.idle.values()) for (const w of list) w.instance.stop();
    this.leased.clear();
    this.idle.clear();
  }
}

function warmKey(t: ForkTarget) {
  return `${t.forkUrl}@${"number" in t.forkBlock ? t.forkBlock.number : `-${t.forkBlock.behindHead}`}`;
}

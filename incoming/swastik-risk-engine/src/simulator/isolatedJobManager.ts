export interface JobOptions {
  timeoutMs?: number;
}

export interface JobExecution<T> {
  id: string;
  run: () => Promise<T>;
  timeoutMs: number;
}

export class IsolatedJobManager {
  private maxConcurrency: number;
  private runningJobs = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrency: number = 2) {
    this.maxConcurrency = maxConcurrency;
  }

  public async executeIsolatedJob<T>(
    jobId: string,
    jobFn: () => Promise<T>,
    options?: JobOptions
  ): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? 10000;

    // Wait for available slot if at max concurrency
    if (this.runningJobs >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.runningJobs += 1;

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Isolated job ${jobId} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      // Race the job execution against the timeout
      const result = await Promise.race([jobFn(), timeoutPromise]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      this.runningJobs -= 1;

      // Unblock next queued job if available
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  public getActiveJobCount(): number {
    return this.runningJobs;
  }

  public getQueuedJobCount(): number {
    return this.queue.length;
  }
}

export const defaultJobManager = new IsolatedJobManager(2);

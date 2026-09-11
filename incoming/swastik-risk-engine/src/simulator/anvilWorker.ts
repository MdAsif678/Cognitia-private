import { spawn, type ChildProcess } from 'child_process';
import { getChainConfig } from '../config/chains';

export interface AnvilWorkerOptions {
  anvilPath?: string;
  port?: number;
  forkUrl?: string;
  chainId?: number;
}

export class AnvilWorker {
  private anvilProcess: ChildProcess | null = null;
  private port: number;
  private anvilPath: string;
  private forkUrl?: string;
  private chainId: number;
  private isRunning = false;

  constructor(options?: AnvilWorkerOptions) {
    this.anvilPath = options?.anvilPath || process.env.ANVIL_PATH || 'anvil';
    this.port = options?.port || parseInt(process.env.ANVIL_PORT || '8545', 10);
    this.chainId = options?.chainId || 1;
    this.forkUrl = options?.forkUrl;
  }

  public getRpcUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Checks whether Anvil is installed and accessible.
   */
  public async isAnvilInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(this.anvilPath, ['--version']);
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Spawns an isolated Anvil node.
   */
  public async start(): Promise<boolean> {
    if (this.isRunning) return true;

    const installed = await this.isAnvilInstalled();
    if (!installed) {
      return false;
    }

    const forkRpc = this.forkUrl || getChainConfig(this.chainId).rpcUrl;
    const args = ['--port', String(this.port), '--chain-id', String(this.chainId)];
    if (forkRpc && !forkRpc.includes('127.0.0.1')) {
      args.push('--fork-url', forkRpc);
    }

    return new Promise((resolve) => {
      try {
        this.anvilProcess = spawn(this.anvilPath, args);
        this.anvilProcess.on('error', () => {
          this.isRunning = false;
          resolve(false);
        });

        // Poll until port responds
        const startTime = Date.now();
        const interval = setInterval(async () => {
          if (Date.now() - startTime > 10000) {
            clearInterval(interval);
            resolve(false);
            return;
          }
          try {
            const res = await fetch(this.getRpcUrl(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
            });
            if (res.ok) {
              clearInterval(interval);
              this.isRunning = true;
              resolve(true);
            }
          } catch {
            // still starting
          }
        }, 300);
      } catch {
        resolve(false);
      }
    });
  }

  public stop(): void {
    if (this.anvilProcess) {
      this.anvilProcess.kill('SIGTERM');
      this.anvilProcess = null;
      this.isRunning = false;
    }
  }

  public async rpcCall<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.getRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        id: Math.floor(Math.random() * 1000000),
      }),
    });

    if (!res.ok) {
      throw new Error(`Anvil RPC HTTP Error ${res.status}: ${res.statusText}`);
    }

    const data = await res.json() as { error?: { message: string }; result?: T };
    if (data.error) {
      throw new Error(`Anvil RPC Call Failed (${method}): ${data.error.message}`);
    }
    return data.result as T;
  }
}

export const defaultAnvilWorker = new AnvilWorker();

import { createPublicClient, http, type PublicClient } from "viem";

/** Client for one private anvil fork: typed viem reads plus raw anvil/debug methods. */
export class ForkRpc {
  readonly client: PublicClient;

  constructor(readonly url: string) {
    this.client = createPublicClient({ transport: http(url, { timeout: 60_000, retryCount: 0 }) });
  }

  request<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.client.request({ method, params } as never) as Promise<T>;
  }

  snapshot(): Promise<string> {
    return this.request<string>("evm_snapshot");
  }

  async revert(id: string): Promise<void> {
    const ok = await this.request<boolean>("evm_revert", [id]);
    if (!ok) throw new Error(`evm_revert(${id}) failed`);
  }
}

export type RawLog = {
  address: `0x${string}`;
  topics: `0x${string}`[];
  data: `0x${string}`;
  logIndex?: `0x${string}`;
};

export type RawReceipt = {
  transactionHash: `0x${string}`;
  status: `0x${string}`;
  gasUsed: `0x${string}`;
  contractAddress?: `0x${string}` | null;
  logs: RawLog[];
};

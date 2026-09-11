import { type ChainReadProvider } from '../providers/types';
import { type PinnedSnapshot } from '../schemas/simulation';

export interface SnapshotResolverConfig {
  defaultChainId?: number;
}

export class SnapshotResolver {
  private defaultChainId: number;

  constructor(config?: SnapshotResolverConfig) {
    this.defaultChainId = config?.defaultChainId || 1;
  }

  /**
   * Resolves and pins the analysis block snapshot.
   * If blockNumber is explicitly provided in metadata, pins to that block.
   * Otherwise, queries the current block number once and pins it for the entire analysis lifecycle.
   */
  public async resolvePinnedSnapshot(
    chainId: number,
    chainReader?: ChainReadProvider,
    explicitBlockNumber?: string | bigint,
    explicitBlockHash?: string
  ): Promise<PinnedSnapshot> {
    if (explicitBlockNumber !== undefined) {
      return {
        chainId,
        blockNumber: explicitBlockNumber.toString(),
        blockHash: explicitBlockHash,
      };
    }

    if (chainReader) {
      try {
        const blockNum = await chainReader.getBlockNumber();
        return {
          chainId,
          blockNumber: blockNum.toString(),
        };
      } catch {
        // Fall back to standard recent block height if reader throws
      }
    }

    // Default pinned fallback snapshot for tests / offline mode
    return {
      chainId,
      blockNumber: '21000000',
    };
  }
}

export const defaultSnapshotResolver = new SnapshotResolver();

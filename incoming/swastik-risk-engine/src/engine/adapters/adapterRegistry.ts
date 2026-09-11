import { type RouterAdapter } from './types';
import { Multicall3Adapter } from './multicall3Adapter';
import { OpenZeppelinMulticallAdapter } from './openZeppelinMulticallAdapter';
import { FixtureTestRouterAdapter } from './fixtureTestRouterAdapter';

export class RouterAdapterRegistry {
  private adapters: RouterAdapter[] = [];

  constructor() {
    // Register default canonical adapters
    this.adapters.push(new Multicall3Adapter());
    this.adapters.push(new OpenZeppelinMulticallAdapter());
    this.adapters.push(new FixtureTestRouterAdapter());
  }

  public registerAdapter(adapter: RouterAdapter): void {
    this.adapters.unshift(adapter); // newer adapters take priority
  }

  public getAdapter(target: string, calldata: string, chainId: number): RouterAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(target, calldata, chainId)) {
        return adapter;
      }
    }
    return null;
  }
}

export const defaultRouterRegistry = new RouterAdapterRegistry();

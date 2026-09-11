import { type Address } from 'viem';
import { type AssetStandard } from '../schemas/intent';

export interface InterfaceEvidence {
  assetStandard: AssetStandard;
  provenance: 'erc165_check' | 'verified_abi' | 'registry' | 'unresolved';
  confidence: {
    level: 'high' | 'medium' | 'low';
    reason: string;
  };
  unresolvedQuestions: string[];
}

export interface InterfaceResolver {
  resolveInterface(address: Address, chainId: number): Promise<InterfaceEvidence | null>;
  registerInterface(address: Address, standard: AssetStandard): void;
}

export class DefaultInterfaceResolver implements InterfaceResolver {
  private registry = new Map<string, AssetStandard>();

  public registerInterface(address: Address, standard: AssetStandard): void {
    this.registry.set(address.toLowerCase(), standard);
  }

  public async resolveInterface(address: Address, chainId: number): Promise<InterfaceEvidence | null> {
    const norm = address.toLowerCase();
    const registered = this.registry.get(norm);
    if (registered) {
      return {
        assetStandard: registered,
        provenance: 'registry',
        confidence: {
          level: 'high',
          reason: `Contract address ${address} is recorded as ${registered} in the verified interface registry.`,
        },
        unresolvedQuestions: [],
      };
    }

    return null;
  }
}

export const defaultInterfaceResolver = new DefaultInterfaceResolver();

export type ProtocolCategory =
  | 'dex_router'
  | 'nft_marketplace'
  | 'bridge'
  | 'lending'
  | 'permit2'
  | 'system';

export interface TrustRecord {
  address: string;
  chainId: number;
  name: string;
  protocol: string;
  category: ProtocolCategory;
  verificationSource: string;
  isTrusted: boolean;
  description?: string;
}

export interface TrustResolution {
  isKnown: boolean;
  isTrusted: boolean;
  record?: TrustRecord;
  identityName?: string;
  protocol?: string;
  rationale: string;
}

export interface TrustRegistryProvider {
  isKnownTrusted(address: string, chainId: number): TrustRecord | null;
  resolveTrust(address: string, chainId: number): TrustResolution;
  registerTrusted(record: TrustRecord): void;
}

/**
 * Authoritative registry of known verified protocol routers, exchanges, and infrastructure.
 *
 * Principle: Absence from a threat database does NOT establish trust.
 * An address is considered a "known/trusted spender/operator" ONLY if verified
 * in an authoritative registry or verified protocol deployment manifest.
 */
export const CANONICAL_TRUST_RECORDS: TrustRecord[] = [
  // Uniswap V3 SwapRouter02 (Ethereum Mainnet)
  {
    address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'.toLowerCase(),
    chainId: 1,
    name: 'Uniswap V3: SwapRouter02',
    protocol: 'Uniswap',
    category: 'dex_router',
    verificationSource: 'https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments',
    isTrusted: true,
    description: 'Canonical Uniswap V3 and V2 unified swap router.',
  },

  // Uniswap Universal Router (Ethereum Mainnet)
  {
    address: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'.toLowerCase(),
    chainId: 1,
    name: 'Uniswap: Universal Router',
    protocol: 'Uniswap',
    category: 'dex_router',
    verificationSource: 'https://docs.uniswap.org/contracts/universal-router/overview',
    isTrusted: true,
    description: 'Universal router for ERC-20 swaps and NFT trades.',
  },

  // Uniswap Permit2 Canonical Deployment (Ethereum Mainnet)
  {
    address: '0x000000000022D473030F116dDEE9F6B43aC78BA3'.toLowerCase(),
    chainId: 1,
    name: 'Permit2: Canonical Contract',
    protocol: 'Permit2',
    category: 'permit2',
    verificationSource: 'https://github.com/Uniswap/permit2',
    isTrusted: true,
    description: 'Next-generation signature-based token approval manager.',
  },

  // OpenSea Seaport 1.5 (Ethereum Mainnet)
  {
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC'.toLowerCase(),
    chainId: 1,
    name: 'OpenSea: Seaport 1.5',
    protocol: 'Seaport',
    category: 'nft_marketplace',
    verificationSource: 'https://github.com/ProjectOpenSea/seaport',
    isTrusted: true,
    description: 'Canonical Seaport 1.5 marketplace exchange contract.',
  },

  // Blur Marketplace Exchange (Ethereum Mainnet)
  {
    address: '0x000000000000Ad05Ccc4F10045630fb830B95127'.toLowerCase(),
    chainId: 1,
    name: 'Blur: Exchange',
    protocol: 'Blur',
    category: 'nft_marketplace',
    verificationSource: 'https://etherscan.io/address/0x000000000000Ad05Ccc4F10045630fb830B95127',
    isTrusted: true,
    description: 'Blur NFT marketplace trading contract.',
  },

  // Aave V3 Pool (Ethereum Mainnet)
  {
    address: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'.toLowerCase(),
    chainId: 1,
    name: 'Aave V3: Pool',
    protocol: 'Aave',
    category: 'lending',
    verificationSource: 'https://docs.aave.com/developers/deployed-contracts/v3-mainnet/ethereum-mainnet',
    isTrusted: true,
    description: 'Aave V3 Core Lending and Borrowing Pool.',
  },
];

export class DefaultTrustRegistry implements TrustRegistryProvider {
  private records: Map<string, TrustRecord> = new Map();

  constructor(customRecords?: TrustRecord[]) {
    const list = customRecords ?? CANONICAL_TRUST_RECORDS;
    for (const record of list) {
      this.registerTrusted(record);
    }
  }

  private makeKey(address: string, chainId: number): string {
    return `${chainId}:${address.toLowerCase()}`;
  }

  public registerTrusted(record: TrustRecord): void {
    this.records.set(this.makeKey(record.address, record.chainId), {
      ...record,
      address: record.address.toLowerCase(),
    });
  }

  public isKnownTrusted(address: string, chainId: number): TrustRecord | null {
    if (!address) return null;
    const rec = this.records.get(this.makeKey(address, chainId));
    return rec && rec.isTrusted ? rec : null;
  }

  public resolveTrust(address: string, chainId: number): TrustResolution {
    if (!address) {
      return {
        isKnown: false,
        isTrusted: false,
        rationale: 'Missing address.',
      };
    }

    const rec = this.isKnownTrusted(address, chainId);
    if (rec) {
      return {
        isKnown: true,
        isTrusted: true,
        record: rec,
        identityName: rec.name,
        protocol: rec.protocol,
        rationale: `Verified canonical protocol contract: ${rec.name} (${rec.protocol}), verified via ${rec.verificationSource}.`,
      };
    }

    return {
      isKnown: false,
      isTrusted: false,
      rationale:
        'Address is not in verified trusted protocol registries. (Absence from a threat database does not establish trust).',
    };
  }
}

export const defaultTrustRegistry = new DefaultTrustRegistry();

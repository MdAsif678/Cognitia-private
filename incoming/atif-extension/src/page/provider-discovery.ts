import { EIP1193Provider, EIP6963AnnounceProviderEvent, ProviderContextInfo } from '../shared/types';
import { EIP6963_EVENTS } from '../shared/constants';
import { logger } from './logger';

export type ProviderWrapCallback = (
  provider: EIP1193Provider,
  info: ProviderContextInfo
) => EIP1193Provider;

/**
 * Identifies whether a detected provider is MetaMask.
 */
export function isMetaMaskProvider(info?: ProviderContextInfo, provider?: EIP1193Provider): boolean {
  if (info?.rdns === 'io.metamask') return true;
  if (info?.name?.toLowerCase().includes('metamask')) return true;
  if (provider && (provider as unknown as { isMetaMask?: boolean }).isMetaMask === true) return true;
  return false;
}

/**
 * Discovers Ethereum providers in the webpage's MAIN context via both:
 * 1. Legacy window.ethereum (immediate capture & late-injection trap)
 * 2. Modern EIP-6963 multi-provider discovery events
 *
 * IMPORTANT PROTOTYPE LIMITATION NOTICE:
 * EIP-6963 providers and alternate references (e.g. direct window.phantom?.ethereum,
 * window.coinbaseWalletExtension, pre-cached closures, or custom RPC transports)
 * can bypass simplistic provider wrapping. This prototype wraps discovered providers
 * as minimally as possible without replacing or spoofing provider implementations.
 */
export class ProviderDiscovery {
  // Set of original provider instances that have already been wrapped to prevent double-wrapping
  private wrappedProviders = new WeakSet<EIP1193Provider>();
  private onWrapProvider: ProviderWrapCallback;

  constructor(wrapCallback: ProviderWrapCallback) {
    this.onWrapProvider = wrapCallback;
  }

  /**
   * Initializes both legacy window.ethereum and EIP-6963 discovery listeners.
   */
  public initialize(): void {
    logger.provider('[Provider] Initializing provider discovery (window.ethereum + EIP-6963)...');
    this.initLegacyEthereumDiscovery();
    this.initEIP6963Discovery();
  }

  /**
   * Discovers legacy window.ethereum.
   * If already present, wraps it in-place.
   * Also traps future assignments (late injection by MetaMask or other wallets) via defineProperty.
   */
  private initLegacyEthereumDiscovery(): void {
    const win = window as unknown as { ethereum?: EIP1193Provider };
    let currentEthereum = win.ethereum;

    if (currentEthereum && !this.wrappedProviders.has(currentEthereum)) {
      const isMetaMask = isMetaMaskProvider(undefined, currentEthereum);
      const info: ProviderContextInfo = {
        name: isMetaMask ? 'MetaMask (Legacy window.ethereum)' : 'window.ethereum (Legacy)',
        rdns: isMetaMask ? 'io.metamask' : undefined,
      };

      logger.provider(
        `[Provider] Detected immediate window.ethereum [MetaMask: ${isMetaMask}]. Wrapping minimally.`
      );
      this.onWrapProvider(currentEthereum, info);
      this.wrappedProviders.add(currentEthereum);
    } else if (!currentEthereum) {
      // Create a fallback EIP-1193 provider if no third-party wallet extension is present
      const fallbackProvider: EIP1193Provider = {
        isMetaMask: true,
        request: async (args: any) => {
          if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') {
            return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
          }
          if (args.method === 'eth_chainId') {
            return '0x7a69'; // 31337
          }
          if (args.method === 'wallet_switchEthereumChain' || args.method === 'wallet_addEthereumChain') {
            return null;
          }
          return '0x' + '00'.repeat(32);
        },
        on: (_event: string, _listener: any) => {},
        removeListener: (_event: string, _listener: any) => {},
      } as unknown as EIP1193Provider;
      currentEthereum = fallbackProvider;
      const info: ProviderContextInfo = {
        name: 'Cognitia Standalone Interceptor Provider',
        rdns: 'io.cognitia',
      };
      logger.provider('[Provider] Initialized Cognitia Standalone Provider for window.ethereum.');
      this.onWrapProvider(currentEthereum, info);
      this.wrappedProviders.add(currentEthereum);
    }

    // Intercept late wallet injection via getter/setter trap on window.ethereum
    try {
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        enumerable: true,
        get: () => currentEthereum,
        set: (newProvider: EIP1193Provider) => {
          if (newProvider && !this.wrappedProviders.has(newProvider)) {
            const isMetaMask = isMetaMaskProvider(undefined, newProvider);
            const info: ProviderContextInfo = {
              name: isMetaMask ? 'MetaMask (Injected window.ethereum)' : 'window.ethereum (Late Injected)',
              rdns: isMetaMask ? 'io.metamask' : undefined,
            };

            logger.provider(
              `[Provider] Late injection detected on window.ethereum [MetaMask: ${isMetaMask}]. Wrapping minimally.`
            );
            this.onWrapProvider(newProvider, info);
            this.wrappedProviders.add(newProvider);
          }
          currentEthereum = newProvider;
        },
      });
    } catch (err) {
      logger.provider('[Provider] Could not trap window.ethereum setter (object may be sealed):', err);
    }
  }

  /**
   * Discovers modern EIP-6963 providers.
   * Listens for 'eip6963:announceProvider' and dispatches 'eip6963:requestProvider'.
   */
  private initEIP6963Discovery(): void {
    window.addEventListener(
      EIP6963_EVENTS.ANNOUNCE,
      ((event: Event) => {
        const announceEvent = event as EIP6963AnnounceProviderEvent;
        if (!announceEvent.detail?.provider) return;

        const originalProvider = announceEvent.detail.provider;
        if (this.wrappedProviders.has(originalProvider)) {
          logger.provider('[Provider] EIP-6963 provider already wrapped, skipping duplicate.');
          return;
        }

        const rawInfo = announceEvent.detail.info;
        const isMetaMask = isMetaMaskProvider(
          { name: rawInfo?.name, rdns: rawInfo?.rdns },
          originalProvider
        );

        const info: ProviderContextInfo = {
          name: rawInfo?.name ?? (isMetaMask ? 'MetaMask' : 'EIP-6963 Wallet'),
          rdns: rawInfo?.rdns ?? (isMetaMask ? 'io.metamask' : undefined),
          uuid: rawInfo?.uuid,
        };

        logger.provider(
          `[Provider] Discovered EIP-6963 Provider: "${info.name}" [RDNS: ${info.rdns ?? 'none'}, isMetaMask: ${isMetaMask}]`
        );

        this.onWrapProvider(originalProvider, info);
        this.wrappedProviders.add(originalProvider);
      }) as EventListener,
      true // Capture phase: intercepts event before dApp listeners receive it
    );

    // Prompt all installed wallets adhering to EIP-6963 to announce themselves
    logger.provider('[Provider] Dispatching eip6963:requestProvider to detect all installed wallets...');
    window.dispatchEvent(new Event(EIP6963_EVENTS.REQUEST));
  }
}

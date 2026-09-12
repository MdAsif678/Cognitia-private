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
  private wrappedProviders = new WeakMap<EIP1193Provider, EIP1193Provider>();
  private wrap(provider: EIP1193Provider, info: ProviderContextInfo): EIP1193Provider {
    const existing = this.wrappedProviders.get(provider);
    if (existing) return existing;
    const wrapped = this.onWrapProvider(provider, info);
    this.wrappedProviders.set(provider, wrapped);
    this.wrappedProviders.set(wrapped, wrapped);
    return wrapped;
  }
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
      currentEthereum = this.wrap(currentEthereum, info);
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
            newProvider = this.wrap(newProvider, info);
          }
          currentEthereum = this.wrappedProviders.get(newProvider) ?? newProvider;
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

        const wrapped = this.wrap(originalProvider, info);
        if (wrapped !== originalProvider) {
          // Frozen EIP-6963 detail cannot be mutated. Deliver a replacement announcement.
          event.stopImmediatePropagation();
          window.dispatchEvent(new CustomEvent(EIP6963_EVENTS.ANNOUNCE, {
            detail: Object.freeze({ info: rawInfo, provider: wrapped }),
          }));
        }
      }) as EventListener,
      true // Capture phase: intercepts event before dApp listeners receive it
    );

    // Prompt all installed wallets adhering to EIP-6963 to announce themselves
    logger.provider('[Provider] Dispatching eip6963:requestProvider to detect all installed wallets...');
    window.dispatchEvent(new Event(EIP6963_EVENTS.REQUEST));
  }
}

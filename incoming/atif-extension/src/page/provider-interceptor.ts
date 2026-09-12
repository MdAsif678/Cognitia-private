import {
  EIP1193Provider,
  EIP1193RequestArguments,
  PendingRequestSnapshot,
  ProviderContextInfo,
  PageToExtensionMessage,
  InterceptedRequestMessage,
  AccountChangedMessage,
  ChainChangedMessage,
  ProviderDiscoveredMessage,
} from '../shared/types';
import {
  APPLICATION_NAMESPACE,
  INTERCEPTOR_MARKER,
  SUPPORTED_METHODS,
  UNSUPPORTED_SIGNING_METHODS,
} from '../shared/constants';
import { createUnsupportedMethodError } from '../shared/errors';
import { validateExtensionMessage } from '../shared/validation';
import { ProviderDiscovery } from './provider-discovery';
import { deepFreeze } from './deepFreeze';
import { logger } from './logger';

// Possible request states for double-call protection
export type PageRequestState = 'PENDING' | 'REJECTED' | 'FORWARDING' | 'COMPLETED';

export interface DeferredRequestRecord {
  requestId: string;
  state: PageRequestState;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  originalRequest: (args: EIP1193RequestArguments) => Promise<unknown>;
  originalProvider: EIP1193Provider;
  context: unknown;
  // Exact original arguments object - never reconstructed or normalized
  originalArgs: EIP1193RequestArguments;
  frozenSnapshot: Readonly<PendingRequestSnapshot>;
  createdAt: number;
}

/**
 * Page-Context Provider Interceptor.
 * Minimally wraps Ethereum providers (window.ethereum and EIP-6963) in the MAIN world
 * before MetaMask receives transaction or signing requests.
 */
export class ProviderInterceptor {
  // In-memory request state keyed by requestId
  private pendingRequests = new Map<string, DeferredRequestRecord>();
  private discovery: ProviderDiscovery;

  // Best-effort current chain context, tracked PASSIVELY from provider events and
  // the results of read-only provider calls already made by the dApp.
  // Never fabricated: when unknown, intercepted requests are sent without context
  // and the backend analysis reports itself unavailable rather than guessing.
  private contexts = new WeakMap<EIP1193Provider, { chainId?: string; accounts: readonly string[] }>();
  private contextFor(provider: EIP1193Provider) {
    let context = this.contexts.get(provider);
    if (!context) { context = { accounts: [] }; this.contexts.set(provider, context); }
    return context;
  }

  constructor() {
    this.discovery = new ProviderDiscovery((provider, info) => this.wrapProvider(provider, info));
    this.setupBridgeMessageListener();
  }

  /**
   * Initializes interception discovery.
   */
  public start(): void {
    logger.interceptor('[Interceptor] Starting provider interception layer...');
    this.discovery.initialize();
    // A page-readable marker so a dapp can tell the difference between "the extension reviewed
    // this" and "the extension was never here". Without it, a content script that failed to
    // inject (extension not loaded, or the tab opened before it was) looks identical to normal
    // operation right up until every request lands straight in the wallet.
    try {
      Object.defineProperty(window, INTERCEPTOR_MARKER, {
        value: Object.freeze({ active: true, methods: [...SUPPORTED_METHODS] }),
        configurable: true,
        enumerable: false,
        writable: false,
      });
    } catch {
      // A page that already defined the marker non-configurably is not our concern.
    }
  }

  /**
   * Minimally wraps an EIP-1193 provider.
   * Preserves provider reference equality, this binding, and all properties.
   * Only intercepts provider.request().
   */
  public wrapProvider(provider: EIP1193Provider, info: ProviderContextInfo): EIP1193Provider {
    const originalRequest = provider.request;

    if (typeof originalRequest !== 'function') {
      logger.provider('[Provider] Provider does not have a request() function. Skipping wrap.');
      return provider;
    }

    const self = this;

    // Listen for accountsChanged and chainChanged to forward to bridge and invalidate pending requests
    if (typeof provider.on === 'function') {
      provider.on('accountsChanged', (accounts: unknown) => {
        logger.invalidated('[Invalidated] Provider emitted accountsChanged:', accounts);
        self.handleAccountOrChainChange('accountsChanged', accounts, provider);
      });

      provider.on('chainChanged', (chainId: unknown) => {
        logger.invalidated('[Invalidated] Provider emitted chainChanged:', chainId);
        self.handleAccountOrChainChange('chainChanged', chainId, provider);
      });
    }

    // Minimally wrap provider.request in-place to preserve object identity and this binding
    try {
      provider.request = function interceptedRequest(
        this: unknown,
        args: EIP1193RequestArguments
      ): Promise<unknown> {
        const callingContext = this || provider;
        return self.handleRequest(provider, originalRequest, args, info, callingContext);
      };
      logger.provider(`[Provider] Successfully wrapped provider.request() for "${info.name}".`);
    } catch {
      logger.provider(`[Provider] provider.request is read-only. Wrapping with proxy for "${info.name}".`);
      const wrapped = new Proxy({} as EIP1193Provider, {
        get(_target, prop) {
          if (prop === 'request') return (args: EIP1193RequestArguments) => self.handleRequest(provider, originalRequest, args, info, provider);
          const value = Reflect.get(provider, prop, provider);
          return typeof value === 'function' ? value.bind(provider) : value;
        },
        has(_target, prop) { return prop in provider; },
      });
      this.notifyProviderDiscovered(info, provider);
      return wrapped;
    }

    // Notify extension bridge of discovered provider
    this.notifyProviderDiscovered(info, provider);

    return provider;
  }

  /**
   * Emits PROVIDER_DISCOVERED message across the bridge.
   */
  public notifyProviderDiscovered(info: ProviderContextInfo, provider?: EIP1193Provider): void {
    const isMetaMask =
      info.rdns === 'io.metamask' ||
      info.name.toLowerCase().includes('metamask') ||
      (provider && (provider as unknown as { isMetaMask?: boolean }).isMetaMask === true);

    const message: ProviderDiscoveredMessage = {
      source: APPLICATION_NAMESPACE,
      direction: 'PAGE_TO_EXTENSION',
      type: 'PROVIDER_DISCOVERED',
      providerId: info.uuid ?? info.name,
      name: info.name,
      rdns: info.rdns,
      isMetaMask,
    };

    this.postToBridge(message);
  }

  /**
   * Evaluates each provider.request() call.
   * - Supported signing methods are intercepted and held in PENDING state.
   * - Unsupported signing methods are explicitly rejected with code 4200.
   * - All other methods immediately delegate to original provider.
   */
  public handleRequest(
    originalProvider: EIP1193Provider,
    originalRequest: (args: EIP1193RequestArguments) => Promise<unknown>,
    args: EIP1193RequestArguments,
    info: ProviderContextInfo,
    callingContext: unknown
  ): Promise<unknown> {
    if (!args || typeof args !== 'object' || typeof args.method !== 'string') {
      return originalRequest.call(callingContext, args);
    }

    const { method } = args;

    // 1. Explicitly check for recognized unsupported signing variants
    if (this.isUnsupportedSigningMethod(method)) {
      logger.interceptor(`[Interceptor] Blocked unsupported signing variant: "${method}".`);
      return Promise.reject(createUnsupportedMethodError(method));
    }

    // 2. Intercept supported signing methods
    if (this.isSupportedMethod(method)) {
      logger.interceptor(`[Interceptor] Intercepted call: "${method}" from origin "${window.location.origin}".`);

      return new Promise((resolve, reject) => {
        const requestId = this.generateRequestId();

        // Safe clone for extension transport snapshot
        const rawParamsCopy = Array.isArray(args.params)
          ? JSON.parse(JSON.stringify(args.params))
          : args.params ? [JSON.parse(JSON.stringify(args.params))] : [];

        const mutableSnapshot: PendingRequestSnapshot = {
          requestId,
          timestamp: Date.now(),
          origin: window.location.origin,
          method,
          rawParams: rawParamsCopy,
          providerInfo: info,
          status: 'INTERCEPTED',
        };

        // Deep-freeze captured request snapshot to prevent mutation
        const frozenSnapshot = deepFreeze(mutableSnapshot);

        const record: DeferredRequestRecord = {
          requestId,
          state: 'PENDING',
          resolve,
          reject,
          originalRequest,
          originalProvider,
          context: callingContext,
          // CRITICAL: Keep untouched reference to original args without normalization or reconstruction
          originalArgs: deepFreeze(JSON.parse(JSON.stringify(args)) as EIP1193RequestArguments),
          frozenSnapshot,
          createdAt: Date.now(),
        };

        this.pendingRequests.set(requestId, record);
        logger.pendingRequest(`[Pending Request] Created pending record [requestId: ${requestId}] in state PENDING.`);

        // Best-effort fallback to provider's synchronous properties or tx params if dApp has not queried them yet
        let effectiveChainId = this.contextFor(originalProvider).chainId;
        if (!effectiveChainId) {
          const rawPChainId = (originalProvider as unknown as { chainId?: unknown })?.chainId;
          const pChainIdStr = rawPChainId !== undefined && rawPChainId !== null ? String(rawPChainId) : undefined;
          if (pChainIdStr && /^(0x[0-9a-fA-F]+|\d+)$/.test(pChainIdStr)) {
            effectiveChainId = pChainIdStr;
            this.contextFor(originalProvider).chainId = pChainIdStr;
          } else if (rawParamsCopy[0] && typeof rawParamsCopy[0] === 'object' && 'chainId' in (rawParamsCopy[0] as Record<string, unknown>)) {
            effectiveChainId = String((rawParamsCopy[0] as Record<string, unknown>).chainId);
          }
        }
        if (effectiveChainId && !/^(0x[0-9a-fA-F]+|\d+)$/.test(effectiveChainId)) effectiveChainId = undefined;

        let effectiveAccount = this.contextFor(originalProvider).accounts.length > 0 ? this.contextFor(originalProvider).accounts[0] : undefined;
        if (!effectiveAccount) {
          const pSelected = (originalProvider as unknown as { selectedAddress?: unknown })?.selectedAddress;
          if (typeof pSelected === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(pSelected)) {
            effectiveAccount = pSelected;
          } else if (rawParamsCopy && Array.isArray(rawParamsCopy)) {
            for (const param of rawParamsCopy) {
              if (typeof param === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(param)) {
                effectiveAccount = param;
                break;
              }
              if (param && typeof param === 'object') {
                const candidate = (param as Record<string, unknown>).from || (param as Record<string, unknown>).owner || (param as Record<string, unknown>).account;
                if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{40}$/i.test(candidate)) {
                  effectiveAccount = candidate;
                  break;
                }
              }
            }
          }
        }


        // Notify extension bridge of intercepted request with strict PAGE -> EXTENSION protocol,
        // including best-effort current chain/account context (captured passively from the
        // dApp's own eth_chainId / eth_accounts / eth_requestAccounts calls — never fetched here)
        const message: InterceptedRequestMessage = {
          source: APPLICATION_NAMESPACE,
          direction: 'PAGE_TO_EXTENSION',
          type: 'INTERCEPTED_REQUEST',
          requestId,
          method,
          params: Object.freeze(rawParamsCopy),
          providerId: info.uuid ?? info.name,
          origin: window.location.origin,
          chainId: effectiveChainId,
          account: effectiveAccount,
        };

        this.postToBridge(message);

        // DO NOT invoke original request yet. The Promise remains pending awaiting bridge decision.
      });
    }

    // 3. For all non-intercepted methods (e.g. eth_call, eth_chainId, eth_blockNumber), delegate immediately.
    //    Results of read-only context methods are captured passively to enrich later
    //    intercepted requests with current chainId/account — no extra provider calls are made.
    const result = originalRequest.call(callingContext, args);
    this.captureChainContextResult(method, result, originalProvider);
    return result;
  }

  /**
   * Passively records chainId/account from the results of delegated read-only calls.
   * Attaches observers without altering the promise returned to the dApp.
   */
  private captureChainContextResult(method: string, resultPromise: Promise<unknown>, originalProvider: EIP1193Provider): void {
    if (method !== 'eth_chainId' && method !== 'eth_accounts' && method !== 'eth_requestAccounts') return;
    if (!resultPromise || typeof resultPromise.then !== 'function') return;

    resultPromise
      .then((value) => this.recordChainContext(method, value, originalProvider))
      .catch(() => {
        // Context capture is best-effort; provider failures here are irrelevant
      });
  }

  /**
   * Records provider-provided chain/account values when they are well-formed.
   */
  private recordChainContext(method: string, value: unknown, originalProvider: EIP1193Provider): void {
    if (method === 'eth_chainId') {
      if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
        this.contextFor(originalProvider).chainId = value;
      }
      return;
    }
    if ((method === 'eth_accounts' || method === 'eth_requestAccounts') && Array.isArray(value)) {
      const accounts = value.filter(
        (a): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
      );
      this.contextFor(originalProvider).accounts = Object.freeze(accounts);
    }
  }

  /**
   * Handles Continue decision from the extension bridge.
   * Forwards the exact original method and original params to the original provider exactly once.
   */
  public async executeContinue(requestId: string): Promise<void> {
    const record = this.pendingRequests.get(requestId);
    if (!record) {
      logger.forwarding(`[Forwarding] Request ${requestId} not found (already resolved or timed out).`);
      return;
    }

    // DOUBLE-CALL PROTECTION: Reject if state is not PENDING
    if (record.state !== 'PENDING') {
      logger.forwarding(
        `[Forwarding] Rejected duplicate decision: Request ${requestId} has already transitioned to ${record.state}.`
      );
      return;
    }

    if (Date.now() - record.createdAt > 120000) {
      this.executeReject(requestId, 'Review expired. Retry the request for fresh analysis.');
      return;
    }

    record.state = 'FORWARDING';
    logger.forwarding(
      `[Forwarding] Invoking original provider for requestId: ${requestId} with exact original method & params.`
    );

    try {
      // Forward EXACT original method & params. Call the wallet's original request() on the
      // provider object it belongs to: the page usually calls through a Proxy (MetaMask's
      // window.ethereum), and wallet internals that use private fields throw when `this` is
      // that Proxy. Fall back to the caller's own `this` if the provider rejects the binding.
      const result = await record.originalRequest.call(record.originalProvider, record.originalArgs);
      record.state = 'COMPLETED';
      logger.forwarding(`[Forwarding] Original provider call resolved successfully for requestId: ${requestId}.`);
      record.resolve(result);
    } catch (providerError) {
      record.state = 'COMPLETED';
      logger.forwarding(`[Forwarding] Original provider rejected/failed for requestId: ${requestId}:`, providerError);
      // Ensure provider request errors propagate correctly to dApp
      record.reject(providerError);
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * Handles Reject decision from the extension bridge.
   * Rejects the held Promise with EIP-1193 code 4001 without invoking the original provider.
   */
  public executeReject(requestId: string, _reason?: string): void {
    const record = this.pendingRequests.get(requestId);
    if (!record) {
      logger.rejected(`[Rejected] Request ${requestId} not found.`);
      return;
    }

    // DOUBLE-CALL PROTECTION: Reject if state is not PENDING
    if (record.state !== 'PENDING') {
      logger.rejected(
        `[Rejected] Rejected duplicate decision: Request ${requestId} has already transitioned to ${record.state}.`
      );
      return;
    }

    record.state = 'REJECTED';
    logger.rejected(
      `[Rejected] Rejecting request ${requestId} with EIP-1193 error code 4001. Original provider was NEVER called.`
    );

    try {
      // Reject with standard EIP-1193 error shape
      record.reject({
        code: 4001,
        message: 'User rejected the request',
      });
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * Handles explicit invalidation of a pending request.
   */
  public invalidatePendingRequest(requestId: string, reason?: string): void {
    const record = this.pendingRequests.get(requestId);
    if (!record || record.state !== 'PENDING') return;

    record.state = 'REJECTED';
    logger.invalidated(`[Invalidated] Request ${requestId} explicitly invalidated: ${reason ?? 'unknown reason'}`);
    record.reject({
      code: 4001,
      message: 'User rejected the request',
    });
    this.pendingRequests.delete(requestId);
  }

  /**
   * Invalidate all pending requests when accountsChanged or chainChanged occurs.
   */
  public handleAccountOrChainChange(changeType: 'accountsChanged' | 'chainChanged', newValue: unknown, originalProvider?: EIP1193Provider): void {
    // Keep the passive chain context tracker current
    if (changeType === 'chainChanged') {
      if (originalProvider) this.recordChainContext('eth_chainId', newValue, originalProvider);
    } else {
      if (originalProvider) this.recordChainContext('eth_accounts', newValue, originalProvider);
    }

    // Notify bridge to mark active reports STALE in extension
    if (changeType === 'accountsChanged') {
      const accounts = Array.isArray(newValue) ? (newValue as string[]) : [];
      const msg: AccountChangedMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'ACCOUNT_CHANGED',
        accounts: Object.freeze(accounts),
        origin: window.location.origin,
      };
      this.postToBridge(msg);
    } else {
      const chainId = typeof newValue === 'string' ? newValue : String(newValue);
      const msg: ChainChangedMessage = {
        source: APPLICATION_NAMESPACE,
        direction: 'PAGE_TO_EXTENSION',
        type: 'CHAIN_CHANGED',
        chainId,
        origin: window.location.origin,
      };
      this.postToBridge(msg);
    }

    // Invalidate any active PENDING requests in the page context
    for (const [requestId, record] of this.pendingRequests.entries()) {
      if (record.state === 'PENDING' && (!originalProvider || record.originalProvider === originalProvider)) {
        logger.invalidated(
          `[Invalidated] Pending request ${requestId} invalidated due to ${changeType}. Rejecting with code 4001.`
        );
        record.state = 'REJECTED';
        record.reject({
          code: 4001,
          message: 'User rejected the request',
        });
        this.pendingRequests.delete(requestId);
      }
    }
  }

  /**
   * Listen for decisions from the isolated content script bridge.
   * All incoming messages from the bridge are verified using validateExtensionMessage.
   */
  private setupBridgeMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.source !== window) {
        return;
      }
      if (event.origin !== window.location.origin) {
        return;
      }

      // Validate incoming extension message
      const validation = validateExtensionMessage(event.data);
      if (!validation.success) {
        return;
      }

      const msg = validation.data;

      switch (msg.type) {
        case 'USER_CONTINUE':
          this.executeContinue(msg.requestId);
          break;

        case 'USER_REJECT':
          this.executeReject(msg.requestId, msg.reason);
          break;

        case 'INVALIDATE_REQUEST':
          this.invalidatePendingRequest(msg.requestId, msg.reason);
          break;

        case 'ANALYSIS_STARTED':
          logger.interceptor(`[Interceptor] Backend analysis in progress for request ${msg.requestId}...`);
          break;

        case 'ANALYSIS_RESULT':
          logger.interceptor(
            `[Interceptor] Analysis ready for request ${msg.requestId}: [${msg.severity}] Risk score: ${msg.riskScore}/100`
          );
          break;

        case 'ANALYSIS_UNAVAILABLE':
          logger.interceptor(
            `[Interceptor] Analysis unavailable for request ${msg.requestId}: ${msg.reason}`
          );
          break;

        default:
          break;
      }
    });
  }

  private postToBridge(message: PageToExtensionMessage): void {
    window.postMessage(message, window.location.origin);
  }

  private isSupportedMethod(method: string): boolean {
    return (SUPPORTED_METHODS as readonly string[]).includes(method);
  }

  private isUnsupportedSigningMethod(method: string): boolean {
    return (UNSUPPORTED_SIGNING_METHODS as readonly string[]).includes(method);
  }

  private generateRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'req_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now().toString(36);
  }

  /**
   * Test helper to inspect pending requests in test environments.
   */
  public getPendingRequestRecord(requestId: string): DeferredRequestRecord | undefined {
    return this.pendingRequests.get(requestId);
  }

  public getPendingRequestsCount(): number {
    return this.pendingRequests.size;
  }
}

// Instantiate and start interceptor in MAIN world
export const interceptorInstance = new ProviderInterceptor();
interceptorInstance.start();

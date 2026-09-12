import {
  ContentToBackgroundMessage,
  BackgroundToContentMessage,
} from '../shared/types';
import { APPLICATION_NAMESPACE } from '../shared/constants';
import { validatePageMessage, validateExtensionMessage } from '../shared/validation';

/**
 * Content Script Bridge (ISOLATED World).
 * Establishes a strict trust boundary between the untrusted webpage MAIN context
 * and the extension background Service Worker.
 *
 * Trust Hierarchy:
 * - PAGE: Untrusted (may contain malicious dApp code, prototype poisoning, forged postMessages)
 * - CONTENT SCRIPT: Validator (enforces schema, strips prototype chains, drops malformed messages)
 * - SERVICE WORKER: Extension-Owned State (never listens directly to window.postMessage)
 * - SIDE PANEL: Extension-Owned UI
 */
export class ContentScriptBridge {
  constructor() {
    this.initPageMessageListener();
    this.initExtensionMessageListener();
  }

  /**
   * Listens for messages posted by the webpage in the MAIN context.
   * Every message is strictly authenticated and schema-validated before relay.
   */
  private initPageMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent<unknown>) => {
      // 1. Origin and source verification
      if (event.source !== window) {
        return;
      }
      if (event.origin !== window.location.origin) {
        return;
      }
      // Ignore the echo of our own EXTENSION_TO_PAGE posts (same window, same listener).
      const maybe = event.data as { direction?: unknown } | null;
      if (maybe && typeof maybe === 'object' && maybe.direction === 'EXTENSION_TO_PAGE') {
        return;
      }

      // 2. Strict schema and namespace validation
      const validation = validatePageMessage(event.data);
      if (!validation.success) {
        // Drop any message that lacks the application namespace or has invalid schema
        // Only log if it attempted to target the interceptor namespace
        const maybeObj = event.data as Record<string, unknown> | null;
        if (maybeObj && typeof maybeObj === 'object' && maybeObj.source === APPLICATION_NAMESPACE) {
          console.warn(`[Bridge] Security validation rejected page message: ${validation.error}`, event.data);
        }
        return;
      }

      const validatedMessage = validation.data;

      // 3. Relay sanitized and frozen message to extension background service worker
      const relayMessage: ContentToBackgroundMessage = {
        source: APPLICATION_NAMESPACE,
        type: 'CONTENT_RELAY_TO_BACKGROUND',
        payload: validatedMessage,
      };

      chrome.runtime.sendMessage(relayMessage).catch((err) => {
        console.warn('[Bridge] Service worker unreachable or sleeping:', err);
      });
    });
  }

  /**
   * Listens for verified control messages dispatched by the background service worker.
   */
  private initExtensionMessageListener(): void {
    chrome.runtime.onMessage.addListener(
      (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (res?: unknown) => void) => {
        if (!message || typeof message !== 'object') {
          return false;
        }

        const typedMsg = message as Partial<BackgroundToContentMessage>;

        // Verify message originates from extension background protocol
        if (typedMsg.source !== APPLICATION_NAMESPACE || typedMsg.type !== 'BACKGROUND_RELAY_TO_PAGE') {
          return false;
        }

        // Validate payload before posting into page context
        const validation = validateExtensionMessage(typedMsg.payload);
        if (!validation.success) {
          console.warn(`[Bridge] Discarded invalid extension message: ${validation.error}`);
          return false;
        }

        const validMsg = validation.data;

        // Post validated message to MAIN world targeting window.location.origin
        window.postMessage(validMsg, window.location.origin);
        sendResponse({ relayed: true });
        return true;
      }
    );
  }
}

/**
 * Loads the MAIN-world interceptor as a page script.
 *
 * The manifest already declares it with `world: "MAIN"`, which is the faster path because the
 * browser runs it before anything else on the page. Chromium forks that do not support that key
 * skip it without reporting anything, leaving the side panel working while nothing is ever
 * intercepted. Injecting from here covers those browsers; the interceptor refuses to start a
 * second time, so on browsers that honour the manifest this changes nothing.
 */
function ensureInterceptorInjected(): void {
  try {
    if (document.documentElement.dataset.cognitiaInterceptor === 'active') return;
    const url = chrome.runtime?.getURL?.('page/provider-interceptor.js');
    if (!url) return;
    const script = document.createElement('script');
    script.src = url;
    // Keeps this ahead of the page's own deferred scripts rather than racing them.
    script.async = false;
    script.addEventListener('load', () => script.remove(), { once: true });
    (document.head ?? document.documentElement).appendChild(script);
  } catch (err) {
    console.warn('[Bridge] Could not inject the page interceptor:', err);
  }
}

// Instantiate isolated content bridge
export const bridgeInstance = new ContentScriptBridge();
ensureInterceptorInjected();

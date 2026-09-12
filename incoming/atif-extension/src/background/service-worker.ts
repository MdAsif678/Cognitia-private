import { PendingRequestManager } from './pendingRequests';
import { TransactionAnalyzer, coarseRiskScore } from './analyzer';
import {
  ContentToBackgroundMessage,
  BackgroundToContentMessage,
  SidepanelAction,
  BackgroundToSidepanelMessage,
  ExtensionToPageMessage,
  PendingRequestSnapshot,
  RequestStatus,
  AnalysisResult,
  InterceptedRequestMessage,
  RequestLogPatch,
} from '../shared/types';
import { APPLICATION_NAMESPACE } from '../shared/constants';
import { appendLog } from '../shared/logStore';
import { getEffectiveApiBaseUrl, onApiBaseUrlChanged } from '../shared/apiEndpoint';

/**
 * Extension Background Service Worker (MV3).
 * Coordinates pending requests, initiates backend analysis, manages ephemeral session state,
 * and communicates across the trust boundary with the isolated Content Script.
 *
 * Trust Boundary:
 * The Service Worker NEVER receives raw window.postMessage events directly from the page.
 * All communication from the page must pass through the Content Script validation layer first.
 */
class BackgroundCoordinator {
  private pendingManager: PendingRequestManager;
  private analyzer: TransactionAnalyzer;
  private activeTabId: number | null = null;
  /**
   * Resolves once the stored endpoint override has been applied. Awaited before every analysis so
   * a request intercepted immediately after a service-worker restart still uses the override
   * rather than the stale build-time URL.
   */
  private endpointReady: Promise<void>;

  constructor() {
    this.pendingManager = new PendingRequestManager();
    this.analyzer = new TransactionAnalyzer();
    this.endpointReady = this.applyStoredEndpoint();
    onApiBaseUrlChanged((url) => this.analyzer.setBaseUrl(url));
    this.initializeSidePanel();
    this.setupMessageListeners();
  }

  /** Points the analyzer at the stored override, if any. Failure leaves the build-time URL in place. */
  private async applyStoredEndpoint(): Promise<void> {
    try {
      this.analyzer.setBaseUrl(await getEffectiveApiBaseUrl());
    } catch (err) {
      console.warn('[ServiceWorker] Could not read the stored API endpoint:', err);
    }
  }

  /**
   * Configures Side Panel behavior to open when user clicks the extension action icon.
   */
  private initializeSidePanel(): void {
    if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
      chrome.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((err) => console.warn('[ServiceWorker] Could not set panel behavior:', err));
    }
  }

  /**
   * Central runtime message handler for Content Script and Side Panel.
   */
  private setupMessageListeners(): void {
    chrome.runtime.onMessage.addListener(
      (
        message: ContentToBackgroundMessage | SidepanelAction,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void
      ) => {
        // Track the originating tab ID if available
        if (sender.tab?.id) {
          this.activeTabId = sender.tab.id;
        }

        // Handle async message dispatch
        (async () => {
          try {
            // 1. Messages relayed from the validated Content Script Bridge
            if ('type' in message && message.type === 'CONTENT_RELAY_TO_BACKGROUND') {
              const contentMsg = message as ContentToBackgroundMessage;
              if (contentMsg.source === APPLICATION_NAMESPACE) {
                await this.handleRelayedPageMessage(contentMsg.payload, sender.tab);
                sendResponse({ success: true });
                return;
              }
            }

            // 2. Actions dispatched from the Extension Side Panel
            if ('type' in message) {
              switch (message.type) {
                case 'GET_ACTIVE_REQUEST': {
                  const active = await this.pendingManager.hydrateFromSessionStorage();
                  sendResponse({ snapshot: active });
                  break;
                }

                case 'USER_CLICK_CONTINUE':
                  await this.handleUserContinue(message.requestId);
                  sendResponse({ success: true });
                  break;

                case 'USER_CLICK_REJECT':
                  await this.handleUserReject(message.requestId, message.reason);
                  sendResponse({ success: true });
                  break;

                default:
                  sendResponse({ success: false, error: 'Unknown message type' });
                  break;
              }
            }
          } catch (err) {
            console.error('[ServiceWorker] Error handling message:', err);
            sendResponse({ success: false, error: (err as Error).message });
          }
        })();

        return true; // Keep message channel open for async response
      }
    );
  }

  /**
   * Handles incoming validated messages from the content script.
   */
  private async handleRelayedPageMessage(
    payload: import('../shared/types').PageToExtensionMessage,
    tab?: chrome.tabs.Tab
  ): Promise<void> {
    switch (payload.type) {
      case 'INTERCEPTED_REQUEST':
        await this.handleInterceptedRequest(payload, tab);
        break;

      case 'ACCOUNT_CHANGED':
        await this.handleAccountChanged(payload.accounts, payload.origin, tab?.id);
        break;

      case 'CHAIN_CHANGED':
        await this.handleChainChanged(payload.chainId, payload.origin, tab?.id);
        break;

      case 'PROVIDER_DISCOVERED':
        console.log(
          `[ServiceWorker] Discovered provider: "${payload.name}" (ID: ${payload.providerId}, MetaMask: ${payload.isMetaMask})`
        );
        break;

      default:
        break;
    }
  }

  /**
   * Handles newly intercepted signing request from content script.
   */
  private async handleInterceptedRequest(
    payload: InterceptedRequestMessage,
    tab?: chrome.tabs.Tab
  ): Promise<void> {
    const snapshot: PendingRequestSnapshot = {
      requestId: payload.requestId,
      timestamp: Date.now(),
      origin: payload.origin ?? 'unknown',
      method: payload.method,
      rawParams: payload.params as unknown[],
      providerInfo: {
        name: payload.providerId ?? 'Wallet Provider',
      },
      status: 'INTERCEPTED',
      // Best-effort current chain/account context tracked by the page interceptor
      chainId: payload.chainId,
      account: payload.account,
      tabId: tab?.id,
    };

    // Open the request's row in the persistent log (fire-and-forget; see recordLog).
    this.recordLog({
      id: payload.requestId,
      timestamp: snapshot.timestamp,
      origin: snapshot.origin,
      method: snapshot.method,
      chainId: snapshot.chainId,
      account: snapshot.account,
      status: 'INTERCEPTED',
    });

    // 1. Ephemerally register the intercepted request in session storage
    if (!await this.pendingManager.registerRequest(snapshot)) {
      await this.relayToContentTab(tab?.id ?? null, {
        source: APPLICATION_NAMESPACE, direction: 'EXTENSION_TO_PAGE', type: 'USER_REJECT',
        requestId: payload.requestId, reason: 'Finish the current Cognitia review before starting another request.',
      });
      return;
    }

    // Keep review docked in the browser. If the user gesture has expired,
    // the toolbar badge directs the user to open the existing side panel.
    if (tab?.id && chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
      } catch {
        // Clicking the extension toolbar icon opens the panel with a fresh gesture.
      }
    }

    // 3. Transition to ANALYZING and notify page & side panel
    await this.pendingManager.setAnalyzing(payload.requestId);
    this.recordLog({ id: payload.requestId, status: 'ANALYZING' });
    this.broadcastStatus(payload.requestId, 'ANALYZING');

    await this.relayToContentTab(tab?.id ?? null, {
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'ANALYSIS_STARTED',
      requestId: payload.requestId,
    });

    // 4. Dispatch to /v1/analyze backend via the real shared API contract
    await this.endpointReady;
    const outcome = await this.analyzer.analyze(snapshot);

    if (outcome.kind === 'unavailable') {
      // Timeout, HTTP/network failure, malformed response, or a backend-reported
      // "failed" analysis: never interpreted as safe — surface the existing
      // non-bypassable "Analysis unavailable" flow.
      this.recordLog({
        id: payload.requestId,
        status: 'ANALYSIS_UNAVAILABLE',
        error: outcome.reason,
        durationMs: Date.now() - snapshot.timestamp,
      });

      const updated = await this.pendingManager.setAnalysisUnavailable(payload.requestId, outcome.reason);
      if (updated) {
        this.broadcastStatus(payload.requestId, 'ANALYSIS_UNAVAILABLE', undefined, outcome.reason);

        await this.relayToContentTab(tab?.id ?? this.activeTabId, {
          source: APPLICATION_NAMESPACE,
          direction: 'EXTENSION_TO_PAGE',
          type: 'ANALYSIS_UNAVAILABLE',
          requestId: payload.requestId,
          reason: outcome.reason,
        });
      }
      return;
    }

    // Contract-valid report: enter the existing ANALYSIS_READY lifecycle unchanged
    const analysisResult = outcome.analysis;

    this.recordLog({
      id: payload.requestId,
      status: 'ANALYSIS_READY',
      severity: analysisResult.severity,
      summary: analysisResult.summary,
      durationMs: Date.now() - snapshot.timestamp,
    });

    const updated = await this.pendingManager.setAnalysisReady(payload.requestId, analysisResult);
    if (updated) {
      this.broadcastStatus(payload.requestId, 'ANALYSIS_READY', analysisResult);

      // Notify page context of analysis completion
      await this.relayToContentTab(tab?.id ?? null, {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'ANALYSIS_RESULT',
        requestId: payload.requestId,
        severity: analysisResult.severity,
        riskScore: coarseRiskScore(outcome.report),
        summary: analysisResult.summary,
        findings: analysisResult.findings,
      });
    }
  }

  /**
   * Handles account changes from the page.
   */
  private async handleAccountChanged(_accounts: readonly string[], origin?: string, tabId?: number): Promise<void> {
    const active = this.pendingManager.getActiveRequest();
    if (!active || active.tabId !== tabId) return;

    const marked = await this.pendingManager.markStale(origin);
    if (marked) {
      // Explicit invalidation: re-enables a fresh analysis request for this requestId
      // should the intercepted call be retried under the new account context.
      this.analyzer.invalidateAnalysis(active.requestId);

      this.recordLog({
        id: active.requestId,
        status: 'STALE',
        decision: 'stale',
        error: 'Active request invalidated: account switched.',
        durationMs: Date.now() - active.timestamp,
      });

      this.broadcastStatus(active.requestId, 'STALE', undefined, 'Active request invalidated: account switched.');

      await this.relayToContentTab(active.tabId ?? null, {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'INVALIDATE_REQUEST',
        requestId: active.requestId,
        reason: 'Account switched during transaction review',
      });
    }
  }

  /**
   * Handles chain changes from the page.
   */
  private async handleChainChanged(_chainId: string, origin?: string, tabId?: number): Promise<void> {
    const active = this.pendingManager.getActiveRequest();
    if (!active || active.tabId !== tabId) return;

    const marked = await this.pendingManager.markStale(origin);
    if (marked) {
      // Explicit invalidation: re-enables a fresh analysis request for this requestId
      // should the intercepted call be retried under the new chain context.
      this.analyzer.invalidateAnalysis(active.requestId);

      this.recordLog({
        id: active.requestId,
        status: 'STALE',
        decision: 'stale',
        error: 'Active request invalidated: chain switched.',
        durationMs: Date.now() - active.timestamp,
      });

      this.broadcastStatus(active.requestId, 'STALE', undefined, 'Active request invalidated: chain switched.');

      await this.relayToContentTab(active.tabId ?? null, {
        source: APPLICATION_NAMESPACE,
        direction: 'EXTENSION_TO_PAGE',
        type: 'INVALIDATE_REQUEST',
        requestId: active.requestId,
        reason: 'Chain switched during transaction review',
      });
    }
  }

  /**
   * User approved: Forward the request to the original wallet provider.
   */
  private async handleUserContinue(requestId: string): Promise<void> {
    // Re-hydrate in case the MV3 worker was restarted between analysis and the user's click.
    await this.pendingManager.hydrateFromSessionStorage();
    const snapshot = await this.pendingManager.beginForwarding(requestId);
    if (!snapshot) {
      console.warn('[ServiceWorker] Forwarding rejected: invalid state or duplicate action.');
      this.recordLog({
        id: requestId,
        status: 'FAILED',
        decision: 'failed',
        error: 'Could not forward to the wallet: request is no longer active.',
      });
      // Tell the side panel instead of leaving it on "Opening MetaMask..." forever.
      this.broadcastStatus(
        requestId,
        'FAILED',
        undefined,
        'Could not forward to the wallet: request is no longer active (already handled, stale, or expired). Retry from the dapp.'
      );
      return;
    }

    this.broadcastStatus(requestId, 'FORWARDING');

    // Send USER_CONTINUE to the tab that intercepted the request (activeTabId may point elsewhere)
    await this.relayToContentTab(snapshot.tabId ?? this.activeTabId, {
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'USER_CONTINUE',
      requestId,
    });

    // Mark completed once forwarded
    await this.pendingManager.complete(requestId);
    this.recordLog({
      id: requestId,
      status: 'COMPLETED',
      decision: 'forwarded',
      durationMs: Date.now() - snapshot.timestamp,
    });
    this.broadcastStatus(requestId, 'COMPLETED');
  }

  /**
   * User rejected: Reject with EIP-1193 code 4001 without calling the original provider.
   */
  private async handleUserReject(requestId: string, reason?: string): Promise<void> {
    await this.pendingManager.hydrateFromSessionStorage();
    const snapshot = await this.pendingManager.markRejected(requestId, reason);
    if (!snapshot) {
      console.warn('[ServiceWorker] Rejection ignored: request already finalized.');
      return;
    }

    this.recordLog({
      id: requestId,
      status: 'REJECTED',
      decision: 'rejected',
      error: reason,
      durationMs: Date.now() - snapshot.timestamp,
    });

    this.broadcastStatus(requestId, 'REJECTED', undefined, reason);

    // Send USER_REJECT to the tab that intercepted the request
    await this.relayToContentTab(snapshot.tabId ?? this.activeTabId, {
      source: APPLICATION_NAMESPACE,
      direction: 'EXTENSION_TO_PAGE',
      type: 'USER_REJECT',
      requestId,
      reason,
    });
  }

  /**
   * Writes one row of the persistent request log.
   *
   * Deliberately synchronous and fire-and-forget: it must never block, reorder or
   * fail any part of the intercept/analyse/decide flow. appendLog already swallows
   * its own errors; the extra guards here make that contract explicit.
   */
  private recordLog(patch: RequestLogPatch): void {
    try {
      void appendLog(patch)
        .then(() => {
          const message: BackgroundToSidepanelMessage = { type: 'LOG_UPDATED', entryId: patch.id };
          chrome.runtime.sendMessage(message).catch(() => {
            // Side panel may not be open; the row is already persisted.
          });
        })
        .catch(() => {
          // Logging is best-effort.
        });
    } catch {
      // Logging is best-effort.
    }
  }

  /**
   * Safely relays a validated extension message to the Content Script.
   */
  private async relayToContentTab(tabId: number | null, payload: ExtensionToPageMessage): Promise<void> {
    if (!tabId) return;

    const message: BackgroundToContentMessage = {
      source: APPLICATION_NAMESPACE,
      type: 'BACKGROUND_RELAY_TO_PAGE',
      payload,
    };

    await chrome.tabs.sendMessage(tabId, message).catch((err) => {
      console.warn('[ServiceWorker] Could not message tab:', err);
    });
  }

  /**
   * Broadcasts status updates to open Side Panel instances.
   */
  private broadcastStatus(
    requestId: string,
    status: RequestStatus,
    analysis?: AnalysisResult,
    error?: string
  ): void {
    const waiting = ['INTERCEPTED', 'ANALYZING', 'ANALYSIS_READY', 'ANALYSIS_UNAVAILABLE', 'STALE'].includes(status);
    chrome.action.setBadgeText({ text: waiting ? '!' : '' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#a84a0c' }).catch(() => {});
    chrome.action.setTitle({ title: waiting ? 'Cognitia: request held. Click to review in the side panel.' : 'Open Cognitia side panel' }).catch(() => {});
    const message: BackgroundToSidepanelMessage = {
      type: 'REQUEST_STATUS_UPDATED',
      requestId,
      status,
      analysis,
      error,
    };
    chrome.runtime.sendMessage(message).catch(() => {
      // Sidepanel may not be open yet; state is persisted in chrome.storage.session
    });
  }
}

// Initialize coordinator in background service worker
new BackgroundCoordinator();

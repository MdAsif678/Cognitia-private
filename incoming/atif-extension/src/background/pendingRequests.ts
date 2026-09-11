import { PendingRequestSnapshot, AnalysisResult } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';

/**
 * Manages the state machine and ephemeral persistence for intercepted pending requests.
 * Uses chrome.storage.session so state survives service worker termination without permanent retention.
 */
export class PendingRequestManager {
  private activeRequest: PendingRequestSnapshot | null = null;
  private actionLock = false;

  constructor() {
    this.hydrateFromSessionStorage();
  }

  /**
   * Restores active pending request from chrome.storage.session on service worker wake-up.
   */
  public async hydrateFromSessionStorage(): Promise<PendingRequestSnapshot | null> {
    try {
      const data = await chrome.storage.session.get(STORAGE_KEYS.CURRENT_PENDING_REQUEST);
      this.activeRequest = data[STORAGE_KEYS.CURRENT_PENDING_REQUEST] ?? null;
      return this.activeRequest;
    } catch {
      return null;
    }
  }

  public getActiveRequest(): PendingRequestSnapshot | null {
    return this.activeRequest;
  }

  /**
   * Registers a new intercepted request, transitioning to INTERCEPTED state.
   */
  public async registerRequest(snapshot: PendingRequestSnapshot): Promise<void> {
    this.activeRequest = {
      ...snapshot,
      status: 'INTERCEPTED',
    };
    await this.persist();
  }

  /**
   * Transitions request state to ANALYZING.
   */
  public async setAnalyzing(requestId: string): Promise<boolean> {
    if (!this.matchesActive(requestId)) return false;
    this.activeRequest!.status = 'ANALYZING';
    await this.persist();
    return true;
  }

  /**
   * Transitions to ANALYSIS_READY when backend returns findings.
   */
  public async setAnalysisReady(requestId: string, analysis: AnalysisResult): Promise<boolean> {
    if (!this.matchesActive(requestId)) return false;

    // Guard: Do not overwrite if request became STALE while analysis was running
    if (this.activeRequest!.status === 'STALE') {
      return false;
    }

    this.activeRequest!.status = 'ANALYSIS_READY';
    this.activeRequest!.analysis = analysis;
    await this.persist();
    return true;
  }

  /**
   * Transitions to ANALYSIS_UNAVAILABLE if backend analysis fails or times out.
   */
  public async setAnalysisUnavailable(requestId: string, errorMsg: string): Promise<boolean> {
    if (!this.matchesActive(requestId)) return false;

    if (this.activeRequest!.status === 'STALE') {
      return false;
    }

    this.activeRequest!.status = 'ANALYSIS_UNAVAILABLE';
    this.activeRequest!.error = errorMsg;
    await this.persist();
    return true;
  }

  /**
   * Transitions request to STALE when an account or chain change is detected.
   */
  public async markStale(origin?: string): Promise<boolean> {
    if (!this.activeRequest) return false;

    // If an active request matches the origin (or origin unspecified), invalidate it
    if (!origin || this.activeRequest.origin === origin) {
      if (this.activeRequest.status !== 'COMPLETED' && this.activeRequest.status !== 'REJECTED') {
        this.activeRequest.status = 'STALE';
        this.activeRequest.error = 'Account or Chain switched. Previous analysis is now invalid.';
        await this.persist();
        return true;
      }
    }
    return false;
  }

  /**
   * Acquires action lock and transitions to FORWARDING.
   * Guarantees that Continue can be executed AT MOST ONCE.
   */
  public async beginForwarding(requestId: string): Promise<PendingRequestSnapshot | null> {
    if (this.actionLock) return null;
    if (!this.matchesActive(requestId)) return null;

    // Forward only from ANALYSIS_READY, or from ANALYSIS_UNAVAILABLE after the user's explicit
    // acknowledgement in the side panel (state machine: ANALYSIS_UNAVAILABLE -> FORWARDING).
    const st = this.activeRequest!.status;
    if (st !== 'ANALYSIS_READY' && st !== 'ANALYSIS_UNAVAILABLE') {
      return null;
    }

    this.actionLock = true;
    try {
      this.activeRequest!.status = 'FORWARDING';
      this.activeRequest!.forwardedAt = Date.now();
      await this.persist();
      return this.activeRequest;
    } finally {
      this.actionLock = false;
    }
  }

  /**
   * Acquires action lock and transitions to REJECTED.
   * Guarantees that Reject can be executed AT MOST ONCE.
   */
  public async markRejected(requestId: string, reason?: string): Promise<PendingRequestSnapshot | null> {
    if (this.actionLock) return null;
    if (!this.matchesActive(requestId)) return null;

    if (this.activeRequest!.status === 'REJECTED' || this.activeRequest!.status === 'FORWARDING') {
      return null;
    }

    this.actionLock = true;
    try {
      this.activeRequest!.status = 'REJECTED';
      this.activeRequest!.error = reason ?? 'User rejected request';
      this.activeRequest!.resolvedAt = Date.now();
      await this.persist();
      const finalSnapshot = this.activeRequest;
      // Ephemeral: clear active request from storage once finalized
      await this.clear();
      return finalSnapshot;
    } finally {
      this.actionLock = false;
    }
  }

  public async complete(requestId: string): Promise<void> {
    if (this.matchesActive(requestId)) {
      this.activeRequest!.status = 'COMPLETED';
      await this.clear();
    }
  }

  private matchesActive(requestId: string): boolean {
    return this.activeRequest !== null && this.activeRequest.requestId === requestId;
  }

  private async persist(): Promise<void> {
    if (this.activeRequest) {
      await chrome.storage.session.set({
        [STORAGE_KEYS.CURRENT_PENDING_REQUEST]: this.activeRequest,
      });
    }
  }

  public async clear(): Promise<void> {
    this.activeRequest = null;
    await chrome.storage.session.remove(STORAGE_KEYS.CURRENT_PENDING_REQUEST);
  }
}

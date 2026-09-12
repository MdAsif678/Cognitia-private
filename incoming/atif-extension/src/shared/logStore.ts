import { RequestLogEntry, RequestLogPatch, RequestStatus } from './types';

/**
 * The persistent, user-viewable request log.
 *
 * An append-only ring buffer of at most MAX_LOG_ENTRIES rows kept under a single
 * chrome.storage.local key. Each intercepted request owns exactly one row, keyed by
 * its requestId, which is rewritten in place as the request moves through its
 * lifecycle (intercepted -> analysed -> decided).
 *
 * Every entry point is total: chrome.storage is unavailable in the dev galleries and
 * in server-side test rendering, and a storage failure must never break the request
 * flow, so all functions degrade to an in-memory array and never reject.
 */

/** Single chrome.storage.local key holding the whole ring buffer. */
export const LOG_STORAGE_KEY = 'cognitia.requestLog.v1';

/** Oldest rows beyond this cap are dropped. */
export const MAX_LOG_ENTRIES = 200;

/** Fallback store, and the read-through cache when chrome.storage is present. */
let memoryLog: RequestLogEntry[] = [];

type StorageAreaLike = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

/**
 * Resolves chrome.storage.local when it exists, otherwise null.
 * Property access itself can throw in hardened/SSR contexts, hence the try/catch.
 */
function storageArea(): StorageAreaLike | null {
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      return chrome.storage.local as unknown as StorageAreaLike;
    }
  } catch {
    /* no extension storage in this context */
  }
  return null;
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Keeps rows small and JSON-serialisable; drops anything unexpected. */
function normalise(entry: RequestLogEntry): RequestLogEntry {
  const next: RequestLogEntry = {
    id: String(entry.id),
    timestamp: Number.isFinite(entry.timestamp) ? Number(entry.timestamp) : Date.now(),
    origin: clampText(entry.origin, 200) ?? 'unknown',
    method: clampText(entry.method, 80) ?? 'unknown',
    status: entry.status,
  };
  const chainId = clampText(entry.chainId, 32);
  if (chainId) next.chainId = chainId;
  const account = clampText(entry.account, 64);
  if (account) next.account = account;
  if (entry.severity) next.severity = entry.severity;
  const summary = clampText(entry.summary, 300);
  if (summary) next.summary = summary;
  if (entry.decision) next.decision = entry.decision;
  if (typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs)) {
    next.durationMs = Math.max(0, Math.round(entry.durationMs));
  }
  const error = clampText(entry.error, 300);
  if (error) next.error = error;
  return next;
}

function isEntry(value: unknown): value is RequestLogEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RequestLogEntry).id === 'string' &&
    typeof (value as RequestLogEntry).timestamp === 'number'
  );
}

/** Drops keys explicitly set to undefined so a patch never erases known fields. */
function definedFields(patch: RequestLogPatch): Partial<RequestLogEntry> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<RequestLogEntry>;
}

/**
 * Reads the log newest-last. Never throws; returns the in-memory fallback when
 * chrome.storage is unavailable or unreadable.
 */
export async function readLog(): Promise<RequestLogEntry[]> {
  const area = storageArea();
  if (!area) return memoryLog.slice();
  try {
    const data = await area.get(LOG_STORAGE_KEY);
    const raw = data?.[LOG_STORAGE_KEY];
    if (Array.isArray(raw)) {
      memoryLog = raw.filter(isEntry).slice(-MAX_LOG_ENTRIES);
    }
    return memoryLog.slice();
  } catch {
    return memoryLog.slice();
  }
}

/**
 * Creates the row for `patch.id`, or merges the patch into the existing row.
 * Fire-and-forget by design: resolves even when persistence fails.
 */
export async function appendLog(patch: RequestLogPatch): Promise<void> {
  try {
    if (!patch || typeof patch.id !== 'string' || !patch.id) return;
    const entries = await readLog();
    const fields = definedFields(patch);
    const index = entries.findIndex((entry) => entry.id === patch.id);

    if (index >= 0) {
      entries[index] = normalise({ ...entries[index], ...fields } as RequestLogEntry);
    } else {
      const seed: RequestLogEntry = {
        id: patch.id,
        timestamp: Date.now(),
        origin: 'unknown',
        method: 'unknown',
        status: 'INTERCEPTED' as RequestStatus,
      };
      entries.push(normalise({ ...seed, ...fields } as RequestLogEntry));
      while (entries.length > MAX_LOG_ENTRIES) entries.shift();
    }

    memoryLog = entries;
    const area = storageArea();
    if (area) await area.set({ [LOG_STORAGE_KEY]: entries });
  } catch {
    /* a logging failure must never break the request flow */
  }
}

/** Empties the log in storage and in memory. Never throws. */
export async function clearLog(): Promise<void> {
  memoryLog = [];
  const area = storageArea();
  if (!area) return;
  try {
    await area.remove(LOG_STORAGE_KEY);
  } catch {
    try {
      await area.set({ [LOG_STORAGE_KEY]: [] });
    } catch {
      /* nothing further to try */
    }
  }
}

function isoOrUnknown(timestamp: number): string {
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return 'unknown-time';
  }
}

/**
 * Renders the log as the plain text the Copy and Download controls hand the user.
 * Newest first, one block per request.
 */
export function formatLogAsText(entries: readonly RequestLogEntry[]): string {
  const exportedAt = isoOrUnknown(Date.now());
  const header = [
    'Cognitia interceptor request log',
    `Exported: ${exportedAt}`,
    `Entries:  ${entries.length}`,
    '',
  ];

  if (entries.length === 0) {
    return [...header, 'No requests have been intercepted yet.', ''].join('\n');
  }

  const body = entries
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((entry) => {
      const lines: string[] = [];
      lines.push(`${isoOrUnknown(entry.timestamp)}  ${entry.method}`);
      lines.push(`  origin:   ${entry.origin}`);
      lines.push(`  status:   ${entry.status}${entry.decision ? `  (${entry.decision})` : ''}`);
      if (entry.severity) lines.push(`  severity: ${entry.severity}`);
      if (entry.chainId) lines.push(`  chain:    ${entry.chainId}`);
      if (entry.account) lines.push(`  account:  ${entry.account}`);
      if (typeof entry.durationMs === 'number') lines.push(`  duration: ${entry.durationMs} ms`);
      if (entry.summary) lines.push(`  summary:  ${entry.summary}`);
      if (entry.error) lines.push(`  note:     ${entry.error}`);
      lines.push(`  id:       ${entry.id}`);
      return lines.join('\n');
    })
    .join('\n\n');

  return [...header, body, ''].join('\n');
}

/**
 * Notifies `listener` whenever the log changes in chrome.storage.local.
 * Returns an unsubscribe function; a no-op where storage events are unavailable.
 */
export function subscribeLog(listener: () => void): () => void {
  try {
    const onChanged = typeof chrome !== 'undefined' ? chrome?.storage?.onChanged : undefined;
    if (!onChanged || typeof onChanged.addListener !== 'function') return () => {};
    const handler = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'local' && changes && LOG_STORAGE_KEY in changes) listener();
    };
    onChanged.addListener(handler);
    return () => {
      try {
        onChanged.removeListener(handler);
      } catch {
        /* already torn down */
      }
    };
  } catch {
    return () => {};
  }
}

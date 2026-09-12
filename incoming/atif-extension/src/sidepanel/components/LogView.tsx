import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackgroundToSidepanelMessage, RequestLogEntry, RiskSeverity } from '../../shared/types';
import { readLog, clearLog, formatLogAsText, subscribeLog } from '../../shared/logStore';
import { Icon } from './Icon';

/**
 * The persistent request log, shown in place of the live report when the user
 * toggles it from the top bar. Rows are newest first and separated by hairlines,
 * matching the report's key/value rhythm rather than introducing cards.
 */

/** Maps the backend's severity vocabulary onto the stylesheet's five severity tokens. */
const SEVERITY_KEY: Record<RiskSeverity, string> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  SAFE: 'low',
  UNKNOWN: 'unknown',
};

function severityKey(severity?: RiskSeverity): string {
  if (!severity) return 'unknown';
  return SEVERITY_KEY[severity] ?? 'unknown';
}

/** Compact, sortable, locale-independent stamp: "09-12 14:03:22". */
function formatStamp(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}:${pad(date.getSeconds())}`;
  } catch {
    return '---- --:--:--';
  }
}

/** The word shown in the outcome column; falls back to the lifecycle status. */
function outcomeLabel(entry: RequestLogEntry): string {
  if (entry.decision) return entry.decision;
  if (entry.status === 'ANALYSIS_UNAVAILABLE') return 'unavailable';
  if (entry.status === 'ANALYSIS_READY') return 'awaiting you';
  if (entry.status === 'ANALYZING' || entry.status === 'INTERCEPTED') return 'in review';
  return entry.status.toLowerCase().replace(/_/g, ' ');
}

export const LogView: React.FC = () => {
  const [entries, setEntries] = useState<RequestLogEntry[]>([]);
  const [notice, setNotice] = useState<string>('');

  const load = useCallback(() => {
    // readLog never rejects; the catch is belt and braces for exotic contexts.
    readLog()
      .then((rows) => setEntries(rows))
      .catch(() => setEntries([]));
  }, []);

  useEffect(() => {
    load();

    // Live refresh: storage events cover writes from the service worker, and the
    // LOG_UPDATED broadcast covers contexts where storage events are throttled.
    const unsubscribeStorage = subscribeLog(load);
    let unsubscribeRuntime = () => {};
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        const listener = (message: BackgroundToSidepanelMessage) => {
          if (message?.type === 'LOG_UPDATED') load();
        };
        chrome.runtime.onMessage.addListener(listener);
        unsubscribeRuntime = () => {
          try {
            chrome.runtime.onMessage.removeListener(listener);
          } catch {
            /* already torn down */
          }
        };
      }
    } catch {
      /* no extension runtime in this context */
    }

    return () => {
      unsubscribeStorage();
      unsubscribeRuntime();
    };
  }, [load]);

  const rows = useMemo(
    () => entries.slice().sort((a, b) => b.timestamp - a.timestamp),
    [entries]
  );

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => setNotice(''), 1800);
    }
  }, []);

  const handleCopy = useCallback(async () => {
    const text = formatLogAsText(rows);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flash('Log copied to the clipboard.');
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      // Fallback for contexts without the async clipboard API.
      try {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', 'true');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
        flash('Log copied to the clipboard.');
      } catch {
        flash('Could not copy the log.');
      }
    }
  }, [rows, flash]);

  const handleDownload = useCallback(() => {
    try {
      const blob = new Blob([formatLogAsText(rows)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `cognitia-log-${Date.now()}.txt`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      flash('Log saved as a text file.');
    } catch {
      flash('Could not save the log.');
    }
  }, [rows, flash]);

  const handleClear = useCallback(async () => {
    try {
      await clearLog();
    } finally {
      setEntries([]);
      flash('Log cleared.');
    }
  }, [flash]);

  return (
    <section className="log enter" aria-labelledby="log-heading">
      <header className="log-head">
        <h2 className="log-title" id="log-heading">
          Request log
        </h2>
        <p className="log-sub">
          Every request this extension held, what the analysis said, and what you decided. Kept on this
          device only{rows.length > 0 ? `, newest first, ${rows.length === 1 ? '1 request' : `${rows.length} requests`}` : ''}.
        </p>
        <div className="log-actions">
          <button type="button" className="btn btn-primary" onClick={handleDownload} disabled={rows.length === 0}>
            Download
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleCopy} disabled={rows.length === 0}>
            Copy
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleClear} disabled={rows.length === 0}>
            Clear
          </button>
        </div>
        <p className="log-notice" role="status" aria-live="polite">
          {notice}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="log-empty">
          <Icon name="clock" size={18} />
          <div>
            <strong>Nothing recorded yet</strong>
            <p>
              The log fills in as requests are intercepted. Nothing leaves this browser, and you can clear it
              whenever you like.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="log-cols" aria-hidden="true">
            <span>Time</span>
            <span>Outcome</span>
          </div>
          <ol className="log-list">
            {rows.map((entry) => (
              <li key={entry.id} className="log-row" data-severity={severityKey(entry.severity)}>
                <div className="log-row-head">
                  <time className="log-time mono" dateTime={new Date(entry.timestamp).toISOString()}>
                    {formatStamp(entry.timestamp)}
                  </time>
                  <span className="log-decision mono" data-decision={entry.decision ?? 'pending'}>
                    {outcomeLabel(entry)}
                  </span>
                </div>
                <div className="log-origin">{entry.origin}</div>
                <div className="log-row-foot">
                  <span className="log-method mono">{entry.method}</span>
                  <span className="log-sev mono">{severityKey(entry.severity)}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
};

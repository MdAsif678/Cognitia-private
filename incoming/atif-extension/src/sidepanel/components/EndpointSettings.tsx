import React, { useCallback, useEffect, useState } from 'react';
import {
  getApiBaseUrlOverride,
  getBuiltInApiBaseUrl,
  normalizeApiBaseUrl,
  originMatchPattern,
  setApiBaseUrlOverride,
} from '../../shared/apiEndpoint';
import { Icon } from './Icon';

/**
 * Repoints the extension at a different analysis backend without a rebuild.
 *
 * The demo API is published through a quick tunnel whose hostname changes on every restart;
 * the build bakes one hostname in. This screen is the recovery path when that happens.
 *
 * Saving also requests host permission for the new origin, because the manifest only grants the
 * hostname known at build time. chrome.permissions.request must run in the click handler's user
 * gesture, so the request is issued directly from the submit handler.
 */

type Feedback = { tone: 'success' | 'danger'; message: string } | null;

export const EndpointSettings: React.FC = () => {
  const builtIn = getBuiltInApiBaseUrl();
  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<'idle' | 'checking' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    let cancelled = false;
    getApiBaseUrlOverride().then((stored) => {
      if (cancelled) return;
      setCurrent(stored);
      setValue(stored ?? builtIn);
    });
    return () => {
      cancelled = true;
    };
  }, [builtIn]);

  const effective = current ?? builtIn;

  /** Confirms the endpoint is actually reachable, so a wrong URL is caught here and not mid-demo. */
  const checkReachable = useCallback(async (baseUrl: string) => {
    setProbe('checking');
    try {
      const response = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(20000) });
      setProbe(response.ok ? 'ok' : 'fail');
    } catch {
      setProbe('fail');
    }
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const normalized = normalizeApiBaseUrl(value);
    if ('error' in normalized) {
      setFeedback({ tone: 'danger', message: normalized.error });
      return;
    }

    setBusy(true);
    setFeedback(null);
    setProbe('idle');
    try {
      // Without host permission for the new origin the service worker's fetch is blocked.
      const pattern = originMatchPattern(normalized.url);
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        setFeedback({
          tone: 'danger',
          message: 'Permission for that host was declined, so the endpoint was not changed.',
        });
        return;
      }

      await setApiBaseUrlOverride(normalized.url === builtIn ? null : normalized.url);
      setCurrent(normalized.url === builtIn ? null : normalized.url);
      setValue(normalized.url);
      setFeedback({ tone: 'success', message: 'Endpoint saved. New requests will use it.' });
      await checkReachable(normalized.url);
    } catch (err) {
      setFeedback({
        tone: 'danger',
        message: err instanceof Error ? err.message : 'Could not save the endpoint.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setApiBaseUrlOverride(null);
      setCurrent(null);
      setValue(builtIn);
      setProbe('idle');
      setFeedback({ tone: 'success', message: 'Reverted to the endpoint built into this install.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screen enter endpoint">
      <h2 className="endpoint-title">Analysis endpoint</h2>
      <p className="notice-text">
        Where this extension sends requests for simulation. Change it if the backend moved — a
        restarted demo tunnel is given a new address each time.
      </p>

      <div className="callout" data-tone="info">
        <Icon name="info" size={16} />
        <div>
          <strong>In use now</strong>
          <span className="endpoint-current">{effective}</span>
          <span className="callout-h">{current ? 'Custom endpoint' : 'Built into this install'}</span>
        </div>
      </div>

      <form onSubmit={handleSave}>
        <label className="endpoint-label" htmlFor="endpoint-url">
          Backend URL
        </label>
        <input
          id="endpoint-url"
          className="endpoint-input"
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="https://example.trycloudflare.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />

        {feedback && (
          <div className="callout" data-tone={feedback.tone === 'success' ? 'success' : 'danger'}>
            <Icon name={feedback.tone === 'success' ? 'check' : 'alert'} size={16} />
            <div>
              <strong>{feedback.tone === 'success' ? 'Saved' : 'Not saved'}</strong>
              {feedback.message}
            </div>
          </div>
        )}

        {probe !== 'idle' && (
          <div className="callout" data-tone={probe === 'ok' ? 'success' : probe === 'fail' ? 'danger' : 'neutral'}>
            <Icon name={probe === 'ok' ? 'check' : probe === 'fail' ? 'alert' : 'clock'} size={16} />
            <div>
              <strong>Reachability</strong>
              {probe === 'checking' && 'Contacting the endpoint…'}
              {probe === 'ok' && 'The endpoint responded and is ready.'}
              {probe === 'fail' && 'The endpoint did not respond. Check that the backend is running.'}
            </div>
          </div>
        )}

        <div className="actions-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving' : 'Save endpoint'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleReset} disabled={busy || !current}>
            Use default
          </button>
        </div>
      </form>

      <p className="footnote">
        Analysis results are never cached across endpoints; changing this discards any report from the
        previous backend.
      </p>
    </section>
  );
};

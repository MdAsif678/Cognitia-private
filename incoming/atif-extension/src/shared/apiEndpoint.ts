/**
 * Runtime override for the analysis API base URL.
 *
 * The build bakes an API_BASE_URL into the bundle and derives `host_permissions` from it
 * (see build.mjs). That is correct for a fixed deployment, but the hackathon demo is published
 * through a cloudflared quick tunnel, which is handed a NEW hostname every time it restarts.
 * Without an override, a tunnel restart would mean rebuilding the extension and every installed
 * copy re-loading it. With one, the new URL is pasted into the side panel instead.
 *
 * The override lives in chrome.storage.local so it survives service-worker restarts. The baked
 * value remains the default, so a fresh install works with no configuration.
 */

import { API_CONFIG } from './config';

export const API_BASE_URL_OVERRIDE_KEY = 'cognitia_api_base_url_override';

export type NormalizedBaseUrl = { url: string } | { error: string };

/**
 * Validates and normalizes a user-entered base URL.
 *
 * Only an origin is accepted — a path would silently break the `/v1/analyze` join. Plain http is
 * allowed solely for loopback, because Chrome blocks insecure requests to any other host from an
 * extension and accepting one here would fail later with a far less obvious error.
 */
export function normalizeApiBaseUrl(raw: string): NormalizedBaseUrl {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) return { error: 'Enter an API URL.' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: 'Not a valid URL. Include https://' };
  }

  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    return { error: 'Must be https:// (http:// is only allowed for localhost).' };
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    return { error: 'Enter the origin only, with no path.' };
  }
  if (parsed.search || parsed.hash) {
    return { error: 'Enter the origin only, with no query or fragment.' };
  }

  return { url: `${parsed.protocol}//${parsed.host}` };
}

/** Chrome match pattern covering the origin, for chrome.permissions.request. */
export function originMatchPattern(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  // Chrome match patterns omit ports, matching how build.mjs derives host_permissions.
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

function storage(): chrome.storage.StorageArea | undefined {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
}

export async function getApiBaseUrlOverride(): Promise<string | null> {
  const area = storage();
  if (!area) return null;
  try {
    const stored = await area.get(API_BASE_URL_OVERRIDE_KEY);
    const value = stored?.[API_BASE_URL_OVERRIDE_KEY];
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Passing null clears the override, returning the extension to the baked build-time URL. */
export async function setApiBaseUrlOverride(url: string | null): Promise<void> {
  const area = storage();
  if (!area) return;
  if (url === null) {
    await area.remove(API_BASE_URL_OVERRIDE_KEY);
    return;
  }
  await area.set({ [API_BASE_URL_OVERRIDE_KEY]: url });
}

/** The URL analysis requests should actually be sent to: the override when set, else the build value. */
export async function getEffectiveApiBaseUrl(): Promise<string> {
  return (await getApiBaseUrlOverride()) ?? API_CONFIG.BASE_URL;
}

/** The build-time value, shown in the UI as the fallback and used to label "default". */
export function getBuiltInApiBaseUrl(): string {
  return API_CONFIG.BASE_URL;
}

/** Fires whenever the override changes, with the new effective URL. */
export function onApiBaseUrlChanged(listener: (effectiveUrl: string) => void): void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !(API_BASE_URL_OVERRIDE_KEY in changes)) return;
    const next = changes[API_BASE_URL_OVERRIDE_KEY]?.newValue;
    listener(typeof next === 'string' && next.length > 0 ? next : API_CONFIG.BASE_URL);
  });
}

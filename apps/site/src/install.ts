import './ui';
import { config, renderApiStatus } from './config';

void renderApiStatus();

const download = document.getElementById('download-zip') as HTMLAnchorElement;
const missing = document.getElementById('zip-missing')!;
const meta = document.getElementById('zip-meta')!;
const store = document.getElementById('store-link') as HTMLAnchorElement;

download.href = config.extensionZipUrl;
if (config.chromeWebStoreUrl) {
  store.href = config.chromeWebStoreUrl;
  store.hidden = false;
}
meta.textContent = config.apiBaseUrl
  ? `This build sends analysis requests to ${new URL(config.apiBaseUrl).host}.`
  : 'This build has no public analysis API configured yet. It will use http://localhost:8080.';

// The ZIP is produced by the publish workflow; say so plainly instead of serving a 404.
fetch(config.extensionZipUrl, { method: 'HEAD' })
  .then((res) => {
    if (res.ok) return;
    missing.hidden = false;
    download.setAttribute('aria-disabled', 'true');
    download.removeAttribute('href');
  })
  .catch(() => undefined);

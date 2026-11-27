/** Build-time site configuration. Edit apps/site/site.config.json or set SITE_* variables. */
export type DemoContracts = {
  testToken: string;
  testNFT: string;
  testERC1155: string;
  fakeRewardsDrainer: string;
  fakeNftRewards: string;
};

export type SiteConfig = {
  apiBaseUrl: string;
  repoUrl: string;
  extensionZipUrl: string;
  chromeWebStoreUrl: string;
  demoVideoUrl: string;
  demo: {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    explorerUrl: string;
    faucetUrl: string;
    attacker: string;
    contracts: DemoContracts;
  };
  /** Documented real attack transactions offered as one-click replays: { label, chainId, txHash, source }. */
  realAttackReplays: { label: string; chainId: number; txHash: string; source?: string }[];
};

declare const __SITE_CONFIG__: SiteConfig;
export const config: SiteConfig = __SITE_CONFIG__;

export const demoDeployed = Object.values(config.demo.contracts).every((a) => /^0x[0-9a-fA-F]{40}$/.test(a));

export async function apiStatus(): Promise<'unconfigured' | 'online' | 'offline'> {
  if (!config.apiBaseUrl) return 'unconfigured';
  try {
    const res = await fetch(`${config.apiBaseUrl}/ready`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

/** Fills every [data-api-status] element with the live API state. */
export async function renderApiStatus() {
  const nodes = document.querySelectorAll<HTMLElement>('[data-api-status]');
  if (!nodes.length) return;
  const status = await apiStatus();
  const text = { unconfigured: 'Analysis API not configured yet', online: 'Analysis API online', offline: 'Analysis API offline' }[status];
  nodes.forEach((n) => { n.dataset.state = status; n.textContent = text; });
}

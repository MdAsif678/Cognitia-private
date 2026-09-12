/** Real EIP-1193 wallet state; a rejected request never becomes a mock connection. */
export class WalletSession {
  constructor({ chainId, chainName, rpcUrl, onChange = () => {} }) {
    Object.assign(this, { chainId, chainName, rpcUrl, onChange });
    this.provider = null;
    this.account = null;
    this.chain = null;
    this.connecting = null;
    this.listeners = {
      accountsChanged: accounts => { this.account = accounts?.[0] ?? null; this.onChange(this); },
      chainChanged: chain => { this.chain = Number(chain); this.onChange(this); },
      disconnect: () => { this.account = null; this.chain = null; this.onChange(this); },
    };
  }
  use(provider) {
    if (this.provider === provider) return;
    if (this.provider) for (const [event, listener] of Object.entries(this.listeners)) this.provider.removeListener?.(event, listener);
    this.provider = provider;
    this.account = null;
    this.chain = null;
    if (provider) for (const [event, listener] of Object.entries(this.listeners)) provider.on?.(event, listener);
    this.onChange(this);
  }
  async refresh() {
    if (!this.provider) return;
    const provider = this.provider;
    const [accounts, chain] = await Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]);
    if (this.provider !== provider) throw new Error('Wallet changed. Retry with the selected wallet.');
    this.account = accounts?.[0] ?? null;
    this.chain = Number(chain);
    this.onChange(this);
  }
  connect() {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (!this.provider) throw new Error('No wallet found. Install or unlock MetaMask, then reload. You can also use read-only demo analysis.');
      const provider = this.provider;
      try {
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        if (this.provider !== provider) throw new Error('Wallet changed while connecting.');
        if (!accounts?.[0]) throw new Error('Wallet did not authorize an account.');
        this.account = accounts[0];
        this.chain = Number(await provider.request({ method: 'eth_chainId' }));
        this.onChange(this);
        return this.account;
      } catch (error) {
        this.account = null;
        this.onChange(this);
        throw error;
      }
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async ensureLocal() {
    if (!this.account) await this.connect();
    await this.refresh();
    if (!this.account) throw new Error('Wallet is locked or disconnected. Connect again.');
    if (this.chain !== this.chainId) {
      const chainId = `0x${this.chainId.toString(16)}`;
      try {
        await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      } catch (error) {
        if (error.code !== 4902 && error.data?.originalError?.code !== 4902) throw error;
        await this.provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: this.chainName, rpcUrls: [this.rpcUrl], nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 } }] });
        await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      }
      await this.refresh();
    }
    if (this.chain !== this.chainId) throw new Error('Wrong network. Demo requests are restricted to local chain 31337.');
    return this.account;
  }
}

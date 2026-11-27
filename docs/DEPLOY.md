# Going live: step-by-step

Everything here is free and needs no credit card. At the end you have:

- the website on GitHub Pages (landing, install, playground, live demo),
- the analysis API on Render's free plan, deployed by GitHub Actions,
- the demo drainer contracts on Sepolia, deployed by GitHub Actions,
- a downloadable extension that talks to your live API.

You need: the GitHub repository and a fresh MetaMask account for Sepolia. Nothing secret is ever
committed; keys live only in GitHub's encrypted secrets.

> **Make the repository public** if you can. GitHub Pages and the "keep awake" ping are free on
> public repositories. On a private one, Pages needs GitHub Pro (free with the Student Pack) and
> the ping must run elsewhere (step 6).

---

## 0. Merge into `main`

Render and the workflows deploy from `main`. Merge the `feature/public-site` branch first
(open a pull request on GitHub and merge it).

## 1. Put the API on Render (free)

The API forks Ethereum inside its container with Anvil. Measured: about 150 MB of RAM and 0.6
CPU-seconds per mainnet analysis, so Render's free instance (512 MB, 0.1 CPU) runs it. A report
takes about 20–30 seconds there.

1. Go to **render.com → Get Started** and sign up **with GitHub**.
2. **New → Blueprint.** Connect GitHub and give Render access to this repository.
3. Pick the repository and branch **main**. Render reads `render.yaml` and shows one service,
   **cognitia-api** (Free). Click **Apply / Deploy Blueprint**.
4. The first build takes 5–10 minutes. When it says **Live**, copy the service URL at the top,
   for example `https://cognitia-api.onrender.com` (Render may add a suffix if the name is taken).
   Open `<that URL>/ready` in a browser: it should show `"ready":true`.

## 2. Put the settings into GitHub

Repository → **Settings**:

**Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Value |
|---|---|
| `ANALYSIS_API_URL` | the service URL from step 1.4, without a trailing `/` |
| `SITE_REPO_URL` | optional: link shown in the footer |

**Pages → Build and deployment → Source: GitHub Actions.**

## 3. Sepolia demo contracts

1. In MetaMask create a **new account used only for deploying** (never one with real funds).
2. Get free Sepolia ETH for it from a faucet (for example the Google Cloud Web3 faucet). 0.05 ETH is plenty.
3. Export that account's private key (MetaMask → account menu → Account details → Show private key).
4. GitHub → Settings → **Environments → New environment → `sepolia`**, secrets:

| Secret | Value |
|---|---|
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `SEPOLIA_DEPLOYER_KEY` | the private key from step 3 |
| `ETHERSCAN_API_KEY` | optional: from etherscan.io → API keys, to publish the contract sources |

Optional repository variable `SEPOLIA_ATTACKER_ADDRESS`: where the demo drainers send stolen test
tokens. Use another address of yours.

## 4. Run the workflows (Actions tab)

1. **Deploy demo contracts to Sepolia → Run workflow.** It deploys the contracts, commits their
   addresses to `incoming/ps2-project/deployments/sepolia.json`, and republishes the site.
2. **Publish site → Run workflow** (if it hasn't run already). Its summary shows the site URL
   (`https://<user>.github.io/<repo>/`).

From now on every push to `main` runs **MVP checks** in GitHub Actions. Render deploys that commit
only after the checks pass (`autoDeployTrigger: checksPass` in `render.yaml`), and **Deploy
analysis API to Render** waits for the new API and republishes the site.

## 5. Check it

- Open the site. The footer should say **Analysis API online**.
- **Playground:** run "Unlimited USDC approval to Inferno Drainer". It should come back Critical.
- **Install:** download the ZIP, load it in Chrome as described on the page.
- **Live demo:** switch MetaMask to Sepolia with a test account that has some Sepolia ETH,
  mint test assets, then try "NFT holder rewards". Cognitia should stop both steps before MetaMask opens.

## 6. Keep the API awake

Render's free instance sleeps after 15 minutes without traffic; the first request after that waits
about a minute.

Create a free job at **cron-job.org** (no card) that requests `<ANALYSIS_API_URL>/health` every
10 minutes. **UptimeRobot** works too.

The **Keep analysis API awake** workflow is only a backup: GitHub runs scheduled workflows late
when it is busy (observed gaps of 5–10 hours instead of 10 minutes), so it cannot keep the
instance awake on its own. It runs on public repositories only.

750 free instance hours a month cover one service running all month.

---

## Alternative: your own Linux server

If you get a VM (Azure, Oracle, any VPS: Ubuntu x86-64, 2 GB RAM or more), the **Deploy analysis
API** workflow ships the same image there behind Caddy with automatic HTTPS:

1. Copy `deploy/bootstrap.sh` to the VM and run `bash bootstrap.sh <api-hostname>`. It installs
   Docker, adds swap on small machines, and writes `/opt/cognitia/.env`.
2. Make a separate SSH key for GitHub Actions and add its public half to the VM's
   `~/.ssh/authorized_keys`; get the host key with `ssh-keyscan -t ed25519 <api-hostname>`.
3. In a `production` environment set secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
   (the private key), `DEPLOY_KNOWN_HOSTS` (the ssh-keyscan line), and set `ANALYSIS_API_URL`
   to `https://<api-hostname>`.
4. Run **Deploy analysis API**.

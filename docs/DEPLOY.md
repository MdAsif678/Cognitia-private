# Going live: step-by-step

This takes about an hour the first time. At the end you have:

- the website on GitHub Pages (landing, install, playground, live demo),
- the analysis API on a small Linux server, deployed by GitHub Actions,
- the demo drainer contracts on Sepolia, deployed by GitHub Actions,
- a downloadable extension that talks to your live API.

You need: the GitHub repository, a university email (for free Azure credit) or any other way to rent
a small Linux server, and a fresh MetaMask account for Sepolia. Commands below are for Windows
PowerShell; macOS and Linux are the same.

---

## 1. Get a server for the API

The API forks Ethereum inside the server with Anvil, so it needs a real machine (Vercel or other
serverless hosts can't run it, and free container tiers are too small). Any **Ubuntu x86-64 VM with
at least 2 GB of RAM** works. The cheapest routes:

| Option | Cost | Notes |
|---|---|---|
| **Azure for Students** (recommended) | Free credit, no credit card | Needs a university email. Credit covers a small VM for months. |
| GitHub Student Developer Pack → DigitalOcean / Azure | Free credit | Same steps, different dashboard. |
| Any VPS (Hetzner, DigitalOcean, Vultr…) | about $5–7 per month | Pick Ubuntu, x86, 2 GB RAM or more. |

> Pick an **x86-64 (Intel/AMD)** size, not ARM. The container image is built for x86.

### Create the VM on Azure (portal.azure.com)

1. Sign up at **azure.microsoft.com/free/students** with your university email.
2. **Create a resource → Virtual machine**:
   - Image: **Ubuntu Server 24.04 LTS – x64 Gen2**
   - Size: **B2s** (2 vCPU, 4 GB) is comfortable; **B1ms** (1 vCPU, 2 GB) also works with the swap the setup script adds.
   - Authentication: **SSH public key**, username `cognitia`, *Generate new key pair*. Download the `.pem` file when asked and keep it safe: it's your login.
   - Inbound ports: allow **SSH (22), HTTP (80), HTTPS (443)**.
3. When it's created, open the VM → **Overview → DNS name → Not configured**. Set a label such as
   `cognitia-api` and save. Your API hostname is now something like
   `cognitia-api.centralindia.cloudapp.azure.com`. You don't need to buy a domain: HTTPS
   certificates are issued for this name automatically.

From here on, `API_HOST` means that hostname.

## 2. Prepare the server (once)

In PowerShell, from the repository folder:

```powershell
$API_HOST = "cognitia-api.centralindia.cloudapp.azure.com"   # your hostname
$PEM = "$HOME\Downloads\cognitia-vm_key.pem"                   # the key Azure gave you
scp -i $PEM deploy/bootstrap.sh "cognitia@${API_HOST}:"
ssh -i $PEM "cognitia@$API_HOST" "bash bootstrap.sh $API_HOST"
```

The script installs Docker, adds swap on small machines, and writes `/opt/cognitia/.env` (no keys
needed: it uses public Ethereum RPCs).

### A separate key for GitHub Actions

GitHub Actions logs in to the server with its own key, so your personal key never leaves your machine:

```powershell
ssh-keygen -t ed25519 -f "$HOME\.ssh\cognitia_deploy" -N '""' -C "github-actions-deploy"
Get-Content "$HOME\.ssh\cognitia_deploy.pub" | ssh -i $PEM "cognitia@$API_HOST" "cat >> ~/.ssh/authorized_keys"
ssh-keyscan -t ed25519 $API_HOST
```

Keep the output of the last command; it's `DEPLOY_KNOWN_HOSTS` below.

## 3. Put the settings into GitHub

Open the repository on GitHub → **Settings**.

**Environments → New environment → `production`**, then add these **secrets**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | your `API_HOST` |
| `DEPLOY_USER` | `cognitia` |
| `DEPLOY_SSH_KEY` | the whole content of `~\.ssh\cognitia_deploy` (the file **without** `.pub`) |
| `DEPLOY_KNOWN_HOSTS` | the line printed by `ssh-keyscan` |

**Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Value |
|---|---|
| `ANALYSIS_API_URL` | `https://` + your `API_HOST` |
| `SITE_REPO_URL` | optional: link shown in the footer |

**Pages → Build and deployment → Source: GitHub Actions.**
GitHub Pages on a *private* repository needs a paid plan (GitHub Pro is free with the Student Pack).
Otherwise make the repository public.

## 4. Sepolia demo contracts

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

## 5. Run the workflows (Actions tab)

Merge the work into `main` first. Then, in order:

1. **Deploy analysis API → Run workflow.** It runs all checks (about 20 minutes), ships the API to
   your server, waits for `https://API_HOST/ready`, then republishes the site.
2. **Deploy demo contracts to Sepolia → Run workflow.** It deploys the contracts, commits their
   addresses to `incoming/ps2-project/deployments/sepolia.json`, and republishes the site.
3. **Publish site** runs by itself after the two above. Its summary shows the site URL
   (`https://<user>.github.io/<repo>/`).

## 6. Check it

- Open the site. The footer should say **Analysis API online**.
- **Playground:** run "Unlimited USDC approval to Inferno Drainer". It should come back Critical in 5–15 seconds.
- **Install:** download the ZIP, load it in Chrome as described on the page.
- **Live demo:** switch MetaMask to Sepolia with a test account that has some Sepolia ETH,
  mint test assets, then try "NFT holder rewards". Cognitia should stop both steps before MetaMask opens.

## Costs and upkeep

- The server runs all the time. With student credit, check the Azure **Cost Management** page now
  and then. Stopping (deallocating) the VM saves credit but takes the API and playground offline.
- Updating is just running **Deploy analysis API** again.
- Nothing secret is stored in the repository. Everything sensitive lives in GitHub's encrypted secrets.

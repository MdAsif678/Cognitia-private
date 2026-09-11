<#
.SYNOPSIS
  Brings up the demo blockchain from scratch: starts Anvil, deploys Syed's contracts at the
  handoff addresses, seeds the test wallet, and (optionally) funds your own MetaMask account.

.EXAMPLE
  .\incoming\integration\demo-chain.ps1
  .\incoming\integration\demo-chain.ps1 -Fund 0x5333d6e2251210157810352dfF2880a9C0af5359
  .\incoming\integration\demo-chain.ps1 -Port 8546 -Fund 0x...   # alternative port

  Anvil keeps running in the background after the script exits. Re-running the script replaces
  the chain on that port (everything is wiped; re-run with -Fund to re-seed your account).
#>
param(
  [string]$Fund = "",          # extra MetaMask address to receive ETH, pUSD, NFTs, badges + the stale approval
  [int]$Port = 8545,
  [string]$Host_ = "127.0.0.1" # use 0.0.0.0 to let other laptops on the Wi-Fi connect
)
# "Continue": forge/cast print warnings to stderr, which strict mode would treat as fatal.
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
function Stop-AnvilOnPort($p) {
  Get-CimInstance Win32_Process -Filter "Name = 'anvil.exe'" | Where-Object { $_.CommandLine -match "--port $p( |$)" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
$foundry = Join-Path $env:USERPROFILE ".foundry\bin"
if (Test-Path $foundry) { $env:PATH = "$foundry;$env:PATH" }
if (-not (Get-Command anvil -ErrorAction SilentlyContinue)) {
  Write-Host "anvil not found. Install Foundry:" -ForegroundColor Red
  Write-Host "  Windows: download foundry_v1.8.1_win32_amd64.zip from https://github.com/foundry-rs/foundry/releases/tag/v1.8.1 and unzip to $foundry"
  Write-Host "  Mac/Linux: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  exit 1
}

$rpc = "http://127.0.0.1:$Port"
$deployer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"   # Anvil account #0 (public test key, local only)
$key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
$attacker = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"     # Anvil account #1

# 1. Fresh chain
Stop-AnvilOnPort $Port
Start-Process anvil -ArgumentList "--host $Host_ --port $Port --chain-id 31337 --silent" -WindowStyle Hidden
Write-Host "Starting Anvil on ${Host_}:$Port (chain 31337)..."
$ok = $false
for ($i = 0; $i -lt 50; $i++) { try { cast chain-id --rpc-url $rpc 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ok = $true; break } } catch {}; Start-Sleep -Milliseconds 200 }
if (-not $ok) { throw "Anvil did not start on port $Port" }

# 2. Deploy Syed's contracts at deployer nonce 8 → same addresses every time
cast rpc anvil_setNonce $deployer 0x8 --rpc-url $rpc | Out-Null
Push-Location (Join-Path $root "incoming\ps2-project")
try {
  $forgeOut = & forge script script/DeployAll.s.sol:DeployAll --rpc-url $rpc --private-key $key --broadcast 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { $forgeOut | Write-Host; throw "forge script failed" }
  $forgeOut | Select-String -Pattern "ONCHAIN EXECUTION COMPLETE" | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
  $run = Get-Content "broadcast\DeployAll.s.sol\31337\run-latest.json" -Raw | ConvertFrom-Json
} finally { Pop-Location }
$addr = @{}
foreach ($t in $run.transactions) { if ($t.transactionType -eq "CREATE") { $addr[$t.contractName] = $t.contractAddress } }
$token = $addr.TestToken; $nft = $addr.TestNFT; $e1155 = $addr.TestERC1155; $drainer = $addr.FakeRewardsDrainer

# 3. Seed an account: 3 NFTs, 100 badges, 1000 pUSD (deployer already has 1M), stale 500 pUSD approval to the drainer
function Seed($who) {
  cast rpc anvil_impersonateAccount $who --rpc-url $rpc | Out-Null
  cast rpc anvil_setBalance $who 0x21E19E0C9BAB2400000 --rpc-url $rpc | Out-Null                   # 10,000 ETH
  cast send $token "mint(address,uint256)" $who 1000000000000000000000 --rpc-url $rpc --private-key $key | Out-Null
  1..3 | ForEach-Object { cast send $nft "mintTo(address)" $who --rpc-url $rpc --private-key $key | Out-Null }
  cast send $e1155 "mint(address,uint256,uint256)" $who 1 100 --rpc-url $rpc --private-key $key | Out-Null
  cast send $token "approve(address,uint256)" $drainer 500000000000000000000 --from $who --unlocked --rpc-url $rpc | Out-Null
  cast rpc anvil_stopImpersonatingAccount $who --rpc-url $rpc | Out-Null
  Write-Host ("  {0}: {1} pUSD, {2} pNFT, {3} badges, ETH {4}" -f $who,
    (cast from-wei ((cast call $token "balanceOf(address)(uint256)" $who --rpc-url $rpc).Split(" ")[0])).Split(".")[0],
    (cast call $nft "balanceOf(address)(uint256)" $who --rpc-url $rpc),
    (cast call $e1155 "balanceOf(address,uint256)(uint256)" $who 1 --rpc-url $rpc),
    (cast balance $who --ether --rpc-url $rpc).Split(".")[0])
}
Write-Host "Seeding accounts:"
Seed $deployer
if ($Fund) { Seed $Fund }

# 4. Write the address file the test scripts and demo site use
$out = [ordered]@{ chainId = 31337; rpcUrl = $rpc; testWallet = $deployer; attacker = $attacker; friend = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4df"
  testToken = $token; testNFT = $nft; testERC1155 = $e1155; fakeRewardsDrainer = $drainer; maliciousApprover = $addr.MaliciousTokenApprover }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "syed-local.json"), ($out | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Demo chain ready on $rpc" -ForegroundColor Green
$out.GetEnumerator() | ForEach-Object { Write-Host ("  {0,-20} {1}" -f $_.Key, $_.Value) }
Write-Host ""
Write-Host "Next: npx tsx incoming/integration/serve-with-swastik.ts   (API on :8081)"
Write-Host "      npx serve -l 3000 incoming/ps2-project/demo            (demo site)"
Write-Host "MetaMask: network RPC $rpc, chain ID 31337. After every restart of this script: MetaMask > Settings > Advanced > Clear activity tab data."

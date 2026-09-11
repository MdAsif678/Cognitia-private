#!/usr/bin/env bash
# Brings up the demo blockchain from scratch (macOS / Linux twin of demo-chain.ps1):
# starts Anvil, deploys Syed's contracts at the handoff addresses, seeds the test wallet and,
# optionally, your own MetaMask account.
#
#   ./incoming/integration/demo-chain.sh                      # test wallet only
#   ./incoming/integration/demo-chain.sh 0xYourMetaMaskAddr   # also fund + seed that account
#   PORT=8546 HOST=0.0.0.0 ./incoming/integration/demo-chain.sh 0x...   # other port / LAN access
#
# Anvil keeps running in the background (log: /tmp/anvil-<port>.log). Re-running replaces it.
set -u
FUND="${1:-}"
PORT="${PORT:-8545}"
HOST="${HOST:-127.0.0.1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
RPC="http://127.0.0.1:$PORT"
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # Anvil account #0 (public test key, local only)
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ATTACKER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

if ! command -v anvil >/dev/null; then
  echo "anvil not found. Install Foundry:  curl -L https://foundry.paradigm.xyz | bash && foundryup" >&2
  exit 1
fi

# 1. Fresh chain on this port
pkill -f "anvil.*--port $PORT( |$)" 2>/dev/null || true
sleep 0.5
nohup anvil --host "$HOST" --port "$PORT" --chain-id 31337 --silent >"/tmp/anvil-$PORT.log" 2>&1 &
echo "Starting Anvil on $HOST:$PORT (chain 31337)..."
for _ in $(seq 1 50); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.2; done
cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 || { echo "Anvil did not start" >&2; exit 1; }

# 2. Deploy at deployer nonce 8 -> same addresses every time
cast rpc anvil_setNonce "$DEPLOYER" 0x8 --rpc-url "$RPC" >/dev/null
( cd "$ROOT/incoming/ps2-project" && forge script script/DeployAll.s.sol:DeployAll --rpc-url "$RPC" --private-key "$KEY" --broadcast 2>&1 | grep -E "ONCHAIN EXECUTION COMPLETE|Error" | sed 's/^/  /' )
RUN="$ROOT/incoming/ps2-project/broadcast/DeployAll.s.sol/31337/run-latest.json"
addr() { node -e "const r=require(process.argv[1]);console.log(r.transactions.find(t=>t.transactionType==='CREATE'&&t.contractName===process.argv[2]).contractAddress)" "$RUN" "$1"; }
TOKEN=$(addr TestToken); NFT=$(addr TestNFT); E1155=$(addr TestERC1155); DRAINER=$(addr FakeRewardsDrainer); APPROVER=$(addr MaliciousTokenApprover)

# 3. Seed: 10,000 ETH, 1000 pUSD, 3 NFTs, 100 badges, stale 500 pUSD approval to the drainer
seed() {
  local who="$1"
  cast rpc anvil_impersonateAccount "$who" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$who" 0x21E19E0C9BAB2400000 --rpc-url "$RPC" >/dev/null
  cast send "$TOKEN" "mint(address,uint256)" "$who" 1000000000000000000000 --rpc-url "$RPC" --private-key "$KEY" >/dev/null
  for _ in 1 2 3; do cast send "$NFT" "mintTo(address)" "$who" --rpc-url "$RPC" --private-key "$KEY" >/dev/null; done
  cast send "$E1155" "mint(address,uint256,uint256)" "$who" 1 100 --rpc-url "$RPC" --private-key "$KEY" >/dev/null
  cast send "$TOKEN" "approve(address,uint256)" "$DRAINER" 500000000000000000000 --from "$who" --unlocked --rpc-url "$RPC" >/dev/null
  cast rpc anvil_stopImpersonatingAccount "$who" --rpc-url "$RPC" >/dev/null
  local pusd; pusd=$(cast from-wei "$(cast call "$TOKEN" "balanceOf(address)(uint256)" "$who" --rpc-url "$RPC" | cut -d' ' -f1)" | cut -d. -f1)
  echo "  $who: $pusd pUSD, $(cast call "$NFT" "balanceOf(address)(uint256)" "$who" --rpc-url "$RPC") pNFT, $(cast call "$E1155" "balanceOf(address,uint256)(uint256)" "$who" 1 --rpc-url "$RPC") badges, ETH $(cast balance "$who" --ether --rpc-url "$RPC" | cut -d. -f1)"
}
echo "Seeding accounts:"
seed "$DEPLOYER"
[ -n "$FUND" ] && seed "$FUND"

# 4. Address file used by the test scripts
cat >"$ROOT/incoming/integration/syed-local.json" <<EOF
{
  "chainId": 31337,
  "rpcUrl": "$RPC",
  "testWallet": "$DEPLOYER",
  "attacker": "$ATTACKER",
  "friend": "0x9965507D1a55bcC2695C58ba16FB37d819B0A4df",
  "testToken": "$TOKEN",
  "testNFT": "$NFT",
  "testERC1155": "$E1155",
  "fakeRewardsDrainer": "$DRAINER",
  "maliciousApprover": "$APPROVER"
}
EOF

echo
echo "Demo chain ready on $RPC"
echo "  testToken           $TOKEN"
echo "  testNFT             $NFT"
echo "  testERC1155         $E1155"
echo "  fakeRewardsDrainer  $DRAINER"
echo
echo "Next: npx tsx incoming/integration/serve-with-swastik.ts   (API on :8081)"
echo "      npx serve -l 3000 incoming/ps2-project/demo            (demo site)"
echo "MetaMask: RPC $RPC, chain ID 31337. After every restart: Settings > Advanced > Clear activity tab data."

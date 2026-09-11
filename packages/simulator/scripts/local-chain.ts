/**
 * Start a local Anvil chain on 127.0.0.1:8545 that mirrors the team's demo deployment:
 * deployer = Anvil account #0 (the "test wallet"), so contracts land at the deterministic
 * addresses 0x5FbD… (nonce 0), 0xe7f1… (nonce 1, pUSD), 0x9fe4… (nonce 2, pNFT).
 * Stand-in bytecode (packages/simulator/test/fixtures) — replace with contracts/ when available.
 *
 *   npx tsx packages/simulator/scripts/local-chain.ts        # keeps running until Ctrl+C
 */
import { spawn } from "node:child_process";
import { createPublicClient, createWalletClient, http, parseEther, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { resolveAnvilPath } from "../src";
import { compileFixtures } from "../test/integration/harness";

const RPC = "http://127.0.0.1:8545";
const WALLET_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
const ATTACKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil #1

const child = spawn(resolveAnvilPath(), ["--host", "127.0.0.1", "--port", "8545", "--chain-id", "31337", "--silent"], { stdio: "inherit", windowsHide: true });
process.on("exit", () => child.kill());
process.on("SIGINT", () => process.exit(130));

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
for (let i = 0; i < 100; i++) {
  try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

const wallet = privateKeyToAccount(WALLET_KEY);
const w = createWalletClient({ account: wallet, chain: foundry, transport: http(RPC) });
const art = compileFixtures();
const deploy = async (name: string, args: unknown[] = []) => {
  const hash = await w.deployContract({ abi: art[name]!.abi, bytecode: art[name]!.bytecode, args });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
};
const write = async (address: `0x${string}`, abi: Abi, functionName: string, args: unknown[]) => {
  const hash = await w.writeContract({ address, abi, functionName, args });
  await pub.waitForTransactionReceipt({ hash });
};

const drainer = await deploy("TestDrainer", [ATTACKER]);                 // nonce 0 → 0x5FbD…
const pUSD = await deploy("TestERC20", ["Phantom USD", "pUSD"]);         // nonce 1 → 0xe7f1…
const pNFT = await deploy("TestERC721", ["Phantom Apes", "pNFT"]);      // nonce 2 → 0x9fe4…
await write(pUSD, art.TestERC20!.abi, "mint", [wallet.address, parseEther("1000")]);
for (const id of [0n, 1n, 2n]) await write(pNFT, art.TestERC721!.abi, "mint", [wallet.address, id]);
await write(pUSD, art.TestERC20!.abi, "approve", [drainer, parseEther("250")]); // stale approval for the claim() demo

console.log(JSON.stringify({ rpc: RPC, chainId: 31337, wallet: wallet.address, attacker: ATTACKER, pUSD, pNFT, drainer }, null, 2));
console.log("chain running — Ctrl+C to stop");
await new Promise(() => {});

/// <reference path="../solc.d.ts" />
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { resolveAnvilPath } from "../../src/anvil";

const here = dirname(fileURLToPath(import.meta.url));

export function anvilAvailable(): boolean {
  const r = spawnSync(resolveAnvilPath(), ["--version"], { windowsHide: true });
  return r.status === 0;
}

type Artifact = { abi: Abi; bytecode: Hex };

let compiled: Record<string, Artifact> | undefined;
export function compileFixtures(): Record<string, Artifact> {
  if (compiled) return compiled;
  const source = readFileSync(join(here, "..", "fixtures", "Fixtures.sol"), "utf8");
  const input = {
    language: "Solidity",
    sources: { "Fixtures.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  compiled = {};
  for (const [name, c] of Object.entries(out.contracts["Fixtures.sol"] as Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>)) {
    compiled[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  }
  return compiled;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      srv.close(() => resolve(typeof a === "object" && a ? a.port : 0));
    });
  });
}

// Anvil's well-known dev keys (never hold real funds).
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  victim: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
} as const;

export const ATTACKER = getAddress("0xa77ac0000000000000000000000000000000bad1");
export const FRIEND = getAddress("0xf00df00df00df00df00df00df00df00df00df00d");

export type Upstream = {
  url: string;
  chainId: number;
  child: ChildProcess;
  publicClient: PublicClient;
  victim: Address;
  deployer: Address;
  addresses: { token: Address; nft: Address; multi: Address; drainer: Address; delegator: Address };
  abis: Record<string, Abi>;
  /** Block right after deployment + minting, before the drainer allowance was seeded. */
  blockBeforeSeed: bigint;
  /** The victim's (mined) approve(drainer, 500 TUSD) transaction. */
  seedApprovalTx: Hex;
  stop(): void;
};

/**
 * Local "upstream" chain standing in for Sepolia/mainnet: assets are deployed and minted here,
 * and the simulator forks it exactly like it forks a live network.
 */
export async function startUpstream(): Promise<Upstream> {
  const artifacts = compileFixtures();
  const port = await freePort();
  const child = spawn(resolveAnvilPath(), ["--host", "127.0.0.1", "--port", String(port), "--silent", "--chain-id", "31337"], {
    stdio: "ignore",
    windowsHide: true,
  });
  const url = `http://127.0.0.1:${port}`;
  const publicClient = createPublicClient({ chain: foundry, transport: http(url) });
  for (let i = 0; i < 100; i++) {
    try {
      await publicClient.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const deployerAccount = privateKeyToAccount(KEYS.deployer);
  const victimAccount = privateKeyToAccount(KEYS.victim);
  const deployerWallet = createWalletClient({ account: deployerAccount, chain: foundry, transport: http(url) });
  const victimWallet = createWalletClient({ account: victimAccount, chain: foundry, transport: http(url) });

  const deploy = async (name: string, args: unknown[] = []) => {
    const a = artifacts[name]!;
    const hash = await deployerWallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  };
  const write = async (wallet: WalletClient, address: Address, name: string, functionName: string, args: unknown[] = [], value?: bigint) => {
    const hash = await wallet.writeContract({
      address,
      abi: artifacts[name]!.abi,
      functionName,
      args,
      value,
      account: wallet.account!,
      chain: foundry,
    });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${name}.${functionName} failed`);
    return hash;
  };

  const token = await deploy("TestERC20", ["Test USD", "TUSD"]);
  const nft = await deploy("TestERC721", ["Test Apes", "TAPE"]);
  const multi = await deploy("TestERC1155");
  const drainer = await deploy("TestDrainer", [ATTACKER]);
  const delegator = await deploy("TestDelegator", [drainer]);

  const victim = victimAccount.address;
  await write(deployerWallet, token, "TestERC20", "mint", [victim, parseEther("1000")]);
  for (const id of [1n, 2n, 3n]) await write(deployerWallet, nft, "TestERC721", "mint", [victim, id]);
  await write(deployerWallet, multi, "TestERC1155", "mint", [victim, 7n, 50n]);
  await write(deployerWallet, multi, "TestERC1155", "mint", [victim, 8n, 5n]);
  const blockBeforeSeed = await publicClient.getBlockNumber({ cacheTime: 0 });

  // The victim once approved the "rewards" contract for 500 TUSD — claim() will use it.
  const seedApprovalTx = await write(victimWallet, token, "TestERC20", "approve", [drainer, parseEther("500")]);

  return {
    seedApprovalTx,
    url,
    chainId: 31337,
    child,
    publicClient,
    victim,
    deployer: deployerAccount.address,
    addresses: { token, nft, multi, drainer, delegator },
    abis: Object.fromEntries(Object.entries(artifacts).map(([k, v]) => [k, v.abi])),
    blockBeforeSeed,
    stop: () => child.kill(),
  };
}

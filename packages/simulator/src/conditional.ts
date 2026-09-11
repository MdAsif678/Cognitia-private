import { domainSeparator, encodeFunctionData, type Address, type PublicClient, type TypedDataDomain } from "viem";
import type { AccountInfo, ConditionalAuthorization, Exposure, SignatureCheck } from "@cognitia/shared";
import { DRAIN_ABI, ERC20_READ_ABI } from "./abi";
import type { StepSpec } from "./scenario";
import { errorMessage, minBigInt, sameAddress } from "./util";

/** Recipient for ERC-1155 follow-ups when the operator is a contract that may reject tokens. */
export const SIMULATED_ATTACKER_SINK = "0x000000000000000000000000000000000000dEaD" as const;

/**
 * Steps that use authority granted by the request, executed as the spender on the fork after
 * the request itself. These model "what could happen next" — never what the request does.
 */
export function buildFollowUpSteps(exposures: Exposure[], accounts: AccountInfo[], limit: number): StepSpec[] {
  const isContract = (a: Address) => accounts.find((x) => sameAddress(x.address, a))?.isContract ?? false;
  const steps: StepSpec[] = [];

  for (const e of exposures) {
    if (e.basis !== "granted" || steps.length >= limit) continue;
    if (sameAddress(e.spender, e.owner)) continue;

    if (e.kind === "erc20-allowance") {
      const amount = minBigInt(BigInt(e.amount ?? "0"), BigInt(e.atRisk.erc20Balance ?? "0"));
      if (amount <= 0n) continue;
      steps.push({
        label: `follow-up: ${e.spender} pulls tokens with transferFrom`,
        role: "follow-up",
        from: e.spender,
        to: e.token,
        value: 0n,
        data: encodeFunctionData({ abi: DRAIN_ABI, functionName: "transferFrom", args: [e.owner, e.spender, amount] }),
      });
    } else if (e.kind === "erc721-token-approval" && e.tokenId) {
      steps.push({
        label: `follow-up: ${e.spender} takes token #${e.tokenId}`,
        role: "follow-up",
        from: e.spender,
        to: e.token,
        value: 0n,
        data: encodeFunctionData({ abi: DRAIN_ABI, functionName: "transferFrom", args: [e.owner, e.spender, BigInt(e.tokenId)] }),
      });
    } else if (e.kind === "operator-approval" && e.standard === "erc721") {
      for (const id of (e.atRisk.tokenIds ?? []).slice(0, Math.max(0, limit - steps.length))) {
        steps.push({
          label: `follow-up: operator ${e.spender} takes token #${id}`,
          role: "follow-up",
          from: e.spender,
          to: e.token,
          value: 0n,
          data: encodeFunctionData({ abi: DRAIN_ABI, functionName: "transferFrom", args: [e.owner, e.spender, BigInt(id)] }),
        });
      }
    } else if (e.kind === "operator-approval" && e.standard === "erc1155") {
      const recipient = isContract(e.spender) ? SIMULATED_ATTACKER_SINK : e.spender;
      for (const b of (e.atRisk.erc1155Balances ?? []).slice(0, Math.max(0, limit - steps.length))) {
        steps.push({
          label: `follow-up: operator ${e.spender} takes ${b.balance} of token #${b.tokenId}`,
          role: "follow-up",
          from: e.spender,
          to: e.token,
          value: 0n,
          data: encodeFunctionData({
            abi: DRAIN_ABI,
            functionName: "safeTransferFrom",
            args: [e.owner, recipient, BigInt(b.tokenId), BigInt(b.balance), "0x"],
          }),
        });
      }
    }
  }
  return steps;
}

/** The authorization a signature would grant, modeled as the owner granting it directly. */
export function authorizationSetupStep(auth: ConditionalAuthorization): StepSpec {
  if (auth.kind === "erc20-allowance") {
    return {
      label: `model: ${auth.source} as approve(${auth.spender}, ${auth.amount}) from owner`,
      role: "setup",
      from: auth.owner,
      to: auth.token,
      value: 0n,
      data: encodeFunctionData({ abi: DRAIN_ABI, functionName: "approve", args: [auth.spender, BigInt(auth.amount)] }),
    };
  }
  return {
    label: `model: setApprovalForAll(${auth.operator}, true) from owner`,
    role: "setup",
    from: auth.owner,
    to: auth.token,
    value: 0n,
    data: encodeFunctionData({ abi: DRAIN_ABI, functionName: "setApprovalForAll", args: [auth.operator, true] }),
  };
}

/** Validates an ERC-2612-style permit message against live token state at the fork block. */
export async function checkPermit(
  client: PublicClient,
  auth: Extract<ConditionalAuthorization, { kind: "erc20-allowance" }>,
  chainId: number,
  blockTimestamp: bigint,
): Promise<SignatureCheck[]> {
  const checks: SignatureCheck[] = [];
  const code = await client.getCode({ address: auth.token }).catch(() => undefined);
  checks.push(
    code && code !== "0x"
      ? { name: "token-code", status: "pass", detail: "Token contract exists at the fork block" }
      : { name: "token-code", status: "fail", detail: "No contract code at the token address" },
  );

  if (auth.domain?.chainId !== undefined) {
    checks.push(
      auth.domain.chainId === chainId
        ? { name: "chain-id", status: "pass", detail: `Signature domain chainId ${chainId} matches the wallet's chain` }
        : { name: "chain-id", status: "fail", detail: `Signature domain chainId ${auth.domain.chainId} does not match the wallet's chain ${chainId}` },
    );
  }
  if (auth.domain?.verifyingContract) {
    checks.push(
      sameAddress(auth.domain.verifyingContract, auth.token)
        ? { name: "verifying-contract", status: "pass", detail: "Domain verifyingContract is the token" }
        : { name: "verifying-contract", status: "fail", detail: `Domain verifyingContract ${auth.domain.verifyingContract} is not the token ${auth.token}` },
    );
  }

  if (auth.nonce !== undefined) {
    try {
      const nonce = await client.readContract({ address: auth.token, abi: ERC20_READ_ABI, functionName: "nonces", args: [auth.owner] });
      checks.push(
        nonce === BigInt(auth.nonce)
          ? { name: "nonce", status: "pass", detail: `Permit nonce ${auth.nonce} is the owner's next nonce — the signature would be immediately usable` }
          : { name: "nonce", status: "fail", detail: `Permit nonce ${auth.nonce} ≠ on-chain nonce ${nonce}; the signature would be rejected unless the nonce catches up` },
      );
    } catch (err) {
      checks.push({ name: "nonce", status: "unavailable", detail: `nonces(owner) unreadable: ${errorMessage(err)}` });
    }
  }

  if (auth.deadline !== undefined) {
    const deadline = BigInt(auth.deadline);
    checks.push(
      deadline >= blockTimestamp
        ? { name: "deadline", status: "pass", detail: `Valid until ${new Date(Number(minBigInt(deadline, 8_640_000_000_000n)) * 1000).toISOString()}${deadline > blockTimestamp + 365n * 86400n ? " (more than a year — effectively no expiry)" : ""}` }
        : { name: "deadline", status: "fail", detail: "Permit deadline has already passed" },
    );
  }

  if (auth.domain) {
    try {
      const onChain = await client.readContract({ address: auth.token, abi: ERC20_READ_ABI, functionName: "DOMAIN_SEPARATOR" });
      const domain: TypedDataDomain = {
        name: auth.domain.name,
        version: auth.domain.version,
        chainId: auth.domain.chainId,
        verifyingContract: auth.domain.verifyingContract,
        salt: auth.domain.salt,
      };
      const expected = domainSeparator({ domain });
      checks.push(
        expected.toLowerCase() === onChain.toLowerCase()
          ? { name: "domain-separator", status: "pass", detail: "Signed domain matches the token's DOMAIN_SEPARATOR()" }
          : { name: "domain-separator", status: "fail", detail: "Signed domain does not match the token's DOMAIN_SEPARATOR(); the token would reject this signature" },
      );
    } catch (err) {
      checks.push({ name: "domain-separator", status: "unavailable", detail: `DOMAIN_SEPARATOR() unreadable: ${errorMessage(err)}` });
    }
  }
  return checks;
}

import { describe, expect, it } from "vitest";
import { computeRequestHash, type AnalyzeRequest } from "@cognitia/shared";
import { normalizeRequest } from "../src/pipeline/normalize";

const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const base = (method: string, params: unknown[]): AnalyzeRequest => ({ requestId: "r1", origin: "https://claim.example", chainId: 11155111, account: ACCOUNT, method, params });

describe("normalizeRequest", () => {
  it("converts hex quantities to decimal strings", () => {
    const n = normalizeRequest(base("eth_sendTransaction", [{ from: ACCOUNT, to: TOKEN, value: "0x0de0b6b3a7640000", gas: "0x5208", data: "0x" }]));
    expect(n.kind).toBe("transaction");
    if (n.kind !== "transaction") return;
    expect(n.tx).toMatchObject({ value: "1000000000000000000", gas: "21000" });
    expect(n.warnings).toHaveLength(0);
  });

  it("accepts `input` as calldata and defaults from to the account", () => {
    const n = normalizeRequest(base("eth_sendTransaction", [{ to: TOKEN, input: "0x095ea7b3" }]));
    expect(n.kind === "transaction" && n.tx.data).toBe("0x095ea7b3");
    expect(n.kind === "transaction" && n.tx.from).toBe(ACCOUNT);
  });

  it("rejects a chainId that does not match the wallet", () => {
    const n = normalizeRequest(base("eth_sendTransaction", [{ from: ACCOUNT, to: TOKEN, chainId: "0x1" }]));
    expect(n).toMatchObject({ kind: "unsupported" });
    expect(n.kind === "unsupported" && n.reason).toMatch(/does not match/);
  });

  it("rejects malformed fields instead of guessing", () => {
    expect(normalizeRequest(base("eth_sendTransaction", [{ from: ACCOUNT, to: "not-an-address" }])).kind).toBe("unsupported");
    expect(normalizeRequest(base("eth_sendTransaction", [{ from: ACCOUNT, to: TOKEN, data: "0x123" }])).kind).toBe("unsupported");
  });

  it("parses typed data given as a JSON string, in either param order", () => {
    const typed = { types: { Permit: [] }, primaryType: "Permit", domain: { name: "X" }, message: { owner: ACCOUNT } };
    const a = normalizeRequest(base("eth_signTypedData_v4", [ACCOUNT, JSON.stringify(typed)]));
    const b = normalizeRequest(base("eth_signTypedData_v4", [JSON.stringify(typed), ACCOUNT]));
    expect(a.kind).toBe("typed-data");
    expect(b.kind).toBe("typed-data");
  });

  it("encodes plain-text personal_sign messages as hex", () => {
    const n = normalizeRequest(base("personal_sign", ["hello", ACCOUNT]));
    expect(n.kind === "personal-sign" && n.message).toBe("0x68656c6c6f");
  });

  it("flags unknown methods as unsupported", () => {
    expect(normalizeRequest(base("wallet_sendCalls", [{}])).kind).toBe("unsupported");
  });
});

describe("computeRequestHash", () => {
  it("is independent of key order and address case", () => {
    const a = computeRequestHash(base("eth_sendTransaction", [{ to: TOKEN, from: ACCOUNT }]));
    const b = computeRequestHash({ ...base("eth_sendTransaction", [{ from: ACCOUNT, to: TOKEN }]), account: ACCOUNT.toLowerCase() as `0x${string}` });
    expect(a).toBe(b);
    expect(a).not.toBe(computeRequestHash(base("eth_sendTransaction", [{ from: ACCOUNT, to: TOKEN, value: "0x1" }])));
  });
});

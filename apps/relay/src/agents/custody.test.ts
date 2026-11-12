import { KeyPair, baseDecode } from "near-api-js";
import { describe, expect, it } from "vitest";
import type { Chain } from "../chain.js";
import { type Custody, bearer, custodyChain, keyOfImplicit, seedOf, walletAccount, walletAccounts } from "./custody.js";
import { roster } from "./roster.js";

const kp = KeyPair.fromRandom("ed25519");
const WALLET = "88b0dd9abb17ff4c707a0b9904570ff6e4ca31d256a531b1426b42503537ef70";

/** An OutLayer that records what it is asked and answers `reply`. */
function outlayer(reply: (path: string, body: unknown) => { status: number; json: unknown }) {
  const asked: { path: string; auth: string; body: unknown }[] = [];
  const custody: Custody = {
    url: "https://custody.test",
    accountId: "keeper.near-post.testnet",
    privateKey: kp.toString(),
    now: () => 1_800_000_000_000,
    fetch: (async (url: string, init: RequestInit) => {
      const path = url.replace("https://custody.test", "");
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      asked.push({ path, auth: (init.headers as Record<string, string>).authorization!, body });
      const r = reply(path, body);
      return new Response(JSON.stringify(r.json), { status: r.status });
    }) as unknown as typeof fetch,
  };
  return { custody, asked };
}

describe("the agents' keys in custody", () => {
  it("signs each request with the account's key: the seed and the second, nothing else", () => {
    const { custody } = outlayer(() => ({ status: 200, json: {} }));
    const token = bearer(custody, seedOf("rive-nord", "v11"));
    expect(token.startsWith("Bearer near:")).toBe(true);
    const p = JSON.parse(Buffer.from(token.slice("Bearer near:".length), "base64url").toString()) as { account_id: string; seed: string; pubkey: string; timestamp: number; signature: string };
    expect(p).toMatchObject({ account_id: "keeper.near-post.testnet", seed: "rive-nord.v11", pubkey: kp.getPublicKey().toString(), timestamp: 1_800_000_000 });
    expect(kp.getPublicKey().verify(new TextEncoder().encode("auth:rive-nord.v11:1800000000"), baseDecode(p.signature))).toBe(true);
    expect(token).not.toContain(kp.toString().slice(8, 40));
  });

  it("an agent's account is his wallet's, and its key is the account itself", async () => {
    const { custody, asked } = outlayer(() => ({ status: 200, json: { address: WALLET } }));
    expect(await walletAccount(custody, "ai-1.v11")).toBe(WALLET);
    expect(asked[0]!.path).toBe("/wallet/v1/address?chain=near");
    expect(keyOfImplicit(WALLET)).toMatch(/^ed25519:/);
    expect(Buffer.from(baseDecode(keyOfImplicit(WALLET).slice(8))).toString("hex")).toBe(WALLET);
    // The roster takes the accounts it is given; an agent without a wallet sits out.
    const all = await walletAccounts(custody, ["rive-nord", "ai-1"], "v11", null);
    const r = roster("near-post.testnet", all);
    expect(r.map((a) => a.slug)).toEqual(["rive-nord", "ai-1"]);
    expect(r.find((a) => a.kind === "footballer")).toMatchObject({ account: WALLET, startsAt: WALLET });
    // Without custody, the accounts are under the parent, as before.
    expect(roster("near-post.testnet")[0]!.account).toBe("rive-nord.near-post.testnet");
  });

  it("a call goes through the wallet; the relay reads, and a failure is the contract's own words", async () => {
    const settled: string[] = [];
    const base = { view: async () => 7 } as unknown as Chain;
    const ok = outlayer(() => ({ status: 200, json: { status: "success", tx_hash: "HASH" } }));
    const chain = custodyChain(base, ok.custody, "ai-1.v11", WALLET, async (h, s) => void settled.push(`${h} ${s}`));
    expect(await chain.view("league", "match_day")).toBe(7);
    expect(await chain.call("league", "report_for_match", { token_id: "p1" }, 30)).toBe("HASH");
    expect(ok.asked[0]!.body).toEqual({ receiver_id: "league", method_name: "report_for_match", args: { token_id: "p1" }, gas: "30000000000000", deposit: "0" });
    expect(settled).toEqual([]);
    expect(await chain.callChecked!("goalars", "ft_transfer_call", {}, 150, 1n)).toBe("HASH");
    expect(ok.asked[1]!.body).toMatchObject({ gas: "150000000000000", deposit: "1" });
    expect(settled).toEqual([`HASH ${WALLET}`]);

    const panic = outlayer(() => ({ status: 422, json: { error: "onchain_tx_failed", message: "Smart contract panicked: create your footballer first" } }));
    await expect(custodyChain(base, panic.custody, "ai-1.v11", WALLET, async () => {}).call("league", "x", {}, 30)).rejects.toThrow("create your footballer first");
    const denied = outlayer(() => ({ status: 403, json: { error: "policy_denied" } }));
    await expect(custodyChain(base, denied.custody, "ai-1.v11", WALLET, async () => {}).call("elsewhere", "x", {}, 30)).rejects.toThrow("custody: policy_denied");
    const waiting = outlayer(() => ({ status: 200, json: { status: "pending_approval", approval_id: "a" } }));
    await expect(custodyChain(base, waiting.custody, "ai-1.v11", WALLET, async () => {}).call("league", "x", {}, 30)).rejects.toThrow("custody: pending_approval");
  });
});

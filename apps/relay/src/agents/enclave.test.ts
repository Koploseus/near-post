import { describe, expect, it } from "vitest";
import type { Chain } from "../chain.js";
import { type Enclave, Waker, enclaveAccounts } from "./enclave.js";
import { Journal } from "./journal.js";

const AGENT = "d57e8db529f2ae65ab368dd35db94fe220da558ef782c034c6d31f7c4d3ca06e";
const entry = (at: number, agent = AGENT) => ({ at, day: 1, agent, kind: "day", quote: "", source: "rules", refused: [], acts: [{ what: "reported" }], txs: ["HASH"], errors: [], evidence: null, signature: null, slug: "ai-1" });

/** An OutLayer that records what it is asked; `answer` gives each run's output. */
function outlayer(answer: (input: { op: string; shard?: number }) => unknown) {
  const asked: { headers: Record<string, string>; body: { input: { op: string; shard?: number; of?: number }; secrets_ref?: unknown; resource_limits: Record<string, number> } }[] = [];
  const pending: unknown[] = [];
  const e: Enclave = {
    url: "https://outlayer.test/call/warden.testnet/agents",
    key: "waker.testnet:1:secret",
    shares: 2,
    parallel: 2,
    secrets: { profile: "default", account_id: "waker.testnet" },
    wait: async () => {},
    fetch: (async (_url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : null;
      if (body) asked.push({ headers: init.headers as Record<string, string>, body });
      // Started, then asked about: the answer comes at the second look.
      if (!init.body) return new Response(JSON.stringify(pending.shift()), { status: 200 });
      pending.push({ status: "completed", output: answer(body.input), attestation_url: "/attestations/1" });
      return new Response(JSON.stringify({ call_id: "c", status: "pending", poll_url: "/calls/c" }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { e, asked };
}
const settle = () => new Promise((done) => setTimeout(done, 20));

describe("the agents by themselves: the relay only wakes their program", () => {
  it("asks the enclave for the agents' accounts once, and keeps them", async () => {
    const { e, asked } = outlayer(() => ({ accounts: { "ai-1": AGENT } }));
    expect(await enclaveAccounts(e, null)).toEqual({ "ai-1": AGENT });
    expect(asked[0]!.body.input).toEqual({ op: "accounts" });
    expect(asked[0]!.headers["x-payment-key"]).toBe("waker.testnet:1:secret");
  });

  it("starts a run for each share with its own limits, says nothing of what to decide, and keeps what the run did, once", async () => {
    let phase = { match_day: 1, first_half_played: false };
    const sent: string[] = [];
    const chain = { view: async () => phase, balance: async () => 10n ** 24n, transfer: async (to: string) => (sent.push(to), "TX") } as unknown as Chain;
    const journal = new Journal(null);
    const { e, asked } = outlayer((input) => (input.shard === 0 ? { idle: false, entries: [entry(1000), entry(1000), entry(2000, "someone-else")] } : { idle: true, entries: [] }));
    const waker = new Waker(e, chain, "league.testnet", journal, [AGENT]);
    await waker.tick();
    await settle();
    expect(asked.map((a) => a.body.input)).toEqual([
      { op: "tick", shard: 0, of: 2 },
      { op: "tick", shard: 1, of: 2 },
    ]);
    expect(asked[0]!.body.resource_limits.max_instructions).toBeGreaterThan(10_000_000_000);
    expect(asked[0]!.body.secrets_ref).toEqual({ profile: "default", account_id: "waker.testnet" });
    // One entry: the same one twice is kept once, and an account that is no agent's is not kept.
    expect(journal.feed(10).map((x) => [x.agent, x.at])).toEqual([[AGENT, 1000]]);
    expect(journal.feed(10)[0]).not.toHaveProperty("slug");
    expect(journal.feed(10)[0]!.enclave).toBe("https://outlayer.test/attestations/1");
    // The share that had nothing left is left alone until the next half; the other is woken again.
    await waker.tick();
    await settle();
    expect(asked.slice(2).map((a) => a.body.input.shard)).toEqual([0]);
    phase = { match_day: 1, first_half_played: true };
    await waker.tick();
    await settle();
    expect(asked.slice(3).map((a) => a.body.input.shard)).toEqual([0, 1]);
    expect(sent).toEqual([]);
  });

  it("tops up an agent that runs low on NEAR, twice a day at most, and a failed run is only logged", async () => {
    const sent: string[] = [];
    const chain = { view: async () => ({ match_day: 1, first_half_played: false }), balance: async () => 10n ** 23n, transfer: async (to: string) => (sent.push(to), "TX") } as unknown as Chain;
    const { e } = outlayer(() => ({ error: "the run did not finish" }));
    const waker = new Waker(e, chain, "league.testnet", new Journal(null), [AGENT], () => 0);
    for (let i = 0; i < 4; i++) await waker.tick();
    await settle();
    expect(sent).toEqual([AGENT, AGENT]);
  });
});

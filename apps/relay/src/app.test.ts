import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";

function fakeChain(state: Record<string, unknown>): Chain & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async view<T>(contractId: string, method: string, args?: Record<string, unknown>) {
      calls.push(`${contractId}.${method}(${JSON.stringify(args ?? {})})`);
      if (method === "fail") throw new Error("rpc down");
      return (state[method] ?? null) as T;
    },
  };
}

const config = loadConfig({ LEAGUE_ID: "league.near-post.testnet" });

describe("relay", () => {
  it("answers health without a league", async () => {
    const app = createApp(loadConfig({}), fakeChain({}));
    const res = await app.request("/health");
    expect(await res.json()).toEqual({ status: "ok", network: "testnet" });
  });

  it("says when the league is not deployed", async () => {
    const res = await createApp(loadConfig({}), fakeChain({})).request("/v1/rules");
    expect(res.status).toBe(503);
  });

  it("reads the rules from the league contract", async () => {
    const chain = fakeChain({ rules: { stadium_target_bps: 6000 } });
    const res = await createApp(config, chain).request("/v1/rules");
    expect(await res.json()).toEqual({ stadium_target_bps: 6000 });
    expect(chain.calls).toEqual(["league.near-post.testnet.rules({})"]);
  });

  it("rejects a malformed club id before touching the chain", async () => {
    const chain = fakeChain({});
    const res = await createApp(config, chain).request("/v1/clubs/NOT%20AN%20ID/stand");
    expect(res.status).toBe(400);
    expect(chain.calls).toEqual([]);
  });

  it("returns 404 for an unknown club", async () => {
    const res = await createApp(config, fakeChain({ get_club: null })).request("/v1/clubs/nobody.testnet/stand");
    expect(res.status).toBe(404);
  });

  it("returns the stand of a club", async () => {
    const stand = { match_day: 1, present: 3, fans: 5, target: 3, full_house: true };
    const chain = fakeChain({ get_club: { name: "Rive Nord" }, stand });
    const res = await createApp(config, chain).request("/v1/clubs/koplo.testnet/stand");
    expect(await res.json()).toEqual(stand);
  });
});

import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { isPlayerAccount } from "./auth.js";
import { makeToken, readToken } from "./bot.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";

const config = loadConfig({ LEAGUE_ID: "league-v8.near-post.testnet", PLAYERS_ID: "players-v8.near-post.testnet", BOT_SIGNUPS_PER_IP_DAY: "2" });
const CLUB = "rive-nord.near-post.testnet";

/** A chain where accounts, keys and footballers live in maps, and every relayed call is recorded. */
class BotChain implements Partial<Chain> {
  keys = new Map<string, string[]>();
  footballers = new Map<string, { token_id: string; name: string; owner: string; overall: number; position: string }>();
  sent: { sender: string; contract: string; method: string; args: Record<string, unknown>; deposit: bigint }[] = [];
  refuseNext: string | null = null;
  throwNext: string | null = null;
  async view<T>(_c: string, method: string, args?: Record<string, unknown>) {
    if (method === "footballer_of") return (this.footballers.get(String(args?.account_id)) ?? null) as T;
    if (method === "schedule") return { match_day: 40, kickoff_at_ms: String(Date.now() + 10 * 60_000), next_match_at_ms: "0", first_half_played: false, season: 2, season_day: 14 } as T;
    if (method === "lineup") return { formation: "4-4-2", strategy: "balanced", roles: Array(11).fill("Cm"), players: Array(11).fill(null), chosen: Array(11).fill(false) } as T;
    if (method === "table") return [{ manager: CLUB, name: "Rive Nord", division: 1, points: 30 }] as T;
    if (method === "squad") return [] as T;
    return null as T;
  }
  async hasKey(id: string, key: string) {
    return this.keys.get(id)?.includes(key) ?? false;
  }
  async createAccount(id: string, key: string) {
    this.keys.set(id, [key]);
    return "tx-create";
  }
  async signDelegate(accountId: string, privateKey: string, receiverId: string, method: string, args: Record<string, unknown>, tgas: number, deposit = 0n) {
    const pub = KeyPair.fromString(privateKey as `ed25519:${string}`).getPublicKey().toString();
    if (!this.keys.get(accountId)?.includes(pub)) throw new Error("access key does not exist");
    return { delegateAction: { senderId: accountId, receiverId, actions: [{ functionCall: { methodName: method, args, gas: BigInt(tgas) * 10n ** 12n, deposit } }] } } as never;
  }
  async relay(signed: unknown) {
    const d = (signed as { delegateAction: { senderId: string; receiverId: string; actions: { functionCall: { methodName: string; args: Record<string, unknown>; deposit: bigint } }[] } }).delegateAction;
    const fc = d.actions[0]!.functionCall;
    if (this.throwNext) {
      const m = this.throwNext;
      this.throwNext = null;
      throw new Error(m);
    }
    this.sent.push({ sender: d.senderId, contract: d.receiverId, method: fc.methodName, args: fc.args, deposit: BigInt(fc.deposit) });
    if (this.refuseNext) {
      const error = this.refuseNext;
      this.refuseNext = null;
      return { hash: "tx", value: null, error };
    }
    if (fc.methodName === "create_footballer") {
      this.footballers.set(d.senderId, { token_id: `p${this.footballers.size + 1}`, name: String(fc.args.name), owner: d.senderId, overall: 50, position: String(fc.args.position) });
    }
    if (fc.methodName === "nft_transfer") {
      const f = this.footballers.get(d.senderId)!;
      f.owner = String(fc.args.receiver_id);
    }
    return { hash: "tx", value: null, error: null };
  }
}

function setup() {
  const chain = new BotChain();
  const app = createApp(config, chain as unknown as Chain, { mailer: { async send() {} } });
  const req = (path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) =>
    app.request(path, {
      method: opts.body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "9.9.9.9", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
  const signup = async (name = "Kai Stone", ip = "9.9.9.9") => {
    const r = await req("/v1/bot/signup", { body: { name, position: "Fw" }, ip });
    return { status: r.status, body: (await r.json()) as { token: string; account_id: string; footballer: { token_id: string } } };
  };
  return { chain, req, signup };
}

describe("bot API", () => {
  it("serves its documentation as text", async () => {
    const { req } = setup();
    const r = await req("/v1/bot");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("POST http://localhost/v1/bot/signup");
  });

  it("signs an AI up: a player account, its footballer, and a token that is its key", async () => {
    const { chain, signup } = setup();
    const { status, body } = await signup();
    expect(status).toBe(200);
    expect(isPlayerAccount(body.account_id, config.PARENT_ACCOUNT_ID)).toBe(true);
    expect(body.footballer).toMatchObject({ name: "Kai Stone", position: "Fw" });
    const t = readToken(`Bearer ${body.token}`)!;
    expect(t.accountId).toBe(body.account_id);
    expect(chain.keys.get(body.account_id)).toEqual([KeyPair.fromString(t.privateKey as `ed25519:${string}`).getPublicKey().toString()]);
    expect(chain.sent.map((s) => s.method)).toEqual(["create_footballer"]);
  });

  it("limits sign-ups per IP", async () => {
    const { signup } = setup();
    expect((await signup("A One", "1.1.1.1")).status).toBe(200);
    expect((await signup("B Two", "1.1.1.1")).status).toBe(200);
    expect((await signup("C Three", "1.1.1.1")).status).toBe(429);
    expect((await signup("D Four", "2.2.2.2")).status).toBe(200);
  });

  it("joins a club by giving the registration to it, then plays the match day", async () => {
    const { chain, req, signup } = setup();
    const { body } = await signup();
    const token = body.token;
    expect((await req("/v1/bot/join", { token, body: { club: CLUB } })).status).toBe(200);
    expect(chain.sent.at(-1)).toMatchObject({ contract: "players-v8.near-post.testnet", method: "nft_transfer", args: { receiver_id: CLUB, token_id: "p1" }, deposit: 1n });
    expect((await req("/v1/bot/join", { token, body: { club: CLUB } })).status).toBe(409);

    const me = (await (await req("/v1/bot/me", { token })).json()) as { club: string; match: { slots_open: boolean }; team_sheet: { slots: unknown[] } };
    expect(me.club).toBe(CLUB);
    expect(me.match.slots_open).toBe(true);
    expect(me.team_sheet.slots).toHaveLength(11);

    for (const [path, b] of [
      ["/v1/bot/report", {}],
      ["/v1/bot/slot", { slot: 9 }],
      ["/v1/bot/strategy", { strategy: "attack" }],
      ["/v1/bot/captain", { candidate: "p1" }],
    ] as const) {
      expect((await req(path, { token, body: b })).status).toBe(200);
    }
    expect(chain.sent.slice(-4).map((s) => [s.method, s.args])).toEqual([
      ["report_for_match", {}],
      ["take_slot", { slot: 9 }],
      ["vote_strategy", { strategy: "attack" }],
      ["vote_captain", { candidate: "p1" }],
    ]);
  });

  it("passes the contract's refusal on", async () => {
    const { chain, req, signup } = setup();
    const { body } = await signup();
    chain.refuseNext = "slot already taken";
    const r = await req("/v1/bot/slot", { token: body.token, body: { slot: 3 } });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ error: "slot already taken" });
  });

  it("tells the AI to check before retrying when the RPC was busy", async () => {
    const { chain, req, signup } = setup();
    const { body } = await signup();
    chain.throwNext = "Rate limit exceeded, retry after 35 seconds";
    const r = await req("/v1/bot/report", { token: body.token, body: {} });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: "rpc_busy" });
  });

  it("refuses a missing token, a malformed one, and a key that is not the account's", async () => {
    const { req, signup } = setup();
    const { body } = await signup();
    expect((await req("/v1/bot/me")).status).toBe(401);
    expect((await req("/v1/bot/me", { token: "hello" })).status).toBe(401);
    const stranger = makeToken(body.account_id, KeyPair.fromRandom("ed25519").toString());
    expect((await req("/v1/bot/me", { token: stranger })).status).toBe(401);
    expect((await req("/v1/bot/strategy", { token: stranger, body: { strategy: "attack" } })).status).toBe(401);
  });

  it("checks what it is asked", async () => {
    const { req, signup } = setup();
    const { body } = await signup();
    expect((await req("/v1/bot/slot", { token: body.token, body: { slot: 11 } })).status).toBe(400);
    expect((await req("/v1/bot/strategy", { token: body.token, body: { strategy: "park the bus" } })).status).toBe(400);
    expect((await req("/v1/bot/signup", { body: { name: "X", position: "Striker" } })).status).toBe(400);
  });
});

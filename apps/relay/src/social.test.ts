import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { accountIdFor } from "./auth.js";
import { Journal, type Entry } from "./agents/journal.js";
import type { Agent } from "./agents/roster.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { ONLINE_MS, Presence, Walls, WALL_KEEP, cleanPost } from "./social.js";
import { presenceMessage, wallMessage, wallReadMessage } from "./vault-message.js";

const CLUB = "rive-nord.near-post.testnet";
const config = loadConfig({ LEAGUE_ID: "league-v3.near-post.testnet" });

/** A chain with accounts, their keys and the footballer each plays. */
class SocialChain implements Partial<Chain> {
  keys = new Map<string, string[]>();
  footballers = new Map<string, { token_id: string; name: string; owner: string }>();
  views = 0;
  keyChecks = 0;
  squads = new Map<string, { token_id: string; name: string; controller: string | null }[]>();
  async view<T>(_c: string, method: string, args?: Record<string, unknown>) {
    this.views += 1;
    if (method === "footballer_of") return (this.footballers.get(String(args?.account_id)) ?? null) as T;
    if (method === "squad") return (this.squads.get(String(args?.account_id)) ?? []) as T;
    return null as T;
  }
  async hasKey(id: string, key: string) {
    this.keyChecks += 1;
    return this.keys.get(id)?.includes(key) ?? false;
  }
}

function setup(agents?: { roster: Agent[]; journal: Journal }) {
  let t = 1_000_000;
  const chain = new SocialChain();
  const app = createApp(config, chain as unknown as Chain, { mailer: { async send() {} }, walls: new Walls(null), now: () => t, ...(agents ? { agents } : {}) });
  const player = (name: string, club = CLUB) => {
    const kp = KeyPair.fromRandom("ed25519");
    const account = accountIdFor(`${name.replace(/\W/g, "")}${chain.footballers.size}@example.com`, config.PARENT_ACCOUNT_ID);
    chain.keys.set(account, [kp.getPublicKey().toString()]);
    chain.footballers.set(account, { token_id: `p${chain.footballers.size + 1}`, name, owner: club });
    const sign = (m: string) => Buffer.from(kp.sign(new TextEncoder().encode(m)).signature).toString("base64");
    return { account, kp, public_key: kp.getPublicKey().toString(), sign };
  };
  const send = (path: string, body: unknown, ip = "1.2.3.4") =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
  const heartbeat = (p: ReturnType<typeof player>) =>
    send("/v1/presence", { account_id: p.account, public_key: p.public_key, ts: t, signature: p.sign(presenceMessage(p.account, t)) });
  const postOn = (p: ReturnType<typeof player>, club: string, text: string, signed = text) =>
    send(`/v1/clubs/${club}/wall`, { account_id: p.account, public_key: p.public_key, ts: t, text, signature: p.sign(wallMessage(p.account, club, t, signed)) });
  const readWall = async (p: ReturnType<typeof player>, club = CLUB) =>
    send(`/v1/clubs/${club}/wall/read`, { account_id: p.account, public_key: p.public_key, ts: t, signature: p.sign(wallReadMessage(p.account, club, t)) });
  const postsOf = async (p: ReturnType<typeof player>, club = CLUB) => ((await (await readWall(p, club)).json()) as { posts: { text: string; ai?: string; name: string; token_id: string; account: string }[] }).posts;
  return { app, chain, player, heartbeat, postOn, readWall, postsOf, later: (ms: number) => (t += ms) };
}

describe("who is online", () => {
  it("counts a signed heartbeat and forgets it after two minutes", async () => {
    const { app, player, heartbeat, later } = setup();
    const a = player("Ada Striker");
    const b = player("Bo Keeper");
    expect((await heartbeat(a)).status).toBe(200);
    const r = await (await app.request(`/v1/presence?accounts=${a.account},${b.account}`)).json();
    expect(r).toEqual({ count: 1, online: [a.account] });
    later(ONLINE_MS + 1);
    expect(await (await app.request(`/v1/presence?accounts=${a.account}`)).json()).toEqual({ count: 0, online: [] });
  });

  it("refuses a heartbeat signed by a key that is not on the account", async () => {
    const { player, heartbeat } = setup();
    const a = player("Ada Striker");
    const other = KeyPair.fromRandom("ed25519");
    const forged = { ...a, public_key: other.getPublicKey().toString(), sign: (m: string) => Buffer.from(other.sign(new TextEncoder().encode(m)).signature).toString("base64") };
    expect((await heartbeat(forged)).status).toBe(401);
  });

  it("checks the key on chain once, not every minute", async () => {
    const { chain, player, heartbeat, later } = setup();
    const a = player("Ada Striker");
    for (let i = 0; i < 3; i++) {
      expect((await heartbeat(a)).status).toBe(200);
      later(60_000);
    }
    expect(chain.keyChecks).toBe(1);
  });

  it("refuses accounts that are not players'", async () => {
    const { app } = setup();
    const kp = KeyPair.fromRandom("ed25519");
    const ts = 1_000_000;
    const r = await app.request("/v1/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account_id: "alice.testnet", public_key: kp.getPublicKey().toString(), ts, signature: Buffer.from(kp.sign(new TextEncoder().encode(presenceMessage("alice.testnet", ts))).signature).toString("base64") }),
    });
    expect(r.status).toBe(400);
  });
});

describe("the team wall", () => {
  it("takes a post from a footballer of the club and shows it newest first", async () => {
    const { player, postOn, postsOf, later } = setup();
    const a = player("Ada Striker");
    expect((await postOn(a, CLUB, "Allez les gars !")).status).toBe(200);
    later(1000);
    expect((await postOn(a, CLUB, "  Full   house tonight  ")).status).toBe(200);
    const posts = await postsOf(a);
    expect(posts.map((p: { text: string }) => p.text)).toEqual(["Full house tonight", "Allez les gars !"]);
    expect(posts[0]).toMatchObject({ account: a.account, name: "Ada Striker", token_id: "p1" });
  });

  it("keeps the dressing room private: no reading for another club's player, a forged key or anyone without asking", async () => {
    const { app, player, postOn, readWall } = setup();
    const a = player("Ada Striker");
    await postOn(a, CLUB, "Our plan for tonight");
    const rival = player("Rex Rival", "port-lune.near-post.testnet");
    expect((await readWall(rival)).status).toBe(403);
    const other = KeyPair.fromRandom("ed25519");
    const forged = { ...a, public_key: other.getPublicKey().toString(), sign: (m: string) => Buffer.from(other.sign(new TextEncoder().encode(m)).signature).toString("base64") };
    expect((await readWall(forged)).status).toBe(401);
    expect((await app.request(`/v1/clubs/${CLUB}/wall`)).status).toBe(404);
  });

  it("refuses a footballer of another club", async () => {
    const { player, postOn } = setup();
    const a = player("Ada Striker", "port-lune.near-post.testnet");
    const r = await postOn(a, CLUB, "Hello");
    expect(r.status).toBe(403);
  });

  it("refuses a text that is not the one signed", async () => {
    const { player, postOn } = setup();
    const a = player("Ada Striker");
    expect((await postOn(a, CLUB, "We lost", "We won")).status).toBe(401);
  });

  it("refuses empty and too long posts", async () => {
    const { player, postOn } = setup();
    const a = player("Ada Striker");
    expect((await postOn(a, CLUB, "   ")).status).toBe(400);
    expect((await postOn(a, CLUB, "x".repeat(201))).status).toBe(400);
  });

  it("slows down a player who floods the wall", async () => {
    const { player, postOn } = setup();
    const a = player("Ada Striker");
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await postOn(a, CLUB, `post ${i}`)).status);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });
});

describe("the AI agents in the dressing room", () => {
  const line = (agent: string, at: number, quote: string, extra: Partial<Entry> = {}): Entry => ({
    at,
    day: 3,
    agent,
    kind: "day",
    quote,
    source: "model",
    refused: [],
    acts: [],
    txs: [],
    errors: [],
    evidence: null,
    signature: null,
    ...extra,
  });

  it("puts the club's coach and its AI footballers on the wall, not other clubs' and not half-time lines", async () => {
    const journal = new Journal(null);
    const roster = [{ kind: "coach", account: CLUB, name: "Gaffer Grey", style: "calm", clubName: "Rive Nord" }] as unknown as Agent[];
    const { chain, player, postOn, postsOf, later } = setup({ roster, journal });
    chain.squads.set(CLUB, [{ token_id: "p7", name: "Robo Nine", controller: "ai-7.near-post.testnet" }]);
    journal.add(line(CLUB, 999_000, "Press high tonight.", { kind: "tactic", half: 1 }));
    journal.add(line("ai-7.near-post.testnet", 999_500, "I'll score twice."));
    journal.add(line("ai-7.near-post.testnet", 999_600, "Second-half secret", { kind: "half", half: 2 }));
    journal.add(line("ai-9.near-post.testnet", 999_700, "Another club's player"));
    const a = player("Ada Striker");
    later(1000);
    await postOn(a, CLUB, "Allez !");
    const posts = await postsOf(a);
    expect(posts.map((p: { text: string; ai?: string }) => [p.text, p.ai ?? null])).toEqual([
      ["Allez !", null],
      ["I'll score twice.", "footballer"],
      ["Press high tonight.", "coach"],
    ]);
    expect(posts[1]).toMatchObject({ name: "Robo Nine", token_id: "p7" });
  });

  it("counts an agent that just acted as online", async () => {
    const journal = new Journal(null);
    const { app, later } = setup({ roster: [], journal });
    journal.add(line("ai-7.near-post.testnet", 1_000_000, "Ready."));
    const r = await (await app.request("/v1/presence?accounts=ai-7.near-post.testnet,ai-8.near-post.testnet")).json();
    expect(r).toEqual({ count: 1, online: ["ai-7.near-post.testnet"] });
    later(ONLINE_MS + 1);
    expect((await (await app.request("/v1/presence?accounts=ai-7.near-post.testnet")).json()).online).toEqual([]);
  });
});

describe("social helpers", () => {
  it("cleans posts", () => {
    expect(cleanPost("a\u0000b‮c\n\nd")).toBe("a b c d");
    expect(cleanPost("\n\t ")).toBeNull();
  });

  it("keeps the last posts of a wall only", () => {
    const w = new Walls(null);
    for (let i = 0; i < WALL_KEEP + 5; i++) w.add(CLUB, { account: "a", token_id: "p1", name: "A", text: `${i}`, at: i });
    expect(w.of(CLUB, 1000)).toHaveLength(WALL_KEEP);
    expect(w.of(CLUB, 1)[0]!.text).toBe(`${WALL_KEEP + 4}`);
  });

  it("counts presence", () => {
    let t = 0;
    const p = new Presence(() => t);
    p.here("a");
    t = 1000;
    p.here("b");
    expect(p.count()).toBe(2);
    t = ONLINE_MS + 500;
    expect(p.online(["a", "b"])).toEqual(["b"]);
  });
});


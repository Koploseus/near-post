import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { accountIdFor } from "./auth.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { type Click, drill, drillEnd, hits } from "./drill.js";
import { DUEL_LEVEL, DUEL_TTL_MS, People, THREAD_KEEP, duelWinner, valueOf } from "./people.js";
import { socialMessage } from "./vault-message.js";

const CLUB = "rive-nord.near-post.testnet";
const config = loadConfig({ LEAGUE_ID: "league-v3.near-post.testnet" });

interface P {
  token_id: string;
  name: string;
  position: string;
  overall: number;
  goals: number;
  owner: string;
  controller: string | null;
}

class PeopleChain implements Partial<Chain> {
  keys = new Map<string, string[]>();
  footballers = new Map<string, P>();
  async view<T>(_c: string, method: string, args?: Record<string, unknown>) {
    if (method === "footballer_of") return (this.footballers.get(String(args?.account_id)) ?? null) as T;
    if (method === "table") return [{ name: "Northbank Rovers", manager: CLUB, treasury: "5000000", division: 1, fans: 3, best_streak: 2 }] as T;
    if (method === "squad") return [...this.footballers.values()].filter((p) => p.owner === args?.account_id) as T;
    return null as T;
  }
  async hasKey(id: string, key: string) {
    return this.keys.get(id)?.includes(key) ?? false;
  }
}

function setup() {
  let t = 1_000_000;
  const chain = new PeopleChain();
  const people = new People(null, () => t);
  const app = createApp(config, chain as unknown as Chain, { mailer: { async send() {} }, people, now: () => t });
  const player = (name: string, overall = 50, club: string | null = CLUB) => {
    const kp = KeyPair.fromRandom("ed25519");
    const account = accountIdFor(`${name.replace(/\W/g, "")}${chain.footballers.size}@example.com`, config.PARENT_ACCOUNT_ID);
    chain.keys.set(account, [kp.getPublicKey().toString()]);
    chain.footballers.set(account, { token_id: `p${chain.footballers.size + 1}`, name, position: "Fw", overall, goals: 0, owner: club ?? account, controller: account });
    const sign = (m: string) => Buffer.from(kp.sign(new TextEncoder().encode(m)).signature).toString("base64");
    return { account, public_key: kp.getPublicKey().toString(), sign };
  };
  type Pl = ReturnType<typeof player>;
  const act = async (p: Pl, action: string, o: { to?: string; id?: number; text?: string; clicks?: unknown[]; signedText?: string } = {}) => {
    const r = await app.request("/v1/people/act", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({
        account_id: p.account,
        public_key: p.public_key,
        ts: t,
        action,
        ...(o.to ? { to: o.to } : {}),
        ...(o.id !== undefined ? { id: o.id } : {}),
        ...(o.text !== undefined ? { text: o.text } : {}),
        ...(o.clicks ? { clicks: o.clicks } : {}),
        signature: p.sign(socialMessage(p.account, t, action, o.to ?? "", o.id ?? 0, o.signedText ?? o.text ?? "")),
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: r.status, body: (await r.json()) as any };
  };
  return { app, chain, people, player, act, later: (ms: number) => (t += ms) };
}

describe("friends", () => {
  it("asks, accepts, and both sides see each other", async () => {
    const { player, act } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    expect((await act(a, "friend_ask", { to: b.account })).body.state).toBe("asked");
    const inbox = (await act(b, "inbox")).body;
    expect(inbox.requests.map((p: { name: string }) => p.name)).toEqual(["Ada"]);
    expect((await act(b, "friend_accept", { to: a.account })).body.ok).toBe(true);
    expect((await act(a, "inbox")).body.friends[0].name).toBe("Bo");
    expect((await act(b, "inbox")).body.friends[0].name).toBe("Ada");
    await act(a, "friend_remove", { to: b.account });
    expect((await act(b, "inbox")).body.friends).toEqual([]);
  });

  it("makes friends at once when both asked", async () => {
    const { player, act } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    await act(a, "friend_ask", { to: b.account });
    expect((await act(b, "friend_ask", { to: a.account })).body.state).toBe("friends");
  });

  it("refuses an account without a footballer, on either side", async () => {
    const { player, act, chain } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    chain.footballers.delete(b.account);
    expect((await act(a, "friend_ask", { to: b.account })).status).toBe(404);
    expect((await act(b, "inbox")).status).toBe(403);
  });

  it("refuses a request signed for something else", async () => {
    const { player, act } = setup();
    const [a, b, c] = [player("Ada"), player("Bo"), player("Cy")];
    const r = await act(a, "message", { to: b.account, text: "hello", signedText: "bye" });
    expect(r.status).toBe(401);
    // Signed for Bo, sent to Cy.
    const ts = 1_000_000;
    const forged = await (
      await (setup().app.request("/v1/people/act", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account_id: a.account, public_key: a.public_key, ts, action: "friend_ask", to: c.account, signature: a.sign(socialMessage(a.account, ts, "friend_ask", b.account, 0, "")) }),
      }))
    ).json();
    expect(forged).toEqual({ error: "bad_signature" });
  });
});

describe("private messages", () => {
  it("delivers a message, counts it unread, and reading it clears the count", async () => {
    const { player, act } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    expect((await act(a, "message", { to: b.account, text: "  Friendly   on  Sunday? " })).body.message.text).toBe("Friendly on Sunday?");
    const inbox = (await act(b, "inbox")).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.threads[0].with.name).toBe("Ada");
    const thread = (await act(b, "thread", { to: a.account })).body;
    expect(thread.messages.map((m: { text: string }) => m.text)).toEqual(["Friendly on Sunday?"]);
    expect((await act(b, "inbox")).body.unread).toBe(0);
    // The sender never has his own message unread.
    expect((await act(a, "inbox")).body.unread).toBe(0);
  });

  it("keeps a thread between its two players", async () => {
    const { player, act } = setup();
    const [a, b, c] = [player("Ada"), player("Bo"), player("Cy")];
    await act(a, "message", { to: b.account, text: "for Bo only" });
    expect((await act(c, "thread", { to: a.account })).body.messages).toEqual([]);
    expect((await act(c, "inbox")).body.threads).toEqual([]);
  });

  it("lets a player take messages from friends only", async () => {
    const { player, act } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    expect((await act(b, "friends_only", { text: "on" })).body.friends_only).toBe(true);
    expect((await act(a, "message", { to: b.account, text: "hi" })).status).toBe(403);
    await act(a, "friend_ask", { to: b.account });
    await act(b, "friend_accept", { to: a.account });
    expect((await act(a, "message", { to: b.account, text: "hi" })).status).toBe(200);
  });

  it("refuses empty and too long messages, and slows a flood down", async () => {
    const { player, act } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    expect((await act(a, "message", { to: b.account, text: "   " })).status).toBe(400);
    expect((await act(a, "message", { to: b.account, text: "x".repeat(201) })).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 14; i++) last = (await act(a, "message", { to: b.account, text: `m${i}` })).status;
    expect(last).toBe(429);
  });

  it("keeps the last messages of a thread only", () => {
    const people = new People(null);
    for (let i = 0; i < THREAD_KEEP + 5; i++) people.send("a.testnet", "b.testnet", `m${i}`);
    const ms = people.thread("b.testnet", "a.testnet");
    expect(ms).toHaveLength(THREAD_KEEP);
    expect(ms[0]!.text).toBe("m5");
  });
});

describe("the terrace", () => {
  it("anyone reads it, only a signed footballer speaks", async () => {
    const { app, player, act } = setup();
    const a = player("Ada");
    expect((await act(a, "say", { text: "Full house tonight!" })).status).toBe(200);
    const lines = ((await (await app.request("/v1/people/chat")).json()) as { lines: { name: string; text: string }[] }).lines;
    expect(lines).toEqual([expect.objectContaining({ name: "Ada", text: "Full house tonight!" })]);
  });
});

describe("search, online and rankings", () => {
  it("finds footballers by name, the best rated first, free agents once met", async () => {
    const { app, player, act, later } = setup();
    const a = player("Ada Lovelace", 70);
    player("Adam Smith", 55);
    const free = player("Adalbert", 60, null);
    const find = async (q: string) => ((await (await app.request(`/v1/people/search?q=${q}`)).json()) as { people: { name: string; club_name: string | null; online: boolean }[] }).people;
    expect(await find("a")).toEqual([]);
    expect((await find("ada")).map((p) => p.name)).toEqual(["Ada Lovelace", "Adam Smith"]);
    // A free agent is in no squad: he shows once he came by (the list is refreshed every two minutes).
    expect(await find("adal")).toEqual([]);
    await act(free, "inbox");
    await act(a, "inbox");
    later(2 * 60_000 + 1);
    const found = await find("adal");
    expect(found.map((p) => p.name)).toEqual(["Adalbert"]);
    expect(found[0]!.club_name).toBeNull();
  });

  it("lists who is online and ranks by value", async () => {
    const { app, player, act } = setup();
    const a = player("Ada", 70);
    player("Bo", 40);
    await act(a, "inbox");
    const online = (await (await app.request("/v1/people/online")).json()) as { people: { name: string }[] };
    expect(online.people.map((p) => p.name)).toEqual(["Ada"]);
    const ranks = (await (await app.request("/v1/people/rankings")).json()) as { valuable: { name: string; value: number }[]; richest: { name: string }[]; streaks: { best_streak: number }[] };
    expect(ranks.valuable.map((p) => p.name)).toEqual(["Ada", "Bo"]);
    expect(ranks.valuable[0]!.value).toBeGreaterThan(ranks.valuable[1]!.value);
    expect(ranks.richest[0]!.name).toBe("Northbank Rovers");
    expect(ranks.streaks[0]!.best_streak).toBe(2);
  });

  it("values a footballer by his rating and his goals", () => {
    expect(valueOf({ overall: 40, goals: 0 })).toBe(50_000);
    expect(valueOf({ overall: 50, goals: 0 })).toBeGreaterThan(valueOf({ overall: 49, goals: 0 }));
    expect(valueOf({ overall: 50, goals: 25 })).toBe(Math.round((valueOf({ overall: 50, goals: 0 }) * 1.5) / 1000) * 1000);
    expect(valueOf({ overall: 50, goals: 500 })).toBe(valueOf({ overall: 50, goals: 50 }));
  });
});

describe("duels", () => {
  /** Clicks that are plausible and last as long as the drill. */
  const idle = (): Click[] => [];

  it("two players play the same drill and the better score wins", async () => {
    const { player, act, later, people } = setup();
    const [a, b] = [player("Ada"), player("Bo")];
    const made = (await act(a, "duel_new", { to: b.account, text: "pace" })).body.duel;
    expect(made.result).toBeNull();
    // One open duel per pair.
    expect((await act(b, "duel_new", { to: a.account, text: "pace" })).status).toBe(409);
    const start = (await act(a, "duel_start", { id: made.id })).body;
    expect(start.level).toBe(DUEL_LEVEL);
    const game = drill(start.seed, DUEL_LEVEL, start.skill);
    // Sent at once: the drill cannot have been played.
    expect((await act(a, "duel_play", { id: made.id, clicks: idle() })).status).toBe(422);
    later(drillEnd(game, idle()) + 1_000);
    const mine = (await act(a, "duel_play", { id: made.id, clicks: idle() })).body.duel;
    expect(mine.mine).toBe(hits(game, idle()));
    expect(mine.result).toBeNull();
    // Played once.
    expect((await act(a, "duel_start", { id: made.id })).status).toBe(409);
    // Bo does not see Ada's score before he has played.
    const before = (await act(b, "inbox")).body.duels[0];
    expect(before.theirs).toBeNull();
    expect(before.their_turn_done).toBe(true);
    await act(b, "duel_start", { id: made.id });
    later(drillEnd(game, idle()) + 1_000);
    const done = (await act(b, "duel_play", { id: made.id, clicks: idle() })).body.duel;
    expect(done.result).toBe("draw");
    expect(done.theirs).toBe(mine.mine);
    expect(duelWinner(people.duelById(made.id)!)).toBeNull();
  });

  it("is between its two players only, and lapses after a day", async () => {
    const { player, act, later } = setup();
    const [a, b, c] = [player("Ada"), player("Bo"), player("Cy")];
    const made = (await act(a, "duel_new", { to: b.account, text: "shooting" })).body.duel;
    expect((await act(c, "duel_start", { id: made.id })).status).toBe(404);
    expect((await act(a, "duel_new", { to: b.account, text: "juggling" })).status).toBe(400);
    await act(a, "duel_start", { id: made.id });
    later(DUEL_TTL_MS + 1);
    expect((await act(a, "duel_play", { id: made.id, clicks: [] })).status).toBe(409);
    expect((await act(a, "inbox")).body.duels).toEqual([]);
    // A new one can then be opened.
    expect((await act(a, "duel_new", { to: b.account, text: "shooting" })).status).toBe(200);
  });

  it("names the winner", () => {
    const d = { id: 1, from: "a", to: "b", skill: "pace" as const, seed: "", at: 0, hits: {} as Record<string, number>, rounds: 5 };
    expect(duelWinner(d)).toBeUndefined();
    d.hits = { a: 3, b: 2 };
    expect(duelWinner(d)).toBe("a");
    d.hits = { a: 1, b: 4 };
    expect(duelWinner(d)).toBe("b");
  });
});

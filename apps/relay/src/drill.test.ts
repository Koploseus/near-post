import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { type Click, FIELD, REACTION_MS, TARGETS, drill, duration, hits, implausible, points } from "./drill.js";

const SEED = "a3".repeat(32);
const perfect = (seed: string, level: number): Click[] =>
  drill(seed, level).map((t) => ({ t: t.appearAt + 300, x: t.x, y: t.y }));

describe("drill", () => {
  it("is the same for the same seed, and stays on the pitch", () => {
    expect(drill(SEED, 50)).toEqual(drill(SEED, 50));
    expect(drill(SEED, 50)).not.toEqual(drill("b4".repeat(32), 50));
    for (const t of drill(SEED, 50)) {
      expect(t.x - t.r).toBeGreaterThanOrEqual(0);
      expect(t.x + t.r).toBeLessThanOrEqual(FIELD.w);
      expect(t.y - t.r).toBeGreaterThanOrEqual(0);
      expect(t.y + t.r).toBeLessThanOrEqual(FIELD.h);
    }
    expect(() => drill("nope", 50)).toThrow();
  });

  it("gets harder with the skill: smaller targets, shorter up", () => {
    const [easy, hard] = [drill(SEED, 20)[0]!, drill(SEED, 90)[0]!];
    expect(hard.r).toBeLessThan(easy.r);
    expect(hard.ttl).toBeLessThan(easy.ttl);
  });

  it("scores hits once, inside the circle and the window, not faster than a human", () => {
    const targets = drill(SEED, 50);
    expect(hits(targets, perfect(SEED, 50))).toBe(TARGETS);
    const t = targets[0]!;
    expect(hits(targets, [{ t: t.appearAt + 300, x: t.x, y: t.y }, { t: t.appearAt + 310, x: t.x, y: t.y }])).toBe(1);
    expect(hits(targets, [{ t: t.appearAt + REACTION_MS - 1, x: t.x, y: t.y }])).toBe(0);
    expect(hits(targets, [{ t: t.appearAt + t.ttl + 1, x: t.x, y: t.y }])).toBe(0);
    expect(hits(targets, [{ t: t.appearAt + 300, x: t.x + t.r + 1, y: t.y }])).toBe(0);
  });

  it("turns hits into 0 to 3 points", () => {
    expect([0, 5, 6, 8, 9, 10, 11, 12].map(points)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it("refuses traces that are not clicks", () => {
    expect(implausible(perfect(SEED, 50))).toBeNull();
    expect(implausible("x")).not.toBeNull();
    expect(implausible([{ t: 5, x: 1, y: 1 }, { t: 4, x: 1, y: 1 }])).not.toBeNull();
    expect(implausible([{ t: 5, x: -1, y: 1 }])).not.toBeNull();
    expect(implausible(Array.from({ length: 61 }, (_, i) => ({ t: i, x: 1, y: 1 })))).not.toBeNull();
  });
});

describe("drill attestation", () => {
  const key = KeyPair.fromRandom("ed25519");
  const LEAGUE = "league-v4.near-post.testnet";
  const config = loadConfig({ LEAGUE_ID: LEAGUE, ATTESTER_PRIVATE_KEY: key.toString() });
  const ticket = { id: 7, token_id: "p12", skill: "pace", match_day: 3, seed: SEED };

  function setup(open = true) {
    let t = 1_000_000;
    const chain = {
      async view(_c: string, method: string) {
        if (method === "training_ticket") return open ? ticket : null;
        if (method === "get_player") return { skills: { pace: 50 } };
        return null;
      },
    } as unknown as Chain;
    const app = createApp(config, chain, { mailer: { async send() {} }, now: () => t });
    const post = (path: string, body: unknown) =>
      app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { post, wait: (ms: number) => (t += ms) };
  }

  it("signs the replayed score of a drill that really lasted", async () => {
    const { post, wait } = setup();
    expect((await post("/v1/training/start", { token_id: "p12" })).status).toBe(200);
    wait(duration(drill(SEED, 50)));
    const r = await post("/v1/training/attest", { token_id: "p12", clicks: perfect(SEED, 50) });
    const body = (await r.json()) as { points: number; signature: string; hits: number };
    expect(body).toMatchObject({ points: 3, hits: TARGETS });
    const message = `near-post:train:${LEAGUE}:p12:7:3`;
    expect(key.verify(new TextEncoder().encode(message), Buffer.from(body.signature, "base64"))).toBe(true);
    // One signature per ticket.
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: [] })).status).toBe(409);
  });

  it("refuses a drill sent back too fast, or never started", async () => {
    const { post, wait } = setup();
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: [] })).status).toBe(422);
    await post("/v1/training/start", { token_id: "p12" });
    wait(2_000);
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: perfect(SEED, 50) })).status).toBe(422);
  });

  it("needs an open ticket and the attester key", async () => {
    expect((await setup(false).post("/v1/training/start", { token_id: "p12" })).status).toBe(404);
    const none = createApp(loadConfig({ LEAGUE_ID: LEAGUE }), {} as Chain, { mailer: { async send() {} } });
    const r = await none.request("/v1/training/start", { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
  });
});

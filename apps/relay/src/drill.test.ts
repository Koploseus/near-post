import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { BALL, GOAL_M, goals, penalties, penaltySetup, toScreen } from "./penalty.js";
import {
  type Click,
  type Drill,
  PASSER,
  REACTION_MS,
  ballOut,
  drill,
  hits,
  implausible,
  laneAt,
  mateAt,
  outcomes,
  points,
} from "./drill.js";

const SEED = "a3".repeat(32);
const OTHER = "b4".repeat(32);

/**
 * A penalty taker who shoots each kick at x metres (and `y` up), with a
 * steady 400 ms swipe, waiting 600 ms between the start of a kick and his run-up.
 */
function kickAll(n: number, x: (k: number) => number, y: number, swipeMs = 400): Click[] {
  const trace: Click[] = [];
  let start = 900;
  for (let k = 0; k < n; k++) {
    const down = start + 600;
    const aim = toScreen(x(k), y);
    trace.push({ t: down, x: BALL.x, y: BALL.y }, { t: down + swipeMs, x: aim.x, y: aim.y, up: true });
    // The next kick starts after the flight and the replay (at most 850 + 1900 ms).
    start = down + swipeMs + 3000;
  }
  return trace;
}

/** A perfect player for each drill (what a strong human aims at). */
function play(d: Drill): Click[] {
  switch (d.game) {
    case "penalties":
      return kickAll(d.setup.kicks.length, (k) => (k % 2 ? 2.9 : -2.9), 0.7);
    case "passes":
      return d.rounds.map((p) => {
        const t = p.start + 300;
        let aim = mateAt(p, t);
        for (let i = 0; i < 20; i++) aim = mateAt(p, t + Math.hypot(aim.x - PASSER.x, aim.y - PASSER.y) / 1.3);
        return { t, x: Math.round(aim.x), y: Math.round(aim.y) };
      });
    case "slalom": {
      const clicks: Click[] = [];
      for (const cone of d.rounds) if (laneAt(clicks, cone.at) === cone.side) clicks.push({ t: cone.at - 400, x: 500, y: 300 });
      return clicks;
    }
    case "tackles":
      return d.rounds.map((duel) => ({ t: duel.start + Math.round(duel.period / 2), x: 500, y: 300 }));
  }
}

describe("football drills", () => {
  it("picks the drill by skill and makes it from the seed", () => {
    expect(drill(SEED, 50, "shooting").game).toBe("penalties");
    expect(drill(SEED, 50, "physical").game).toBe("penalties");
    expect(drill(SEED, 50, "passing").game).toBe("passes");
    expect(drill(SEED, 50, "dribbling").game).toBe("slalom");
    expect(drill(SEED, 50, "pace").game).toBe("slalom");
    expect(drill(SEED, 50, "defending").game).toBe("tackles");
    expect(drill(SEED, 50, "passing")).toEqual(drill(SEED, 50, "passing"));
    expect(drill(SEED, 50, "passing")).not.toEqual(drill(OTHER, 50, "passing"));
    expect(() => drill("nope", 50, "pace")).toThrow();
  });

  it("a perfect player scores in every drill, a lazy one does not", () => {
    for (const skill of ["passing", "dribbling", "defending"] as const) {
      const d = drill(SEED, 60, skill);
      const best = hits(d, play(d));
      expect(best, skill).toBeGreaterThanOrEqual(Math.ceil(d.rounds.length * (skill === "shooting" ? 0.4 : 0.6)));
      expect(hits(d, []), skill).toBeLessThan(d.rounds.length / 2 + 1);
    }

  });

  it("penalties: corners beat the keeper more often than the middle", () => {
    let corners = 0;
    let middle = 0;
    for (let i = 0; i < 40; i++) {
      const seed = (i.toString(16).padStart(2, "0") + "c7").repeat(16);
      const setup = penaltySetup(seed, 50);
      corners += goals(penalties(setup, kickAll(5, (k) => (k % 2 ? 2.9 : -2.9), 0.7)));
      middle += goals(penalties(setup, kickAll(5, () => 0, 0.8)));
    }
    expect(corners / 200).toBeGreaterThan(0.55);
    expect(middle / 200).toBeLessThan(corners / 200 - 0.2);
  });

  it("penalties: a flick drifts, a press off the ball does nothing, kicks follow one another", () => {
    const setup = penaltySetup(SEED, 50);
    const wild = penalties(setup, kickAll(5, () => GOAL_M.halfWidth - 0.1, GOAL_M.height - 0.1, 60));
    expect(wild.some((k) => k.shot!.result === "wide" || k.shot!.result === "over" || k.shot!.result === "post")).toBe(true);
    const off = penalties(setup, [{ t: 1_500, x: 100, y: 100 }, { t: 1_600, x: 500, y: 200, up: true }]);
    expect(off[0]!.shot).toBeNull();
    const ks = penalties(setup, kickAll(5, () => 2.9, 0.7));
    expect(ks.every((k, i) => i === 0 || k.start === ks[i - 1]!.end)).toBe(true);
    expect(ks.every((k) => k.shot && k.shot.flight > 300 && k.shot.flight < 900)).toBe(true);
  });

  it("tackles: only when the ball is away from his feet", () => {
    const d = drill(SEED, 50, "defending");
    if (d.game !== "tackles") throw new Error("not tackles");
    const duel = d.rounds[0]!;
    expect(ballOut(duel, duel.start + duel.period / 2)).toBeCloseTo(1);
    const early = { t: duel.start + duel.period, x: 500, y: 300 }; // ball at his feet
    expect(outcomes({ ...d, rounds: [duel] }, [early])).toEqual([false]);
  });

  it("gets harder as the skill rises", () => {
    let easy = 0;
    let hard = 0;
    for (let i = 0; i < 40; i++) {
      const seed = (i.toString(16).padStart(2, "0") + "d1").repeat(16);
      const trace = kickAll(5, (k) => (k % 2 ? 2.4 : -2.4), 0.9);
      easy += goals(penalties(penaltySetup(seed, 20), trace));
      hard += goals(penalties(penaltySetup(seed, 95), trace));
    }
    expect(hard).toBeLessThan(easy);
    const [s1, s2] = [drill(SEED, 20, "pace"), drill(SEED, 95, "pace")];
    expect(s2.end).toBeLessThan(s1.end);
  });

  it("turns rounds into 0 to 3 points", () => {
    expect([0, 4, 5, 6, 7, 8, 9, 10].map((h) => points(h, 10))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(points(11, 12)).toBe(3);
  });

  it("refuses traces that are not clicks", () => {
    expect(implausible(play(drill(SEED, 50, "pace")))).toBeNull();
    expect(implausible("x")).not.toBeNull();
    expect(implausible([{ t: 5, x: 1, y: 1 }, { t: 4, x: 1, y: 1 }])).not.toBeNull();
    expect(implausible([{ t: 5, x: -1, y: 1 }])).not.toBeNull();
  });
});

describe("drill attestation", () => {
  const key = KeyPair.fromRandom("ed25519");
  const LEAGUE = "league-v4.near-post.testnet";
  const config = loadConfig({ LEAGUE_ID: LEAGUE, ATTESTER_PRIVATE_KEY: key.toString() });
  const ticket = { id: 7, token_id: "p12", skill: "shooting", match_day: 3, seed: SEED };
  const d = drill(SEED, 50, "shooting");

  function setup(open = true) {
    let t = 1_000_000;
    const chain = {
      async view(_c: string, method: string) {
        if (method === "training_ticket") return open ? ticket : null;
        if (method === "get_player") return { skills: { shooting: 50 } };
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
    wait(play(d).at(-1)!.t + 3_000);
    const r = await post("/v1/training/attest", { token_id: "p12", clicks: play(d) });
    const body = (await r.json()) as { points: number; signature: string; hits: number; rounds: number };
    expect(body.rounds).toBe(5);
    expect(body.hits).toBe(hits(d, play(d)));
    expect(body.points).toBe(points(body.hits, 5));
    const message = `near-post:train:${LEAGUE}:p12:7:${body.points}`;
    expect(key.verify(new TextEncoder().encode(message), Buffer.from(body.signature, "base64"))).toBe(true);
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: [] })).status).toBe(409);
  });

  it("refuses a drill sent back too fast, or never started", async () => {
    const { post, wait } = setup();
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: [] })).status).toBe(422);
    await post("/v1/training/start", { token_id: "p12" });
    wait(2_000);
    expect((await post("/v1/training/attest", { token_id: "p12", clicks: play(d) })).status).toBe(422);
  });

  it("needs an open ticket and the attester key", async () => {
    expect((await setup(false).post("/v1/training/start", { token_id: "p12" })).status).toBe(404);
    const none = createApp(loadConfig({ LEAGUE_ID: LEAGUE }), {} as Chain, { mailer: { async send() {} } });
    const r = await none.request("/v1/training/start", { method: "POST", body: "{}" });
    expect(r.status).toBe(503);
  });
});

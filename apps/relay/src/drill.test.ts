import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { type Challenge, type Duel, type PassRound, PASSER, type Race, dribble, mateAt, passes, sprints, tackles } from "./games.js";
import { BALL, GOAL_M, goals, penalties, penaltySetup, toScreen } from "./penalty.js";
import { type Click, type Drill, MAX_CLICKS, drill, drillEnd, hits, implausible, points, rounds } from "./drill.js";

const SEED = "a3".repeat(32);
const OTHER = "b4".repeat(32);
const seeds = (tag: string, n = 30) => Array.from({ length: n }, (_, i) => (i.toString(16).padStart(2, "0") + tag).repeat(16));

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

/** A passer who looks for the moment and spot where a 250 ms swipe reaches his teammate. */
function passAll(rounds: PassRound[]): Click[] {
  const trace: Click[] = [];
  for (let k = 0; k < rounds.length; k++) {
    const start = passes(rounds, trace)[k]!.start;
    const round = rounds[k]!;
    for (let t = start + 700; t < start + 6_000; t += 100) {
      let aim = mateAt(round.mate, t - start);
      for (let i = 0; i < 20; i++) {
        const swipe = Math.hypot(aim.x - PASSER.x, aim.y - PASSER.y) / 250;
        const speed = 0.45 + 0.85 * Math.min(1, Math.max(0, (swipe - 0.25) / 1.5));
        aim = mateAt(round.mate, t + Math.hypot(aim.x - PASSER.x, aim.y - PASSER.y) / speed - start);
      }
      const tryIt: Click[] = [...trace, { t: t - 250, x: PASSER.x, y: PASSER.y }, { t, x: Math.round(aim.x), y: Math.round(aim.y), up: true }];
      if (passes(rounds, tryIt)[k]!.pass?.result === "received") {
        trace.splice(0, trace.length, ...tryIt);
        break;
      }
    }
  }
  return trace;
}

/** A dribbler who sidesteps 150 ms after each defender commits, towards the middle. */
function dribbleAll(cs: Challenge[], react = 150): Click[] {
  const trace: Click[] = [];
  let lane = 0;
  for (const c of cs) {
    const dir = lane === 0 ? 1 : -lane;
    trace.push({ t: c.commitAt + react, x: 500, y: 400 }, { t: c.commitAt + react + 100, x: 500 + dir * 120, y: 400, up: true });
    lane += dir;
  }
  return trace;
}

/** A sprinter pressing left and right in turn, `perSecond` times a second, until he gets to the ball. */
function sprintAll(races: Race[], perSecond: number, sameSide = false): Click[] {
  const trace: Click[] = [];
  for (let k = 0; k < races.length; k++) {
    const go = sprints(races, trace)[k]!.go;
    for (let n = 0; n < perSecond * 8; n++) {
      const t = go + 60 + Math.round((n * 1000) / perSecond);
      trace.push({ t, x: sameSide || n % 2 ? 250 : 750, y: 300 });
      const r = sprints(races, trace)[k]!;
      if (r.won || t > go + r.rival) break;
    }
  }
  return trace;
}

/** A defender who tackles each duel `at` ms from the cut, to the side `side(duel)`. */
function tackleAll(ds: Duel[], at: (d: Duel) => number, side: (d: Duel) => number): Click[] {
  return ds.flatMap((d) => {
    const up = at(d);
    return [
      { t: up - 90, x: 500, y: 300 },
      { t: up, x: 500 + side(d) * 120, y: 300, up: true },
    ];
  });
}

/** A strong player for each drill. */
function play(d: Drill): Click[] {
  switch (d.game) {
    case "penalties":
      return kickAll(d.setup.kicks.length, (k) => (k % 2 ? 2.9 : -2.9), 0.7);
    case "passes":
      return passAll(d.setup);
    case "dribble":
      return dribbleAll(d.setup);
    case "sprint":
      return sprintAll(d.setup, 9);
    case "tackles":
      return tackleAll(d.setup, (x) => x.cutAt + 80, (x) => x.side);
  }
}

describe("football drills", () => {
  it("picks the game by skill and makes it from the seed", () => {
    expect(drill(SEED, 50, "shooting").game).toBe("penalties");
    expect(drill(SEED, 50, "physical").game).toBe("penalties");
    expect(drill(SEED, 50, "passing").game).toBe("passes");
    expect(drill(SEED, 50, "dribbling").game).toBe("dribble");
    expect(drill(SEED, 50, "pace").game).toBe("sprint");
    expect(drill(SEED, 50, "defending").game).toBe("tackles");
    expect(drill(SEED, 50, "passing")).toEqual(drill(SEED, 50, "passing"));
    expect(drill(SEED, 50, "passing")).not.toEqual(drill(OTHER, 50, "passing"));
    expect(() => drill("nope", 50, "pace")).toThrow();
  });

  it("a strong player wins most rounds, doing nothing wins none", () => {
    for (const skill of ["passing", "dribbling", "pace", "defending"] as const) {
      let best = 0;
      let total = 0;
      for (const seed of seeds("e5", 12)) {
        const d = drill(seed, 60, skill);
        best += hits(d, play(d));
        total += rounds(d);
        expect(hits(d, []), skill).toBe(0);
        expect(implausible(play(d)), skill).toBeNull();
      }
      expect(best / total, skill).toBeGreaterThan(0.85);
    }
  });

  it("penalties: corners beat the keeper more often than the middle", () => {
    let corners = 0;
    let middle = 0;
    for (const seed of seeds("c7", 40)) {
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

  it("passes: a pass at your own feet or far behind him does not reach him", () => {
    const d = drill(SEED, 60, "passing");
    if (d.game !== "passes") throw new Error("not passes");
    const start = passes(d.setup, [])[0]!.start;
    const back = [{ t: start + 1_000, x: PASSER.x, y: PASSER.y }, { t: start + 1_300, x: PASSER.x, y: 590, up: true }];
    expect(passes(d.setup, back)[0]!.pass?.result).not.toBe("received");
    const off = [{ t: start + 1_000, x: 100, y: 100 }, { t: start + 1_300, x: 300, y: 300, up: true }];
    expect(passes(d.setup, off)[0]!.pass).toBeNull();
  });

  it("dribble: sidestepping too early, too late or all the time loses the ball", () => {
    for (const seed of seeds("f1", 8)) {
      const d = drill(seed, 60, "dribbling");
      if (d.game !== "dribble") throw new Error("not dribble");
      expect(hits(d, dribbleAll(d.setup, -500))).toBeLessThan(2);
      expect(hits(d, dribbleAll(d.setup, 500))).toBeLessThan(2);
      const spam: Click[] = [];
      for (let t = 1_000, n = 0; t < d.setup.at(-1)!.arriveAt; t += 230, n++) {
        spam.push({ t, x: 500, y: 300 }, { t: t + 80, x: n % 2 ? 380 : 620, y: 300, up: true });
      }
      expect(dribble(d.setup, spam).challenges.filter((c) => c.dodged).length).toBeLessThan(3);
    }
  });

  it("sprint: slow or same-foot presses lose the race", () => {
    for (const seed of seeds("a9", 8)) {
      const d = drill(seed, 60, "pace");
      if (d.game !== "sprint") throw new Error("not sprint");
      expect(hits(d, sprintAll(d.setup, 4))).toBe(0);
      expect(hits(d, sprintAll(d.setup, 12, true))).toBe(0);
      // Presses before GO are false starts and do not count.
      const early = sprintAll(d.setup, 9).map((c) => ({ ...c, t: c.t - 700 }));
      expect(hits(d, early)).toBeLessThan(hits(d, sprintAll(d.setup, 9)));
    }
  });

  it("tackles: biting on the feint, diving in early or the wrong way fails", () => {
    for (const seed of seeds("b2", 8)) {
      const d = drill(seed, 60, "defending");
      if (d.game !== "tackles") throw new Error("not tackles");
      expect(hits(d, tackleAll(d.setup, (x) => x.cutAt - 450, (x) => x.side))).toBe(0);
      expect(hits(d, tackleAll(d.setup, (x) => x.cutAt + 80, (x) => -x.side))).toBe(0);
      const bite = tackleAll(d.setup, (x) => (x.feintAt ?? x.cutAt) + 100, (x) => (x.feintAt ? -x.side : x.side));
      const feints = d.setup.filter((x) => x.feintAt).length;
      expect(tackles(d.setup, bite).filter((x) => x.feintAt && x.won).length).toBe(0);
      expect(feints).toBeLessThanOrEqual(6);
    }
  });

  it("gets harder as the skill rises", () => {
    let easy = 0;
    let hard = 0;
    for (const seed of seeds("d1", 40)) {
      const trace = kickAll(5, (k) => (k % 2 ? 2.4 : -2.4), 0.9);
      easy += goals(penalties(penaltySetup(seed, 20), trace));
      hard += goals(penalties(penaltySetup(seed, 95), trace));
    }
    expect(hard).toBeLessThan(easy);
    let [e, h] = [0, 0];
    for (const skill of ["passing", "dribbling", "pace", "defending"] as const) {
      for (const seed of seeds("d2", 10)) {
        // The same moderate player against an easy and a hard drill.
        const de = drill(seed, 20, skill);
        const dh = drill(seed, 95, skill);
        const mid = (d: Drill) =>
          d.game === "sprint" ? sprintAll(d.setup, 7) : d.game === "dribble" ? dribbleAll(d.setup, 280) : d.game === "tackles" ? tackleAll(d.setup, (x) => x.cutAt + 200, (x) => x.side) : play(d);
        e += hits(de, mid(de));
        h += hits(dh, mid(dh));
      }
    }
    expect(h).toBeLessThan(e);
  });

  it("knows when a drill ends", () => {
    const d = drill(SEED, 50, "pace");
    expect(drillEnd(d, play(d))).toBeLessThan(drillEnd(d, []));
    expect(drillEnd(d, [])).toBeLessThan(60_000);
  });

  it("turns rounds into 0 to 3 points", () => {
    expect([0, 4, 5, 6, 7, 8, 9, 10].map((h) => points(h, 10))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(points(11, 12)).toBe(3);
  });

  it("refuses traces that are not presses", () => {
    expect(implausible(play(drill(SEED, 50, "pace")))).toBeNull();
    expect(implausible("x")).not.toBeNull();
    expect(implausible([{ t: 5, x: 1, y: 1 }, { t: 4, x: 1, y: 1 }])).not.toBeNull();
    expect(implausible([{ t: 5, x: -1, y: 1 }])).not.toBeNull();
    expect(implausible([{ t: 5, x: 1, y: 1, up: "yes" }])).not.toBeNull();
    expect(implausible(Array.from({ length: MAX_CLICKS + 1 }, (_, t) => ({ t, x: 1, y: 1 })))).not.toBeNull();
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

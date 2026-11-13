import { describe, expect, it } from "vitest";
import { atBall, frameAt, keyframes, positions } from "./flow.js";
import { SPOTS } from "./pitch.js";
import type { Formation, MatchEvent } from "./types.js";

const ev = (second: number, home: boolean, kind: MatchEvent["kind"], player = 9): MatchEvent => ({ second, home, kind, player });

describe("the live pitch follows the events", () => {
  const events = [ev(300, true, "saved"), ev(305, true, "corner"), ev(900, false, "foul", 3), ev(930, true, "free_kick", 10), ev(932, true, "goal", 10), ev(2000, false, "missed", 9)];
  const keys = keyframes(events, 0, 2760, 0);

  it("keys are in time order and inside the pitch", () => {
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.t).toBeGreaterThanOrEqual(keys[i - 1]!.t);
    for (const k of keys) {
      expect(k.ball[0]).toBeGreaterThanOrEqual(0);
      expect(k.ball[0]).toBeLessThanOrEqual(100);
      expect(Number.isFinite(k.ball[1])).toBe(true);
    }
  });

  it("the shooter has the ball just before his shot, near the goal he attacks", () => {
    const before = frameAt(keys, 298);
    expect(before.ball[0]).toBeGreaterThan(70); // home attacks to the right
    expect(before.side).toBe(0);
    const goal = frameAt(keys, 932);
    expect(goal.ball[0]).toBeGreaterThan(98); // in the away net
    expect(frameAt(keys, 950).dead).toBe(true);
    // Kick-off by the side that conceded, from the centre.
    expect(frameAt(keys, 932 + 45).ball).toEqual([50, 50]);
  });

  it("a corner is taken from the flag of the goal attacked", () => {
    const k = frameAt(keys, 306);
    expect(k.ball[0]).toBeGreaterThan(98);
    expect(k.ball[1] < 6 || k.ball[1] > 94).toBe(true);
  });

  it("a free kick is placed in front of the goal attacked, and an away miss goes past the home goal", () => {
    expect(frameAt(keys, 925).ball[0]).toBeGreaterThan(70);
    expect(frameAt(keys, 2000).ball[0]).toBeLessThan(2);
  });

  it("the ball moves smoothly: no jump bigger than a long pass between two seconds of play", () => {
    let prev = frameAt(keys, 0).ball;
    for (let s = 1; s < 2760; s++) {
      const f = frameAt(keys, s);
      const d = Math.hypot(f.ball[0] - prev[0], f.ball[1] - prev[1]);
      expect(d).toBeLessThan(60);
      prev = f.ball;
    }
  });

  it("keepers stay in their goal; both blocks cross the halfway line", () => {
    const attack = positions("4-3-3", 0, [80, 50], 0);
    const defend = positions("4-3-3", 1, [80, 50], 0);
    expect(attack[0]![0]).toBeLessThan(5);
    expect(defend[0]![0]).toBeGreaterThan(95);
    expect(Math.max(...attack.slice(1).map((p) => p[0]))).toBeGreaterThan(60); // home forwards in the away half
    expect(Math.min(...defend.slice(1).map((p) => p[0]))).toBeLessThan(80);
    // The man on the ball is at the ball.
    const withBall = positions("4-4-2", 0, [70, 30], 0, 9);
    expect(Math.hypot(withBall[9]![0] - 70, withBall[9]![1] - 30)).toBeLessThan(3);
  });
});

describe("where the elevens stand", () => {
  const FORMATIONS = Object.keys(SPOTS) as Formation[];

  it("at a kick-off and at rest each eleven is in its own half, and the side without the ball is out of the centre circle", () => {
    for (const f of FORMATIONS) {
      for (const restart of ["kickoff", "rest"] as const) {
        const home = positions(f, 0, [50, 50], 0, undefined, { restart });
        const away = positions(f, 1, [50, 50], 0, undefined, { restart });
        expect(Math.max(...home.map((p) => p[0]))).toBeLessThan(50);
        expect(Math.min(...away.map((p) => p[0]))).toBeGreaterThan(50);
        // 9.15 m on a 105 m pitch is under 9 of these units along the pitch.
        for (const p of away) expect(Math.hypot(p[0] - 50, (p[1] - 50) * 0.65)).toBeGreaterThan(9);
        const onBall = home.filter((p) => Math.hypot(p[0] - 50, p[1] - 50) < 3).length;
        expect(onBall).toBe(restart === "kickoff" ? 1 : 0);
      }
    }
  });

  it("a block turns from defending to attacking without a jump, and moves less than the ball", () => {
    for (const f of FORMATIONS) {
      // The ball changes feet at the same place: eased, nobody's place moves more than a step at a time.
      // (The one who pressed and the one who takes the ball have a run to make: they are left out.)
      let before = positions(f, 0, [55, 40], 1, undefined, { attack: 0 });
      const presser = atBall(before, [55, 40]);
      for (let i = 1; i <= 10; i++) {
        const now = positions(f, 0, [55, 40], 0, 5, { attack: i / 10 });
        for (let k = 1; k < 11; k++) if (k !== 5 && k !== presser) expect(Math.hypot(now[k]![0] - before[k]![0], now[k]![1] - before[k]![1])).toBeLessThan(3.5);
        before = now;
      }
      // The ball goes 40 units up the pitch: the back line follows by clearly less.
      const low = positions(f, 0, [30, 50], 0, 9);
      const high = positions(f, 0, [70, 50], 0, 9);
      const line = (out: [number, number][]) => Math.min(...out.slice(1).map((p) => p[0]));
      expect(line(high) - line(low)).toBeGreaterThan(8);
      expect(line(high) - line(low)).toBeLessThan(26);
    }
  });

  it("the one who went to the ball keeps going while another is not clearly nearer", () => {
    const first = positions("4-4-2", 1, [52, 50], 0);
    const presser = atBall(first, [52, 50]);
    const then = positions("4-4-2", 1, [54, 53], 0, undefined, { prefer: presser });
    expect(atBall(then, [54, 53])).toBe(presser);
  });
});

describe("tackles and assists on the live pitch", () => {
  const events = [ev(400, false, "tackle", 4), ev(700, true, "tackle", 6), ev(900, true, "goal", 9), ev(900, true, "assist", 7)];
  const keys = keyframes(events, 0, 2760, 0);
  it("a tackle gives the ball to the tackler's side, and keys stay in order", () => {
    for (let i = 1; i < keys.length; i++) expect(keys[i]!.t).toBeGreaterThanOrEqual(keys[i - 1]!.t);
    expect(frameAt(keys, 399).side).toBe(0); // home was running at him
    expect(frameAt(keys, 402).side).toBe(1);
    expect(frameAt(keys, 702).side).toBe(0);
    expect(frameAt(keys, 900).ball[0]).toBeGreaterThan(98);
  });
});

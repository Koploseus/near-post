import { describe, expect, it } from "vitest";
import { frameAt, keyframes, positions } from "./flow.js";
import type { MatchEvent } from "./types.js";

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

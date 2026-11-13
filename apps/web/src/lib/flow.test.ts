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
    expect(attack[0]![0]).toBeLessThan(9); // a little off his line: his side is camped up the pitch
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

  it("a block turns from defending to attacking without a jump", () => {
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
    }
  });

  it("the side without the ball is goal side of it, and the forwards of the other stay onside", () => {
    for (const f of FORMATIONS) {
      for (const x of [12, 25, 40, 55, 70, 85, 95]) {
        // Home has the ball at x; away defends the goal at x = 100.
        const home = positions(f, 0, [x, 50], 0, 9);
        const away = positions(f, 1, [x, 50], 0);
        const outfield = away.slice(1).map((p) => p[0]);
        const lastLine = Math.max(...outfield);
        // The back line is between the ball and its goal (it stops at the six-yard box when the ball is past it).
        if (x < 90) expect(lastLine).toBeGreaterThan(x);
        // Most of the eleven is behind the ball or level with it.
        expect(outfield.filter((px) => px > x - (x > 90 ? 20 : 9)).length).toBeGreaterThanOrEqual(8);
        // Nobody of the side on the ball waits behind the last defender, but the man on the ball.
        for (let k = 1; k < 11; k++) if (k !== 9) expect(home[k]![0]).toBeLessThanOrEqual(lastLine + 0.5);
        // The elevens keep a team's length: neither a pack nor strung over the whole pitch.
        const len = (out: [number, number][]) => Math.max(...out.slice(1).map((p) => p[0])) - Math.min(...out.slice(1).map((p) => p[0]));
        expect(len(away)).toBeGreaterThan(12);
        expect(len(away)).toBeLessThan(48);
      }
    }
  });

  it("at a corner the box fills up, at a penalty it empties, at a free kick there is a wall", () => {
    const inBox = (out: [number, number][], end: number) => out.slice(1).filter((p) => Math.abs(p[0] - end) < 18 && p[1] > 20 && p[1] < 80).length;
    for (const f of FORMATIONS) {
      // Home's corner, from the top flag at the away end.
      const taking = positions(f, 0, [99.5, 1], 0, 7, { set: "corner" });
      const defending = positions(f, 1, [99.5, 1], 0, undefined, { set: "corner" });
      expect(Math.hypot(taking[7]![0] - 99.5, taking[7]![1] - 1)).toBeLessThan(3);
      expect(inBox(taking, 100)).toBeGreaterThanOrEqual(5);
      expect(inBox(defending, 100)).toBeGreaterThanOrEqual(7);
      expect(defending[0]![0]).toBeGreaterThan(97);
      // Away's penalty at the home end: only the taker and the keeper in the box.
      const pen = positions(f, 1, [11, 50], 1, 9, { set: "penalty" });
      const facing = positions(f, 0, [11, 50], 1, undefined, { set: "penalty" });
      expect(inBox(pen, 0)).toBe(1);
      expect(inBox(facing, 0)).toBe(0);
      expect(facing[0]![0]).toBeLessThan(2);
      // Home's free kick 24 from goal: four of the away side stand between the ball and their goal.
      const wall = positions(f, 1, [76, 40], 0, undefined, { set: "free_kick" }).slice(1).filter((p) => Math.abs(p[0] - 85) < 0.6 && Math.abs(p[1] - 41) < 6);
      expect(wall).toHaveLength(4);
    }
  });

  it("the shooter gets the last pass and strikes it, and a set piece's keys say which", () => {
    const keys = keyframes([ev(600, true, "goal", 9), ev(900, false, "corner", 6), ev(1500, true, "penalty", 10), ev(1500, true, "goal", 10)], 0, 2700, 0);
    const strike = keys.findIndex((k) => k.move === "shot");
    expect(keys[strike]!.t).toBe(598);
    expect(keys[strike]!.carrier).toBe(9);
    // He took a touch: the key before is his too, and the ball came to him from a team-mate.
    expect(keys[strike - 1]!.carrier).toBe(9);
    expect(keys[strike - 2]!.move).toBe("pass");
    expect(keys[strike - 2]!.side).toBe(0);
    expect(keys[strike - 2]!.carrier).not.toBe(9);
    expect(frameAt(keys, 902).set).toBe("corner");
    expect(frameAt(keys, 1495).set).toBe("penalty");
    expect(frameAt(keys, 700).set).toBeUndefined();
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

describe("the football between the events", () => {
  const events = [ev(74, false, "tackle", 10), ev(169, true, "tackle", 4), ev(241, false, "saved", 10), ev(246, false, "corner", 10), ev(251, false, "goal", 3), ev(525, true, "foul", 6), ev(526, true, "yellow", 6), ev(915, false, "penalty", 7), ev(917, false, "saved", 7), ev(1226, false, "missed", 10), ev(1500, true, "goal", 9), ev(1500, true, "assist", 7), ev(2000, true, "red", 5), ev(2400, true, "tackle", 2)];
  const RATE = 4.5;
  const keys = keyframes(events, 0, 2760, 0, { formations: ["4-3-3", "4-2-3-1"], rate: RATE });
  const legs = keys.slice(1).map((b, i) => ({ a: keys[i]!, b, d: Math.hypot(b.ball[0] - keys[i]!.ball[0], b.ball[1] - keys[i]!.ball[1]), dt: (b.t - keys[i]!.t) / RATE }));

  it("the ball is passed from one player to another, hundreds of times a half", () => {
    const passes = legs.filter((l) => l.a.move === "pass");
    expect(passes.length).toBeGreaterThan(150);
    // A pass leaves a player's feet and, in open play, arrives at another's.
    for (const l of passes) expect(l.a.carrier).toBeDefined();
    const open = passes.filter((l) => !l.b.dead);
    for (const l of open) expect(l.b.carrier).toBeDefined();
    for (const l of open) if (l.a.side === l.b.side) expect(l.b.carrier).not.toBe(l.a.carrier);
    // Some are cut out: the ball changes sides in open play too.
    expect(open.filter((l) => l.a.side !== l.b.side).length).toBeGreaterThan(8);
  });

  it("a man with the ball goes at a runner's pace, a pass at a pass's", () => {
    for (const l of legs.filter((l) => l.a.move === "carry")) expect(l.d / Math.max(l.dt, 0.01)).toBeLessThan(5.6);
    const speeds = legs.filter((l) => l.a.move === "pass" && l.dt > 0.3).map((l) => l.d / l.dt).sort((x, y) => x - y);
    expect(speeds[Math.floor(speeds.length / 2)]!).toBeGreaterThan(14);
    expect(speeds[Math.floor(speeds.length * 0.9)]!).toBeLessThan(40);
    // Nobody keeps the ball for ever.
    for (const l of legs.filter((l) => l.a.move === "carry")) expect(l.dt).toBeLessThan(4.5);
  });

  it("the ball is at the feet of the player the event names", () => {
    // The side that is tackled was carrying the ball; the tackler has it after.
    expect(frameAt(keys, 73).side).toBe(0);
    expect(frameAt(keys, 73).move).toBe("carry");
    expect(frameAt(keys, 75.5).carrier).toBe(10);
    expect(frameAt(keys, 75.5).side).toBe(1);
    // The assist: the scorer's pass came from the one who is credited with it.
    const strike = keys.findIndex((k) => k.move === "shot" && k.t === 1498);
    expect(keys[strike]!.carrier).toBe(9);
    const pass = keys.slice(0, strike).reverse().find((k) => k.move === "pass")!;
    expect(pass.carrier).toBe(7);
    // And the kick-off after it waits for the elevens to be back in their halves.
    expect(frameAt(keys, 1530).set).toBe("kickoff");
    expect(frameAt(keys, 1530).side).toBe(1);
    expect(frameAt(keys, 1545.5).ball).toEqual([50, 50]);
    // The corner is headed in by the scorer, from the flag.
    const header = keys.find((k) => k.move === "shot" && k.t === 249)!;
    expect(header.carrier).toBe(3);
    // Sent off: he is not passed to again.
    expect(keys.filter((k) => k.t > 2001 && k.side === 0 && k.carrier === 5)).toHaveLength(0);
  });

  it("a ball on its way has no carrier, and says who it is going to", () => {
    const i = keys.findIndex((k, j) => j > 4 && k.move === "pass" && !k.dead && keys[j + 1]!.t - k.t > 1);
    const f = frameAt(keys, (keys[i]!.t + keys[i + 1]!.t) / 2);
    expect(f.carrier).toBeUndefined();
    expect(f.flight).toBeDefined();
    expect(f.next).toEqual({ side: keys[i + 1]!.side, k: keys[i + 1]!.carrier, at: keys[i + 1]!.ball });
    // On the ball: nobody of his side is at the ball when it is free, the carrier is when he has it.
    const free = positions("4-3-3", 0, [60, 40], 0, undefined, { free: true });
    expect(free.slice(1).every((p) => Math.hypot(p[0] - 60, p[1] - 40) > 2)).toBe(true);
    const keeper = positions("4-3-3", 0, [5, 50], 0, 0);
    expect(keeper[0]).toEqual([5, 50]);
    expect(keeper.slice(1).every((p) => Math.hypot(p[0] - 5, p[1] - 50) > 5)).toBe(true);
  });
});

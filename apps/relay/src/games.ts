/**
 * The other three training games (passing, dribbling, pace, defending),
 * shared by the web app and the relay like penalty.ts. No imports.
 *
 * Every game is a few rounds played one after another. Inputs are presses
 * (and releases) on a 1000 × 600 screen, with their time since the start;
 * keyboard keys arrive as presses on the left or right half. Each round's
 * outcome depends only on the seed, the level and those inputs.
 *
 * - Through balls (passing): from your feet, a teammate makes his run and
 *   defenders shift across. Press on the ball, drag to where the pass should
 *   go, release; a quick swipe plays it harder (harder to cut out, harder to
 *   control).
 * - Dribble (dribbling): you run at goal and defenders come in with slide
 *   tackles. Each commits to the lane you are in; swipe left or right after
 *   he commits and before he arrives.
 * - Sprint (pace): race a defender to a ball played into space. Press left
 *   and right in turn (or ←/→) to run; the same side twice is a stumble, and
 *   pressing before "GO" does not count.
 * - Tackles (defending): an attacker runs at you and cuts left or right,
 *   sometimes after a feint. Swipe to the side he goes, as he goes.
 */

export interface Press {
  t: number;
  x: number;
  y: number;
  up?: boolean;
}

export const SCREEN = { w: 1000, h: 600 } as const;

function rng(seedHex: string): () => number {
  if (!/^[0-9a-f]{16,}$/.test(seedHex)) throw new Error("bad drill seed");
  let a = 0x811c9dc5;
  for (let i = 0; i < seedHex.length; i++) a = Math.imul(a ^ seedHex.charCodeAt(i), 0x01000193);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The press-and-release pairs that start inside [from, to], first one first. */
function swipes(trace: Press[], from: number, to: number): { down: Press; up: Press }[] {
  const out: { down: Press; up: Press }[] = [];
  for (let i = 0; i < trace.length; i++) {
    const d = trace[i]!;
    if (d.up || d.t < from || d.t > to) continue;
    const u = trace.slice(i + 1).find((e) => e.up);
    if (u) out.push({ down: d, up: u });
  }
  return out;
}

// ---------------------------------------------------------------- passes

export const PASSER = { x: 500, y: 530, grab: 70 } as const;
export const PASS_ROUND_MS = 6_500;

export interface PassRound {
  mate: { x0: number; y0: number; vx: number; vy: number };
  defenders: { x0: number; y: number; amp: number; period: number; phase: number }[];
}
export interface PassPlay {
  start: number;
  end: number;
  pass: null | { down: Press; up: Press; speed: number; flight: number; result: "received" | "cut" | "overhit" | "short"; cutBy: number; cutF: number };
}

export function passSetup(seedHex: string, level: number): PassRound[] {
  const r = rng(seedHex);
  const hard = clamp(level, 1, 99) / 99;
  return Array.from({ length: 5 }, () => {
    const fromLeft = r() < 0.5;
    const pace = 1 + 0.35 * hard;
    return {
      mate: { x0: fromLeft ? 170 : 830, y0: 400, vx: (fromLeft ? 0.075 : -0.075) * pace * (0.8 + r() * 0.4), vy: -0.06 * pace * (0.8 + r() * 0.4) },
      defenders: Array.from({ length: 2 + Math.round(hard * 2) }, (_, i) => ({
        x0: 200 + r() * 600,
        y: 200 + i * 55 + r() * 30,
        amp: 90 + r() * 120 + 60 * hard,
        period: 520 - 160 * hard + r() * 200,
        phase: r() * Math.PI * 2,
      })),
    };
  });
}

export function mateAt(m: PassRound["mate"], ms: number): { x: number; y: number } {
  const t = Math.max(0, ms);
  return { x: m.x0 + m.vx * t, y: Math.max(90, m.y0 + m.vy * t) };
}

export function defenderAt(d: PassRound["defenders"][number], ms: number): { x: number; y: number } {
  return { x: d.x0 + d.amp * Math.sin(ms / d.period + d.phase), y: d.y };
}

export function passes(rounds: PassRound[], trace: Press[]): PassPlay[] {
  const out: PassPlay[] = [];
  let start = 900;
  let used = -1;
  for (const round of rounds) {
    const s = swipes(trace, start, start + PASS_ROUND_MS).find(
      (sw) => sw.down.t > used && Math.hypot(sw.down.x - PASSER.x, sw.down.y - PASSER.y) <= PASSER.grab,
    );
    let pass: PassPlay["pass"] = null;
    if (s) {
      used = s.up.t;
      const swipe = Math.hypot(s.up.x - s.down.x, s.up.y - s.down.y) / Math.max(50, s.up.t - s.down.t);
      const power = clamp((swipe - 0.25) / 1.5, 0, 1);
      const speed = 0.45 + 0.85 * power; // screen units per ms
      const flight = Math.hypot(s.up.x - PASSER.x, s.up.y - PASSER.y) / speed;
      let result: "received" | "cut" | "overhit" | "short" = "received";
      let cutBy = -1;
      let cutF = 1;
      for (let i = 1; i <= 16 && cutBy < 0; i++) {
        const f = i / 16;
        cutF = f;
        const b = { x: PASSER.x + (s.up.x - PASSER.x) * f, y: PASSER.y + (s.up.y - PASSER.y) * f };
        round.defenders.forEach((d, n) => {
          const p = defenderAt(d, s.up.t + flight * f - start);
          if (cutBy < 0 && Math.hypot(p.x - b.x, p.y - b.y) < 34) cutBy = n;
        });
      }
      if (cutBy >= 0) result = "cut";
      else {
        const mate = mateAt(round.mate, s.up.t + flight - start);
        const control = 75 - 35 * power;
        const d = Math.hypot(mate.x - s.up.x, mate.y - s.up.y);
        if (d > control) result = (mate.y - s.up.y) > 0 ? "overhit" : "short";
      }
      pass = { down: s.down, up: s.up, speed, flight, result, cutBy, cutF };
    }
    const end = pass ? pass.up.t + pass.flight + 1_600 : start + PASS_ROUND_MS;
    out.push({ start, end, pass });
    start = end;
  }
  return out;
}

// ---------------------------------------------------------------- dribble

export interface Challenge {
  commitAt: number;
  arriveAt: number;
  /** Lane the defender comes from: -1 left, 1 right (looks only). */
  from: -1 | 1;
}
export interface DribblePlay {
  challenges: (Challenge & { target: number; dodged: boolean })[];
  end: number;
}

export function dribbleSetup(seedHex: string, level: number): Challenge[] {
  const r = rng(seedHex);
  const hard = clamp(level, 1, 99) / 99;
  const gap = 1_500 - 450 * hard;
  return Array.from({ length: 8 }, (_, i) => {
    const commitAt = Math.round(1_800 + i * gap + r() * 250);
    return { commitAt, arriveAt: commitAt + Math.round(560 - 240 * hard), from: r() < 0.5 ? -1 : 1 };
  });
}

/** Your lane (-1, 0, 1) at `t`: each sideways swipe moves you one lane, a moment after you let go. */
export function laneAt(trace: Press[], t: number): number {
  let lane = 0;
  for (let i = 0; i < trace.length; i++) {
    const d = trace[i]!;
    if (d.up) continue;
    const u = trace.slice(i + 1).find((e) => e.up);
    if (!u || u.t + 110 > t) continue;
    const dx = u.x - d.x;
    if (Math.abs(dx) >= 40) lane = clamp(lane + Math.sign(dx), -1, 1);
  }
  return lane;
}

export function dribble(challenges: Challenge[], trace: Press[]): DribblePlay {
  const out = challenges.map((c) => {
    const target = laneAt(trace, c.commitAt);
    // You must be set in your lane before he commits (no swiping all the
    // time) and out of it when he arrives.
    const set = laneAt(trace, c.commitAt - 300) === target;
    return { ...c, target, dodged: set && laneAt(trace, c.arriveAt) !== target };
  });
  return { challenges: out, end: challenges[challenges.length - 1]!.arriveAt + 1_400 };
}

// ---------------------------------------------------------------- sprint

export const SPRINT_M = 30;
export const SET_MS = 1_600;
const RACE_MAX_MS = 9_000;

export interface Race {
  /** Defender's top speed (m/s) and how fast he gets there. */
  rival: number;
  /** The rival starts this late after GO (ms). */
  delay: number;
}
export interface RacePlay {
  start: number;
  go: number;
  end: number;
  /** Time (ms after GO) to the ball, or null if he never got there. */
  you: number | null;
  rival: number;
  won: boolean;
}

export function sprintSetup(seedHex: string, level: number): Race[] {
  const r = rng(seedHex);
  const hard = clamp(level, 1, 99) / 99;
  return Array.from({ length: 5 }, () => ({ rival: 6.0 + 2.4 * hard + r() * 0.6, delay: 150 + r() * 250 }));
}

/** Distance (m) the rival has run `ms` after GO. */
export function rivalAt(race: Race, ms: number): number {
  const t = Math.max(0, ms - race.delay) / 1000;
  // Accelerates over the first 0.8 s, then holds his speed.
  return t < 0.8 ? (race.rival * t * t) / 1.6 : race.rival * 0.4 + race.rival * (t - 0.8);
}

/**
 * Your run after GO, in 10 ms steps up to `ms`: each press on the other side
 * from the last one is a stride (+1.25 m/s, up to 10); the same side twice is
 * a stumble; you slow down between strides. Presses before GO do not count.
 */
export function runnerAt(trace: Press[], go: number, ms: number): { d: number; v: number; strides: number; reachedAt: number | null } {
  let v = 0;
  let d = 0;
  let strides = 0;
  let side = 0;
  let reachedAt: number | null = null;
  const steps = trace.filter((p) => !p.up && p.t >= go && p.t <= go + ms);
  let k = 0;
  for (let t = 0; t <= ms; t += 10) {
    while (k < steps.length && steps[k]!.t - go <= t) {
      const s = steps[k]!.x < SCREEN.w / 2 ? -1 : 1;
      if (s !== side) {
        v = Math.min(10, v + 1.25);
        strides++;
      } else v *= 0.6;
      side = s;
      k++;
    }
    v -= v * 0.9 * 0.01;
    d += v * 0.01;
    if (reachedAt === null && d >= SPRINT_M) reachedAt = t;
  }
  return { d, v, strides, reachedAt };
}

/** When the rival reaches the ball (ms after GO). */
export function rivalTime(race: Race): number {
  let t = 0;
  while (rivalAt(race, t) < SPRINT_M) t += 10;
  return t;
}

export function sprints(races: Race[], trace: Press[]): RacePlay[] {
  const out: RacePlay[] = [];
  let start = 900;
  for (const race of races) {
    const go = start + SET_MS;
    const rival = rivalTime(race);
    const you = runnerAt(trace, go, RACE_MAX_MS).reachedAt;
    const won = you !== null && you < rival;
    // The race is over when the first one gets to the ball.
    const end = go + (won ? you : rival) + 1_500;
    out.push({ start, go, end, you, rival, won });
    start = end;
  }
  return out;
}

// ---------------------------------------------------------------- tackles

export interface Duel {
  start: number;
  run: number;
  cutAt: number;
  side: -1 | 1;
  /** A feint to the other side first, at this time (or null). */
  feintAt: number | null;
  late: number;
}
export interface DuelPlay extends Duel {
  end: number;
  tackle: null | { at: number; side: number };
  won: boolean;
}

export function tackleSetup(seedHex: string, level: number): Duel[] {
  const r = rng(seedHex);
  const hard = clamp(level, 1, 99) / 99;
  const out: Duel[] = [];
  let start = 1_200;
  for (let i = 0; i < 6; i++) {
    const run = Math.round(2_700 - 800 * hard + r() * 400);
    const cutAt = start + Math.round(run * (0.62 + r() * 0.15));
    const feint = r() < 0.15 + 0.4 * hard;
    out.push({ start, run, cutAt, side: r() < 0.5 ? -1 : 1, feintAt: feint ? cutAt - 480 : null, late: Math.round(280 - 110 * hard) });
    start += run + 1_500;
  }
  return out;
}

export function tackles(duels: Duel[], trace: Press[]): DuelPlay[] {
  return duels.map((d) => {
    const sw = swipes(trace, d.start, d.start + d.run).find((s) => Math.abs(s.up.x - s.down.x) >= 40);
    const tackle = sw ? { at: sw.up.t, side: Math.sign(sw.up.x - sw.down.x) } : null;
    const won = !!tackle && tackle.side === d.side && tackle.at >= d.cutAt - 130 && tackle.at <= d.cutAt + d.late;
    return { ...d, end: d.start + d.run + 1_500, tackle, won };
  });
}

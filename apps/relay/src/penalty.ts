/**
 * The penalty game (shooting and physical training), shared by the web app
 * and the relay. No imports: it runs the same in the browser and in Node.
 *
 * Five penalties from behind the ball. Press on the ball, drag towards the
 * spot of the goal you aim at and release: the direction is where you
 * release, the power is how fast you swipe. A hard shot leaves the keeper
 * less time but drifts more (wide, over the bar). The keeper sways on his
 * line, reacts after a moment and dives: sometimes he reads you, sometimes
 * he guesses. Everything comes from the ticket's seed and the trace of
 * presses and releases, so the relay replays it exactly.
 */

/** The screen the game is drawn on (logical units). */
export const SCREEN = { w: 1000, h: 600 } as const;
/** The ball on the spot, and how close a press must be to take it. */
export const BALL = { x: 500, y: 512, grab: 70 } as const;
/** The goal mouth on screen: posts and crossbar, and the goal line. */
export const GOAL_SCREEN = { left: 300, right: 700, top: 178, bottom: 330 } as const;
/** The real goal, in metres. */
export const GOAL_M = { halfWidth: 3.66, height: 2.44 } as const;
const DISTANCE_M = 11;
const KICKS = 5;
/** Longest a kick waits for its shot before it counts as missed. */
const KICK_TIMEOUT_MS = 12_000;
/** Time to watch the result before the next kick. */
const AFTER_MS = 1_900;
const FIRST_MS = 900;

export interface Press {
  t: number;
  x: number;
  y: number;
  /** True when the button is released. */
  up?: boolean;
}

export interface PenaltySetup {
  level: number;
  /** Per kick: the keeper's sway phase, his guess, read chance roll, and the shot's drift. */
  kicks: { phase: number; guess: number; readRoll: number; driftX: number; driftY: number }[];
}

export type Result = "goal" | "saved" | "wide" | "over" | "post" | "none";

export interface Shot {
  /** Press and release times (drill time). */
  down: number;
  up: number;
  /** Where the ball crosses the goal line, in metres (x from the centre, y up from the grass). */
  target: { x: number; y: number };
  /** Ball speed in m/s and its flight time in ms. */
  speed: number;
  flight: number;
  /** Keeper: where he stood when the ball was struck, where he dives, when. */
  keeper: { from: number; to: number; reactAt: number; reachAt: number };
  result: Result;
}

export interface Kick {
  start: number;
  end: number;
  shot: Shot | null;
}

/** mulberry32 seeded with an FNV-1a hash of the whole seed. */
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

export function penaltySetup(seedHex: string, level: number): PenaltySetup {
  const r = rng(seedHex);
  return {
    level: Math.min(99, Math.max(1, Math.round(level))),
    kicks: Array.from({ length: KICKS }, () => ({
      phase: r() * Math.PI * 2,
      guess: [-2.4, -1.2, 0, 1.2, 2.4][Math.floor(r() * 5)]!,
      readRoll: r(),
      driftX: r() * 2 - 1,
      driftY: r() * 2 - 1,
    })),
  };
}

/** Where the keeper stands on his line at `ms` into a kick, before the shot (metres). */
export function sway(phase: number, ms: number): number {
  return 0.55 * Math.sin(ms / 430 + phase) + 0.2 * Math.sin(ms / 170 + phase * 2);
}

/** Screen position of a point of the goal plane (metres). */
export function toScreen(x: number, y: number): { x: number; y: number } {
  const sx = (GOAL_SCREEN.right - GOAL_SCREEN.left) / (2 * GOAL_M.halfWidth);
  const sy = (GOAL_SCREEN.bottom - GOAL_SCREEN.top) / GOAL_M.height;
  return { x: (GOAL_SCREEN.left + GOAL_SCREEN.right) / 2 + x * sx, y: GOAL_SCREEN.bottom - y * sy };
}

/** The goal-plane point (metres) under a screen point. */
export function toGoal(px: number, py: number): { x: number; y: number } {
  const sx = (GOAL_SCREEN.right - GOAL_SCREEN.left) / (2 * GOAL_M.halfWidth);
  const sy = (GOAL_SCREEN.bottom - GOAL_SCREEN.top) / GOAL_M.height;
  return { x: (px - (GOAL_SCREEN.left + GOAL_SCREEN.right) / 2) / sx, y: (GOAL_SCREEN.bottom - py) / sy };
}

/** Strikes one penalty: from a press on the ball and its release. */
function strike(s: PenaltySetup, k: number, start: number, down: Press, up: Press): Shot {
  const p = s.kicks[k]!;
  const hard = s.level / 99;
  const aim = toGoal(up.x, up.y);
  // Power from the swipe speed (screen units per ms): a flick is 1.5 and more.
  const swipe = Math.hypot(up.x - down.x, up.y - down.y) / Math.max(50, up.t - down.t);
  const power = Math.min(1, Math.max(0, (swipe - 0.25) / 1.6));
  const speed = 13 + 17 * power;
  // Harder hits drift more; a better player drifts less.
  const control = 1.15 - 0.6 * (s.level / 99);
  const drift = (0.15 + 1.15 * power * power) * control;
  const target = {
    x: aim.x + p.driftX * drift,
    y: Math.max(0.05, aim.y + p.driftY * drift * 0.7 + 0.5 * power * power * control),
  };
  const flight = Math.round((DISTANCE_M / speed) * 1000);
  // The keeper gets sharper as the trained skill rises.
  const from = sway(p.phase, up.t - start);
  const reads = p.readRoll < 0.28 + 0.3 * hard;
  const to = reads ? target.x + (p.driftX * 0.5) : p.guess;
  const react = Math.round(300 - 130 * hard);
  const vk = 7.0 + 1.8 * hard; // lateral m/s when diving
  const travel = vk * Math.max(0, (flight - react) / 1000);
  const at = from + Math.max(-travel, Math.min(travel, to - from));
  const reachUp = 2.4 - 0.1 * Math.abs(at); // diving to the corners, he reaches less high
  let result: Result;
  if (target.y > GOAL_M.height + 0.02) result = "over";
  else if (Math.abs(target.x) > GOAL_M.halfWidth + 0.02) result = "wide";
  else if (Math.abs(Math.abs(target.x) - GOAL_M.halfWidth) < 0.08 || Math.abs(target.y - GOAL_M.height) < 0.06) result = "post";
  else if (Math.abs(target.x - at) < 1.0 && target.y < reachUp) result = "saved";
  // Down the middle, his trailing legs block low shots even when he dives.
  else if (Math.abs(target.x - from) < 0.55 && target.y < 1.1) result = "saved";
  else result = "goal";
  return {
    down: down.t,
    up: up.t,
    target,
    speed,
    flight,
    keeper: { from, to: at, reactAt: up.t + react, reachAt: up.t + flight },
    result,
  };
}

/**
 * The five kicks played by a trace of presses and releases: when each
 * starts and ends, and its shot. A kick takes the first press on the ball
 * after it starts and the release that follows.
 */
export function penalties(s: PenaltySetup, trace: Press[]): Kick[] {
  const kicks: Kick[] = [];
  let start = FIRST_MS;
  let i = 0;
  for (let k = 0; k < s.kicks.length; k++) {
    let shot: Shot | null = null;
    while (i < trace.length) {
      const d = trace[i]!;
      if (d.t > start + KICK_TIMEOUT_MS) break;
      i++;
      if (d.up || d.t < start || Math.hypot(d.x - BALL.x, d.y - BALL.y) > BALL.grab) continue;
      const u = trace.slice(i).find((e) => e.up);
      if (!u || u.t > start + KICK_TIMEOUT_MS) break;
      i = trace.indexOf(u, i) + 1;
      shot = strike(s, k, start, d, u);
      break;
    }
    const end = shot ? shot.up + shot.flight + AFTER_MS : start + KICK_TIMEOUT_MS;
    kicks.push({ start, end, shot });
    start = end;
  }
  return kicks;
}

/** Goals scored. */
export function goals(kicks: Kick[]): number {
  return kicks.filter((k) => k.shot?.result === "goal").length;
}

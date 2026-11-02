/**
 * The training drills, shared by the web app (which plays them) and the relay
 * (which replays the clicks and signs the score). No imports: they run the
 * same in the browser and in Node.
 *
 * Four football drills, one per family of skills. Each is fully set by the
 * ticket's seed (from the chain) and the trained skill's level, which makes
 * it harder as the skill rises; the score depends only on the click times
 * and places, so the relay can replay it exactly.
 *
 * - Penalties (shooting, physical): five kicks from behind the ball; see
 *   penalty.ts.
 * - Through balls (passing): a teammate runs across, defenders stand in the
 *   way. Click where the pass should go: it must reach him, not them.
 * - Slalom (dribbling, pace): you run up the pitch between cones. Click to
 *   switch side and pass each cone on the free side.
 * - Tackles (defending): an attacker runs at you pushing the ball. Click when
 *   the ball is furthest from his feet.
 */

import { type PenaltySetup, goals, penalties, penaltySetup } from "./penalty.js";

export const FIELD = { w: 1000, h: 600 } as const;
export const REACTION_MS = 120;
export const MAX_CLICKS = 80;

export type Skill = "pace" | "shooting" | "passing" | "dribbling" | "defending" | "physical";
export type Game = "penalties" | "passes" | "slalom" | "tackles";

export interface Click {
  /** Milliseconds since the drill started. */
  t: number;
  x: number;
  y: number;
  /** Penalties: true when the button is released (presses have no flag). */
  up?: boolean;
}

export const GAME_OF: Record<Skill, Game> = {
  shooting: "penalties",
  physical: "penalties",
  passing: "passes",
  dribbling: "slalom",
  pace: "slalom",
  defending: "tackles",
};

/** Where a pass starts (through balls). */
export const PASSER = { x: 500, y: 560 } as const;
const PASS_SPEED = 1.3; // field units per millisecond
/** Lanes of the slalom, and how long a switch takes. */
export const LANES = [380, 620] as const;
const SWITCH_MS = 160;

export interface Pass {
  start: number;
  window: number;
  mate: { x0: number; y: number; vx: number };
  defenders: { x: number; y: number }[];
}
export interface Cone {
  at: number;
  side: 0 | 1;
}
export interface Duel {
  start: number;
  window: number;
  period: number;
  /** Fraction of the touch (0 to 1) the ball must be out for a clean tackle. */
  need: number;
}

export type Drill =
  | { game: "penalties"; setup: PenaltySetup; rounds: unknown[]; end: number }
  | { game: "passes"; rounds: Pass[]; end: number }
  | { game: "slalom"; rounds: Cone[]; end: number }
  | { game: "tackles"; rounds: Duel[]; end: number };

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

/** The drill for a ticket: its game and every round, from the seed. `level` is the skill (1 to 99). */
export function drill(seedHex: string, level: number, skill: Skill): Drill {
  const r = rng(seedHex);
  const l = Math.min(99, Math.max(1, Math.round(level)));
  const hard = l / 99; // 0 easy … 1 hard
  switch (GAME_OF[skill]) {
    case "penalties": {
      const setup = penaltySetup(seedHex, l);
      // The longest it can last; the real end depends on when you shoot.
      return { game: "penalties", setup, rounds: setup.kicks, end: 5 * 14_000 };
    }
    case "passes": {
      const rounds: Pass[] = [];
      let t = 1200;
      for (let i = 0; i < 10; i++) {
        const fromLeft = r() < 0.5;
        const speed = 0.18 + 0.17 * hard + r() * 0.06;
        const y = 120 + Math.round(r() * 200);
        const x0 = fromLeft ? 60 : FIELD.w - 60;
        const defenders = Array.from({ length: 2 + Math.round(hard * 2) }, () => ({
          x: 160 + Math.round(r() * 680),
          y: y + 90 + Math.round(r() * 220),
        }));
        rounds.push({ start: t, window: 2200, mate: { x0, y, vx: fromLeft ? speed : -speed }, defenders });
        t += 2200 + 800;
      }
      return { game: "passes", rounds, end: t };
    }
    case "slalom": {
      const rounds: Cone[] = [];
      const gap = Math.round(1000 - 420 * hard);
      let t = 1500;
      let side: 0 | 1 = 0;
      for (let i = 0; i < 12; i++) {
        // Mostly alternating, sometimes the same side twice.
        side = (r() < 0.75 ? 1 - side : side) as 0 | 1;
        rounds.push({ at: t, side });
        t += gap + Math.round(r() * 200);
      }
      return { game: "slalom", rounds, end: t + 600 };
    }
    case "tackles": {
      const rounds: Duel[] = [];
      let t = 1200;
      for (let i = 0; i < 10; i++) {
        const period = Math.round(900 - 380 * hard + r() * 200);
        rounds.push({ start: t, window: 2400, period, need: 0.7 + 0.15 * hard });
        t += 2400 + 700;
      }
      return { game: "tackles", rounds, end: t };
    }
  }
}

/** Where the running teammate is at `t`. */
export function mateAt(p: Pass, t: number): { x: number; y: number } {
  return { x: p.mate.x0 + p.mate.vx * (t - p.start), y: p.mate.y };
}

/** How far the ball is from the attacker's feet, 0 to 1, at `t` in a duel. */
export function ballOut(d: Duel, t: number): number {
  return Math.abs(Math.sin((Math.PI * (t - d.start)) / d.period));
}

/** The slalom lane (0 or 1) at `t`: every click switches side, after a short move. */
export function laneAt(clicks: Click[], t: number): 0 | 1 {
  let lane: 0 | 1 = 0;
  for (const c of clicks) if (c.t + SWITCH_MS <= t) lane = (1 - lane) as 0 | 1;
  return lane;
}

/** The first click of a round's window, if any (each round takes one try). */
function tryIn(clicks: Click[], from: number, to: number): Click | undefined {
  return clicks.find((c) => c.t >= from + REACTION_MS && c.t <= to);
}

/** Distance from point p to the segment a-b. */
function toSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const len = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Each round's outcome: true for a goal, a pass received, a cone passed, a clean tackle. */
export function outcomes(d: Drill, clicks: Click[]): boolean[] {
  const cs = clicks.slice(0, MAX_CLICKS);
  switch (d.game) {
    case "penalties":
      return penalties(d.setup, cs).map((k) => k.shot?.result === "goal");
    case "passes":
      return d.rounds.map((p) => {
        const c = tryIn(cs, p.start, p.start + p.window);
        if (!c) return false;
        const flight = Math.hypot(c.x - PASSER.x, c.y - PASSER.y) / PASS_SPEED;
        const mate = mateAt(p, c.t + flight);
        const reached = Math.hypot(mate.x - c.x, mate.y - c.y) <= 55;
        const cut = p.defenders.some((df) => toSegment(df, PASSER, c) <= 34);
        return reached && !cut;
      });
    case "slalom":
      return d.rounds.map((cone) => laneAt(cs, cone.at) !== cone.side);
    case "tackles":
      return d.rounds.map((duel) => {
        const c = tryIn(cs, duel.start, duel.start + duel.window);
        return !!c && ballOut(duel, c.t) >= duel.need;
      });
  }
}

/** When a played drill is over (penalties end with the last kick). */
export function drillEnd(d: Drill, clicks: Click[]): number {
  if (d.game !== "penalties") return d.end;
  const kicks = penalties(d.setup, clicks.slice(0, MAX_CLICKS));
  return kicks[kicks.length - 1]!.end;
}

/** Successful rounds. */
export function hits(d: Drill, clicks: Click[]): number {
  if (d.game === "penalties") return goals(penalties(d.setup, clicks.slice(0, MAX_CLICKS)));
  return outcomes(d, clicks).filter(Boolean).length;
}

/** Skill points for a score: 90% of the rounds give 3, 70% give 2, 50% give 1. */
export function points(hit: number, total: number): number {
  const r = total > 0 ? hit / total : 0;
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : r >= 0.5 ? 1 : 0;
}

/** Why a trace is not believable, or null. */
export function implausible(clicks: unknown): string | null {
  if (!Array.isArray(clicks) || clicks.length > MAX_CLICKS) return "too many clicks";
  let last = -1;
  for (const c of clicks) {
    const ok =
      typeof c === "object" &&
      c !== null &&
      [c.t, c.x, c.y].every((v) => typeof v === "number" && Number.isFinite(v)) &&
      c.t >= last &&
      c.t <= 60_000 &&
      c.x >= 0 &&
      c.x <= FIELD.w &&
      c.y >= 0 &&
      c.y <= FIELD.h;
    if (!ok) return "malformed clicks";
    last = c.t;
  }
  return null;
}

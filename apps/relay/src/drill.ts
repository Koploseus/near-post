/**
 * The training drills, shared by the web app (which plays them) and the relay
 * (which replays the inputs and signs the score). No imports outside this
 * folder: they run the same in the browser and in Node.
 *
 * One football game per family of skills, each fully set by the ticket's
 * seed (from the chain) and the trained skill's level, which makes it harder
 * as the skill rises. The score depends only on the trace of presses and
 * releases, so the relay can replay it exactly.
 *
 * - Penalties (shooting, physical): see penalty.ts.
 * - Through balls (passing), Dribble (dribbling), Sprint (pace) and Tackles
 *   (defending): see games.ts.
 */

import {
  type Challenge,
  type Duel,
  type PassRound,
  type Press,
  type Race,
  dribble,
  dribbleSetup,
  passSetup,
  passes,
  sprintSetup,
  sprints,
  tackleSetup,
  tackles,
} from "./games.js";
import { type PenaltySetup, penalties, penaltySetup } from "./penalty.js";

export const FIELD = { w: 1000, h: 600 } as const;
/** Sprints take many presses; nothing needs more than this. */
export const MAX_CLICKS = 800;
const MAX_MS = 90_000;

export type Skill = "pace" | "shooting" | "passing" | "dribbling" | "defending" | "physical";
export type Game = "penalties" | "passes" | "dribble" | "sprint" | "tackles";
export type Click = Press;

export const GAME_OF: Record<Skill, Game> = {
  shooting: "penalties",
  physical: "penalties",
  passing: "passes",
  dribbling: "dribble",
  pace: "sprint",
  defending: "tackles",
};

export type Drill =
  | { game: "penalties"; setup: PenaltySetup }
  | { game: "passes"; setup: PassRound[] }
  | { game: "dribble"; setup: Challenge[] }
  | { game: "sprint"; setup: Race[] }
  | { game: "tackles"; setup: Duel[] };

/** The drill for a ticket, from the seed. `level` is the skill (1 to 99). */
export function drill(seedHex: string, level: number, skill: Skill): Drill {
  const l = Math.min(99, Math.max(1, Math.round(level)));
  switch (GAME_OF[skill]) {
    case "penalties":
      return { game: "penalties", setup: penaltySetup(seedHex, l) };
    case "passes":
      return { game: "passes", setup: passSetup(seedHex, l) };
    case "dribble":
      return { game: "dribble", setup: dribbleSetup(seedHex, l) };
    case "sprint":
      return { game: "sprint", setup: sprintSetup(seedHex, l) };
    case "tackles":
      return { game: "tackles", setup: tackleSetup(seedHex, l) };
  }
}

/** How many rounds the drill has. */
export function rounds(d: Drill): number {
  return d.game === "penalties" ? d.setup.kicks.length : d.setup.length;
}

/** Each round's outcome (a goal, a pass received, a challenge beaten, a race won, a clean tackle) and when the drill ends. */
export function replay(d: Drill, clicks: Click[]): { won: boolean[]; end: number } {
  const cs = clicks.slice(0, MAX_CLICKS);
  switch (d.game) {
    case "penalties": {
      const ks = penalties(d.setup, cs);
      return { won: ks.map((k) => k.shot?.result === "goal"), end: ks[ks.length - 1]!.end };
    }
    case "passes": {
      const ps = passes(d.setup, cs);
      return { won: ps.map((p) => p.pass?.result === "received"), end: ps[ps.length - 1]!.end };
    }
    case "dribble": {
      const p = dribble(d.setup, cs);
      return { won: p.challenges.map((c) => c.dodged), end: p.end };
    }
    case "sprint": {
      const rs = sprints(d.setup, cs);
      return { won: rs.map((r) => r.won), end: rs[rs.length - 1]!.end };
    }
    case "tackles": {
      const ds = tackles(d.setup, cs);
      return { won: ds.map((x) => x.won), end: ds[ds.length - 1]!.end };
    }
  }
}

export const outcomes = (d: Drill, clicks: Click[]) => replay(d, clicks).won;
/** When a played drill is over. */
export const drillEnd = (d: Drill, clicks: Click[]) => replay(d, clicks).end;
/** Successful rounds. */
export const hits = (d: Drill, clicks: Click[]) => outcomes(d, clicks).filter(Boolean).length;

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
      (c.up === undefined || typeof c.up === "boolean") &&
      c.t >= last &&
      c.t <= MAX_MS &&
      c.x >= 0 &&
      c.x <= FIELD.w &&
      c.y >= 0 &&
      c.y <= FIELD.h;
    if (!ok) return "malformed clicks";
    last = c.t;
  }
  return null;
}

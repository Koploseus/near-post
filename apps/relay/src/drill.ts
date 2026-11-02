/**
 * The training drill, shared by the web app (which plays it) and the relay
 * (which replays the clicks and signs the score). No imports: it runs the same
 * in the browser and in Node.
 *
 * Targets pop up one after another on a pitch of FIELD.w × FIELD.h. Hit a
 * target inside its circle while it is up. The ticket's seed (from the chain)
 * fixes where and when; the trained skill's level makes targets smaller and
 * shorter-lived. A click that lands less than REACTION_MS after a target
 * appears does not count: humans are not that fast.
 */

export const FIELD = { w: 1000, h: 600 } as const;
export const TARGETS = 12;
export const REACTION_MS = 120;
export const MAX_CLICKS = 60;

export interface Target {
  appearAt: number;
  x: number;
  y: number;
  r: number;
  ttl: number;
}

export interface Click {
  /** Milliseconds since the drill started. */
  t: number;
  x: number;
  y: number;
}

/** A small seeded PRNG (mulberry32), seeded with an FNV-1a hash of the whole seed. */
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

/** The targets of a drill. `level` is the trained skill's value (1 to 99). */
export function drill(seedHex: string, level: number): Target[] {
  const rand = rng(seedHex);
  const l = Math.min(99, Math.max(1, Math.round(level)));
  const r = Math.round(70 - l * 0.3);
  const ttl = Math.round(1150 - l * 4);
  const out: Target[] = [];
  for (let i = 0; i < TARGETS; i++) {
    out.push({
      appearAt: 900 + i * 1150 + Math.floor(rand() * 300),
      x: Math.round(r + rand() * (FIELD.w - 2 * r)),
      y: Math.round(r + rand() * (FIELD.h - 2 * r)),
      r,
      ttl,
    });
  }
  return out;
}

/** How long a drill lasts, in milliseconds. */
export const duration = (targets: Target[]) => Math.max(...targets.map((t) => t.appearAt + t.ttl));

/** Targets hit by these clicks. Each click hits at most one target, each target counts once. */
export function hits(targets: Target[], clicks: Click[]): number {
  const done = new Set<number>();
  for (const c of clicks.slice(0, MAX_CLICKS)) {
    const i = targets.findIndex(
      (t, k) =>
        !done.has(k) &&
        c.t >= t.appearAt + REACTION_MS &&
        c.t <= t.appearAt + t.ttl &&
        (c.x - t.x) ** 2 + (c.y - t.y) ** 2 <= t.r ** 2,
    );
    if (i >= 0) done.add(i);
  }
  return done.size;
}

/** Skill points for a number of hits: 11+ → 3, 9+ → 2, 6+ → 1. */
export const points = (hit: number) => (hit >= 11 ? 3 : hit >= 9 ? 2 : hit >= 6 ? 1 : 0);

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
      c.t <= 30_000 &&
      c.x >= 0 &&
      c.x <= FIELD.w &&
      c.y >= 0 &&
      c.y <= FIELD.h;
    if (!ok) return "malformed clicks";
    last = c.t;
  }
  return null;
}

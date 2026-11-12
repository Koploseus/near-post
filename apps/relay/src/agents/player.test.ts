import { describe, expect, it } from "vitest";
import { type Skill, drill, implausible, points } from "../drill.js";
import { play, played } from "./player.js";

/** A repeatable roll. */
const dice = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const seedOf = (n: number) => n.toString(16).padStart(8, "0").repeat(4);
const SKILLS: Skill[] = ["shooting", "passing", "dribbling", "pace", "defending"];

/** Share of rounds won over many drills, at a drill level and with hands rated `rating`. */
function share(skill: Skill, level: number, rating: number): number {
  let hits = 0;
  let rounds = 0;
  for (let n = 1; n <= 60; n++) {
    const r = played(drill(seedOf(n * 7919), level, skill), rating, dice(n));
    hits += r.hits;
    rounds += r.rounds;
  }
  return hits / rounds;
}

describe("an agent plays the drills himself", () => {
  it("produces a trace the relay would take from anyone", () => {
    for (const skill of SKILLS) {
      const clicks = play(drill(seedOf(42), 50, skill), 60, dice(1)).sort((a, b) => a.t - b.t);
      expect(clicks.length).toBeGreaterThan(4);
      expect(implausible(clicks)).toBeNull();
    }
  });

  it("scores what the game's replay gives his trace: better hands win more, on every drill", () => {
    for (const skill of SKILLS) {
      const weak = share(skill, 50, 35);
      const strong = share(skill, 50, 85);
      expect(strong, `${skill}: strong ${strong} weak ${weak}`).toBeGreaterThan(weak + 0.08);
      // Nobody is perfect and nobody is hopeless: like people.
      expect(strong, skill).toBeLessThan(1);
      expect(weak, skill).toBeGreaterThan(0.05);
      expect(weak, skill).toBeLessThan(0.7);
      expect(strong, skill).toBeGreaterThan(0.6);
    }
  });

  it("finds a drill harder as its level rises, like anyone", () => {
    for (const skill of SKILLS) expect(share(skill, 90, 60), skill).toBeLessThanOrEqual(share(skill, 20, 60) + 0.03);
  });

  it("earns points like a person: an average footballer gets one or two, not three every time", () => {
    const got = [0, 0, 0, 0];
    for (let n = 1; n <= 200; n++) {
      const skill = SKILLS[n % SKILLS.length]!;
      const r = played(drill(seedOf(n * 104729), 55, skill), 58, dice(n));
      got[points(r.hits, r.rounds)]! += 1;
    }
    const mean = (got[1]! + 2 * got[2]! + 3 * got[3]!) / 200;
    expect(mean, got.join(",")).toBeGreaterThan(0.5);
    expect(mean, got.join(",")).toBeLessThan(2);
    expect(got[3]!, got.join(",")).toBeLessThan(60);
    expect(got[0]!, got.join(",")).toBeLessThan(120);
  });
});

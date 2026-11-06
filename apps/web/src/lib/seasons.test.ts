import { describe, expect, it } from "vitest";
import { bySeason, finishesOf, ordinal, seasonOf } from "./seasons.js";
import type { Champion, FinalRow } from "./types.js";

const row = (club_id: string, points: number, moved = 0): FinalRow => ({ club_id, name: club_id, played: 26, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points, moved });
const champ = (season: number, division: number, club_id: string): Champion => ({ season, division, club_id, name: club_id, points: 60, won: 19, drawn: 3, lost: 4 });

describe("seasons", () => {
  it("maps a league match day to its season and day", () => {
    expect(seasonOf(1, 26)).toEqual({ season: 1, day: 1 });
    expect(seasonOf(26, 26)).toEqual({ season: 1, day: 26 });
    expect(seasonOf(27, 26)).toEqual({ season: 2, day: 1 });
    expect(seasonOf(165, 26)).toEqual({ season: 7, day: 9 });
  });
  it("groups champions by season, divisions in order", () => {
    const g = bySeason([champ(3, 2, "b"), champ(3, 1, "a"), champ(2, 1, "c")]);
    expect(g.map((s) => s.season)).toEqual([3, 2]);
    expect(g[0]!.champions.map((c) => c.division)).toEqual([1, 2]);
  });
  it("finds a club's finish each season, latest first", () => {
    const f = finishesOf("x", [
      { season: 1, division: 2, rows: [row("x", 55, 1), row("y", 40)] },
      { season: 2, division: 1, rows: [row("z", 60), row("x", 50)] },
    ]);
    expect(f).toEqual([
      { season: 2, division: 1, position: 2, of: 2, points: 50, moved: 0 },
      { season: 1, division: 2, position: 1, of: 2, points: 55, moved: 1 },
    ]);
  });
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

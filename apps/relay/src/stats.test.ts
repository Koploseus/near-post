import { describe, expect, it } from "vitest";
import { type Line, type Sheet, clubLines, count } from "./stats.js";

const eleven = (p: string) => Array.from({ length: 11 }, (_, i) => `${p}${i}`);
const sheet = (events: Sheet["events"], firstHalf = events.length): Sheet => ({
  home: "h.testnet",
  away: "a.testnet",
  events,
  elevens: [eleven("h"), eleven("a"), eleven("h"), [...eleven("a").slice(0, 10), "a99"]],
  first_half_events: firstHalf,
  full_time: true,
  stats: { man_of_the_match: { player: "h9" } },
});

describe("season stats from match sheets", () => {
  it("credits goals, shots, saves, fouls and cards to the token in that slot", () => {
    const lines = new Map<string, Line>();
    count(
      lines,
      sheet(
        [
          { second: 10, home: true, kind: "goal", player: 9 },
          { second: 20, home: true, kind: "saved", player: 9 },
          { second: 30, home: false, kind: "missed", player: 10 },
          { second: 40, home: false, kind: "foul", player: 4 },
          { second: 41, home: false, kind: "yellow", player: 4 },
          { second: 3000, home: false, kind: "goal", player: 10 },
          { second: 3100, home: true, kind: "own_goal", player: 3 },
        ],
        5,
      ),
    );
    expect(lines.get("h9")).toMatchObject({ goals: 1, shots: 2, on_target: 2, motm: 1, club: "h.testnet" });
    expect(lines.get("a0")).toMatchObject({ saves: 1 });
    expect(lines.get("a10")).toMatchObject({ shots: 1, goals: 0 });
    // Second half: slot 10 of the away eleven is a substitute.
    expect(lines.get("a99")).toMatchObject({ goals: 1, apps: 1 });
    expect(lines.get("a4")).toMatchObject({ fouls: 1, yellows: 1 });
    // An own goal "for" home is scored by slot 3 of the away eleven.
    expect(lines.get("a3")).toMatchObject({ own_goals: 1 });
    expect(lines.get("h0")).toMatchObject({ apps: 1, clean_sheets: 0 });
  });

  it("counts assists, tackles, penalties and clean sheets", () => {
    const lines = new Map<string, Line>();
    count(
      lines,
      sheet([
        { second: 10, home: true, kind: "tackle", player: 6 },
        { second: 20, home: true, kind: "goal", player: 9 },
        { second: 20, home: true, kind: "assist", player: 7 },
        { second: 30, home: false, kind: "foul", player: 2 },
        { second: 50, home: true, kind: "penalty", player: 9 },
        { second: 52, home: true, kind: "goal", player: 9 },
        { second: 60, home: true, kind: "penalty", player: 10 },
        { second: 62, home: true, kind: "saved", player: 10 },
      ]),
    );
    expect(lines.get("h7")).toMatchObject({ assists: 1 });
    expect(lines.get("h6")).toMatchObject({ tackles: 1 });
    expect(lines.get("h9")).toMatchObject({ goals: 2, penalties: 1, penalties_scored: 1 });
    expect(lines.get("h10")).toMatchObject({ penalties: 1, penalties_scored: 0 });
    // Home conceded nothing: its keeper keeps a clean sheet; away conceded two.
    expect(lines.get("h0")).toMatchObject({ clean_sheets: 1 });
    expect(lines.get("a0")).toMatchObject({ clean_sheets: 0 });
  });

  it("ignores a match that is not finished", () => {
    const lines = new Map<string, Line>();
    count(lines, { ...sheet([{ second: 10, home: true, kind: "goal", player: 9 }]), full_time: false });
    expect(lines.size).toBe(0);
  });
});

describe("club season lines", () => {
  const m = (home: string, away: string, hg: number, ag: number): Sheet => ({
    home, away, home_goals: hg, away_goals: ag, events: [], elevens: [], first_half_events: 0, full_time: true,
    stats: { man_of_the_match: null, home_possession: 60, away_possession: 40, home_yellows: 1, away_yellows: 2, home_reds: 0, away_reds: 1, home_fouls: 5, away_fouls: 9 },
  });
  const days = [
    { day: 1, sheets: [m("a", "b", 3, 0)] },
    { day: 2, sheets: [m("b", "a", 1, 2)] },
    { day: 3, sheets: [m("a", "b", 1, 1)] },
    { day: 4, sheets: [m("b", "a", 0, 4)] },
  ];
  const stands = new Map([["a", new Map([[1, { present: 6, fans: 10, full_house: true }], [2, { present: 3, fans: 10, full_house: false }]])]]);
  const lines = clubLines(days, stands, [{ manager: "a", full_house_streak: 0, best_streak: 1 }, { manager: "b" }]);
  const a = lines.find((l) => l.club === "a")!;
  const b = lines.find((l) => l.club === "b")!;

  it("counts results, goals, form and win runs", () => {
    expect(a).toMatchObject({ played: 4, won: 3, drawn: 1, lost: 0, goals_for: 10, goals_against: 2, form: ["W", "W", "D", "W"], win_streak: 1, best_win_streak: 2 });
    expect(a.biggest_win).toEqual({ day: 4, margin: 4, score: "4-0", opponent: "b" });
    expect(b).toMatchObject({ won: 0, form: ["L", "L", "D", "L"], biggest_win: null });
  });

  it("averages possession and adds up discipline", () => {
    // a: 60 at home twice, 40 away twice.
    expect(a.possession).toBe(50);
    expect(a).toMatchObject({ yellows: 6, reds: 2, fouls: 28 });
  });

  it("counts the stand: attendance, fill of the target, full houses", () => {
    // Target 6 of 10: 100% then 50%.
    expect(a).toMatchObject({ attendance_total: 9, attendance_best: 6, fill: 75, full_houses: 1, best_full_house_streak: 1 });
  });
});

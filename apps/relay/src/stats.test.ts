import { describe, expect, it } from "vitest";
import { type Line, type Sheet, count } from "./stats.js";

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
    expect(lines.get("h0")).toMatchObject({ apps: 1 });
  });

  it("ignores a match that is not finished", () => {
    const lines = new Map<string, Line>();
    count(lines, { ...sheet([{ second: 10, home: true, kind: "goal", player: 9 }]), full_time: false });
    expect(lines.size).toBe(0);
  });
});

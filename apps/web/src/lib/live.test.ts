import { describe, expect, it } from "vitest";
import { HALF_SECONDS, clock, liveDay, minuteLabel, scoreOf, visible } from "./live.js";
import type { MatchResult, Schedule } from "./types.js";

const MIN = 60_000;
const sched = (o: Partial<Schedule>): Schedule => ({
  match_day: 3,
  next_match_at_ms: "0",
  interval_ms: String(30 * MIN),
  kickoff_at_ms: String(100 * MIN),
  last_kickoff_at_ms: String(70 * MIN),
  first_half_played: false,
  half_ms: String(10 * MIN),
  half_time_ms: String(5 * MIN),
  season: 1,
  season_day: 3,
  season_days: 19,
  divisions: 1,
  ...o,
});
const match = (full: boolean): MatchResult =>
  ({
    events: [
      { second: 600, home: true, kind: "goal", player: 9 },
      { second: 2_800, home: false, kind: "saved", player: 10 },
      { second: 3_000, home: false, kind: "goal", player: 10 },
      { second: 5_500, home: false, kind: "own_goal", player: 2 },
    ].slice(0, full ? 4 : 2),
    first_half_events: 2,
    half_ends: full ? [2_820, 5_520] : [2_820],
    full_time: full,
  }) as unknown as MatchResult;

describe("live replay", () => {
  it("follows the match in play, then the one being replayed, then the next", () => {
    expect(liveDay(sched({ first_half_played: true }), 101 * MIN)).toEqual({ day: 3, kickoff: 100 * MIN, state: "live" });
    expect(liveDay(sched({}), 90 * MIN)).toEqual({ day: 2, kickoff: 70 * MIN, state: "live" });
    expect(liveDay(sched({}), 97 * MIN)).toEqual({ day: 3, kickoff: 100 * MIN, state: "before" });
  });

  it("runs the clock at 45 minutes per real half, with half-time", () => {
    const s = sched({});
    const k = 100 * MIN;
    expect(clock(match(false), k, s, k + 5 * MIN)).toMatchObject({ phase: "first_half", label: "24'" });
    expect(clock(match(false), k, s, k + 12 * MIN).phase).toBe("half_time");
    expect(clock(match(false), k, s, k + 16 * MIN).phase).toBe("waiting_second_half");
    expect(clock(match(true), k, s, k + 20 * MIN)).toMatchObject({ phase: "second_half" });
    expect(clock(match(true), k, s, k + 26 * MIN)).toMatchObject({ phase: "full_time", label: "FT" });
  });

  it("reveals events and the score as the clock runs", () => {
    const s = sched({});
    const k = 100 * MIN;
    const m = match(true);
    expect(scoreOf(visible(m, clock(m, k, s, k + 1 * MIN)))).toEqual([0, 0]);
    expect(scoreOf(visible(m, clock(m, k, s, k + 3 * MIN)))).toEqual([1, 0]);
    expect(visible(m, clock(m, k, s, k + 12 * MIN))).toHaveLength(2);
    expect(scoreOf(visible(m, clock(m, k, s, k + 26 * MIN)))).toEqual([1, 2]);
  });

  it("writes minutes like a match sheet", () => {
    expect(minuteLabel(0, 0)).toBe("1'");
    expect(minuteLabel(HALF_SECONDS + 130, 0)).toBe("45+3'");
    expect(minuteLabel(HALF_SECONDS, 1)).toBe("46'");
    expect(minuteLabel(2 * HALF_SECONDS + 70, 1)).toBe("90+2'");
  });
});

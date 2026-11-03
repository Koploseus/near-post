import { describe, expect, it } from "vitest";
import { dayEndsAt } from "./Training.js";
import type { Schedule } from "../lib/types.js";

const base: Schedule = {
  match_day: 5, next_match_at_ms: "0", interval_ms: "1800000", kickoff_at_ms: "1000000", last_kickoff_at_ms: "0",
  first_half_played: false, half_ms: "600000", half_time_ms: "300000", season: 1, season_day: 5, season_days: 19, divisions: 2,
};

describe("training window", () => {
  it("ends with the second half: kick-off + half + half-time before the match", () => {
    expect(dayEndsAt(base)).toBe(1_000_000 + 600_000 + 300_000);
  });
  it("ends when the second half is due, once the first is played", () => {
    expect(dayEndsAt({ ...base, first_half_played: true, next_match_at_ms: "2000000" })).toBe(2_000_000);
  });
});

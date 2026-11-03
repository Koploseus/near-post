import { describe, expect, it } from "vitest";
import { slotsOpen } from "./Lineup.js";

describe("team sheet slots", () => {
  const s = { first_half_played: false, kickoff_at_ms: "1000000" };
  it("are open until one minute before kick-off", () => {
    expect(slotsOpen(s, 1_000_000 - 61_000)).toBe(true);
    expect(slotsOpen(s, 1_000_000 - 59_000)).toBe(false);
  });
  it("are closed once the first half is played", () => {
    expect(slotsOpen({ ...s, first_half_played: true }, 0)).toBe(false);
  });
});

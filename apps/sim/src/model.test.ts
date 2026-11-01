import { describe, expect, it } from "vitest";
import { RULES, SCENARIOS, simulate } from "./model.js";

describe("goalars supply", () => {
  it("never passes the 10B cap, even in a huge league", () => {
    const s = simulate({ ...SCENARIOS["Big league (64 clubs), loyal fans"]!, newAccountsPerDay: 5_000 }, 120);
    expect(Math.max(...s)).toBeLessThan(RULES.maxSupply);
  });

  it("a living league grows and a dead one shrinks", () => {
    const alive = simulate(SCENARIOS["Attacking, loyal fans"]!);
    const dead = simulate(SCENARIOS["Dead league: no newcomers, absent fans"]!);
    expect(alive[59]!).toBeGreaterThan(alive[0]! * 2);
    expect(dead[59]!).toBeLessThan(dead[0]! / 2);
  });

  it("is reproducible", () => {
    expect(simulate(SCENARIOS["Attacking, loyal fans"]!)).toEqual(simulate(SCENARIOS["Attacking, loyal fans"]!));
  });
});

import { describe, expect, it } from "vitest";
import { RULES, SCENARIOS, simulate } from "./model.js";

describe("goalars supply", () => {
  it("never passes the 10B cap, even in a huge league", () => {
    const s = simulate({ ...SCENARIOS["Full league (200 clubs), loyal fans"]!, newAccountsPerDay: 5_000 }, 120);
    expect(Math.max(...s)).toBeLessThan(RULES.maxSupply);
  }, 60_000); // tens of thousands of fans a day, drawn one by one

  it("a living league grows and a dead one stalls", () => {
    const alive = simulate(SCENARIOS["Loyal fans (75% come)"]!);
    const dead = simulate(SCENARIOS["Dead league: no newcomers, absent fans"]!);
    expect(alive[59]!).toBeGreaterThan(alive[29]! * 1.3);
    expect(dead[59]!).toBeLessThan(dead[29]! * 1.05);
    expect(dead[59]!).toBeLessThan(alive[59]! / 5);
  });

  it("goals with nobody in the stands mint nothing", () => {
    const ghost = simulate({ ...SCENARIOS["Dead league: no newcomers, absent fans"]!, attendance: 0 });
    expect(ghost[59]!).toBeLessThanOrEqual(ghost[0]!);
  });

  it("the fans decide: the same league with absent fans ends lower", () => {
    const loyal = simulate(SCENARIOS["Loyal fans (75% come)"]!);
    const absent = simulate(SCENARIOS["Absent fans (45% come)"]!);
    expect(absent[59]!).toBeLessThan(loyal[59]! * 0.8);
  });

  it("is reproducible", () => {
    expect(simulate(SCENARIOS["Loyal fans (75% come)"]!)).toEqual(simulate(SCENARIOS["Loyal fans (75% come)"]!));
  });
});

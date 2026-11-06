import { describe, expect, it } from "vitest";

import { breathing, fullHouseTarget, netBySplit } from "./breathing.js";
import type { LedgerEntry } from "./near.js";

const e = (id: number, match_day: number, kind: string, amount: string, mint: boolean): LedgerEntry => ({ id, match_day, kind, who: "club.testnet", amount, mint });

describe("the money breathes with the fans", () => {
  it("adds up each day's stands and the G minted and burned", () => {
    const ledger = [
      e(1, 9, "pack", "1", false), // day 9 is cut by the ring: left out
      e(2, 10, "full_house", "300000000000", true),
      e(3, 10, "goals", "600000000000", true),
      e(4, 10, "welcome", "1000000000000", true),
      e(5, 10, "training", "400000000000", false),
      e(6, 11, "empty_stand", "20000000", false),
    ];
    const stands = new Map([
      [9, [{ present: 5, fans: 5, full_house: true }]],
      [10, [{ present: 3, fans: 5, full_house: true }, { present: 0, fans: 0, full_house: false }]],
      [11, [{ present: 1, fans: 5, full_house: false }]],
    ]);
    const days = breathing(ledger, stands);
    expect(days.map((d) => d.day)).toEqual([10, 11]);
    expect(days[0]).toMatchObject({ fill: 100, fullHouses: 1, stands: 1, minted: 900000000000n, onboarding: 1000000000000n, burned: 400000000000n });
    expect(days[1]).toMatchObject({ fill: 33, fullHouses: 0, minted: 0n, burned: 20000000n });
    expect(netBySplit(days)).toEqual({ full: 1500000000000n, empty: -20000000n });
  });

  it("uses the league's full-house target: 60% of the fans, rounded up", () => {
    expect([1, 2, 3, 5, 10].map((fans) => fullHouseTarget(fans))).toEqual([1, 2, 2, 3, 6]);
  });
});

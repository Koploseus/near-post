import { describe, expect, it } from "vitest";
import { clubName, g, minute, short, tier } from "./format.js";

describe("format", () => {
  it("shows goalars the way the game talks about them", () => {
    expect(g("4200000000000")).toBe("4.2M G");
    expect(g("400000000000")).toBe("400k G");
    expect(g("1799172170000")).toBe("1.8M G");
    expect(g("12000000")).toBe("12 G");
    expect(g("10000000000000000")).toBe("10.00B G");
  });
  it("writes minutes and names", () => {
    expect(minute(62)).toBe("62'");
    expect(minute(92)).toBe("90+2'");
    expect(short("rive-nord.near-post.testnet")).toBe("rive-nord");
  });
  it("gives cards a tier by rating", () => {
    expect(tier(64)).toBe("bronze");
    expect(tier(65)).toBe("silver");
    expect(tier(74)).toBe("silver");
    expect(tier(75)).toBe("gold");
  });
});

describe("club names", () => {
  it("drops the prefix people do not say", () => {
    expect(clubName("FC Port-Lune")).toBe("Port-Lune");
    expect(clubName("Stade des Marais")).toBe("Marais");
    expect(clubName("Olympique Rive Nord")).toBe("Rive Nord");
    expect(clubName("Sporting Val-d'Ombre")).toBe("Val-d'Ombre");
    expect(clubName("Les Canaris")).toBe("Les Canaris");
  });
});

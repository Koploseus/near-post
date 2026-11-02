import { describe, expect, it } from "vitest";
import { g, minute, short, tier } from "./format.js";

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
  it("turns a sticker gold at 75", () => {
    expect(tier(74, 40)).toBe("silver");
    expect(tier(40, 75)).toBe("gold");
  });
});

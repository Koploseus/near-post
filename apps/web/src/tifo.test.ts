import { describe, expect, it } from "vitest";
import { COLORS, COLS, PATTERNS, ROWS, leading, olaTarget, paint, pictureColor, revealOrder, target } from "./tifo.js";

describe("tifo", () => {
  it("is complete exactly at the full-house target", () => {
    expect(paint(target(340), 340).every((s) => s.lit)).toBe(true);
    expect(paint(target(340) - 1, 340).every((s) => s.lit)).toBe(false);
  });

  it("an empty stand paints nothing", () => {
    expect(paint(0, 340).some((s) => s.lit)).toBe(false);
    expect(paint(0, 0).some((s) => s.lit)).toBe(false);
  });

  it("lights squares in a fixed order, each rank once", () => {
    const order = revealOrder();
    expect(new Set(order).size).toBe(COLS * ROWS);
    expect(revealOrder()).toEqual(order);
  });

  it("has six patterns, each with both colours, and the scarf rows", () => {
    expect(PATTERNS).toHaveLength(6);
    for (let p = 0; p < PATTERNS.length; p++) {
      const inside = new Set<string>();
      for (let y = 1; y < ROWS - 1; y++) for (let x = 0; x < COLS; x++) inside.add(pictureColor(x, y, p));
      expect([...inside].sort()).toEqual([COLORS.blue, COLORS.yellow].sort());
      expect(pictureColor(0, 0, p)).toBe(COLORS.paper);
    }
  });

  it("flies a derby winner's colours on the scarf rows", () => {
    const squares = paint(3, 5, 0, { a: "#111111", b: "#eeeeee" });
    expect(new Set(squares.slice(0, COLS).map((s) => s.color))).toEqual(new Set(["#111111", "#eeeeee"]));
  });

  it("shows the most voted pattern, the lower one on a tie, the star with no vote", () => {
    expect(leading(undefined)).toBe(0);
    expect(leading([0, 0, 0, 0, 0, 0])).toBe(0);
    expect(leading([0, 0, 1, 0, 2, 0])).toBe(4);
    expect(leading([0, 2, 0, 2, 0, 0])).toBe(1);
  });

  it("counts the ola like the contract: half the target, rounded up", () => {
    expect(olaTarget(10)).toBe(3);
    expect(olaTarget(5)).toBe(2);
    expect(olaTarget(1)).toBe(1);
  });

  it("rounds the target up like the contract", () => {
    expect(target(340)).toBe(204);
    expect(target(5)).toBe(3);
  });
});

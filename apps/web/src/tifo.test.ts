import { describe, expect, it } from "vitest";
import { COLS, ROWS, paint, revealOrder, target } from "./tifo.js";

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

  it("rounds the target up like the contract", () => {
    expect(target(340)).toBe(204);
    expect(target(5)).toBe(3);
  });
});

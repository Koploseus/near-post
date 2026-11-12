import { describe, expect, it } from "vitest";
import { pixelGrid } from "./PixelPlayer.js";
import { faceNumber } from "../screens/Look.js";

describe("pixel footballer", () => {
  it("draws any token number, even past 2^31", () => {
    for (const id of ["1", "2147483648", "2147483650", "12345678901234567890", "", "0"]) {
      const g = pixelGrid({ n: faceNumber(id) });
      expect(g.flat().every((c) => c === null || /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    }
  });
});

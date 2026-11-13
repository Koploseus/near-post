import { describe, expect, it } from "vitest";
import { moved } from "./transfer.js";

describe("transfer news", () => {
  it("announces a move from one club to another only", () => {
    expect(moved("a", "b")).toBe(true);
    expect(moved("a", "a")).toBe(false);
    expect(moved(null, "b")).toBe(false); // first look on this browser
    expect(moved("", "b")).toBe(false); // a free agent who signed
    expect(moved("a", "")).toBe(false); // released, or his contract ended
  });
});

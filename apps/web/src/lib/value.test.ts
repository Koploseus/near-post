import { describe, expect, it } from "vitest";
import { valueOf as relayValue } from "../../../relay/src/people.js";
import { valueOf } from "./people.js";

describe("a footballer's value", () => {
  it("is the same sum in the browser as at the relay", () => {
    for (const overall of [30, 40, 43, 51, 60, 75, 99]) for (const goals of [0, 1, 12, 50, 80]) expect(valueOf({ overall, goals })).toBe(relayValue({ overall, goals }));
  });
});

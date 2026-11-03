import { describe, expect, it } from "vitest";
import { transient } from "./near.js";

describe("reads", () => {
  it("move to another RPC on a rate limit or a network failure, not on a contract error", () => {
    expect(transient(new Error("POST https://test.rpc.fastnear.com/ 429 (Too Many Requests)"))).toBe(true);
    expect(transient(new TypeError("Failed to fetch"))).toBe(true);
    expect(transient(new Error("Exceeded 2 attempts for https://test.rpc.fastnear.com."))).toBe(true);
    expect(transient(new Error("Smart contract panicked: no such club"))).toBe(false);
  });
});

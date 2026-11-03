import { describe, expect, it } from "vitest";
import { recoverSigner } from "./brain.js";

// A real NEAR AI Cloud signature of one of the agents' calls (journal of 3 November 2026).
const text =
  "Qwen/Qwen3.6-35B-A3B-FP8:efaa18e7d88a9c9ad7756d998579b98c2137cdcef63aaf8055ef2f8fc2594d5b:34dfccdd4eb009d7732d8f6202a8650bd8f55a6d2a66501f10b2b310facbe77b";
const signature =
  "0xfe049b17a35ab9948d6671987101dadf201b495e6e02855c5cd59ec8ec35777b22582349c2c239f6885291bcd14e56b716d1ed52aa4d2814c1429a07a7102ffc1b";

describe("NEAR AI signatures", () => {
  it("recover the TEE's signing address", () => {
    expect(recoverSigner(text, signature)).toBe("0xfdbd7952498b333206f360d71d97a1e0961e8ddf");
  });
  it("do not recover it for another text", () => {
    expect(recoverSigner(text.replace("efaa", "efab"), signature)).not.toBe("0xfdbd7952498b333206f360d71d97a1e0961e8ddf");
    expect(recoverSigner(text, "0xabc")).toBeNull();
  });
});

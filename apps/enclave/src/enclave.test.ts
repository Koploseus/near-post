import { sha256 } from "@noble/hashes/sha2.js";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { base58, base64, hex, text, unbase58, unbase64, utf8 } from "./bytes.js";
import { Jobs, drain, later } from "./jobs.js";
import { nearToYocto } from "./shims/near-api-js.js";
import { createHash } from "./shims/crypto.js";
import { signedCall } from "./tx.js";

describe("bytes, without the platform's helpers", () => {
  it("writes and reads UTF-8 like the platform", () => {
    for (const s of ["", "Northbank Rovers", "é à ü", "日本", "⚽ 2-0 🎉", '{"a":"\\n"}']) {
      expect(Buffer.from(utf8(s)).toString("hex")).toBe(Buffer.from(s, "utf8").toString("hex"));
      expect(text(utf8(s))).toBe(s);
    }
  });

  it("base64 and base58, both ways", () => {
    for (const n of [0, 1, 2, 3, 31, 32, 33, 100]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect(base64(b)).toBe(Buffer.from(b).toString("base64"));
      expect(hex(unbase64(base64(b)))).toBe(hex(b));
      expect(hex(unbase58(base58(b)))).toBe(hex(b));
    }
    // Leading zeros are kept, as "1".
    expect(base58(Uint8Array.from([0, 0, 1]))).toBe("112");
    expect(base58(new Uint8Array(32))).toBe("1".repeat(32));
  });
});

describe("a transaction signed here", () => {
  it("is NEAR's borsh for one function call, signed over its SHA-256", () => {
    const pair = nacl.sign.keyPair.fromSeed(sha256(utf8("an agent")));
    const signer = hex(pair.publicKey);
    const blockHash = base58(sha256(utf8("a block")));
    const raw = unbase64(
      signedCall({ signerId: signer, secretKey: pair.secretKey, nonce: 277429097000001n, receiverId: "league-v13.near-post.testnet", blockHash, method: "report_for_match", args: { token_id: "p1" }, gas: 30_000_000_000_000n, deposit: 1n }),
    );
    const tx = raw.subarray(0, raw.length - 65);
    expect(raw[raw.length - 65]).toBe(0); // an ed25519 signature
    expect(nacl.sign.detached.verify(sha256(tx), raw.subarray(raw.length - 64), pair.publicKey)).toBe(true);
    // Read it back, field by field.
    let at = 0;
    const u32 = () => (at += 4, new DataView(tx.buffer, tx.byteOffset + at - 4, 4).getUint32(0, true));
    const u64 = () => (at += 8, new DataView(tx.buffer, tx.byteOffset + at - 8, 8).getBigUint64(0, true));
    const bytes = (n: number) => (at += n, tx.subarray(at - n, at));
    const str = () => text(bytes(u32()));
    expect(str()).toBe(signer);
    expect(bytes(1)[0]).toBe(0);
    expect(hex(bytes(32))).toBe(signer); // an implicit account's key is the account
    expect(u64()).toBe(277429097000001n);
    expect(str()).toBe("league-v13.near-post.testnet");
    expect(base58(bytes(32))).toBe(blockHash);
    expect(u32()).toBe(1);
    expect(bytes(1)[0]).toBe(2); // FunctionCall
    expect(str()).toBe("report_for_match");
    expect(JSON.parse(str())).toEqual({ token_id: "p1" });
    expect(u64()).toBe(30_000_000_000_000n);
    expect(u64()).toBe(1n);
    expect(u64()).toBe(0n);
    expect(at).toBe(tx.length);
  });
});

describe("promises with our own job queue", () => {
  it("nothing runs until the queue is drained, then everything does, in order", () => {
    const seen: string[] = [];
    const p = Jobs.resolve(1).then((v: number) => (seen.push(`a${v}`), v + 1));
    p.then((v: number) => seen.push(`b${v}`));
    later(() => seen.push("timer"), 1000);
    Jobs.all([1, Jobs.resolve(2), new Jobs((ok: (v: number) => void) => later(() => ok(3), 5))]).then((all: number[]) => seen.push(all.join()));
    Jobs.reject(new Error("no")).catch((e: Error) => seen.push(e.message)).finally(() => seen.push("finally"));
    expect(seen).toEqual([]);
    drain();
    expect(seen).toContain("a1");
    expect(seen.indexOf("a1")).toBeLessThan(seen.indexOf("b2"));
    expect(seen).toEqual(expect.arrayContaining(["timer", "1,2,3", "no", "finally"]));
  });

  it("an error thrown in a job rejects what follows, and a promise returned is followed", () => {
    let out: unknown;
    Jobs.resolve(1)
      .then(() => {
        throw new Error("boom");
      })
      .then(() => "not here", (e: Error) => Jobs.resolve(`caught ${e.message}`))
      .then((v: unknown) => (out = v));
    drain();
    expect(out).toBe("caught boom");
  });
});

describe("what stands in for Node's own", () => {
  it("NEAR amounts and SHA-256, as the agents' code expects them", () => {
    expect(nearToYocto("0.2")).toBe("200000000000000000000000");
    expect(nearToYocto("1")).toBe("1000000000000000000000000");
    expect(createHash("sha256").update("abc").digest("hex")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

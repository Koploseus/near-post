import { describe, expect, it } from "vitest";
import { noPrfMessage, providerOf } from "./passkey.js";

const authData = (aaguid: string) => {
  const b = new Uint8Array(37 + 16 + 2);
  const hex = aaguid.replace(/-/g, "");
  for (let i = 0; i < 16; i++) b[37 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
};

describe("passkey providers", () => {
  it("reads the provider from the AAGUID", () => {
    expect(providerOf(authData("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4"))).toBe("Google Password Manager");
    expect(providerOf(authData("08987058-cadc-4b81-b6e1-30de50dcbe96"))).toBe("Windows Hello");
    expect(providerOf(authData("00000000-0000-0000-0000-000000000000"))).toBeNull();
    expect(providerOf(new Uint8Array(10))).toBeNull();
    expect(providerOf(undefined)).toBeNull();
  });
  it("says what to do for each provider", () => {
    expect(noPrfMessage("Chrome profile")).toMatch(/browser profile only/);
    expect(noPrfMessage("Windows Hello")).toMatch(/24H2/);
    expect(noPrfMessage("Bitwarden")).toMatch(/^Bitwarden can't/);
    expect(noPrfMessage(null)).toMatch(/Google Password Manager/);
  });
});

describe("recovery keys", () => {
  it("round-trips 20 bytes through 32 characters in groups of four", async () => {
    const { encodeRecovery, decodeRecovery } = await import("./passkey.js");
    for (let n = 0; n < 50; n++) {
      const b = crypto.getRandomValues(new Uint8Array(20));
      const t = encodeRecovery(b);
      expect(t).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(decodeRecovery(t)).toEqual(b);
      expect(decodeRecovery(t.toLowerCase().replace(/-/g, " "))).toEqual(b);
    }
    expect(decodeRecovery("too short")).toBeNull();
    expect(decodeRecovery("UUUU".repeat(8))).toBeNull();
  });
});

describe("recovery key backup", () => {
  it("locks the key for the relay and opens it with the recovery key only", async () => {
    const { KeyPair } = await import("near-api-js");
    const { saveWithRecoveryKey, unlockWithRecoveryKey, encodeRecovery } = await import("./passkey.js");
    const privateKey = KeyPair.fromRandom("ed25519").toString();
    const accountId = "u0123456789abcdef.near-post.testnet";
    let sent: Record<string, string> = {};
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const key = await saveWithRecoveryKey({ accountId, privateKey });
      expect(sent.credential_id).toMatch(/^recovery-key-[A-Za-z0-9_-]{16}$/);
      expect(JSON.stringify(sent)).not.toContain(privateKey.slice(8, 30));
      const b = { credential_id: sent.credential_id!, salt: sent.salt!, iv: sent.iv!, ciphertext: sent.ciphertext! };
      expect((await unlockWithRecoveryKey(accountId, [b], key)).privateKey).toBe(privateKey);
      await expect(unlockWithRecoveryKey(accountId, [b], encodeRecovery(new Uint8Array(20)))).rejects.toThrow(/doesn't open/);
      await expect(unlockWithRecoveryKey("other.near-post.testnet", [b], key)).rejects.toThrow(/doesn't open/);
    } finally {
      globalThis.fetch = real;
    }
  });
});

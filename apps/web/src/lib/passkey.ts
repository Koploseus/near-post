import { KeyPair } from "near-api-js";
import { vaultMessage } from "../../../relay/src/vault-message.js";
import { RELAY } from "./config.js";
import type { Session } from "./near.js";
import { serverNow } from "./time.js";

/**
 * Passkey backup of the account's key. The passkey (Face ID, fingerprint,
 * phone PIN) produces a secret through the WebAuthn PRF extension; that
 * secret encrypts the key here, in the browser. The relay keeps only the
 * ciphertext and gives it back after the email code; only the passkey can
 * open it. Passkeys are bound to this site and synced by the phone's or
 * computer's password manager (iCloud Keychain, Google Password Manager).
 */

export interface Backup {
  credential_id: string;
  salt: string;
  iv: string;
  ciphertext: string;
}

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
const prfOf = (c: PublicKeyCredential) => (c.getClientExtensionResults() as PrfResults).prf;

export const passkeysAvailable = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

async function aesKey(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("near-post vault v1"), info: enc.encode("account key") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** One PRF input per account: the same for all its passkeys, so a plain `eval` works everywhere. */
async function accountSalt(accountId: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`near-post prf v1:${accountId}`)));
}

/**
 * Asks the passkey for its PRF secret (one prompt). With one salt for all,
 * a plain `eval` (what every browser supports); older backups with their
 * own salts need `evalByCredential`.
 */
async function prfSecret(ids: { id: string; salt: string }[]): Promise<{ id: string; secret: ArrayBuffer | null }> {
  const same = ids.every((x) => x.salt === ids[0]!.salt);
  const prf = same
    ? { eval: { first: fromB64u(ids[0]!.salt) } }
    : { evalByCredential: Object.fromEntries(ids.map((x) => [x.id, { first: fromB64u(x.salt) }])) };
  const a = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: ids.map((x) => ({ type: "public-key" as const, id: fromB64u(x.id) })),
      userVerification: "required",
      extensions: { prf } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!a) throw new Error("Cancelled.");
  return { id: b64u(a.rawId), secret: prfOf(a)?.results?.first ?? null };
}

/**
 * Who keeps a passkey, from the AAGUID in its authenticator data
 * (https://github.com/passkeydeveloper/passkey-authenticator-aaguids).
 */
const PROVIDERS: Record<string, string> = {
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome profile",
  "b5397666-4885-aa6b-cebf-e52262a439a9": "Chrome profile",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Microsoft Password Manager",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
};

/** The AAGUID sits at bytes 37..53 of the authenticator data. */
export function providerOf(authData: ArrayBuffer | Uint8Array | undefined): string | null {
  if (!authData) return null;
  const b = authData instanceof Uint8Array ? authData : new Uint8Array(authData);
  if (b.length < 53) return null;
  const h = [...b.slice(37, 53)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return PROVIDERS[id] ?? null;
}

/** The passkey worked, but its provider cannot give the secret that locks the key. */
export function noPrfMessage(provider: string | null): string {
  const use = "Save a recovery key instead, or try again with iCloud Keychain, Google Password Manager, 1Password or your phone (\"Use a phone or tablet\").";
  if (provider === "Chrome profile") return `Chrome saved this passkey in this browser profile only, which can't lock your key. ${use}`;
  if (provider === "Windows Hello")
    return `Windows Hello on this PC can't lock your key yet (it needs Windows 11 24H2 up to date, with Chrome or Edge 147+). ${use}`;
  if (provider) return `${provider} can't lock your key with a passkey yet. ${use}`;
  return `This passkey's password manager can't lock your key. ${use}`;
}

/** Tells the password manager to drop a passkey we can't use, where browsers support it. */
async function forget(credentialId: string): Promise<void> {
  const pkc = PublicKeyCredential as unknown as {
    signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>;
  };
  await pkc.signalUnknownCredential?.({ rpId: location.hostname, credentialId }).catch(() => {});
}

/** Creates a passkey for this site and stores the key, encrypted by it, with the relay. */
export async function saveWithPasskey(s: Session, label: string): Promise<void> {
  if (!passkeysAvailable()) throw new Error("This browser has no passkeys.");
  const salt = await accountSalt(s.accountId);
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "NEAR Post", id: location.hostname },
      user: { id: random(16), name: label, displayName: label },
      challenge: random(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was created.");
  const id = b64u(cred.rawId);
  const provider = providerOf((cred.response as AuthenticatorAttestationResponse).getAuthenticatorData?.());
  const fail = async () => {
    await forget(id);
    return new Error(noPrfMessage(provider));
  };
  if (prfOf(cred)?.enabled === false) throw await fail();
  // Open it once, as a new device would: some providers give the secret only
  // here, and some give it at creation but not here, so the backup must
  // pass this test before it is kept.
  const atCreate: ArrayBuffer | null = prfOf(cred)?.results?.first ?? null;
  let secret: ArrayBuffer | null;
  try {
    secret = (await prfSecret([{ id, salt: b64u(salt) }])).secret;
  } catch (e) {
    // Cancelled, or a provider that can't open what it made: nothing is kept.
    if (e instanceof DOMException && e.name === "NotAllowedError")
      throw new Error(`The passkey didn't open, so nothing was saved. If it keeps failing, ${noPrfMessage(provider).replace(/^./, (c) => c.toLowerCase())}`);
    throw e;
  }
  if (!secret) throw await fail();
  if (atCreate && b64u(atCreate) !== b64u(secret)) throw await fail();
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(s.accountId) }, await aesKey(secret), enc.encode(s.privateKey));
  await store(s, { credential_id: id, salt: b64u(salt), iv: b64u(iv), ciphertext: b64u(ciphertext) });
}

/** Sends a backup to the relay, signed with the account's key (nobody can plant one for someone else). */
async function store(s: Session, entry: Backup): Promise<void> {
  const kp = KeyPair.fromString(s.privateKey as `ed25519:${string}`);
  const ts = Math.round(serverNow());
  const signature = btoa(String.fromCharCode(...kp.sign(enc.encode(vaultMessage(s.accountId, ts, entry))).signature));
  const r = await fetch(`${RELAY}/v1/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...entry, account_id: s.accountId, public_key: kp.getPublicKey().toString(), ts, signature }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `relay error ${r.status}`);
}

// ---- Recovery key ----
//
// For password managers that keep passkeys but can't lock a key with them
// (Bitwarden, older Windows Hello...): a random 160-bit key, shown once, that
// the player saves like a password. It encrypts the account's key the same
// way; the relay keeps only the ciphertext. 160 random bits: nothing to guess.

const RECOVERY = "recovery-key-";
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

export const isRecovery = (b: Backup) => b.credential_id.startsWith(RECOVERY);

export function encodeRecovery(bytes: Uint8Array): string {
  let bits = 0, v = 0, out = "";
  for (const x of bytes) {
    v = ((v << 8) | x) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(v >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(v << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

/** Back to bytes, forgiving case, spaces, dashes and look-alikes (O for 0, I or L for 1). */
export function decodeRecovery(text: string): Uint8Array<ArrayBuffer> | null {
  const t = text.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (t.length !== 32) return null;
  const out: number[] = [];
  let bits = 0, v = 0;
  for (const c of t) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    v = ((v << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function recoveryAes(key: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("near-post recovery key v1") },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The name of a recovery key's backup at the relay: a hash of the key. With it the key alone finds
 * its account (sign-in without the email); the relay learns nothing about the key from it.
 */
export async function recoveryId(key: Uint8Array<ArrayBuffer>): Promise<string> {
  const label = enc.encode("near-post recovery id v1:");
  const bytes = new Uint8Array(label.length + key.length);
  bytes.set(label);
  bytes.set(key, label.length);
  return RECOVERY + b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 12));
}

/** Makes a recovery key, stores the key it locks with the relay, and returns it (shown once). */
export async function saveWithRecoveryKey(s: Session): Promise<string> {
  const key = random(20);
  const salt = random(32);
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(s.accountId) }, await recoveryAes(key, salt), enc.encode(s.privateKey));
  await store(s, { credential_id: await recoveryId(key), salt: b64u(salt), iv: b64u(iv), ciphertext: b64u(ciphertext) });
  return encodeRecovery(key);
}

/** Opens a backup with the recovery key. */
export async function unlockWithRecoveryKey(accountId: string, backups: Backup[], text: string): Promise<Session> {
  const key = decodeRecovery(text);
  if (!key) throw new Error("That isn't a recovery key: 32 letters and digits, in groups of four.");
  for (const b of backups.filter(isRecovery)) {
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64u(b.iv), additionalData: enc.encode(accountId) },
        await recoveryAes(key, fromB64u(b.salt)),
        fromB64u(b.ciphertext),
      );
      const privateKey = new TextDecoder().decode(plain);
      KeyPair.fromString(privateKey as `ed25519:${string}`);
      return { accountId, privateKey };
    } catch {
      // not this one
    }
  }
  throw new Error("This recovery key doesn't open this account.");
}

/** Signs in with a recovery key and nothing else: the key finds its backup at the relay, then opens it here. */
export async function signInWithRecoveryKey(text: string): Promise<Session> {
  const key = decodeRecovery(text);
  if (!key) throw new Error("That isn't a recovery key: 32 letters and digits, in groups of four.");
  const r = await fetch(`${RELAY}/v1/vault/find`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential_id: await recoveryId(key) }) });
  if (r.status === 404) {
    // An older key: its backup has a random name. The relay gives the few there are, and the key is tried on each here.
    const old = await fetch(`${RELAY}/v1/vault/legacy`, { method: "POST" });
    if (old.status === 429) throw new Error("Too many tries. Wait a while.");
    const { vaults } = old.ok ? ((await old.json()) as { vaults: { account_id: string; vault: Backup }[] }) : { vaults: [] };
    for (const v of vaults) {
      const s = await unlockWithRecoveryKey(v.account_id, [v.vault], text).catch(() => null);
      if (s) return s;
    }
    throw new Error("This recovery key opens no account. Check it letter by letter (it has 32 letters and digits).");
  }
  if (r.status === 429) throw new Error("Too many tries. Wait a while.");
  if (!r.ok) throw new Error("The game could not look this key up. Try again.");
  const { account_id, vault } = (await r.json()) as { account_id: string; vault: Backup };
  return unlockWithRecoveryKey(account_id, [vault], text);
}

/** Opens a backup with the passkey: the account's key, back in this browser. */
export async function unlockWithPasskey(accountId: string, all: Backup[]): Promise<Session> {
  const backups = all.filter((b) => !isRecovery(b));
  if (!backups.length) throw new Error("No passkey opens this account: use your recovery key.");
  const { id, secret } = await prfSecret(backups.map((b) => ({ id: b.credential_id, salt: b.salt })));
  const b = backups.find((x) => x.credential_id === id);
  if (!b) throw new Error("This passkey doesn't match this account.");
  if (!secret) throw new Error("This passkey can't sign you in on this browser. Try Safari on Apple devices, or Chrome.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64u(b.iv), additionalData: enc.encode(accountId) },
    await aesKey(secret),
    fromB64u(b.ciphertext),
  );
  const privateKey = new TextDecoder().decode(plain);
  KeyPair.fromString(privateKey as `ed25519:${string}`); // throws if it is not a key
  return { accountId, privateKey };
}

/** How many backups (passkeys and recovery keys) can unlock an account. */
export async function passkeysOf(accountId: string): Promise<number> {
  try {
    const r = await fetch(`${RELAY}/v1/vault/${accountId}`);
    return r.ok ? ((await r.json()) as { passkeys: number }).passkeys : 0;
  } catch {
    return 0;
  }
}

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

/** The passkey worked, but its provider cannot do this (e.g. a browser profile or some password managers). */
const NO_PRF = "This passkey can't be used to sign in elsewhere. Save it in iCloud Keychain or Google Password Manager.";

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
  // Some platforms only say PRF is on at creation: ask once more to get the secret.
  let secret: ArrayBuffer | null = prfOf(cred)?.results?.first ?? null;
  if (!secret) {
    if (prfOf(cred)?.enabled === false) throw new Error(NO_PRF);
    secret = (await prfSecret([{ id, salt: b64u(salt) }])).secret;
  }
  if (!secret) throw new Error(NO_PRF);
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(s.accountId) }, await aesKey(secret), enc.encode(s.privateKey));
  const entry: Backup = { credential_id: id, salt: b64u(salt), iv: b64u(iv), ciphertext: b64u(ciphertext) };
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

/** Opens a backup with the passkey: the account's key, back in this browser. */
export async function unlockWithPasskey(accountId: string, backups: Backup[]): Promise<Session> {
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

/** How many passkeys can unlock an account. */
export async function passkeysOf(accountId: string): Promise<number> {
  try {
    const r = await fetch(`${RELAY}/v1/vault/${accountId}`);
    return r.ok ? ((await r.json()) as { passkeys: number }).passkeys : 0;
  } catch {
    return 0;
  }
}

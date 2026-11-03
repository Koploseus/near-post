import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate } from "near-api-js";
import { GOALARS, ITEMS, LEAGUE, PLAYERS, READ_RPCS, RELAY, RPC } from "./config.js";

/**
 * For signing: the access key's nonce and a recent block, from the first RPC
 * that answers (a gasless player's transaction is then sent by the relay).
 */
export const provider = new FailoverRpcProvider([RPC, ...READ_RPCS.filter((u) => u !== RPC)].map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 300, backoff: 2 })));

/**
 * Reads: the same view asked twice within a few seconds is asked once (the
 * screens share them), and a rate-limited or unreachable RPC rests for a
 * while as the next one answers.
 */
const readers = READ_RPCS.map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 300, backoff: 2 }));
const resting = new Map<number, number>();
const recent = new Map<string, { at: number; value: Promise<unknown> }>();
const FRESH_MS = 3000;
const REST_MS = 30_000;
let next = 0;

/** A rate limit, a network or CORS failure (a 429 comes without CORS headers): try another RPC. */
export const transient = (e: unknown) =>
  /429|rate limit|too many|failed to fetch|fetch failed|network|load failed|exceeded \d+ attempts|timeout|5\d\d/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

async function read<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  let last: unknown = new Error("no RPC answered");
  for (let tried = 0; tried < readers.length; tried++) {
    const k = (next + tried) % readers.length;
    if ((resting.get(k) ?? 0) > Date.now() && tried < readers.length - 1) continue;
    try {
      const value = (await readers[k]!.callFunction({ contractId, method, args })) as T;
      next = k;
      return value;
    } catch (e) {
      if (!transient(e)) throw e; // the contract answered: an error of the call itself
      last = e;
      resting.set(k, Date.now() + REST_MS);
    }
  }
  throw last;
}

export function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const key = `${contractId} ${method} ${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value as Promise<T>;
  const value = read<T>(contractId, method, args);
  recent.set(key, { at: Date.now(), value });
  value.catch(() => recent.delete(key));
  if (recent.size > 400) for (const [k, v] of recent) if (Date.now() - v.at >= FRESH_MS) recent.delete(k);
  return value;
}
export const league = <T>(method: string, args: Record<string, unknown> = {}) => view<T>(LEAGUE, method, args);

const KEY = "near-post.session";

export interface Session {
  accountId: string;
  privateKey: string;
}

/** The player's key never leaves this browser. Storage can fail (private mode): then the session lives in memory. */
let memory: Session | null = null;
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : memory;
  } catch {
    return memory;
  }
}
export function saveSession(s: Session | null) {
  memory = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* memory only */
  }
}
export const signOut = () => saveSession(null);

async function relay<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${RELAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `relay error ${r.status}`);
  return data;
}

export const startSignIn = (email: string) => relay<{ sent: boolean; account_id: string; code?: string }>("/v1/auth/start", { email });

/** After the code: signed in, or a key to unlock with a passkey (another device made the account). */
export type SignInResult =
  | { session: Session; created: boolean }
  | { unlock: { accountId: string; backups: import("./passkey.js").Backup[] } };

/**
 * Finishes sign-in: a new key pair is made here; the relay creates the account
 * with its public key. A returning player needs his key: the one this browser
 * kept, or his passkey backup.
 */
export async function finishSignIn(email: string, code: string): Promise<SignInResult> {
  const existing = loadSession();
  const kp = existing ? KeyPair.fromString(existing.privateKey as `ed25519:${string}`) : KeyPair.fromRandom("ed25519");
  const r = await relay<{ account_id: string; created: boolean; key_on_account?: boolean; vaults?: import("./passkey.js").Backup[] }>("/v1/auth/verify", {
    email,
    code,
    public_key: kp.getPublicKey().toString(),
  });
  if (!r.created && !r.key_on_account) {
    if (r.vaults?.length) return { unlock: { accountId: r.account_id, backups: r.vaults } };
    throw new Error(
      "Sign in on the device you signed up with first, and add a passkey in the Locker room.",
    );
  }
  const s = { accountId: r.account_id, privateKey: kp.toString() };
  saveSession(s);
  return { session: s, created: r.created };
}

export const topUp = (accountId: string) => relay(`/v1/accounts/${accountId}/topup`, {});

/** Accounts the relay made for email sign-in: it pays their gas. */
const PLAYER_ACCOUNT = /^u[0-9a-f]{16}\./;
export const isGasless = (accountId: string) => PLAYER_ACCOUNT.test(accountId);

/** Calls a contract with the player's own key. Returns the tx hash and the decoded return value. */
export async function call<T = unknown>(
  s: Session,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  opts: { tgas?: number; deposit?: bigint } = {},
): Promise<{ hash: string; value: T | undefined }> {
  try {
    return await send<T>(s, contractId, methodName, args, opts);
  } finally {
    recent.clear(); // what the screens read next must include this transaction
  }
}

async function send<T>(
  s: Session,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: { tgas?: number; deposit?: bigint },
): Promise<{ hash: string; value: T | undefined }> {
  const account = new Account(s.accountId, provider, s.privateKey as `ed25519:${string}`);
  const gas = BigInt(opts.tgas ?? 100) * 10n ** 12n;
  if (PLAYER_ACCOUNT.test(s.accountId)) {
    // Gasless: sign a delegate action (NEP-366); the relay sends it and pays the gas.
    const { signedDelegate } = await account.createSignedMetaTransaction({
      receiverId: contractId,
      actions: [actions.functionCall(methodName, args, gas, opts.deposit ?? 0n)],
      blockHeightTtl: 120,
    });
    const bytes = encodeSignedDelegate(signedDelegate);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const r = await relay<{ hash: string; value: string | null }>("/v1/relay", { signed_delegate: btoa(bin) });
    const raw = r.value ? atob(r.value) : "";
    return { hash: r.hash, value: raw ? (JSON.parse(raw) as T) : undefined };
  }
  const r = await account.callFunctionRaw({
    contractId,
    methodName,
    args,
    gas,
    deposit: opts.deposit ?? 0n,
  });
  const status = r.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure) throw new Error(failure(status.Failure));
  const raw = status.SuccessValue ? atob(status.SuccessValue) : "";
  return { hash: r.transaction.hash, value: raw ? (JSON.parse(raw) as T) : undefined };
}

function failure(f: unknown): string {
  const text = JSON.stringify(f);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/);
  return m?.[1] ?? "the transaction failed";
}

export const leagueCall = <T = unknown>(s: Session, method: string, args: Record<string, unknown> = {}, tgas = 100) =>
  call<T>(s, LEAGUE, method, args, { tgas });

export const transferRegistration = (s: Session, tokenId: string, club: string) =>
  call(s, PLAYERS, "nft_transfer", { receiver_id: club, token_id: tokenId }, { deposit: 1n });

/** Pays for a training session on one skill: the league opens a ticket. */
export const train = (s: Session, tokenId: string, skill: string, amount: string) =>
  call(s, GOALARS, "ft_transfer_call", { receiver_id: LEAGUE, amount, msg: JSON.stringify({ train: { token_id: tokenId, skill } }) }, { deposit: 1n, tgas: 150 });

export const startDrill = (tokenId: string) =>
  relay<{ ticket: import("./types.js").Ticket; level: number }>("/v1/training/start", { token_id: tokenId });

export const attestDrill = (tokenId: string, clicks: { t: number; x: number; y: number; up?: boolean }[]) =>
  relay<{ hits: number; rounds: number; points: number; signature: string }>("/v1/training/attest", { token_id: tokenId, clicks });

/** Submits the attested score: the league adds the points. */
export const finishTraining = (s: Session, tokenId: string, points: number, signature: string) =>
  leagueCall<import("./types.js").Player>(s, "finish_training", { token_id: tokenId, points, signature }, 30);

export const goalars = (accountId: string) => view<string>(GOALARS, "ft_balance_of", { account_id: accountId });

// ---- Wardrobe ----

/** A pack of three items, paid in G (burned). */
export const buyPack = (s: Session, amount: string) =>
  call(s, GOALARS, "ft_transfer_call", { receiver_id: LEAGUE, amount, msg: JSON.stringify({ pack: {} }) }, { deposit: 1n, tgas: 150 });

/** How many of each catalog item an account holds. */
export async function itemsOf(accountId: string, ids: string[]): Promise<Map<string, number>> {
  const counts = await view<string[]>(ITEMS, "mt_batch_balance_of", { account_id: accountId, token_ids: ids });
  return new Map(ids.map((id, i) => [id, Number(counts[i] ?? 0)]).filter(([, n]) => (n as number) > 0) as [string, number][]);
}

export const fuse = (s: Session, items: string[]) => leagueCall(s, "fuse", { items }, 120);
export const equip = (s: Session, tokenId: string, item: string) => leagueCall(s, "equip", { token_id: tokenId, item }, 120);
export const unequip = (s: Session, tokenId: string, kind: string) => leagueCall(s, "unequip", { token_id: tokenId, kind }, 60);

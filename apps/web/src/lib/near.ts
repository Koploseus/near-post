import { Account, JsonRpcProvider, KeyPair, actions, encodeSignedDelegate } from "near-api-js";
import { GOALARS, LEAGUE, PLAYERS, RELAY, RPC } from "./config.js";

export const provider = new JsonRpcProvider({ url: RPC });

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
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
function saveSession(s: Session | null) {
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

/**
 * Finishes sign-in: a new key pair is made here; the relay creates the account
 * with its public key. A returning player needs the key this browser kept.
 */
export async function finishSignIn(email: string, code: string): Promise<Session> {
  const existing = loadSession();
  const kp = existing ? KeyPair.fromString(existing.privateKey as `ed25519:${string}`) : KeyPair.fromRandom("ed25519");
  const r = await relay<{ account_id: string; created: boolean; key_on_account?: boolean }>("/v1/auth/verify", {
    email,
    code,
    public_key: kp.getPublicKey().toString(),
  });
  if (!r.created && !r.key_on_account) {
    throw new Error("This account was opened on another device. Its key lives there: sign in from that browser.");
  }
  const s = { accountId: r.account_id, privateKey: kp.toString() };
  saveSession(s);
  return s;
}

export const topUp = (accountId: string) => relay(`/v1/accounts/${accountId}/topup`, {});

/** Accounts the relay made for email sign-in: it pays their gas. */
const PLAYER_ACCOUNT = /^u[0-9a-f]{16}\./;

/** Calls a contract with the player's own key. Returns the tx hash and the decoded return value. */
export async function call<T = unknown>(
  s: Session,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  opts: { tgas?: number; deposit?: bigint } = {},
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

export const attestDrill = (tokenId: string, clicks: { t: number; x: number; y: number }[]) =>
  relay<{ hits: number; rounds: number; points: number; signature: string }>("/v1/training/attest", { token_id: tokenId, clicks });

/** Submits the attested score: the league adds the points. */
export const finishTraining = (s: Session, tokenId: string, points: number, signature: string) =>
  leagueCall<import("./types.js").Player>(s, "finish_training", { token_id: tokenId, points, signature }, 30);

export const goalars = (accountId: string) => view<string>(GOALARS, "ft_balance_of", { account_id: accountId });

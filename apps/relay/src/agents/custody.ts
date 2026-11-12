/**
 * The agents' keys, outside the relay: each agent signs with an OutLayer
 * wallet (https://github.com/out-layer/outlayer). Its private key is derived
 * and used inside an Intel TDX enclave and no endpoint exports it; the
 * agent's NEAR account is the wallet's implicit account.
 *
 * The relay asks the wallet to call a contract and holds no agent key. What
 * it holds is the key of one NEAR account (`accountId`), which names the
 * wallets (one per `seed`) and signs each request. A wallet's policy,
 * stored on chain, can limit what such a request may do.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { KeyPair, baseEncode } from "near-api-js";
import type { Chain } from "../chain.js";

export interface Custody {
  /** The OutLayer API (https://testnet-api.outlayer.ai on testnet). */
  url: string;
  /** The NEAR account the wallets belong to, and one of its full-access keys: it signs requests, never a transaction. */
  accountId: string;
  privateKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Which wallet is an agent's: his short name and the league's version ("rive-nord.v11"). */
export const seedOf = (slug: string, version: string) => `${slug}.${version}`;

/** `Authorization` for one request: the account's raw ed25519 signature of `auth:<seed>:<seconds>`. */
export function bearer(c: Custody, seed: string): string {
  const kp = KeyPair.fromString(c.privateKey as `ed25519:${string}`);
  const timestamp = Math.floor((c.now ?? Date.now)() / 1000);
  const signature = baseEncode(kp.sign(new TextEncoder().encode(`auth:${seed}:${timestamp}`)).signature);
  const json = JSON.stringify({ account_id: c.accountId, seed, pubkey: kp.getPublicKey().toString(), timestamp, signature });
  return `Bearer near:${Buffer.from(json).toString("base64url")}`;
}

async function request<T>(c: Custody, seed: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const r = await (c.fetch ?? fetch)(`${c.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: bearer(c, seed), ...(body === undefined ? {} : { "content-type": "application/json", "x-idempotency-key": randomUUID() }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as T };
}

/** The NEAR account of the wallet named `seed` (created on first use): 64 hex characters. */
export async function walletAccount(c: Custody, seed: string): Promise<string> {
  const { status, json } = await request<{ address?: string; error?: string }>(c, seed, "/wallet/v1/address?chain=near");
  if (status !== 200 || !/^[0-9a-f]{64}$/.test(json.address ?? "")) throw new Error(`custody: no wallet for ${seed}: ${status} ${json.error ?? ""}`);
  return json.address!;
}

/**
 * The account of every agent's wallet, by short name. Read once from
 * OutLayer and kept in `file`; an agent whose wallet cannot be read now is
 * left out (he sits out until the next start).
 */
export async function walletAccounts(c: Custody, slugs: string[], version: string, file: string | null): Promise<Record<string, string>> {
  let known: Record<string, string> = {};
  if (file) {
    try {
      known = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      known = {};
    }
  }
  let fresh = 0;
  for (const slug of slugs) {
    if (known[slug]) continue;
    try {
      known[slug] = await walletAccount(c, seedOf(slug, version));
      fresh++;
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  }
  if (file && fresh) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(known), { mode: 0o600 });
  }
  return known;
}

/** The public key of an implicit account: the account id is the key, in hex. */
export const keyOfImplicit = (account: string) => `ed25519:${baseEncode(Buffer.from(account, "hex"))}`;

/**
 * `base` with the agent's own calls sent through his wallet. Reads and
 * everything the parent signs stay on `base`. `settled` reads a
 * transaction's receipts and throws when one failed (for `callChecked`).
 */
export function custodyChain(base: Chain, c: Custody, seed: string, account: string, settled: (hash: string, signer: string) => Promise<void>): Chain {
  const call = async (contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit = 0n) => {
    const { status, json } = await request<{ status?: string; tx_hash?: string; error?: string; message?: string }>(c, seed, "/wallet/v1/call", {
      receiver_id: contractId,
      method_name: method,
      args,
      gas: String(BigInt(tgas) * 10n ** 12n),
      deposit: String(deposit),
    });
    if (status === 200 && json.status === "success" && json.tx_hash) return json.tx_hash;
    const said = json.message ?? json.error ?? json.status ?? `status ${status}`;
    throw new Error(said.match(/Smart contract panicked: (.+)$/)?.[1] ?? `custody: ${said}`);
  };
  return {
    ...base,
    call,
    async callChecked(contractId, method, args, tgas, deposit) {
      const hash = await call(contractId, method, args, tgas, deposit);
      await settled(hash, account);
      return hash;
    },
  };
}

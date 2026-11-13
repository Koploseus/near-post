/**
 * NEAR as the enclave reaches it: the host reads the chain and sends signed
 * transactions; the agent's key is derived here and signs here.
 */

import { block, sendTx, view, viewAccessKey, viewAccount } from "near:rpc/api@0.1.0";
import { mac } from "outlayer:encryption-keys/api@0.1.0";
import nacl from "tweetnacl";
import type { Chain } from "../../relay/src/chain.js";
import { base58, hex, utf8 } from "./bytes.js";
import { signedCall } from "./tx.js";

/**
 * What this run has asked of the chain. The host allows a run 100 requests:
 * a run stops taking new work well before, and the next run goes on.
 */
export const used = { calls: 0, sent: 0 };
export const MAX_CALLS = 100;

/**
 * An agent's key: an HMAC of his short name under a key that only this
 * program, run by its usual caller, is given by the enclave's keystore. No
 * one holds it outside a run.
 */
export function keyOf(slug: string): { account: string; publicKey: string; secretKey: Uint8Array } {
  const known = keys.get(slug);
  if (known) return known;
  const pair = nacl.sign.keyPair.fromSeed(mac("agents", undefined, utf8(slug)));
  const key = { account: hex(pair.publicKey), publicKey: `ed25519:${base58(pair.publicKey)}`, secretKey: pair.secretKey };
  keys.set(slug, key);
  return key;
}
const keys = new Map<string, { account: string; publicKey: string; secretKey: Uint8Array }>();

/** What the host answered: a view's own value, or a JSON-RPC envelope whose `result` is taken and whose `error` is thrown. */
const parsed = <T>([result, error]: [string, string], what: string): T => {
  const panic = (text: string) => text.match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? text.slice(0, 300);
  if (error) throw new Error(`${what}: ${panic(error)}`);
  const value = JSON.parse(result) as { jsonrpc?: string; result?: T; error?: unknown } | T;
  if (value && typeof value === "object" && "jsonrpc" in value) {
    if (value.error !== undefined) throw new Error(`${what}: ${panic(JSON.stringify(value.error))}`);
    return value.result as T;
  }
  return value as T;
};
const missing = (e: unknown) => /does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|doesn't exist/i.test(String(e));

interface Outcome {
  status?: unknown;
  transaction?: { hash: string };
  transaction_outcome?: { id: string };
  receipts_outcome?: { outcome: { status: unknown } }[];
}
const failure = (statuses: unknown[]) => {
  const failed = statuses.find((s) => typeof s === "object" && s !== null && "Failure" in s);
  return failed ? (JSON.stringify(failed).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "the transaction failed") : null;
};

const reads: Pick<Chain, "view" | "balance" | "freeBalance" | "hasKey"> = {
  async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
    used.calls++;
    return parsed<T>(view(contractId, method, JSON.stringify(args), "optimistic"), `${contractId}.${method}`);
  },
  async balance(accountId) {
    try {
      used.calls++;
      const a = parsed<{ amount: string; locked?: string }>(viewAccount(accountId, "optimistic"), accountId);
      return BigInt(a.amount) - BigInt(a.locked ?? 0);
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  },
  async freeBalance(accountId) {
    return reads.balance(accountId);
  },
  async hasKey(accountId, publicKey) {
    try {
      used.calls++;
      parsed(viewAccessKey(accountId, publicKey, "optimistic"), accountId);
      return true;
    } catch (e) {
      if (missing(e)) return false;
      throw e;
    }
  },
};

const notHere = (what: string) => async (): Promise<never> => {
  throw new Error(`${what}: the enclave holds no key but the agents'`);
};

/** The chain without a signer: the parent's work (funding an account) is not done here. */
export const chain: Chain = { ...reads, createAccount: notHere("create an account"), transfer: notHere("send NEAR"), call: notHere("call"), relay: notHere("relay") };

const nonces = new Map<string, bigint>();
const recent = { hash: "" };

/** The chain as one agent: his calls are signed with his key, here. */
export function chainOf(slug: string): Chain {
  const key = keyOf(slug);
  const send = async (contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit = 0n, checked = false) => {
    // His key's nonce is read once in a run, then counted here; any recent block's hash will do.
    if (!nonces.has(slug)) {
      used.calls++;
      const access = parsed<{ nonce: number | string; block_hash: string }>(viewAccessKey(key.account, key.publicKey, "optimistic"), `${slug}'s key`);
      nonces.set(slug, BigInt(access.nonce));
      recent.hash ||= access.block_hash;
    }
    const nonce = nonces.get(slug)! + 1n;
    nonces.set(slug, nonce);
    if (!recent.hash) {
      used.calls++;
      recent.hash = parsed<{ header: { hash: string } }>(block("final"), "block").header.hash;
    }
    const blockHash = recent.hash;
    const tx = signedCall({ signerId: key.account, secretKey: key.secretKey, nonce, receiverId: contractId, blockHash, method, args, gas: BigInt(tgas) * 10n ** 12n, deposit });
    used.calls++;
    used.sent++;
    const out = parsed<Outcome>(sendTx(tx, "EXECUTED_OPTIMISTIC"), `${contractId}.${method}`);
    const failed = failure(checked ? [out.status, ...(out.receipts_outcome ?? []).map((o) => o.outcome.status)] : [out.status]);
    if (failed) throw new Error(failed);
    return out.transaction?.hash ?? out.transaction_outcome?.id ?? "";
  };
  return {
    ...chain,
    call: (contractId, method, args, tgas, deposit) => send(contractId, method, args, tgas, deposit),
    callChecked: (contractId, method, args, tgas, deposit) => send(contractId, method, args, tgas, deposit, true),
  };
}

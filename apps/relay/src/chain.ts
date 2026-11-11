import { Account, JsonRpcProvider, type SignedDelegate, actions, nearToYocto } from "near-api-js";

/** What the relay needs from NEAR. Swappable in tests. */
export interface Chain {
  view<T>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  /** Spendable balance in yoctoNEAR, or null if the account does not exist. */
  balance(accountId: string): Promise<bigint | null>;
  hasKey(accountId: string, publicKey: string): Promise<boolean>;
  /** Balance not locked by storage, in yoctoNEAR, or null if the account does not exist. */
  freeBalance(accountId: string): Promise<bigint | null>;
  /** Signed by the parent account. Each returns the transaction hash. */
  createAccount(accountId: string, publicKey: string, yocto: bigint): Promise<string>;
  transfer(receiverId: string, yocto: bigint): Promise<string>;
  /**
   * Sends G from the parent to an account, registering it with the token
   * first (NEP-145 storage, paid by the parent). Optional: tests and old
   * relays leave it out.
   */
  giveG?(tokenId: string, receiverId: string, amount: bigint): Promise<string>;
  call(contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit?: bigint): Promise<string>;
  /** Like `call`, but also fails when a receipt it spawned failed (a cross-contract call that panicked). */
  callChecked?(contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit?: bigint): Promise<string>;
  /** Sends a player's signed delegate action, the parent paying the gas. */
  relay(signed: SignedDelegate): Promise<{ hash: string; value: string | null; error: string | null }>;
  /** Signs a delegate action as `accountId` with its key (an AI player's, for the bot API); nothing is sent. */
  signDelegate?(
    accountId: string,
    privateKey: string,
    receiverId: string,
    method: string,
    args: Record<string, unknown>,
    tgas: number,
    deposit?: bigint,
  ): Promise<SignedDelegate>;
}

export const near = (amount: string): bigint => BigInt(nearToYocto(amount as `${number}`));

/** The RPC says the account (or key) does not exist, as opposed to an error (rate limit, network). */
const missing = (e: unknown) => /does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|doesn't exist/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

/** A rate limit or a network failure: another RPC may answer. */
export const transient = (e: unknown) =>
  /429|rate limit|too many|fetch failed|network|timeout|ECONN|exceeded \d+ attempts|internal server error|bad gateway|service unavailable|gateway time-?out|status(?: code)? 5\d\d|\b50[234]\b/i.test(
    e instanceof Error ? `${e.name} ${e.message}` : String(e),
  );

/**
 * One provider over several public RPCs: a call that one refuses for a rate
 * limit or a network error goes to the next (and the next call starts there).
 * Anything else (account missing, contract panic) is the answer and is not
 * retried elsewhere. A signed transaction re-sent to another RPC is the same
 * transaction (same hash and nonce): it cannot land twice.
 */
export function failover(urls: string[]): JsonRpcProvider {
  const all = urls.map((url) => new JsonRpcProvider({ url }, { retries: 1, wait: 250, backoff: 2 }));
  if (all.length === 1) return all[0]!;
  let current = 0;
  return new Proxy(all[0]!, {
    get(_target, prop) {
      const first = (all[0] as unknown as Record<PropertyKey, unknown>)[prop];
      if (typeof first !== "function") return first;
      return async (...args: unknown[]) => {
        let last: unknown;
        const start = current;
        for (let i = 0; i < all.length; i++) {
          const at = (start + i) % all.length;
          const p = all[at] as unknown as Record<PropertyKey, (...a: unknown[]) => Promise<unknown>>;
          try {
            return await p[prop as string]!.apply(p, args);
          } catch (e) {
            if (!transient(e)) throw e;
            last = e;
            current = (at + 1) % all.length;
          }
        }
        throw last;
      };
    },
  });
}

/**
 * `urls`: the RPCs to use, in order of preference; the next one takes over
 * when one refuses (a 429) or fails on the network. `readsAlso`: more RPCs
 * for views only (the scheduler reads every few seconds and must not stop).
 */
export function rpcChain(urls: string | string[], signer?: { accountId: string; privateKey: string }, readsAlso: string[] = []): Chain {
  const list = [...new Set(typeof urls === "string" ? [urls] : urls)];
  const provider = failover(list);
  const quick = { retries: 2, wait: 200, backoff: 2 };
  const readers = [...list, ...readsAlso.filter((u) => !list.includes(u))].map((u) => new JsonRpcProvider({ url: u }, quick));
  const parent = () => {
    if (!signer) throw new Error("PARENT_PRIVATE_KEY is not set");
    return new Account(signer.accountId, provider, signer.privateKey as `ed25519:${string}`);
  };
  return {
    async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
      let last: unknown;
      for (const r of readers) {
        try {
          return (await r.callFunction({ contractId, method, args })) as T;
        } catch (e) {
          if (!transient(e)) throw e;
          last = e;
        }
      }
      throw last;
    },
    async balance(accountId) {
      try {
        const a = await provider.viewAccount({ accountId });
        return BigInt(a.amount) - BigInt(a.locked ?? 0);
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async freeBalance(accountId) {
      try {
        const a = await provider.viewAccount({ accountId });
        return BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n;
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    async hasKey(accountId, publicKey) {
      try {
        await provider.viewAccessKey({ accountId, publicKey });
        return true;
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
    async createAccount(accountId, publicKey, yocto) {
      const r = await parent().createAccount({ newAccountId: accountId, publicKey, nearToTransfer: yocto });
      return r.transaction.hash;
    },
    async giveG(tokenId, receiverId, amount) {
      const r = await parent().signAndSendTransaction({
        receiverId: tokenId,
        actions: [
          actions.functionCall("storage_deposit", { account_id: receiverId, registration_only: true }, 30n * 10n ** 12n, near("0.00125")),
          actions.functionCall("ft_transfer", { receiver_id: receiverId, amount: amount.toString(), memo: "welcome to NEAR Post" }, 30n * 10n ** 12n, 1n),
        ],
        throwOnFailure: false,
      });
      const failed = [r.status, ...r.receipts_outcome.map((o) => o.outcome.status)].find((s) => typeof s === "object" && s !== null && "Failure" in s);
      if (failed) throw new Error(JSON.stringify(failed).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? "the welcome transfer failed");
      return r.transaction.hash;
    },
    async transfer(receiverId, yocto) {
      const r = await parent().transfer({ receiverId, amount: yocto });
      return r.transaction.hash;
    },
    async relay(signed) {
      const r = await parent().signAndSendTransaction({
        receiverId: signed.delegateAction.senderId,
        actions: [actions.signedDelegate(signed)],
        throwOnFailure: false,
      });
      const failed = [r.status, ...r.receipts_outcome.map((o) => o.outcome.status)].find(
        (s) => typeof s === "object" && s !== null && "Failure" in s,
      );
      const text = failed ? JSON.stringify(failed) : "";
      const panic = text.match(/Smart contract panicked: ([^"\\]+)/)?.[1];
      const status = r.status as { SuccessValue?: string };
      return {
        hash: r.transaction.hash,
        value: failed ? null : (status.SuccessValue ?? null),
        error: failed ? (panic ?? "the transaction failed") : null,
      };
    },
    async signDelegate(accountId, privateKey, receiverId, method, args, tgas, deposit = 0n) {
      const a = new Account(accountId, provider, privateKey as `ed25519:${string}`);
      const { signedDelegate } = await a.createSignedMetaTransaction({
        receiverId,
        actions: [actions.functionCall(method, args, BigInt(tgas) * 10n ** 12n, deposit)],
        blockHeightTtl: 120,
      });
      return signedDelegate;
    },
    async call(contractId, methodName, args, tgas, deposit) {
      const r = await parent().callFunctionRaw({ contractId, methodName, args, gas: BigInt(tgas) * 10n ** 12n, ...(deposit ? { deposit } : {}) });
      const status = r.status as { Failure?: unknown };
      if (status.Failure) {
        const m = JSON.stringify(status.Failure).match(/Smart contract panicked: ([^"\\]+)/);
        throw new Error(m?.[1] ?? "the transaction failed");
      }
      return r.transaction.hash;
    },
    async callChecked(contractId, methodName, args, tgas, deposit) {
      const r = await parent().callFunctionRaw({ contractId, methodName, args, gas: BigInt(tgas) * 10n ** 12n, ...(deposit ? { deposit } : {}) });
      const failed = [r.status, ...r.receipts_outcome.map((o) => o.outcome.status)].find(
        (s) => typeof s === "object" && s !== null && "Failure" in s,
      );
      if (failed) {
        const m = JSON.stringify(failed).match(/Smart contract panicked: ([^"\\]+)/);
        throw new Error(m?.[1] ?? "the transaction failed");
      }
      return r.transaction.hash;
    },
  };
}

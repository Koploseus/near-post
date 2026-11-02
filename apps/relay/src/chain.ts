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
  call(contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit?: bigint): Promise<string>;
  /** Like `call`, but also fails when a receipt it spawned failed (a cross-contract call that panicked). */
  callChecked?(contractId: string, method: string, args: Record<string, unknown>, tgas: number, deposit?: bigint): Promise<string>;
  /** Sends a player's signed delegate action, the parent paying the gas. */
  relay(signed: SignedDelegate): Promise<{ hash: string; value: string | null; error: string | null }>;
}

export const near = (amount: string): bigint => BigInt(nearToYocto(amount as `${number}`));

/** The RPC says the account (or key) does not exist, as opposed to an error (rate limit, network). */
const missing = (e: unknown) => /does not exist|UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|doesn't exist/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));

export function rpcChain(url: string, signer?: { accountId: string; privateKey: string }): Chain {
  const provider = new JsonRpcProvider({ url });
  const parent = () => {
    if (!signer) throw new Error("PARENT_PRIVATE_KEY is not set");
    return new Account(signer.accountId, provider, signer.privateKey as `ed25519:${string}`);
  };
  return {
    async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
      return (await provider.callFunction({ contractId, method, args })) as T;
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

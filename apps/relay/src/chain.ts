import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";

/** What the relay needs from NEAR. Swappable in tests. */
export interface Chain {
  view<T>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  /** Spendable balance in yoctoNEAR, or null if the account does not exist. */
  balance(accountId: string): Promise<bigint | null>;
  hasKey(accountId: string, publicKey: string): Promise<boolean>;
  /** Signed by the parent account. Each returns the transaction hash. */
  createAccount(accountId: string, publicKey: string, yocto: bigint): Promise<string>;
  transfer(receiverId: string, yocto: bigint): Promise<string>;
  call(contractId: string, method: string, args: Record<string, unknown>, tgas: number): Promise<string>;
}

export const near = (amount: string): bigint => BigInt(nearToYocto(amount as `${number}`));

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
      } catch {
        return null;
      }
    },
    async hasKey(accountId, publicKey) {
      try {
        await provider.viewAccessKey({ accountId, publicKey });
        return true;
      } catch {
        return false;
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
    async call(contractId, methodName, args, tgas) {
      const r = await parent().callFunctionRaw({ contractId, methodName, args, gas: BigInt(tgas) * 10n ** 12n });
      return r.transaction.hash;
    },
  };
}

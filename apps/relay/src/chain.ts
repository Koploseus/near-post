import { JsonRpcProvider } from "near-api-js";

/** The read side of the chain the relay needs. Swappable in tests. */
export interface Chain {
  view<T>(contractId: string, method: string, args?: Record<string, unknown>): Promise<T>;
}

export function rpcChain(url: string): Chain {
  const provider = new JsonRpcProvider({ url });
  return {
    async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
      return (await provider.callFunction({ contractId, method, args })) as T;
    },
  };
}

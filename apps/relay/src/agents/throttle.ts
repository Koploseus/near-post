import type { Chain } from "../chain.js";

/**
 * The agents share the relay's RPC (and its rate limit) with the match-day
 * scheduler, which must never wait. Every agent request goes through one
 * limiter: at most `perSecond` a second, and a request the RPC refuses for
 * its rate limit (429) is retried after a pause.
 */
export class Limiter {
  private next = 0;
  constructor(private perSecond: number) {}
  async take() {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + 1000 / this.perSecond;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const limited = (e: unknown) => /429|rate limit/i.test(e instanceof Error ? e.message : String(e));

export function throttle(chain: Chain, limiter: Limiter, retries = 4): Chain {
  const run = async <T>(f: () => Promise<T>, readOnly: boolean): Promise<T> => {
    for (let i = 0; ; i++) {
      await limiter.take();
      try {
        return await f();
      } catch (e) {
        // A refused write may still have landed: only reads are retried blindly.
        if (!limited(e) || i >= retries || (!readOnly && !/429/.test(String(e)))) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
  };
  return {
    view: (c, m, a) => run(() => chain.view(c, m, a), true),
    balance: (a) => run(() => chain.balance(a), true),
    freeBalance: (a) => run(() => chain.freeBalance(a), true),
    hasKey: (a, k) => run(() => chain.hasKey(a, k), true),
    createAccount: (a, k, y) => run(() => chain.createAccount(a, k, y), false),
    transfer: (r, y) => run(() => chain.transfer(r, y), false),
    call: (c, m, a, t, d) => run(() => chain.call(c, m, a, t, d), false),
    ...(chain.callChecked ? { callChecked: (c: string, m: string, a: Record<string, unknown>, t: number, d?: bigint) => run(() => chain.callChecked!(c, m, a, t, d), false) } : {}),
    relay: (s) => run(() => chain.relay(s), false),
  };
}

/**
 * Reads from one RPC, writes through another: the agents' many reads go to
 * their own endpoint, their few transactions to the relay's (dRPC's public
 * endpoint answers views but failed to commit transactions from Fly).
 */
export function readsFrom(reads: Chain, writes: Chain): Chain {
  return {
    view: (c, m, a) => reads.view(c, m, a),
    balance: (a) => reads.balance(a),
    freeBalance: (a) => reads.freeBalance(a),
    hasKey: (a, k) => reads.hasKey(a, k),
    createAccount: (a, k, y) => writes.createAccount(a, k, y),
    transfer: (r, y) => writes.transfer(r, y),
    call: (c, m, a, t, d) => writes.call(c, m, a, t, d),
    ...(writes.callChecked ? { callChecked: (c: string, m: string, a: Record<string, unknown>, t: number, d?: bigint) => writes.callChecked!(c, m, a, t, d) } : {}),
    relay: (s) => writes.relay(s),
  };
}

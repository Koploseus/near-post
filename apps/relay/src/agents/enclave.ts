/**
 * The agents, by themselves. Their program (apps/enclave) runs inside an
 * enclave on OutLayer: it reads the league, decides with the same rules as
 * agents/runner.ts, signs with keys that exist only inside it and sends the
 * transactions. The relay holds no agent key and decides nothing for them.
 *
 * What is left here is the alarm clock: start a run for one share of the
 * agents, again while it says there is more to do, and keep what it says it
 * did, for the app to show. The relay also keeps the agents' accounts in
 * NEAR for gas, which is the parent's money.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type Chain, near } from "../chain.js";
import type { Entry, Journal } from "./journal.js";

export interface Enclave {
  /** The project's call address on OutLayer (`https://…/call/<owner>/<project>`). */
  url: string;
  /** The payment key that pays for the runs. It starts a run; it cannot tell it what to do. */
  key: string;
  /** How many shares the agents are split in (a run looks at one), and how many runs go at once. */
  shares: number;
  parallel: number;
  /** The most a run may cost, in millionths of a dollar. */
  limit?: number;
  /** An agent's account is topped up under this much NEAR (0.4 by default: a call may prepay 0.3). */
  low?: bigint;
  /** The row of OutLayer secrets a run reads (the model's API key), as `{profile, account_id}`. */
  secrets?: { profile: string; account_id: string };
  fetch?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
}

interface Answer {
  call_id?: string;
  status?: string;
  error?: string;
  poll_url?: string;
  /** The enclave's quote for this run (Intel TDX). */
  attestation_url?: string;
  output?: { error?: string; idle?: boolean; more?: boolean; entries?: (Entry & { slug?: string })[]; accounts?: Record<string, string>; logs?: string[] };
}
type Output = NonNullable<Answer["output"]> & { attestation?: string };

/**
 * One run of the program. It is started and then asked about until it is
 * over: a connection held for the whole run is cut by the network before a
 * long one ends, and what the run did would be lost to the relay.
 */
async function run(e: Enclave, input: unknown): Promise<Output> {
  const f = e.fetch ?? fetch;
  const wait = e.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const headers = { "x-payment-key": e.key, "x-compute-limit": String(e.limit ?? 300_000), "content-type": "application/json" };
  const r = await f(e.url, {
    method: "POST",
    headers,
    // Without limits of its own a run gets 10 billion instructions and a minute, and is cut off past either.
    body: JSON.stringify({ input, async: true, ...(e.secrets ? { secrets_ref: e.secrets } : {}), resource_limits: { max_instructions: 150_000_000_000, max_memory_mb: 512, max_execution_seconds: 170 } }),
    signal: AbortSignal.timeout(30_000),
  });
  let a = (await r.json().catch(() => ({}))) as Answer;
  if (!r.ok) throw new Error(`enclave: ${a.error?.split("\n")[0] ?? `status ${r.status}`}`);
  for (let i = 0; a.status === "pending" && a.poll_url && i < 100; i++) {
    await wait(i < 5 ? 2_000 : 4_000);
    const p = await f(new URL(a.poll_url, e.url).toString(), { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const next = p?.ok ? ((await p.json().catch(() => null)) as Answer | null) : null;
    if (next) a = { ...next, poll_url: next.poll_url ?? a.poll_url! };
  }
  if (a.status !== "completed" || !a.output) throw new Error(`enclave: ${a.error?.split("\n")[0] ?? a.status ?? "no answer"}`);
  if (a.output.error) throw new Error(`enclave: ${a.output.error}`);
  return { ...a.output, ...(a.attestation_url ? { attestation: new URL(a.attestation_url, e.url).toString() } : {}) };
}

/** Every agent's account, by short name, as the enclave derives them. Asked once, then kept in `file`. */
export async function enclaveAccounts(e: Enclave, file: string | null): Promise<Record<string, string>> {
  if (file) {
    try {
      const known = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      if (Object.keys(known).length) return known;
    } catch {
      // asked below
    }
  }
  const accounts = (await run({ ...e, limit: 1_000_000 }, { op: "accounts" })).accounts ?? {};
  if (file && Object.keys(accounts).length) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(accounts), { mode: 0o600 });
  }
  return accounts;
}

/** An agent's account is kept above this, for gas: a call may prepay 0.3 NEAR. */
const LOW = near("0.4");
const TOP_UP = near("0.3");

export class Waker {
  private busy = new Set<number>();
  /** The phase (match day and half) in which a share last said it had nothing left to do. */
  private idle = new Map<number, string>();
  private seen = new Set<string>();
  private toppedUp = new Map<string, number>();

  constructor(
    private e: Enclave,
    private chain: Chain,
    private leagueId: string,
    private journal: Journal,
    private accounts: string[],
    private now: () => number = Date.now,
  ) {
    for (const x of journal.feed(4000)) this.seen.add(`${x.agent}:${x.at}:${x.kind}`);
  }

  /** One look: starts runs for the shares that may have work, up to `parallel` at once. */
  async tick(): Promise<void> {
    const s = await this.chain.view<{ match_day: number; first_half_played: boolean }>(this.leagueId, "schedule");
    const phase = `${s.match_day}:${s.first_half_played ? 2 : 1}`;
    for (let share = 0; share < this.e.shares && this.busy.size < this.e.parallel; share++) {
      if (this.busy.has(share) || this.idle.get(share) === phase) continue;
      this.busy.add(share);
      void this.wake(share, phase).finally(() => this.busy.delete(share));
    }
    // Not waited for: the runs must not wait for the chain's answers about 76 balances.
    void this.fund();
  }

  private async wake(share: number, phase: string) {
    try {
      const out = await run(this.e, { op: "tick", shard: share, of: this.e.shares });
      for (const { slug: _, ...entry } of out.entries ?? []) {
        const k = `${entry.agent}:${entry.at}:${entry.kind}`;
        if (this.seen.has(k) || !this.accounts.includes(entry.agent)) continue;
        this.seen.add(k);
        // The run's quote goes with what it did: anyone can check which program decided.
        this.journal.add({ ...entry, ...(out.attestation ? { enclave: out.attestation } : {}) });
      }
      if (out.entries?.length) this.journal.save();
      if (out.idle) this.idle.set(share, phase);
    } catch (e) {
      console.error(`agents: share ${share}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private cursor = 0;
  private funding = false;

  /** Looks at a few agents' NEAR at each look, in turn, and tops up those that run low: each at most twice a day. */
  private async fund() {
    if (this.funding || !this.accounts.length) return;
    this.funding = true;
    try {
      for (let i = 0; i < Math.min(6, this.accounts.length); i++) {
        const account = this.accounts[this.cursor++ % this.accounts.length]!;
        const k = `${account}:${Math.floor(this.now() / 86_400_000)}`;
        if ((this.toppedUp.get(k) ?? 0) >= 2) continue;
        const low = this.e.low ?? LOW;
        const balance = await this.chain.balance(account).catch(() => low);
        if (balance !== null && balance >= low) continue;
        this.toppedUp.set(k, (this.toppedUp.get(k) ?? 0) + 1);
        await this.chain.transfer(account, TOP_UP).catch((e) => console.error(`agents: top-up of ${account}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      this.funding = false;
    }
  }
}

import type { Chain } from "./chain.js";
import { type CrowdClub, seatedBy } from "./crowd.js";

interface Schedule {
  match_day: number;
  next_match_at_ms: string;
  interval_ms: string;
}

/** One call: plays a division's half if the match day is due. Returns the tx hash if it did. */
export async function tick(chain: Chain, leagueId: string, nowMs = Date.now()): Promise<string | null> {
  const s = await chain.view<{ next_match_at_ms: string }>(leagueId, "schedule");
  if (nowMs < Number(s.next_match_at_ms)) return null;
  return chain.call(leagueId, "play_match_day", {}, 300);
}

/**
 * When each half of a match day really reached the chain (relay time, ms).
 * The app starts each half's clock there rather than at the scheduled time,
 * so a half played a few seconds late is still revealed whole, in step for
 * every viewer. Kept in memory: after a restart the app falls back to the
 * schedule.
 */
export class Kickoffs {
  private at = new Map<string, number>();
  record(day: number, half: 1 | 2, ms: number) {
    const k = `${day}:${half}`;
    if (!this.at.has(k)) this.at.set(k, ms);
    for (const key of this.at.keys()) if (Number(key.split(":")[0]) < day - 3) this.at.delete(key);
  }
  get(day: number): { first: number | null; second: number | null } {
    return { first: this.at.get(`${day}:1`) ?? null, second: this.at.get(`${day}:2`) ?? null };
  }
}

/**
 * Plays everything due: the league plays one division per call, so it calls
 * again while the match day stays due (at most `max` calls a tick). Records
 * when each half was first played.
 */
export async function playDue(chain: Chain, leagueId: string, max = 24, now: () => number = Date.now, kickoffs?: Kickoffs): Promise<string[]> {
  const txs: string[] = [];
  while (txs.length < max) {
    const s = await chain.view<{ next_match_at_ms: string; match_day: number; first_half_played: boolean }>(leagueId, "schedule");
    if (now() < Number(s.next_match_at_ms)) break;
    txs.push(await chain.call(leagueId, "play_match_day", {}, 300));
    kickoffs?.record(s.match_day, s.first_half_played ? 2 : 1, now());
  }
  return txs;
}

/**
 * Seats the demo crowd as the match day goes on. `asFan` signs for a crowd
 * account. Returns the fans seated by this tick. `done` remembers who sat
 * (or was refused) so a fan is sent once per day.
 */
export async function crowdTick(
  chain: Chain,
  asFan: (fan: string) => Chain,
  leagueId: string,
  crowd: CrowdClub[],
  every: number,
  done: Set<string>,
  nowMs = Date.now(),
): Promise<string[]> {
  if (crowd.length === 0) return [];
  const s = await chain.view<Schedule>(leagueId, "schedule");
  const interval = Number(s.interval_ms);
  const progress = Math.min(1, Math.max(0, 1 - (Number(s.next_match_at_ms) - nowMs) / interval));
  const seated: string[] = [];
  for (const c of crowd) {
    for (const fan of seatedBy(c, s.match_day, progress, every)) {
      const key = `${s.match_day}:${fan}`;
      if (done.has(key)) continue;
      done.add(key);
      try {
        await asFan(fan).call(leagueId, "check_in", {}, 30);
        seated.push(fan);
      } catch (e) {
        // "already in the stand" after a restart is fine; anything else is logged.
        const m = e instanceof Error ? e.message : String(e);
        if (!m.includes("already in the stand")) console.error(`crowd: ${fan} not seated: ${m}`);
      }
    }
  }
  for (const k of done) if (Number(k.split(":")[0]) < s.match_day) done.delete(k);
  return seated;
}

/**
 * Contracts pay for their own storage. Sends `topUp` from the parent to any
 * of them whose free balance falls under `minFree`. Returns those topped up.
 */
export async function keepFunded(chain: Chain, contracts: string[], minFree: bigint, topUp: bigint): Promise<string[]> {
  const out: string[] = [];
  for (const id of contracts) {
    const free = await chain.freeBalance(id);
    if (free !== null && free < minFree) {
      await chain.transfer(id, topUp);
      out.push(id);
    }
  }
  return out;
}

export interface SchedulerOptions {
  /** How often to look whether a half is due (3 s: a half starts at most a few seconds late). */
  everyMs?: number;
  kickoffs?: Kickoffs;
  crowd?: { clubs: CrowdClub[]; every: number; asFan: (fan: string) => Chain };
  keep?: { contracts: string[]; minFree: bigint; topUp: bigint };
}

/** Checks every `everyMs`; anyone else may play a match day first, that is fine. */
export function startScheduler(chain: Chain, leagueId: string, opts: SchedulerOptions = {}) {
  const done = new Set<string>();
  let n = 0;
  let busy = false;
  const log = (what: string) => (e: unknown) => console.error(`${what}: ${e instanceof Error ? e.message : e}`);
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      const txs = await playDue(chain, leagueId, 24, Date.now, opts.kickoffs).catch(log("match day not played"));
      for (const tx of txs ?? []) console.log(`match day played: ${tx}`);
      // The rest needs no hurry: every tenth look (30 s).
      if (n++ % 10 !== 0) return;
      if (opts.crowd) {
        const seated = await crowdTick(chain, opts.crowd.asFan, leagueId, opts.crowd.clubs, opts.crowd.every, done).catch(log("crowd"));
        if (seated?.length) console.log(`crowd: ${seated.length} fans seated`);
      }
      if (opts.keep && n % 200 === 1) {
        const topped = await keepFunded(chain, opts.keep.contracts, opts.keep.minFree, opts.keep.topUp).catch(log("storage top-up"));
        if (topped?.length) console.log(`storage top-up: ${topped.join(", ")}`);
      }
    } finally {
      busy = false;
    }
  };
  void run();
  return setInterval(() => void run(), opts.everyMs ?? 3_000);
}

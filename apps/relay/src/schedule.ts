import type { Chain } from "./chain.js";
import { type CrowdClub, seatedBy } from "./crowd.js";

interface Schedule {
  match_day: number;
  next_match_at_ms: string;
  interval_ms: string;
}

/** One tick: plays the match day if it is due. Returns the tx hash if it did. */
export async function tick(chain: Chain, leagueId: string, nowMs = Date.now()): Promise<string | null> {
  const s = await chain.view<{ next_match_at_ms: string }>(leagueId, "schedule");
  if (nowMs < Number(s.next_match_at_ms)) return null;
  return chain.call(leagueId, "play_match_day", {}, 300);
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
  everyMs?: number;
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
      const tx = await tick(chain, leagueId).catch(log("match day not played"));
      if (tx) console.log(`match day played: ${tx}`);
      if (opts.crowd) {
        const seated = await crowdTick(chain, opts.crowd.asFan, leagueId, opts.crowd.clubs, opts.crowd.every, done).catch(log("crowd"));
        if (seated?.length) console.log(`crowd: ${seated.length} fans seated`);
      }
      if (opts.keep && n++ % 20 === 0) {
        const topped = await keepFunded(chain, opts.keep.contracts, opts.keep.minFree, opts.keep.topUp).catch(log("storage top-up"));
        if (topped?.length) console.log(`storage top-up: ${topped.join(", ")}`);
      }
    } finally {
      busy = false;
    }
  };
  void run();
  return setInterval(() => void run(), opts.everyMs ?? 30_000);
}

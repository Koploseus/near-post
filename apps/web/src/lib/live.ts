import type { Kickoffs } from "./time.js";
import type { MatchEvent, MatchResult, Schedule } from "./types.js";

export const HALF_SECONDS = 45 * 60;

/** Which match day the live screen shows, and when it kicked off. */
export interface LiveDay {
  day: number;
  kickoff: number;
  /** "before": kick-off ahead; "live": being replayed; "done": over. */
  state: "before" | "live";
}

/** The match day to follow at `now`: the one in play, the one being replayed, or the next. */
export function liveDay(s: Schedule, now: number): LiveDay {
  const half = Number(s.half_ms);
  const ht = Number(s.half_time_ms);
  const last = Number(s.last_kickoff_at_ms);
  if (s.first_half_played) return { day: s.match_day, kickoff: Number(s.kickoff_at_ms), state: "live" };
  // A few minutes of grace: a half that reached the chain late is revealed late.
  if (last > 0 && now < last + 2 * half + ht + 180_000) return { day: s.match_day - 1, kickoff: last, state: "live" };
  return { day: s.match_day, kickoff: Number(s.kickoff_at_ms), state: "before" };
}

export type Phase = "before" | "first_half" | "half_time" | "waiting_second_half" | "second_half" | "full_time";

export interface Clock {
  phase: Phase;
  /** Match second reached (0 to the end of the second half). */
  second: number;
  /** "37'", "45+2'", "HT", "FT". */
  label: string;
  /** 0 to 1 through the whole match, for a progress bar. */
  progress: number;
}

/**
 * Where a match is at `now`: each half was played in one transaction, and is
 * revealed over `half_ms` of real time, its clock running at 45 min per half.
 * Each half starts when it really reached the chain (`kickoffs`, from the
 * relay), else at its scheduled time; every viewer computes the same.
 */
export function clock(m: MatchResult | null, kickoff: number, s: Schedule, now: number, kickoffs?: Kickoffs | null): Clock {
  const half = Number(s.half_ms);
  const ht = Number(s.half_time_ms);
  const end1 = m?.half_ends[0] ?? HALF_SECONDS;
  const end2 = m?.half_ends[1] ?? 2 * HALF_SECONDS;
  const start1 = Math.max(kickoff, kickoffs?.first ?? kickoff);
  // The first half is always shown whole, with at least 30 s of break.
  const start2 = Math.max(kickoffs?.second ?? kickoff + half + ht, start1 + half + 30_000);
  const progress = Math.min(1, Math.max(0, (now - start1) / (start2 + half - start1)));
  if (now < start1 || !m) return { phase: "before", second: 0, label: "–", progress: 0 };
  if (now < start1 + half) {
    const second = Math.floor(((now - start1) / half) * end1);
    return { phase: "first_half", second, label: minuteLabel(second, 0), progress };
  }
  if (!m.full_time) return { phase: now < start1 + half + ht ? "half_time" : "waiting_second_half", second: end1, label: "HT", progress };
  if (now < start2) return { phase: "half_time", second: end1, label: "HT", progress };
  if (now < start2 + half) {
    const second = HALF_SECONDS + Math.floor(((now - start2) / half) * (end2 - HALF_SECONDS));
    return { phase: "second_half", second, label: minuteLabel(second, 1), progress };
  }
  return { phase: "full_time", second: end2, label: "FT", progress: 1 };
}

/** "12'", "45+2'", "67'", "90+3'". */
export function minuteLabel(second: number, half: 0 | 1): string {
  const m = Math.floor(second / 60) + 1;
  if (half === 0) return m > 45 ? `45+${Math.min(9, m - 45)}'` : `${m}'`;
  const mm = Math.max(46, m);
  return mm > 90 ? `90+${Math.min(9, mm - 90)}'` : `${mm}'`;
}

/** The events shown so far, each with its half (0 or 1). */
export function visible(m: MatchResult, c: Clock): (MatchEvent & { half: 0 | 1 })[] {
  if (c.phase === "before") return [];
  return m.events
    .map((e, i) => ({ ...e, half: (i < m.first_half_events ? 0 : 1) as 0 | 1 }))
    .filter((e) => (e.half === 0 ? c.phase !== "first_half" || e.second <= c.second : (c.phase === "second_half" && e.second <= c.second) || c.phase === "full_time"));
}

/** The score of what is shown. */
export function scoreOf(events: MatchEvent[]): [number, number] {
  let h = 0;
  let a = 0;
  for (const e of events) if (e.kind === "goal" || e.kind === "own_goal") e.home ? h++ : a++;
  return [h, a];
}

/** Which eleven a player of an event belongs to: [half, side] → index in `elevens`. */
export function eleven(m: MatchResult, e: MatchEvent & { half: 0 | 1 }): string[] {
  const side = (e.home ? 0 : 1) ^ (e.kind === "own_goal" ? 1 : 0);
  return m.elevens[2 * e.half + side] ?? [];
}

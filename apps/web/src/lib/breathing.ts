import type { LedgerEntry } from "./near.js";

/** What a stand looked like after a match day (league `stand_result`). */
export interface StandSettled {
  present: number;
  fans: number;
  full_house: boolean;
}

export interface DayBreath {
  day: number;
  /** Fans present over the full-house targets of every club with fans, 0 to 100. */
  fill: number;
  fullHouses: number;
  stands: number;
  /** Minted because people showed up: full houses, goals (scaled by the stand), season tickets. */
  minted: bigint;
  /** Signup grant and welcome bonuses (check-ins). */
  onboarding: bigint;
  burned: bigint;
}

const PRESENCE = new Set(["full_house", "goals", "season_tickets"]);
const ONBOARDING = new Set(["signup", "welcome"]);

/** A stand's full-house target: `stadium_target_bps` of its fans, rounded up (league `full_house_target`). */
export const fullHouseTarget = (fans: number, targetBps = 6_000) => Math.ceil((fans * targetBps) / 10_000);

/**
 * Match day by match day: how full the stands were, and the G that minted and burned. Only the
 * days the ledger still holds whole (it is a ring of the last 600 entries), oldest first.
 */
export function breathing(ledger: LedgerEntry[], stands: Map<number, StandSettled[]>, targetBps = 6_000): DayBreath[] {
  if (ledger.length === 0) return [];
  const oldest = Math.min(...ledger.map((e) => e.match_day));
  return [...stands.keys()]
    .filter((day) => day > oldest)
    .sort((a, b) => a - b)
    .map((day) => {
      const of = stands.get(day)!.filter((s) => s.fans > 0);
      const present = of.reduce((a, s) => a + s.present, 0);
      const wanted = of.reduce((a, s) => a + fullHouseTarget(s.fans, targetBps), 0);
      const entries = ledger.filter((e) => e.match_day === day);
      const sum = (pick: (e: LedgerEntry) => boolean) => entries.filter(pick).reduce((a, e) => a + BigInt(e.amount), 0n);
      return {
        day,
        fill: wanted ? Math.min(100, Math.round((present * 100) / wanted)) : 0,
        fullHouses: of.filter((s) => s.full_house).length,
        stands: of.length,
        minted: sum((e) => e.mint && PRESENCE.has(e.kind)),
        onboarding: sum((e) => e.mint && ONBOARDING.has(e.kind)),
        burned: sum((e) => !e.mint),
      };
    });
}

/** Average net G (minted − burned) per day, on days the stands were at least half full and on the others. */
export function netBySplit(days: DayBreath[]): { full: bigint | null; empty: bigint | null } {
  const avg = (rows: DayBreath[]) => (rows.length ? rows.reduce((a, r) => a + r.minted + r.onboarding - r.burned, 0n) / BigInt(rows.length) : null);
  return { full: avg(days.filter((d) => d.fill >= 50)), empty: avg(days.filter((d) => d.fill < 50)) };
}

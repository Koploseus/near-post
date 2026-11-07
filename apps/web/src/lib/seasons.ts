import type { Champion, FinalRow, Schedule } from "./types.js";

/** The season and its match day (1-based) of a league-wide match day. */
export function seasonOf(matchDay: number, seasonDays: number): { season: number; day: number } {
  const i = Math.max(1, matchDay) - 1;
  return { season: Math.floor(i / seasonDays) + 1, day: (i % seasonDays) + 1 };
}

/** How far the current season is: days played, days left, share done. */
export function seasonProgress(s: Schedule): { played: number; left: number; share: number } {
  const played = s.season_day - 1;
  return { played, left: s.season_days - played, share: played / s.season_days };
}

/** Champions grouped by season, latest first: [{season, champions by division}]. */
export function bySeason(champions: Champion[]): { season: number; champions: Champion[] }[] {
  const out: { season: number; champions: Champion[] }[] = [];
  for (const c of champions) {
    const last = out.at(-1);
    if (last && last.season === c.season) last.champions.push(c);
    else out.push({ season: c.season, champions: [c] });
  }
  for (const s of out) s.champions.sort((a, b) => a.division - b.division);
  return out;
}

/** A club's finish in each past season it played, latest first. */
export interface Finish {
  season: number;
  division: number;
  position: number;
  of: number;
  points: number;
  moved: number;
}

export function finishesOf(club: string, tables: { season: number; division: number; rows: FinalRow[] }[]): Finish[] {
  const out: Finish[] = [];
  for (const t of tables) {
    const i = t.rows.findIndex((r) => r.club_id === club);
    if (i < 0) continue;
    const r = t.rows[i]!;
    out.push({ season: t.season, division: t.division, position: i + 1, of: t.rows.length, points: r.points, moved: r.moved });
  }
  return out.sort((a, b) => b.season - a.season);
}

/** "1st", "2nd", "3rd", "11th"... */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

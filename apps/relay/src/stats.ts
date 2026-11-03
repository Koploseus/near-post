/**
 * Season statistics, counted from the match sheets the league keeps on chain
 * (`results`): every goal, shot, save, foul and card has a player slot, and
 * each half's elevens say which token stood in that slot. Nothing here is
 * trusted input: anyone can recount it from the same views.
 */

import type { Chain } from "./chain.js";

type Kind = "goal" | "own_goal" | "saved" | "missed" | "corner" | "foul" | "yellow" | "red" | "free_kick" | "penalty";

export interface Sheet {
  home: string;
  away: string;
  events: { second: number; home: boolean; kind: Kind; player: number }[];
  /** First half home, first half away, second half home, second half away. */
  elevens: string[][];
  first_half_events: number;
  full_time: boolean;
  stats: { man_of_the_match: { player: string } | null };
}

export interface Line {
  token_id: string;
  club: string;
  apps: number;
  goals: number;
  shots: number;
  on_target: number;
  /** Shots on target this player stopped (keepers). */
  saves: number;
  fouls: number;
  yellows: number;
  reds: number;
  own_goals: number;
  motm: number;
}

/** Adds one finished match to the lines, by token. */
export function count(lines: Map<string, Line>, m: Sheet) {
  if (!m.full_time) return;
  const line = (token: string | undefined, club: string) => {
    if (!token) return null;
    let l = lines.get(token);
    if (!l) {
      l = { token_id: token, club, apps: 0, goals: 0, shots: 0, on_target: 0, saves: 0, fouls: 0, yellows: 0, reds: 0, own_goals: 0, motm: 0 };
      lines.set(token, l);
    }
    l.club = club;
    return l;
  };
  // Who played: anyone in an eleven of either half, once per match.
  const played = new Set<string>();
  m.elevens.forEach((eleven, i) => {
    for (const t of eleven) if (t && !played.has(t)) (played.add(t), line(t, i % 2 === 0 ? m.home : m.away)!.apps++);
  });
  m.events.forEach((e, i) => {
    const half = i < m.first_half_events ? 0 : 1;
    const side = e.home ? 0 : 1;
    const club = e.home ? m.home : m.away;
    const other = e.home ? m.away : m.home;
    const own = m.elevens[half * 2 + side] ?? [];
    const theirs = m.elevens[half * 2 + (1 - side)] ?? [];
    switch (e.kind) {
      case "goal": {
        const l = line(own[e.player], club);
        if (l) (l.goals++, l.shots++, l.on_target++);
        break;
      }
      case "saved": {
        const l = line(own[e.player], club);
        if (l) (l.shots++, l.on_target++);
        const keeper = line(theirs[0], other);
        if (keeper) keeper.saves++;
        break;
      }
      case "missed": {
        const l = line(own[e.player], club);
        if (l) l.shots++;
        break;
      }
      case "own_goal": {
        // `player` is a slot in the other eleven: the man who put it in his own net.
        const l = line(theirs[e.player], other);
        if (l) l.own_goals++;
        break;
      }
      case "foul": {
        const l = line(own[e.player], club);
        if (l) l.fouls++;
        break;
      }
      case "yellow": {
        const l = line(own[e.player], club);
        if (l) l.yellows++;
        break;
      }
      case "red": {
        const l = line(own[e.player], club);
        if (l) l.reds++;
        break;
      }
      default:
        break;
    }
  });
  const star = m.stats.man_of_the_match?.player;
  if (star && lines.has(star)) lines.get(star)!.motm++;
}

export interface SeasonStats {
  season: number;
  /** Match days counted: first to last. */
  from: number;
  to: number;
  players: (Line & { name: string })[];
}

interface ScheduleView {
  match_day: number;
  season: number;
  season_day: number;
}

/**
 * The season so far. A finished match day never changes, so each is read
 * once; names come from the squads, refreshed every few minutes.
 */
export class Stats {
  private days = new Map<number, Sheet[]>();
  private names = new Map<string, string>();
  private namesAt = 0;
  private cached: { at: number; value: SeasonStats } | null = null;

  constructor(
    private chain: Chain,
    private leagueId: string,
    private now: () => number = Date.now,
  ) {}

  async season(): Promise<SeasonStats> {
    if (this.cached && this.now() - this.cached.at < 30_000) return this.cached.value;
    const s = await this.chain.view<ScheduleView>(this.leagueId, "schedule");
    // `season_day` is the current day's place in the season (1 = its first).
    const from = s.match_day - s.season_day + 1;
    const to = s.match_day - 1;
    for (let d = from; d <= to; d++) {
      if (!this.days.has(d)) this.days.set(d, await this.chain.view<Sheet[]>(this.leagueId, "results", { match_day: d }));
    }
    for (const d of this.days.keys()) if (d < from) this.days.delete(d);
    if (this.now() - this.namesAt > 5 * 60_000) await this.loadNames();
    const lines = new Map<string, Line>();
    for (let d = from; d <= to; d++) for (const m of this.days.get(d) ?? []) count(lines, m);
    // Players who left every squad since (released, or out of the league) keep their name.
    for (const t of lines.keys()) {
      if (this.names.has(t)) continue;
      const p = await this.chain.view<{ name: string } | null>(this.leagueId, "get_player", { token_id: t }).catch(() => null);
      this.names.set(t, p?.name ?? t);
    }
    const value: SeasonStats = {
      season: s.season,
      from,
      to,
      players: [...lines.values()].map((l) => ({ ...l, name: this.names.get(l.token_id) ?? l.token_id })),
    };
    this.cached = { at: this.now(), value };
    return value;
  }

  private async loadNames() {
    const table = await this.chain.view<{ manager: string }[]>(this.leagueId, "table");
    for (const c of table) {
      const squad = await this.chain.view<{ token_id: string; name: string }[]>(this.leagueId, "squad", { account_id: c.manager });
      for (const p of squad) this.names.set(p.token_id, p.name);
    }
    this.namesAt = this.now();
  }
}

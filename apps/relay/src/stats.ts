/**
 * Season statistics, counted from the match sheets the league keeps on chain
 * (`results`): every goal, shot, save, foul and card has a player slot, and
 * each half's elevens say which token stood in that slot. Nothing here is
 * trusted input: anyone can recount it from the same views.
 */

import type { Chain } from "./chain.js";

type Kind = "goal" | "own_goal" | "saved" | "missed" | "corner" | "foul" | "yellow" | "red" | "free_kick" | "penalty" | "assist" | "tackle";

export interface Sheet {
  home: string;
  away: string;
  home_goals?: number;
  away_goals?: number;
  derby?: boolean;
  events: { second: number; home: boolean; kind: Kind; player: number }[];
  /** First half home, first half away, second half home, second half away. */
  elevens: string[][];
  first_half_events: number;
  full_time: boolean;
  stats: {
    man_of_the_match: { player: string } | null;
    home_possession?: number;
    away_possession?: number;
    home_yellows?: number;
    away_yellows?: number;
    home_reds?: number;
    away_reds?: number;
    home_fouls?: number;
    away_fouls?: number;
  };
}

/** A club's season, from its match sheets and its stand each day. */
export interface ClubLine {
  club: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  /** Last five results, oldest first: "W", "D" or "L". */
  form: string[];
  /** Wins in a row now, and the season's best run. */
  win_streak: number;
  best_win_streak: number;
  /** Biggest win: margin, score and opponent. */
  biggest_win: { day: number; margin: number; score: string; opponent: string } | null;
  /** Average share of the ball, in percent. */
  possession: number;
  yellows: number;
  reds: number;
  fouls: number;
  /** Fans present on match days at home and away alike (the stand is the club's). */
  attendance_total: number;
  attendance_best: number;
  /** Average fill of the full-house target, in percent (capped at 100 per day). */
  fill: number;
  full_houses: number;
  /** Runs of full houses: now, and best ever (the league's own counters). */
  full_house_streak: number;
  best_full_house_streak: number;
}

interface StandDay {
  present: number;
  fans: number;
  full_house: boolean;
}

/** Club lines from the match sheets (days in order) and each club's stand per day. */
export function clubLines(days: { day: number; sheets: Sheet[] }[], stands: Map<string, Map<number, StandDay>>, table: { manager: string; full_house_streak?: number; best_streak?: number }[]): ClubLine[] {
  const lines = new Map<string, ClubLine & { poss: number[]; results: string[] }>();
  const line = (club: string) => {
    let l = lines.get(club);
    if (!l) {
      l = {
        club, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, form: [], win_streak: 0, best_win_streak: 0, biggest_win: null,
        possession: 0, yellows: 0, reds: 0, fouls: 0, attendance_total: 0, attendance_best: 0, fill: 0, full_houses: 0, full_house_streak: 0,
        best_full_house_streak: 0, poss: [], results: [],
      };
      lines.set(club, l);
    }
    return l;
  };
  for (const c of table) line(c.manager);
  for (const { day, sheets } of days) {
    for (const m of sheets) {
      if (!m.full_time) continue;
      const hg = m.home_goals ?? 0;
      const ag = m.away_goals ?? 0;
      for (const home of [true, false]) {
        const l = line(home ? m.home : m.away);
        const [f, a] = home ? [hg, ag] : [ag, hg];
        l.played++;
        l.goals_for += f;
        l.goals_against += a;
        const r = f > a ? "W" : f === a ? "D" : "L";
        l.results.push(r);
        if (r === "W") {
          l.won++;
          l.win_streak++;
          l.best_win_streak = Math.max(l.best_win_streak, l.win_streak);
          if (!l.biggest_win || f - a > l.biggest_win.margin || (f - a === l.biggest_win.margin && f > Number(l.biggest_win.score.split("-")[0]))) {
            l.biggest_win = { day, margin: f - a, score: `${f}-${a}`, opponent: home ? m.away : m.home };
          }
        } else {
          l.win_streak = 0;
          if (r === "D") l.drawn++;
          else l.lost++;
        }
        const st = m.stats;
        const p = home ? st.home_possession : st.away_possession;
        if (typeof p === "number") l.poss.push(p);
        l.yellows += (home ? st.home_yellows : st.away_yellows) ?? 0;
        l.reds += (home ? st.home_reds : st.away_reds) ?? 0;
        l.fouls += (home ? st.home_fouls : st.away_fouls) ?? 0;
      }
    }
  }
  for (const c of table) {
    const l = line(c.manager);
    l.full_house_streak = c.full_house_streak ?? 0;
    l.best_full_house_streak = c.best_streak ?? 0;
    const fills: number[] = [];
    for (const [, s] of stands.get(c.manager) ?? new Map<number, StandDay>()) {
      l.attendance_total += s.present;
      l.attendance_best = Math.max(l.attendance_best, s.present);
      if (s.full_house) l.full_houses++;
      const target = Math.ceil((s.fans * 60) / 100);
      if (target > 0) fills.push(Math.min(100, (100 * s.present) / target));
    }
    l.fill = fills.length ? Math.round(fills.reduce((a, b) => a + b, 0) / fills.length) : 0;
  }
  return [...lines.values()].map(({ poss, results, ...l }) => ({
    ...l,
    form: results.slice(-5),
    possession: poss.length ? Math.round(poss.reduce((a, b) => a + b, 0) / poss.length) : 0,
  }));
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
  /** The last pass before a goal (match days since the engine records it). */
  assists: number;
  /** Balls won off a dribbler (same). */
  tackles: number;
  /** Matches in goal without conceding. */
  clean_sheets: number;
  penalties: number;
  penalties_scored: number;
}

/** Adds one finished match to the lines, by token. */
export function count(lines: Map<string, Line>, m: Sheet) {
  if (!m.full_time) return;
  const line = (token: string | undefined, club: string) => {
    if (!token) return null;
    let l = lines.get(token);
    if (!l) {
      l = { token_id: token, club, apps: 0, goals: 0, shots: 0, on_target: 0, saves: 0, fouls: 0, yellows: 0, reds: 0, own_goals: 0, motm: 0, assists: 0, tackles: 0, clean_sheets: 0, penalties: 0, penalties_scored: 0 };
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
      case "assist": {
        const l = line(own[e.player], club);
        if (l) l.assists++;
        break;
      }
      case "tackle": {
        const l = line(own[e.player], club);
        if (l) l.tackles++;
        break;
      }
      case "penalty": {
        const l = line(own[e.player], club);
        if (l) {
          l.penalties++;
          // The kick is the next event of the same side and player.
          const kick = m.events.slice(i + 1).find((x) => x.home === e.home && x.player === e.player && ["goal", "saved", "missed"].includes(x.kind));
          if (kick?.kind === "goal") l.penalties_scored++;
        }
        break;
      }
      default:
        break;
    }
  });
  // Clean sheets: the keepers (slot 0, either half) of a side that conceded nothing.
  for (const side of [0, 1] as const) {
    const conceded = m.events.filter((e) => (e.kind === "goal" && e.home === (side === 1)) || (e.kind === "own_goal" && e.home === (side === 1))).length;
    if (conceded > 0) continue;
    const keepers = new Set([m.elevens[side]?.[0], m.elevens[2 + side]?.[0]].filter((t): t is string => !!t));
    for (const k of keepers) line(k, side === 0 ? m.home : m.away)!.clean_sheets++;
  }
  const star = m.stats.man_of_the_match?.player;
  if (star && lines.has(star)) lines.get(star)!.motm++;
}

export interface SeasonStats {
  season: number;
  /** Match days counted: first to last. */
  from: number;
  to: number;
  /** The first match day of the season whose sheets record assists and tackles (the engine added them mid-season), or null. */
  assists_from: number | null;
  players: (Line & { name: string })[];
  clubs: ClubLine[];
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
  /** Each club's stand on each finished match day (never changes once played). */
  private stands = new Map<string, Map<number, StandDay>>();
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
    let assistsFrom: number | null = null;
    for (let d = from; d <= to && assistsFrom === null; d++) {
      if ((this.days.get(d) ?? []).some((m) => m.events.some((e) => e.kind === "assist" || e.kind === "tackle"))) assistsFrom = d;
    }
    const table = await this.chain.view<{ manager: string; full_house_streak?: number; best_streak?: number }[]>(this.leagueId, "table");
    await this.loadStands(table.map((c) => c.manager), from, to);
    const days: { day: number; sheets: Sheet[] }[] = [];
    for (let d = from; d <= to; d++) days.push({ day: d, sheets: this.days.get(d) ?? [] });
    const seasonStands = new Map<string, Map<number, StandDay>>();
    for (const [club, byDay] of this.stands) seasonStands.set(club, new Map([...byDay].filter(([d]) => d >= from && d <= to)));
    const value: SeasonStats = {
      season: s.season,
      from,
      to,
      assists_from: assistsFrom,
      players: [...lines.values()].map((l) => ({ ...l, name: this.names.get(l.token_id) ?? l.token_id })),
      clubs: clubLines(days, seasonStands, table),
    };
    this.cached = { at: this.now(), value };
    return value;
  }

  /** Reads the stands of finished days not read yet, a few at a time. */
  private async loadStands(clubs: string[], from: number, to: number) {
    const todo: [string, number][] = [];
    for (const c of clubs) for (let d = from; d <= to; d++) if (!this.stands.get(c)?.has(d)) todo.push([c, d]);
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async ([c, d]) => {
          const r = await this.chain.view<StandDay | null>(this.leagueId, "stand_result", { club_id: c, match_day: d }).catch(() => undefined);
          if (r === undefined) return; // try again next time
          if (!this.stands.has(c)) this.stands.set(c, new Map());
          this.stands.get(c)!.set(d, r ?? { present: 0, fans: 0, full_house: false });
        }),
      );
    }
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

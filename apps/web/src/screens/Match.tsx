import { useEffect, useMemo, useState } from "react";
import { clubName, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { serverNow } from "../lib/time.js";
import { league } from "../lib/near.js";
import { seasonOf, seasonProgress } from "../lib/seasons.js";
import type { Club, MatchResult } from "../lib/types.js";
import { Crest } from "./Crest.js";

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

type Outcome = "W" | "D" | "L";

/** Each club's last results this season (oldest first), from the match days fetched. */
export function formOf(days: MatchResult[][]): Map<string, Outcome[]> {
  const form = new Map<string, Outcome[]>();
  const add = (club: string, o: Outcome) => form.set(club, [...(form.get(club) ?? []), o]);
  for (const day of days) {
    for (const m of day) {
      const h: Outcome = m.home_goals > m.away_goals ? "W" : m.home_goals < m.away_goals ? "L" : "D";
      add(m.home, h);
      add(m.away, h === "W" ? "L" : h === "L" ? "W" : "D");
    }
  }
  return form;
}

/**
 * The league: the season so far up top, a division at a time (yours first),
 * its table with each club's crest and form, then a match day's results,
 * stepped through with arrows.
 */
export function Match() {
  const { schedule, clubId, club } = useGame();
  const now = useNow();
  const day = schedule?.match_day ?? 1;
  const last = day - 1;
  const [picked, setPicked] = useState<number | null>(null);
  const shown = picked ?? last;
  const [div, setDiv] = useState<number | null>(null);
  const seasonDays = schedule?.season_days ?? 26;
  // The match days of this season already played (the last five for the form).
  const firstOfSeason = last - (seasonOf(Math.max(1, last), seasonDays).day - 1);

  const { data: table } = useData(() => league<Club[]>("table"), [last]);
  const { data: results } = useData(() => (shown > 0 ? league<MatchResult[]>("results", { match_day: shown }) : Promise.resolve([])), [shown]);
  const { data: recent } = useData(async () => {
    const days = [];
    for (let d = Math.max(firstOfSeason, last - 4, 1); d <= last; d++) days.push(d);
    return Promise.all(days.map((d) => league<MatchResult[]>("results", { match_day: d }).catch(() => [])));
  }, [last, firstOfSeason]);

  const all = divisions(table ?? []);
  const division = div ?? club?.division ?? 1;
  const clubs = all[division - 1] ?? [];
  const names = new Map((table ?? []).map((c) => [c.manager, c.name]));
  const form = useMemo(() => formOf(recent ?? []), [recent]);
  const games = (results ?? []).map((m, i) => ({ m, i })).filter(({ m }) => m.division === division);

  const due = schedule ? Number(schedule.next_match_at_ms) : 0;
  const left = Math.max(0, due - now);
  const label = (d: number) => {
    const s = seasonOf(d, seasonDays);
    return `Season ${s.season} · day ${s.day}`;
  };

  return (
    <div className="league">
      <section className="league-strip" aria-label="Next match day">
        <div>
          <span className="eyebrow">
            SEASON {schedule?.season ?? 1} · DAY {schedule?.season_day ?? day} OF {seasonDays}
          </span>
          {schedule && (
            <div className="season-bar thin" role="progressbar" aria-label="Season" aria-valuemin={0} aria-valuemax={seasonDays} aria-valuenow={seasonProgress(schedule).played}>
              <div style={{ width: `${Math.round(seasonProgress(schedule).share * 100)}%` }} />
            </div>
          )}
        </div>
        {schedule?.first_half_played ? (
          <a className="cta small" href="#/live">
            LIVE NOW →
          </a>
        ) : left > 0 ? (
          <span className="strip-clock">
            <em>Kick-off in</em>
            <b>
              {Math.floor(left / 60000)}:{String(Math.floor(left / 1000) % 60).padStart(2, "0")}
            </b>
          </span>
        ) : (
          <span className="strip-clock">
            <b>Kick-off!</b>
          </span>
        )}
      </section>

      {all.length > 1 && (
        <nav className="div-tabs" aria-label="Divisions">
          {all.map((_, d) => (
            <button key={d} type="button" aria-pressed={division === d + 1} onClick={() => setDiv(d + 1)}>
              Division {d + 1}
              {club?.division === d + 1 && <span className="yours">yours</span>}
            </button>
          ))}
        </nav>
      )}

      <div className="league-grid">
        <section className="paper panel league-table" aria-label={`Division ${division} table`}>
          <span className="k">DIVISION {division} · TABLE</span>
          <table className="table standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Club</th>
                <th scope="col">P</th>
                <th scope="col" className="wdl">
                  W
                </th>
                <th scope="col" className="wdl">
                  D
                </th>
                <th scope="col" className="wdl">
                  L
                </th>
                <th scope="col">GD</th>
                <th scope="col">Pts</th>
                <th scope="col" className="form-col">
                  Form
                </th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((c, i) => {
                const d = division - 1;
                const up = d > 0 && i < movers(all[d - 1]!.length, clubs.length);
                const down = d < all.length - 1 && i >= clubs.length - movers(clubs.length, all[d + 1]!.length);
                const gd = c.goals_for - c.goals_against;
                return (
                  <tr key={c.manager} className={`${c.manager === clubId ? "mine" : ""}${up ? " up" : ""}${down ? " down" : ""}${i === 0 ? " lead" : ""}`}>
                    <td className="rank">{i + 1}</td>
                    <td className="club-cell">
                      <span className="club-in">
                        <Crest clubId={c.manager} name={c.name} size={24} />
                        <span>{c.name}</span>
                      </span>
                    </td>
                    <td>{c.played}</td>
                    <td className="wdl">{c.won}</td>
                    <td className="wdl">{c.drawn}</td>
                    <td className="wdl">{c.lost}</td>
                    <td>{gd > 0 ? `+${gd}` : gd}</td>
                    <td className="pts">{c.points}</td>
                    <td className="form-col">
                      <span className="form-strip">
                        {(form.get(c.manager) ?? []).slice(-5).map((o, k) => (
                          <i key={k} className={`r${o}`} title={o === "W" ? "Won" : o === "D" ? "Drawn" : "Lost"}>
                            {o}
                          </i>
                        ))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note legend-zones">
            <span className="z lead" /> champion
            {all.length > 1 && (
              <>
                <span className="z up" /> promoted <span className="z down" /> relegated
              </>
            )}
            <span> · after day {seasonDays}.</span> <a href="#/seasons">Past champions →</a>
          </p>
        </section>

        <section className="paper panel league-results" aria-label="Results">
          <div className="day-nav">
            <button type="button" className="chip" disabled={shown <= Math.max(1, last - 95)} onClick={() => setPicked(shown - 1)} aria-label="Previous match day">
              ‹
            </button>
            <span className="k">{shown > 0 ? `RESULTS · ${label(shown).toUpperCase()}` : "NO MATCH PLAYED YET"}</span>
            <button type="button" className="chip" disabled={shown >= last} onClick={() => setPicked(shown + 1)} aria-label="Next match day">
              ›
            </button>
          </div>
          <div className="games">
            {games.map(({ m, i }) => (
              <a key={`${m.home}-${m.away}`} className={`game-card${m.home === clubId || m.away === clubId ? " mine" : ""}`} href={`#/game/${shown}/${i}`}>
                {(
                  [
                    [m.home, m.home_goals, m.away_goals],
                    [m.away, m.away_goals, m.home_goals],
                  ] as const
                ).map(([id, g, other]) => (
                  <span key={id} className={`side${g > other ? " won" : ""}`}>
                    <Crest clubId={id} name={names.get(id) ?? short(id)} size={22} />
                    <span className="side-name">{clubName(names.get(id) ?? short(id))}</span>
                    <b>{g}</b>
                  </span>
                ))}
                <span className="game-foot">
                  {m.derby && <span className="tag">DERBY</span>}
                  <span>{m.goals.length ? `${m.goals.length} goal${m.goals.length > 1 ? "s" : ""}` : "No goals"}</span>
                  <span className="more">Match sheet ›</span>
                </span>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** The league table split by division (it comes division by division). */
export function divisions(table: Club[]): Club[][] {
  const out: Club[][] = [];
  for (const c of table) (out[c.division - 1] ??= []).push(c);
  return out.filter(Boolean);
}

/** How many clubs swap between two divisions at the end of a season (as the league does). */
export const movers = (upper: number, lower: number) => Math.min(3, Math.floor(upper / 2), Math.floor(lower / 2));

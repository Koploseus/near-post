import { Fragment, useEffect, useState } from "react";
import { clubName, minute, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league } from "../lib/near.js";
import type { Club, MatchResult } from "../lib/types.js";

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function Match() {
  const { schedule, clubId } = useGame();
  const now = useNow();
  const day = schedule?.match_day ?? 1;
  const last = day - 1;
  const [picked, setShown] = useState<number | null>(null);
  const shown = picked ?? last;
  const { data } = useData(async () => {
    const [results, table] = await Promise.all([
      shown > 0 ? league<MatchResult[]>("results", { match_day: shown }) : Promise.resolve([]),
      league<Club[]>("table"),
    ]);
    return { results, table };
  }, [shown]);
  const names = new Map((data?.table ?? []).map((c) => [c.manager, c.name]));
  const due = schedule ? Number(schedule.next_match_at_ms) : 0;
  const left = Math.max(0, due - now);
  return (
    <div className="match">
      <section className="panel ink" aria-label="Next match day">
        <span className="eyebrow">
          SEASON {schedule?.season ?? 1} · MATCH DAY {schedule?.season_day ?? day} OF {schedule?.season_days ?? 19}
        </span>
        {schedule?.first_half_played ? (
          <h2>
            Live now · <a href="#/live">follow the match →</a>
          </h2>
        ) : left > 0 ? (
          <h2>Kick-off in {Math.floor(left / 60000)}:{String(Math.floor(left / 1000) % 60).padStart(2, "0")}</h2>
        ) : (
          <h2 className="kickoff-now">Kick-off! The whistle is coming…</h2>
        )}
        <p className="sub">Kick-off is automatic: the relay plays each half on chain when it is due (anyone could).</p>
        {last > 1 && (
          <label className="seg-select">
            <span className="note">Results of match day</span>
            <select value={shown} onChange={(e) => setShown(Number(e.target.value))}>
              {Array.from({ length: Math.min(last, 96) }, (_, i) => last - i).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="paper panel" aria-label={`Results of match day ${last}`}>
        <h2>{shown > 0 ? `Match day ${shown}` : "No match played yet"}</h2>
        {data?.results.map((m, i) => (
          <Fragment key={`${m.home}-${m.away}`}>
          {(i === 0 || data.results[i - 1]!.division !== m.division) && (data.results.at(-1)?.division ?? 1) > 1 && <h3 className="div-head">Division {m.division}</h3>}
          <a className="result" key={`${m.home}-${m.away}`} href={`#/game/${shown}/${i}`} aria-label={`Match details: ${names.get(m.home)} ${m.home_goals}-${m.away_goals} ${names.get(m.away)}`}>
            <div className="score compact">
              <span className={m.home === clubId ? "mine" : ""}>{clubName(names.get(m.home) ?? short(m.home))}</span>
              <strong>
                {m.home_goals} - {m.away_goals}
              </strong>
              <span className={m.away === clubId ? "mine" : ""}>{clubName(names.get(m.away) ?? short(m.away))}</span>
              {m.derby && <span className="tag">DERBY</span>}
              <span className="more" aria-hidden="true">›</span>
            </div>
            {m.goals.length > 0 && (
              <p className="scorers">
                {m.goals.map((g) => `${minute(g.minute)} ${g.name}${g.kind === "Own" ? " (og)" : ""}`).join(" · ")}
              </p>
            )}
          </a>
          </Fragment>
        ))}
      </section>

      {divisions(data?.table ?? []).map((clubs, d, all) => (
        <section className="paper panel" aria-label={`Division ${d + 1} table`} key={d}>
          <h2>Division {d + 1}</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Club</th>
                <th scope="col">P</th>
                <th scope="col">GD</th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((c, i) => {
                const up = d > 0 && i < movers(all[d - 1]!.length, clubs.length);
                const down = d < all.length - 1 && i >= clubs.length - movers(clubs.length, all[d + 1]!.length);
                return (
                  <tr key={c.manager} className={`${c.manager === clubId ? "mine" : ""}${up ? " up" : ""}${down ? " down" : ""}`}>
                    <td>{i + 1}</td>
                    <td>
                      {c.name}
                      {up && <span className="zone"> ▲</span>}
                      {down && <span className="zone"> ▼</span>}
                    </td>
                    <td>{c.played}</td>
                    <td>{c.goals_for - c.goals_against}</td>
                    <td>{c.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {all.length > 1 && <p className="note">▲ promoted, ▼ relegated at the end of the season (match day {schedule?.season_days ?? 19}).</p>}
        </section>
      ))}
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

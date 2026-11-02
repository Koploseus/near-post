import { useEffect, useState } from "react";
import { minute, short } from "../lib/format.js";
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
        <span className="eyebrow">MATCH DAY {day}</span>
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
              {Array.from({ length: last }, (_, i) => last - i).map((d) => (
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
          <a className="result" key={`${m.home}-${m.away}`} href={`#/game/${shown}/${i}`} aria-label={`Match details: ${names.get(m.home)} ${m.home_goals}-${m.away_goals} ${names.get(m.away)}`}>
            <div className="score">
              <span className={m.home === clubId ? "mine" : ""}>{names.get(m.home) ?? short(m.home)}</span>
              <strong>
                {m.home_goals} - {m.away_goals}
              </strong>
              <span className={m.away === clubId ? "mine" : ""}>{names.get(m.away) ?? short(m.away)}</span>
              {m.derby && <span className="tag">DERBY</span>}
            </div>
            <ul className="goals">
              {m.goals.map((g, i) => (
                <li key={i}>
                  {minute(g.minute)} {g.name}
                  {g.kind === "Own" ? " (own goal, burns 6M)" : g.kind === "Late" ? " (late: mints double)" : ""} for{" "}
                  {names.get(g.for_home ? m.home : m.away) ?? ""}
                </li>
              ))}
              {m.goals.length === 0 && <li>No goal.</li>}
            </ul>
            {m.stats && <Sheet m={m} />}
            <span className="more">Match sheet, elevens and every action →</span>
          </a>
        ))}
      </section>

      <section className="paper panel" aria-label="Table">
        <h2>Division 3</h2>
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
            {data?.table.map((c, i) => (
              <tr key={c.manager} className={c.manager === clubId ? "mine" : ""}>
                <td>{i + 1}</td>
                <td>{c.name}</td>
                <td>{c.played}</td>
                <td>{c.goals_for - c.goals_against}</td>
                <td>{c.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Shots, shots on target and the man of the match, like the old match sheets. */
function Sheet({ m }: { m: MatchResult }) {
  const st = m.stats;
  const rows: [string, number, number][] = [
    ["Shots", st.home_shots, st.away_shots],
    ["On target", st.home_on_target, st.away_on_target],
  ];
  return (
    <div className="sheet">
      <table className="duel">
        <tbody>
          {rows.map(([label, h, a]) => (
            <tr key={label}>
              <td className="num">{h}</td>
              <td>
                <span className="duel-bar" aria-hidden="true">
                  <span style={{ width: `${(100 * h) / Math.max(1, h + a)}%` }} />
                </span>
                <span className="duel-label">{label}</span>
              </td>
              <td className="num">{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.man_of_the_match && (
        <p className="mom">
          <span className="k">MAN OF THE MATCH</span> {st.man_of_the_match.name} · {(st.man_of_the_match.rating / 10).toFixed(1)}
        </p>
      )}
    </div>
  );
}

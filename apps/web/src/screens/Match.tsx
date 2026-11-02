import { useEffect, useState } from "react";
import { Action } from "../lib/Action.js";
import { minute, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league, leagueCall } from "../lib/near.js";
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
  const { session, schedule, refresh, clubId } = useGame();
  const now = useNow();
  const day = schedule?.match_day ?? 1;
  const last = day - 1;
  const { data } = useData(async () => {
    const [results, table] = await Promise.all([
      last > 0 ? league<MatchResult[]>("results", { match_day: last }) : Promise.resolve([]),
      league<Club[]>("table"),
    ]);
    return { results, table };
  }, [last]);
  const names = new Map((data?.table ?? []).map((c) => [c.manager, c.name]));
  const due = schedule ? Number(schedule.next_match_at_ms) : 0;
  const left = Math.max(0, due - now);
  return (
    <div className="match">
      <section className="panel ink" aria-label="Next match day">
        <span className="eyebrow">MATCH DAY {day}</span>
        <h2>{left > 0 ? `Kick-off in ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}` : "Kick-off now"}</h2>
        <p className="sub">Anyone can play a match day once it is due. The score comes from the block's random seed and the elevens' ratings.</p>
        {session && left === 0 && (
          <Action label="PLAY THE MATCH DAY" run={() => leagueCall(session, "play_match_day", {}, 300)} done={() => setTimeout(refresh, 3000)} />
        )}
      </section>

      <section className="paper panel" aria-label={`Results of match day ${last}`}>
        <h2>{last > 0 ? `Match day ${last}` : "No match played yet"}</h2>
        {data?.results.map((m) => (
          <div className="result" key={`${m.home}-${m.away}`}>
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
          </div>
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

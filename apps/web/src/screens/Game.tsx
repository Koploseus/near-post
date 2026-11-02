import { useEffect, useMemo, useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { liveDay } from "../lib/live.js";
import { league } from "../lib/near.js";
import { ROLE_LABEL } from "../lib/pitch.js";
import type { Club, Formation, MatchResult, Player, Role } from "../lib/types.js";
import { MatchView } from "./Live.js";

const ROLES: Record<Formation, Role[]> = {
  "4-4-2": ["Gk", "Lb", "Cb", "Cb", "Rb", "Lm", "Cm", "Cm", "Rm", "St", "St"],
  "4-3-3": ["Gk", "Lb", "Cb", "Cb", "Rb", "Dm", "Cm", "Cm", "Lw", "St", "Rw"],
  "3-5-2": ["Gk", "Cb", "Cb", "Cb", "Lm", "Dm", "Cm", "Cm", "Rm", "St", "St"],
  "4-2-3-1": ["Gk", "Lb", "Cb", "Cb", "Rb", "Dm", "Dm", "Lw", "Am", "Rw", "St"],
};

/** One match, from #/game/<match day>/<index>: the whole sheet and both elevens. */
export function Game() {
  const { schedule } = useGame();
  const [, , dayS, idxS] = location.hash.split("/");
  const day = Number(dayS) || 1;
  const idx = Number(idxS) || 0;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ld = schedule ? liveDay(schedule, now) : null;
  const inPlay = ld?.state === "live" && ld.day === day;
  const { data } = useData(
    () => Promise.all([league<MatchResult[]>("results", { match_day: day }), league<Club[]>("table")]),
    [day, inPlay ? Math.floor(now / 20_000) : 0],
  );
  const m = data?.[0][idx] ?? null;
  const { data: squads } = useData(
    () => (m ? Promise.all([league<Player[]>("squad", { account_id: m.home }), league<Player[]>("squad", { account_id: m.away })]) : Promise.resolve(null)),
    [m?.home, m?.away],
  );
  const who = useMemo(() => new Map((squads ?? []).flat().map((p) => [p.token_id, p])), [squads]);
  if (!data) return <p className="sub">Loading the match…</p>;
  if (!m) return <p className="sub">No such match. <a href="#/match">Back to the results</a></p>;
  const names = new Map(data[1].map((c) => [c.manager, c.name]));
  return (
    <div className="game">
      <a className="link back-link" href="#/match">
        ← Results
      </a>
      <MatchView m={m} kickoff={ld?.kickoff ?? 0} now={now} names={names} all={data[0]} idx={idx} day={day} final={!inPlay} />
      <section className="paper panel">
        <h3>Elevens</h3>
        <div className="elevens">
          {[0, 1].map((side) => (
            <div key={side}>
              <span className="k">
                {names.get(side ? m.away : m.home)} · {m.formations[side]} · {m.strategies[side]}
                {m.formations[2 + side] && (m.formations[2 + side] !== m.formations[side] || m.strategies[2 + side] !== m.strategies[side])
                  ? ` → ${m.formations[2 + side]} · ${m.strategies[2 + side]} after half-time`
                  : ""}
              </span>
              <ol className="xi">
                {(m.elevens[side] ?? []).map((t, k) => {
                  const p = who.get(t);
                  const later = m.elevens[2 + side]?.[k];
                  return (
                    <li key={k}>
                      <b>{ROLE_LABEL[ROLES[m.formations[side]!]![k]!]}</b>
                      <span>
                        {p ? p.name : t ? t : "empty"}
                        {p?.controller ? " ★" : ""}
                        {later && later !== t ? ` → ${who.get(later)?.name ?? later}` : ""}
                      </span>
                      <em>{p?.overall ?? ""}</em>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
        <p className="note">★ played by a person. An arrow shows a change at half-time.</p>
      </section>
    </div>
  );
}

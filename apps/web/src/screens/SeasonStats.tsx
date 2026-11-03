import { useState } from "react";
import { RELAY } from "../lib/config.js";
import { useData, useGame } from "../lib/game.js";
import { league } from "../lib/near.js";
import type { Club } from "../lib/types.js";

/** One player's season, counted by the relay from the on-chain match sheets. */
interface Line {
  token_id: string;
  name: string;
  club: string;
  apps: number;
  goals: number;
  shots: number;
  on_target: number;
  saves: number;
  fouls: number;
  yellows: number;
  reds: number;
  own_goals: number;
  motm: number;
  assists: number;
  tackles: number;
  clean_sheets: number;
  penalties: number;
  penalties_scored: number;
}
interface Season {
  season: number;
  from: number;
  to: number;
  assists_from: number | null;
  players: Line[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const BOARDS: { title: string; score: (l: Line) => number; show: (l: Line) => string }[] = [
  { title: "Top scorer", score: (l) => l.goals, show: (l) => plural(l.goals, "goal") },
  { title: "Playmaker", score: (l) => l.assists, show: (l) => plural(l.assists, "assist") },
  { title: "Most shots", score: (l) => l.shots, show: (l) => `${l.shots} · ${l.on_target} on target` },
  { title: "Ball winner", score: (l) => l.tackles, show: (l) => plural(l.tackles, "tackle") },
  { title: "Safest hands", score: (l) => l.saves, show: (l) => plural(l.saves, "save") },
  { title: "Clean sheets", score: (l) => l.clean_sheets, show: (l) => plural(l.clean_sheets, "clean sheet") },
  { title: "Man of the match", score: (l) => l.motm, show: (l) => `${l.motm}×` },
  { title: "From the spot", score: (l) => l.penalties_scored * 10 - (l.penalties - l.penalties_scored), show: (l) => `${l.penalties_scored} of ${plural(l.penalties, "penalty", "penalties")}` },
  { title: "Hardest man", score: (l) => l.fouls, show: (l) => plural(l.fouls, "foul") },
  { title: "Referee's friend", score: (l) => l.yellows + 3 * l.reds, show: (l) => `${plural(l.yellows, "yellow")}${l.reds ? ` · ${plural(l.reds, "red")}` : ""}` },
];

const load = (): Promise<Season> =>
  fetch(`${RELAY}/v1/stats`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Season>) : Promise.reject(new Error(`relay error ${r.status}`))));

/** The season's leaderboards: your club, or the whole league. */
export function SeasonStats() {
  const { me, clubId } = useGame();
  const [scope, setScope] = useState<"club" | "league">(clubId ? "club" : "league");
  const { data, error } = useData(load, []);
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const clubName = (id: string) => table?.find((c) => c.manager === id)?.name ?? id.split(".")[0];
  const players = (data?.players ?? []).filter((l) => scope === "league" || l.club === clubId);
  return (
    <section className="paper panel season-stats" aria-labelledby="stats-title">
      <span className="k">{data ? `SEASON ${data.season} · MATCH DAYS ${data.from} TO ${data.to}` : "SEASON"}</span>
      <h3 id="stats-title">Season stats</h3>
      {clubId && (
        <div className="formations" role="group" aria-label="Scope">
          {(["club", "league"] as const).map((s) => (
            <button key={s} type="button" className={`chip${scope === s ? " on" : ""}`} onClick={() => setScope(s)}>
              {s === "club" ? "Our club" : "The league"}
            </button>
          ))}
        </div>
      )}
      {error && <p className="note">Stats unavailable right now.</p>}
      {data && data.to < data.from && <p className="note">The season starts after the first match day.</p>}
      <div className="boards">
        {data &&
          BOARDS.map((b) => {
            const top = players.filter((l) => b.score(l) > 0).sort((x, y) => b.score(y) - b.score(x) || x.apps - y.apps).slice(0, 3);
            return (
              <div key={b.title} className="board-card">
                <span className="k">{b.title.toUpperCase()}</span>
                {top.length === 0 ? (
                  <p className="note">Nobody yet.</p>
                ) : (
                  <ol>
                    {top.map((l) => (
                      <li key={l.token_id} className={l.token_id === me?.token_id ? "me" : ""}>
                        <b>{l.token_id === me?.token_id ? `${l.name} (you)` : l.name}</b>
                        {scope === "league" && <span className="note"> {clubName(l.club)}</span>}
                        <span className="val">{b.show(l)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
      </div>
      <p className="note">
        Counted from the match sheets the league keeps on chain (view <code>results</code>). {data && data.assists_from !== data.from && (data.assists_from ? `Assists and tackles count from match day ${data.assists_from}.` : "Assists and tackles count from the next match day.")}
      </p>
    </section>
  );
}

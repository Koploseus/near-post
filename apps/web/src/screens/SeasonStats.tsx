import { type ReactNode, useState } from "react";
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
  clubs: ClubLine[];
}
interface ClubLine {
  club: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  form: string[];
  win_streak: number;
  best_win_streak: number;
  biggest_win: { day: number; margin: number; score: string; opponent: string } | null;
  possession: number;
  yellows: number;
  reds: number;
  fouls: number;
  attendance_total: number;
  attendance_best: number;
  fill: number;
  full_houses: number;
  full_house_streak: number;
  best_full_house_streak: number;
}
type ClubBoard = { title: string; rank: (a: ClubLine, b: ClubLine) => number; keep?: (l: ClubLine) => boolean; show: (l: ClubLine, name: (id: string) => string) => ReactNode };
const formPoints = (l: ClubLine) => l.form.reduce((n, r) => n + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);
const Form = ({ l }: { l: ClubLine }) => (
  <span className="form-strip">
    {l.form.map((r, i) => (
      <i key={i} className={`r${r}`}>
        {r}
      </i>
    ))}
  </span>
);
const CLUB_BOARDS: ClubBoard[] = [
  { title: "Best attack", rank: (a, b) => b.goals_for - a.goals_for, keep: (l) => l.goals_for > 0, show: (l) => `${plural(l.goals_for, "goal")} in ${plural(l.played, "match", "matches")}` },
  { title: "Best defence", rank: (a, b) => a.goals_against / a.played - b.goals_against / b.played, keep: (l) => l.played > 0, show: (l) => `${l.goals_against} conceded in ${l.played}` },
  { title: "In form", rank: (a, b) => formPoints(b) - formPoints(a) || b.goals_for - b.goals_against - (a.goals_for - a.goals_against), keep: (l) => l.played > 0, show: (l) => <Form l={l} /> },
  { title: "Winning run", rank: (a, b) => b.best_win_streak - a.best_win_streak || b.win_streak - a.win_streak, keep: (l) => l.best_win_streak > 0, show: (l) => `${plural(l.best_win_streak, "win")} in a row${l.win_streak ? ` · ${l.win_streak} now` : ""}` },
  { title: "Biggest win", rank: (a, b) => (b.biggest_win?.margin ?? 0) - (a.biggest_win?.margin ?? 0), keep: (l) => !!l.biggest_win, show: (l, name) => `${l.biggest_win!.score} v ${name(l.biggest_win!.opponent)}, day ${l.biggest_win!.day}` },
  { title: "Keeps the ball", rank: (a, b) => b.possession - a.possession, keep: (l) => l.played > 0, show: (l) => `${l.possession}% possession` },
  { title: "Fair play", rank: (a, b) => a.yellows + 3 * a.reds - (b.yellows + 3 * b.reds) || a.fouls - b.fouls, keep: (l) => l.played > 0, show: (l) => `${plural(l.yellows, "yellow")} · ${plural(l.reds, "red")} · ${plural(l.fouls, "foul")}` },
];
const FAN_BOARDS: ClubBoard[] = [
  { title: "Biggest crowds", rank: (a, b) => b.attendance_total - a.attendance_total, keep: (l) => l.attendance_total > 0, show: (l) => `${plural(l.attendance_total, "fan")} in · best day ${l.attendance_best}` },
  { title: "Fullest stands", rank: (a, b) => b.fill - a.fill, keep: (l) => l.fill > 0, show: (l) => `${l.fill}% of the full-house target, on average` },
  { title: "Full houses", rank: (a, b) => b.full_houses - a.full_houses, keep: (l) => l.full_houses > 0, show: (l) => plural(l.full_houses, "full house", "full houses") },
  { title: "Longest run of full houses", rank: (a, b) => b.best_full_house_streak - a.best_full_house_streak || b.full_house_streak - a.full_house_streak, keep: (l) => l.best_full_house_streak > 0, show: (l) => `${plural(l.best_full_house_streak, "match day")}${l.full_house_streak ? ` · ${l.full_house_streak} now` : ""}` },
];

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
  type Scope = "club" | "league" | "clubs" | "fans";
  const [scope, setScope] = useState<Scope>(clubId ? "club" : "league");
  const { data, error } = useData(load, []);
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const clubName = (id: string): string => table?.find((c) => c.manager === id)?.name ?? id.split(".")[0] ?? id;
  const players = (data?.players ?? []).filter((l) => scope === "league" || l.club === clubId);
  return (
    <section className="paper panel season-stats" aria-labelledby="stats-title">
      <span className="k">{data ? `SEASON ${data.season} · MATCH DAYS ${data.from} TO ${data.to}` : "SEASON"}</span>
      <h3 id="stats-title">Season stats</h3>
      <div className="formations" role="group" aria-label="Scope">
        {((clubId ? ["club", "league", "clubs", "fans"] : ["league", "clubs", "fans"]) as Scope[]).map((s) => (
          <button key={s} type="button" className={`chip${scope === s ? " on" : ""}`} onClick={() => setScope(s)}>
            {{ club: "Our players", league: "League players", clubs: "Clubs", fans: "Fans" }[s]}
          </button>
        ))}
      </div>
      {error && <p className="note">Stats unavailable right now.</p>}
      {data && data.to < data.from && <p className="note">The season starts after the first match day.</p>}
      {data && (scope === "clubs" || scope === "fans") && (
        <div className="boards">
          {(scope === "clubs" ? CLUB_BOARDS : FAN_BOARDS).map((b) => {
            const top = data.clubs.filter((l) => !b.keep || b.keep(l)).sort(b.rank).slice(0, 5);
            return (
              <div key={b.title} className="board-card">
                <span className="k">{b.title.toUpperCase()}</span>
                {top.length === 0 ? (
                  <p className="note">Nobody yet.</p>
                ) : (
                  <ol>
                    {top.map((l) => (
                      <li key={l.club} className={l.club === clubId ? "me" : ""}>
                        <b>{clubName(l.club)}</b>
                        <span className="val">{b.show(l, clubName)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="boards">
        {data &&
          (scope === "club" || scope === "league") &&
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
        Counted from the match sheets and stands the league keeps on chain (views <code>results</code>, <code>stand_result</code>). {data && data.assists_from !== data.from && (data.assists_from ? `Assists and tackles count from match day ${data.assists_from}.` : "Assists and tackles count from the next match day.")}
      </p>
    </section>
  );
}

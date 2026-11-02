import { useEffect, useMemo, useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { clock, eleven, liveDay, minuteLabel, scoreOf, visible } from "../lib/live.js";
import { league } from "../lib/near.js";
import type { Club, MatchEvent, MatchResult, Player } from "../lib/types.js";

const ICON: Record<MatchEvent["kind"], string> = {
  goal: "⚽",
  own_goal: "⚽",
  saved: "🧤",
  missed: "↗",
  corner: "⚑",
  foul: "✋",
  yellow: "🟨",
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The live match: each half is played on chain at once and revealed over ten real minutes. */
export function Live() {
  const { schedule, clubId, refresh } = useGame();
  const now = useNow();
  const ld = schedule ? liveDay(schedule, now) : null;
  const waiting = ld?.state === "live" && schedule?.first_half_played && now > Number(schedule.next_match_at_ms);
  const tick = Math.floor(now / 15_000);
  const { data } = useData(async () => {
    if (!ld) return null;
    const [results, table, fixtures] = await Promise.all([
      ld.state === "live" ? league<MatchResult[]>("results", { match_day: ld.day }) : Promise.resolve([]),
      league<Club[]>("table"),
      league<[string, string][]>("fixtures_of", { match_day: ld.day }),
    ]);
    return { results, table, fixtures };
  }, [ld?.day, ld?.state, waiting ? tick : 0]);
  useEffect(() => {
    if (waiting) refresh();
  }, [waiting, tick, refresh]);

  const names = new Map((data?.table ?? []).map((c) => [c.manager, c.name]));
  const mineIdx = data?.results.findIndex((m) => m.home === clubId || m.away === clubId) ?? -1;
  const [pick, setPick] = useState<number | null>(null);
  const idx = pick ?? (mineIdx >= 0 ? mineIdx : 0);
  const m = data?.results[idx] ?? null;

  if (!schedule || !ld) return <p className="sub">Loading the match…</p>;
  if (ld.state === "before") {
    const left = Math.max(0, ld.kickoff - now);
    return (
      <div className="live">
        <section className="scoreboard before">
          <span className="eyebrow">MATCH DAY {ld.day} · KICK-OFF IN</span>
          <div className="countdown">
            {Math.floor(left / 60_000)}:{String(Math.floor(left / 1000) % 60).padStart(2, "0")}
          </div>
          <p className="sub">Two halves of ten minutes, five minutes of half-time. Take your slot and vote the strategy before kick-off.</p>
          <a className="cta" href="#/team">
            SET YOUR TEAM
          </a>
        </section>
        <section className="paper panel">
          <h2>Fixtures</h2>
          <ul className="fixtures">
            {data?.fixtures.map(([h, a]) => (
              <li key={h} className={h === clubId || a === clubId ? "mine" : ""}>
                <span>{names.get(h) ?? h}</span>
                <b>v</b>
                <span>{names.get(a) ?? a}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }
  if (!m) return <p className="sub">Waiting for the kick-off transaction…</p>;
  return <Match m={m} kickoff={ld.kickoff} now={now} names={names} all={data?.results ?? []} pick={setPick} idx={idx} day={ld.day} />;
}

function Match({
  m,
  kickoff,
  now,
  names,
  all,
  pick,
  idx,
  day,
}: {
  m: MatchResult;
  kickoff: number;
  now: number;
  names: Map<string, string>;
  all: MatchResult[];
  pick: (i: number) => void;
  idx: number;
  day: number;
}) {
  const { schedule } = useGame();
  const { data: squads } = useData(
    () => Promise.all([league<Player[]>("squad", { account_id: m.home }), league<Player[]>("squad", { account_id: m.away })]),
    [m.home, m.away],
  );
  const who = useMemo(() => new Map((squads ?? []).flat().map((p) => [p.token_id, p.name])), [squads]);
  const c = clock(m, kickoff, schedule!, now);
  const shown = visible(m, c);
  const [hs, as] = scoreOf(shown);
  const name = (e: MatchEvent & { half: 0 | 1 }) => who.get(eleven(m, e)[e.player] ?? "") ?? "a player";
  const line = (e: MatchEvent & { half: 0 | 1 }) => {
    const n = name(e);
    switch (e.kind) {
      case "goal":
        return `GOAL! ${n}`;
      case "own_goal":
        return `Own goal, ${n}`;
      case "saved":
        return `${n}'s shot is saved`;
      case "missed":
        return `${n} shoots wide`;
      case "corner":
        return "Corner";
      case "foul":
        return `Foul by ${n}`;
      case "yellow":
        return `Yellow card for ${n}`;
    }
  };
  const count = (home: boolean, kinds: MatchEvent["kind"][]) => shown.filter((e) => e.home === home && kinds.includes(e.kind)).length;
  const half1 = m.possession.slice(0, 2);
  const poss = c.phase === "full_time" ? [m.stats.home_possession, m.stats.away_possession] : half1.length === 2 && c.phase !== "first_half" ? half1.map((v) => Math.round((100 * v) / (half1[0]! + half1[1]! || 1))) : null;
  const rows: [string, number, number][] = [
    ["Shots", count(true, ["goal", "saved", "missed"]), count(false, ["goal", "saved", "missed"])],
    ["On target", count(true, ["goal", "saved"]), count(false, ["goal", "saved"])],
    ["Corners", count(true, ["corner"]), count(false, ["corner"])],
    ["Fouls", count(true, ["foul"]), count(false, ["foul"])],
  ];
  const phaseLabel = {
    before: "Kick-off soon",
    first_half: "First half",
    half_time: "Half-time: change your slot or strategy",
    waiting_second_half: "Half-time: the second half kicks off any second",
    second_half: "Second half",
    full_time: "Full time",
  }[c.phase];
  return (
    <div className="live">
      <section className="scoreboard" aria-live="polite">
        <span className="eyebrow">
          MATCH DAY {day} · {phaseLabel.toUpperCase()}
          {m.derby && <span className="tag">DERBY</span>}
        </span>
        <div className="board">
          <span className="team">{names.get(m.home) ?? m.home}</span>
          <span className="score">
            {hs} - {as}
          </span>
          <span className="team">{names.get(m.away) ?? m.away}</span>
        </div>
        <div className="clock-row">
          <span className={`clock${c.phase === "first_half" || c.phase === "second_half" ? " running" : ""}`}>{c.label}</span>
        </div>
        <div className="match-bar" aria-hidden="true">
          <span style={{ width: `${c.progress * 100}%` }} />
        </div>
        {(c.phase === "half_time" || c.phase === "waiting_second_half") && (
          <a className="cta small" href="#/team">
            CHANGE SLOT OR STRATEGY
          </a>
        )}
      </section>

      <div className="live-grid">
        <section className="paper panel feed" aria-label="Match events">
          <h3>Live</h3>
          <ol>
            {shown.length === 0 && <li className="note">Kick-off. The ball is rolling.</li>}
            {[...shown].reverse().map((e, i) => (
              <li key={`${e.half}-${e.second}-${i}`} className={`ev ${e.kind} ${e.home ? "h" : "a"}`}>
                <span className="ev-min">{minuteLabel(e.second, e.half)}</span>
                <span className="ev-icon" aria-hidden="true">
                  {ICON[e.kind]}
                </span>
                <span>
                  {line(e)} <span className="note">({names.get(e.home !== (e.kind === "own_goal") ? m.home : m.away)?.split(" ").slice(-1)[0]})</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <aside className="paper panel">
          <h3>Stats</h3>
          {poss && (
            <div className="poss">
              <span>{poss[0]}%</span>
              <span className="duel-bar">
                <span style={{ width: `${poss[0]}%` }} />
              </span>
              <span>{poss[1]}%</span>
              <span className="duel-label">Possession</span>
            </div>
          )}
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
          {c.phase === "full_time" && m.stats.man_of_the_match && (
            <p className="mom">
              <span className="k">MAN OF THE MATCH</span> {m.stats.man_of_the_match.name} · {(m.stats.man_of_the_match.rating / 10).toFixed(1)}
            </p>
          )}
          <h3>Other matches</h3>
          <ul className="others">
            {all.map((o, i) => {
              const [h, a] = scoreOf(visible(o, clock(o, kickoff, schedule!, now)));
              return (
                <li key={o.home}>
                  <button type="button" className={`link${i === idx ? " on" : ""}`} onClick={() => pick(i)}>
                    {names.get(o.home)} {h}-{a} {names.get(o.away)}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

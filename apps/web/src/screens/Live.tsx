import { useEffect, useMemo, useRef, useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { serverNow } from "../lib/time.js";
import { type Clock, clock, eleven, liveDay, minuteLabel, scoreOf, visible } from "../lib/live.js";
import { SPOTS } from "../lib/pitch.js";
import { league } from "../lib/near.js";
import { BOT, type Club, type MatchEvent, type MatchResult, type Player } from "../lib/types.js";
import { clubName } from "../lib/format.js";
import { Highlight, type HighlightKind, type HighlightMoment } from "./Highlight.js";

const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const ICON: Record<MatchEvent["kind"], string> = {
  goal: "⚽",
  own_goal: "⚽",
  saved: "🧤",
  missed: "↗",
  corner: "⚑",
  foul: "✋",
  yellow: "🟨",
  red: "🟥",
  free_kick: "◠",
  penalty: "◉",
};

/** "an academy kid shoots wide" → "An academy kid shoots wide". */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
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
  const tick = Math.floor(now / 3_000);
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
    if (waiting && tick % 5 === 0) refresh();
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
          {left > 0 ? (
            <>
              <span className="eyebrow">MATCH DAY {ld.day} · KICK-OFF IN</span>
              <div className="countdown">
                <span className="bouncing-ball" aria-hidden="true">
                  ⚽
                </span>
                {Math.floor(left / 60_000)}:{String(Math.floor(left / 1000) % 60).padStart(2, "0")}
              </div>
            </>
          ) : (
            <>
              <span className="eyebrow">MATCH DAY {ld.day}</span>
              <div className="countdown kickoff-now">KICK-OFF!</div>
              <p className="sub">The teams walk out: the first half is being played on chain, the whistle comes in a few seconds.</p>
            </>
          )}
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
  return <MatchView m={m} kickoff={ld.kickoff} now={now} names={names} all={data?.results ?? []} pick={setPick} idx={idx} day={ld.day} />;
}

/** Full time, for a match looked at afterwards. */
export const FINAL: Clock = { phase: "full_time", second: 99_999, label: "FT", progress: 1 };

export function MatchView({
  m,
  kickoff,
  now,
  names,
  all,
  pick,
  idx,
  day,
  final,
}: {
  m: MatchResult;
  kickoff: number;
  now: number;
  names: Map<string, string>;
  all: MatchResult[];
  pick?: (i: number) => void;
  idx: number;
  day: number;
  final?: boolean;
}) {
  const { schedule, kickoffs } = useGame();
  const { data: squads } = useData(
    () => Promise.all([league<Player[]>("squad", { account_id: m.home }), league<Player[]>("squad", { account_id: m.away })]),
    [m.home, m.away],
  );
  const who = useMemo(() => new Map((squads ?? []).flat().map((p) => [p.token_id, p.name])), [squads]);
  const c = final || !schedule ? FINAL : clock(m, kickoff, schedule, now, kickoffs[day]);
  // Until the real kick-off times are in (a few seconds), nothing replays.
  const syncing = !final && kickoffs[day] === undefined;
  const shown = visible(m, c);
  const [hs, as] = scoreOf(shown);
  const name = (e: MatchEvent & { half: 0 | 1 }) => {
    const t = eleven(m, e)[e.player] ?? "";
    return t === BOT ? "an academy kid" : (who.get(t) ?? "a player");
  };
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
      case "red": {
        const second = shown.some((x) => x !== e && x.kind === "yellow" && x.home === e.home && eleven(m, x)[x.player] === eleven(m, e)[e.player] && x.second <= e.second);
        return second ? `Second yellow: ${n} is sent off` : `RED CARD! ${n} is sent off`;
      }
      case "free_kick":
        return `Free kick on goal: ${n} steps up`;
      case "penalty":
        return `PENALTY! ${n} takes it`;
    }
  };
  // Big moments replay as a short animation, as they are revealed.
  const [replay, setReplay] = useState<HighlightMoment | null>(null);
  const seenEvents = useRef<number | null>(null);
  const wasSyncing = useRef(true);
  useEffect(() => {
    const justSynced = wasSyncing.current && !syncing;
    wasSyncing.current = syncing;
    if (seenEvents.current === null || final || REDUCED || syncing || justSynced) {
      seenEvents.current = shown.length; // nothing replays for what happened before we arrived
      return;
    }
    const fresh = shown.slice(seenEvents.current);
    seenEvents.current = shown.length;
    for (let i = shown.length - 1; i >= shown.length - fresh.length; i--) {
      const e = shown[i]!;
      const prev = shown[i - 1];
      const set = prev && prev.home === e.home && prev.player === e.player && (prev.kind === "penalty" || prev.kind === "free_kick") ? prev.kind : null;
      let kind: HighlightKind | null = null;
      if (e.kind === "red") kind = "red";
      else if (e.kind === "own_goal") kind = "own_goal";
      else if (e.kind === "goal") kind = set ? `${set}_goal` : "goal";
      else if (set && (e.kind === "saved" || e.kind === "missed")) kind = `${set}_${e.kind}`;
      if (kind) {
        const side = e.home !== (e.kind === "own_goal") ? m.home : m.away;
        setReplay({ kind, name: name(e), team: clubName(names.get(e.kind === "own_goal" ? (e.home ? m.away : m.home) : side) ?? ""), seed: e.second * 7 + e.player });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.length, syncing]);
  const count = (home: boolean, kinds: MatchEvent["kind"][]) => shown.filter((e) => e.home === home && kinds.includes(e.kind)).length;
  const half1 = m.possession.slice(0, 2);
  const poss = c.phase === "full_time" ? [m.stats.home_possession, m.stats.away_possession] : half1.length === 2 && c.phase !== "first_half" ? half1.map((v) => Math.round((100 * v) / (half1[0]! + half1[1]! || 1))) : null;
  const rows: [string, number, number][] = [
    ["Shots", count(true, ["goal", "saved", "missed"]), count(false, ["goal", "saved", "missed"])],
    ["On target", count(true, ["goal", "saved"]), count(false, ["goal", "saved"])],
    ["Corners", count(true, ["corner"]), count(false, ["corner"])],
    ["Fouls", count(true, ["foul"]), count(false, ["foul"])],
    ["Yellow cards", count(true, ["yellow"]), count(false, ["yellow"])],
    ["Red cards", count(true, ["red"]), count(false, ["red"])],
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
          <span className="team">{clubName(names.get(m.home) ?? m.home)}</span>
          <span className="score">
            {hs} - {as}
          </span>
          <span className="team">{clubName(names.get(m.away) ?? m.away)}</span>
        </div>
        <div className="clock-row">
          <span className={`clock${c.phase === "first_half" || c.phase === "second_half" ? " running" : ""}`}>{c.label}</span>
        </div>
        <div className="match-bar" aria-hidden="true">
          <span style={{ width: `${c.progress * 100}%` }} />
        </div>
        {!final && (replay ? <Highlight m={replay} onEnd={() => setReplay(null)} /> : <Pitch m={m} shown={shown} c={c} />)}
        {!final && <Moment shown={shown} name={name} names={names} m={m} />}
        {(c.phase === "half_time" || c.phase === "waiting_second_half") && (
          <a className="cta small" href="#/team">
            CHANGE SLOT OR STRATEGY
          </a>
        )}
      </section>

      <div className="live-grid">
        <section className="paper panel feed" aria-label="Match events">
          <h3>{final ? "Every action" : "Live"}</h3>
          <ol>
            {shown.length === 0 && <li className="note">Kick-off. The ball is rolling.</li>}
            {[...shown].reverse().map((e, i) => (
              <li key={`${e.half}-${e.second}-${i}`} className={`ev ${e.kind} ${e.home ? "h" : "a"}`}>
                <span className="ev-min">{minuteLabel(e.second, e.half)}</span>
                <span className="ev-icon" aria-hidden="true">
                  {ICON[e.kind]}
                </span>
                <span>
                  {cap(line(e))} <span className="note">({clubName(names.get(e.home !== (e.kind === "own_goal") ? m.home : m.away) ?? "")})</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <aside className="paper panel">
          <h3>Stats</h3>
          <p className="legend">
            <span className="sw home" /> {clubName(names.get(m.home) ?? "")}
            <span className="sw away" /> {clubName(names.get(m.away) ?? "")}
          </p>
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
              const [h, a] = final || !schedule ? [o.home_goals, o.away_goals] : scoreOf(visible(o, clock(o, kickoff, schedule, now, kickoffs[day])));
              return (
                <li key={o.home}>
                  {pick ? (
                    <button type="button" className={`link${i === idx ? " on" : ""}`} onClick={() => pick(i)}>
                      {clubName(names.get(o.home) ?? "")} {h}-{a} {clubName(names.get(o.away) ?? "")}
                    </button>
                  ) : (
                    <a className={`link${i === idx ? " on" : ""}`} href={`#/game/${day}/${i}`}>
                      {clubName(names.get(o.home) ?? "")} {o.home_goals}-{o.away_goals} {clubName(names.get(o.away) ?? "")}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/** A small pitch: 22 players in their formations, and the ball going where the play is. */
function Pitch({ m, shown, c }: { m: MatchResult; shown: (MatchEvent & { half: 0 | 1 })[]; c: Clock }) {
  const second = c.phase === "second_half" || c.phase === "full_time";
  const f = [m.formations[second ? 2 : 0] ?? m.formations[0]!, m.formations[second ? 3 : 1] ?? m.formations[1]!];
  const last = shown[shown.length - 1];
  const s = c.second;
  const recent = last && s - last.second < 45 && (c.phase === "first_half" || c.phase === "second_half");
  let x = 50 + 28 * Math.sin(s / 37) + 8 * Math.sin(s / 11);
  let y = 50 + 30 * Math.sin(s / 23 + 1);
  if (recent && last) {
    const dir = last.home ? 1 : -1; // home attacks to the right
    const at = (v: number) => 50 + dir * v;
    if (last.kind === "goal" || last.kind === "own_goal") [x, y] = [at(47), 50];
    else if (last.kind === "saved") [x, y] = [at(43), 46 + (s % 9)];
    else if (last.kind === "missed") [x, y] = [at(46), (s % 2 ? 30 : 70)];
    else if (last.kind === "corner") [x, y] = [at(48), s % 2 ? 3 : 97];
    else if (last.kind === "penalty") [x, y] = [at(39), 50];
    else if (last.kind === "free_kick") [x, y] = [at(31), 35 + (s % 30)];
    else [x, y] = [at(5 + (s % 20)), 20 + (s % 60)];
  }
  const stopped = c.phase === "half_time" || c.phase === "waiting_second_half" || c.phase === "full_time";
  if (stopped) [x, y] = [50, 50];
  // Sent off: his dot leaves the pitch (and his slot stays empty after the break).
  const half = second ? 1 : 0;
  const gone = (side: number, k: number) =>
    (second && m.elevens[2 + side]?.[k] === "") ||
    shown.some((e) => e.kind === "red" && e.half === half && Number(!e.home) === side && e.player === k);
  const spot = (side: 0 | 1, k: number) => {
    const [sx, sy] = SPOTS[f[side]!][k]!;
    const depth = (100 - sy) * 0.46 + 3; // own goal line to halfway
    const wobble = stopped ? 0 : Math.sin(s / 7 + k * 1.7 + side) * 2;
    return side === 0 ? { left: `${depth + wobble}%`, top: `${sx}%` } : { left: `${100 - depth + wobble}%`, top: `${100 - sx}%` };
  };
  return (
    <div className="mini-pitch" aria-hidden="true">
      <span className="mp-line mp-half" />
      <span className="mp-line mp-circle" />
      <span className="mp-goal mp-left" />
      <span className="mp-goal mp-right" />
      {[0, 1].map((side) =>
        Array.from({ length: 11 }, (_, k) =>
          gone(side, k) ? null : <span key={`${side}-${k}`} className={`mp-dot ${side ? "away" : "home"}`} style={spot(side as 0 | 1, k)} />,
        ),
      )}
      <span className="mp-ball" style={{ left: `${Math.min(98, Math.max(2, x))}%`, top: `${Math.min(96, Math.max(4, y))}%` }} />
    </div>
  );
}

/** "GOAL!" and cards, shown for a few seconds as they happen. */
function Moment({
  shown,
  name,
  names,
  m,
}: {
  shown: (MatchEvent & { half: 0 | 1 })[];
  name: (e: MatchEvent & { half: 0 | 1 }) => string;
  names: Map<string, string>;
  m: MatchResult;
}) {
  const seen = useRef<number | null>(null);
  const [moment, setMoment] = useState<(MatchEvent & { half: 0 | 1 }) | null>(null);
  useEffect(() => {
    // With animations on, goals, penalties and reds replay as highlights: only yellows show here.
    const big = shown.filter((e) => (REDUCED ? ["goal", "own_goal", "yellow", "red", "penalty"] : ["yellow"]).includes(e.kind));
    if (seen.current === null) {
      seen.current = big.length; // no fanfare for what happened before we arrived
      return;
    }
    if (big.length > seen.current) {
      seen.current = big.length;
      setMoment(big[big.length - 1]!);
      const t = setTimeout(() => setMoment(null), 4_000);
      return () => clearTimeout(t);
    }
  }, [shown]);
  if (!moment) return null;
  const goal = moment.kind === "goal" || moment.kind === "own_goal";
  const team = names.get((moment.home !== (moment.kind === "own_goal")) ? m.home : m.away) ?? "";
  const title = { goal: "GOAL!", own_goal: "OWN GOAL!", yellow: "🟨 BOOKED", red: "🟥 SENT OFF", penalty: "PENALTY!" }[moment.kind as string] ?? "";
  return (
    <div className={`moment ${goal ? "goal" : moment.kind === "red" ? "card red" : moment.kind === "penalty" ? "goal" : "card"}`} role="status">
      <strong>{title}</strong>
      <span>
        {name(moment)} · {team}
      </span>
    </div>
  );
}

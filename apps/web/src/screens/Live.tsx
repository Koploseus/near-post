import { CoachFace } from "../floodlight/art.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { serverNow } from "../lib/time.js";
import { type Clock, HALF_SECONDS, clock, eleven, liveDay, minuteLabel, scoreOf, visible } from "../lib/live.js";
import { frameAt, keyframes, positions } from "../lib/flow.js";
import { league } from "../lib/near.js";
import { BOT, type Club, type MatchEvent, type MatchResult, type Player, type Stand, type StandResult } from "../lib/types.js";
import { clubName } from "../lib/format.js";
import { type AgentEntry, agentFeed, useAgents } from "../lib/agents.js";
import { Highlight, type HighlightKind, type HighlightMoment } from "./Highlight.js";
import { TvPitch } from "./TvPitch.js";
import { faceNumber } from "./Look.js";
import { Crest, crestOf } from "./Crest.js";
import { PixelAvatar } from "../floodlight/PixelPlayer.js";

/** Shirt colours on the pitch: the home side in club blue, the away side in red. */

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
  assist: "",
  tackle: "",
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
  const players = useMemo(() => new Map((squads ?? []).flat().map((p) => [p.token_id, p])), [squads]);
  // Each side's stand for this match day: settled once the match is over, live before.
  const { data: standsOf } = useData(
    () =>
      Promise.all(
        [m.home, m.away].map(async (club_id) => {
          const done = await league<StandResult | null>("stand_result", { club_id, match_day: day }).catch(() => null);
          if (done) return { present: done.present, fans: done.fans, full: done.full_house };
          const now = await league<Stand | null>("stand", { club_id }).catch(() => null);
          return now && now.match_day === day ? { present: now.present, fans: now.fans, full: now.full_house } : null;
        }),
      ),
    [m.home, m.away, day],
  );
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
      case "goal": {
        const a = shown.find((x) => x.kind === "assist" && x.second === e.second && x.home === e.home);
        return a ? `GOAL! ${n} (assist ${name(a)})` : `GOAL! ${n}`;
      }
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
      default:
        return "";
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
    ["Tackles", count(true, ["tackle"]), count(false, ["tackle"])],
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
    <div className="live live-split">
      <div className="live-left">
      <section className="scoreboard" aria-live="polite">
        <span className="eyebrow">
          MATCH DAY {day} · {phaseLabel.toUpperCase()}
          {m.derby && <span className="tag">DERBY</span>}
        </span>
        <div className="board">
          {[m.home, m.away].map((id, side) => {
            const st = standsOf?.[side];
            return (
              <span key={id} className={`team${side ? " away" : ""}`}>
                <Crest clubId={id} name={names.get(id) ?? id} size={44} />
                <span>
                  <b>{clubName(names.get(id) ?? id)}</b>
                  {st && st.fans > 0 && (
                    <i className={`stand-tag${st.full ? " full" : ""}`}>
                      {side ? "AWAY" : "HOME"} STAND {st.present}/{st.fans}
                      {st.full ? " · FULL HOUSE" : ""}
                    </i>
                  )}
                </span>
              </span>
            );
          })}
          <span className="score">
            {hs}-{as}
          </span>
        </div>
        <div className="clock-row">
          <span className={`clock${c.phase === "first_half" || c.phase === "second_half" ? " running" : ""}`}>{c.label}</span>
        </div>
        <div className="match-bar" aria-hidden="true">
          <span style={{ width: `${c.progress * 100}%` }} />
        </div>
        {!final && (replay ? <Highlight m={replay} onEnd={() => setReplay(null)} /> : <Pitch m={m} shown={shown} c={c} players={players} names={names} />)}
        {!final && <Moment shown={shown} name={name} names={names} m={m} />}
        {(c.phase === "half_time" || c.phase === "waiting_second_half") && (
          <a className="cta small" href="#/team">
            VOTE THE SECOND-HALF STRATEGY
          </a>
        )}
      </section>

      <CoachTalk day={day} m={m} names={names} c={c} />
      </div>

      <div className="live-grid live-right">
        <section className="paper panel feed" aria-label="Match events">
          <h3>{final ? "Every action" : "Live"}</h3>
          <ol>
            {shown.length === 0 && <li className="note">Kick-off. The ball is rolling.</li>}
            {[...shown]
              .reverse()
              .filter((e) => e.kind !== "assist" && e.kind !== "tackle")
              .map((e, i) => (
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
        </aside>
      </div>
      <section className="other-matches" aria-label="Other matches">
          <span className="np-label">OTHER MATCHES</span>
        <ul className="others chips">
          {all.map((o, i) => {
            const [h, a] = final || !schedule ? [o.home_goals, o.away_goals] : scoreOf(visible(o, clock(o, kickoff, schedule, now, kickoffs[day])));
            return (
              <li key={o.home}>
                {pick ? (
                  <button type="button" className={`link${i === idx ? " on" : ""}`} onClick={() => pick(i)}>
                    <Crest clubId={o.home} name={names.get(o.home) ?? ""} size={18} /> {clubName(names.get(o.home) ?? "")} <b>{h}-{a}</b> {clubName(names.get(o.away) ?? "")} <Crest clubId={o.away} name={names.get(o.away) ?? ""} size={18} />
                  </button>
                ) : (
                  <a className={`link${i === idx ? " on" : ""}`} href={`#/game/${day}/${i}`}>
                    <Crest clubId={o.home} name={names.get(o.home) ?? ""} size={18} /> {clubName(names.get(o.home) ?? "")} <b>{o.home_goals}-{o.away_goals}</b> {clubName(names.get(o.away) ?? "")} <Crest clubId={o.away} name={names.get(o.away) ?? ""} size={18} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** A small pitch: 22 players in their formations, and the ball going where the play is. */
function Pitch({ m, shown, c, players, names }: { m: MatchResult; shown: (MatchEvent & { half: 0 | 1 })[]; c: Clock; players: Map<string, Player>; names: Map<string, string> }) {
  const second = c.phase === "second_half" || c.phase === "full_time";
  const half = second ? 1 : 0;
  const f = [m.formations[second ? 2 : 0] ?? m.formations[0]!, m.formations[second ? 3 : 1] ?? m.formations[1]!];
  // The ball's path through this half's events (the first half kicked off by the home side).
  const keys = useMemo(() => {
    const evs = half === 0 ? m.events.slice(0, m.first_half_events) : m.events.slice(m.first_half_events);
    const start = half === 0 ? 0 : HALF_SECONDS;
    const end = m.half_ends[half] ?? start + HALF_SECONDS;
    return keyframes(evs, start, end, half === 0 ? 0 : 1);
  }, [m, half]);
  const stopped = c.phase === "half_time" || c.phase === "waiting_second_half" || c.phase === "full_time" || c.phase === "before";
  const at = stopped ? { t: c.second, ball: [50, 50] as [number, number], side: 0 as const } : frameAt(keys, c.second);
  // Sent off: his dot leaves the pitch (and his slot stays empty after the break).
  const gone = (side: number, k: number) =>
    (second && m.elevens[2 + side]?.[k] === "") ||
    shown.some((e) => e.kind === "red" && e.half === half && Number(!e.home) === side && e.player === k);
  const teams = ([0, 1] as const).map((side) => positions(f[side]!, side, at.ball, at.side, at.side === side ? at.carrier : undefined));
  // Club colours on the pitch; when both clubs wear the same, the away side changes.
  const home = crestOf(m.home);
  const away = crestOf(m.away);
  const shirts = [home.main, away.main === home.main ? away.accent : away.main];
  // Momentum: who has had the ball over the last ten minutes of this half (the same play the pitch shows).
  const from = Math.max(half === 0 ? 0 : HALF_SECONDS, c.second - 600);
  let mine = 0;
  let all = 0;
  if (!stopped)
    for (let s = from; s <= c.second; s += 10) {
      all++;
      if (frameAt(keys, s).side === 0) mine++;
    }
  const share = all ? mine / all : 0.5;
  return (
    <>
    {/* The TV broadcast (camera on the ball); the small pitch of dots when motion is reduced. */}
    {!REDUCED ? (
      <TvPitch m={m} shown={shown} c={c} players={players} shirts={[shirts[0]!, shirts[1]!]} />
    ) : (
    <div className="mini-pitch" aria-hidden="true">
      <span className="mp-line mp-half" />
      <span className="mp-line mp-circle" />
      <span className="mp-box mp-left" />
      <span className="mp-box mp-right" />
      <span className="mp-goal mp-left" />
      <span className="mp-goal mp-right" />
      {teams.map((team, side) =>
        team.map(([x, y], k) => {
          if (gone(side, k)) return null;
          // Who plays this slot this half: his face, in his side's shirt.
          const id = (second ? m.elevens[2 + side] : undefined)?.[k] || m.elevens[side]?.[k];
          const p = id ? players.get(id) : undefined;
          return (
            <span key={`${side}-${k}`} className={`mp-sprite ${side ? "away" : "home"}`} style={{ left: `${x}%`, top: `${y}%` }}>
              {/* The whole footballer in his club's shirt; an academy kid (empty slot) gets one from his slot. */}
              <PixelAvatar look={p?.look} n={p ? faceNumber(p.token_id) : 7 + side * 11 + k} shirt={shirts[side]} size={34} />
            </span>
          );
        }),
      )}
      <span className="mp-ball" style={{ left: `${Math.min(99.5, Math.max(0.5, at.ball[0]))}%`, top: `${at.ball[1]}%` }} />
    </div>
    )}
    {!stopped && (
      <div className="momentum" aria-label={`Momentum: ${Math.round(share * 100)}% of the ball to the home side over the last ten minutes`}>
        <span className="np-label">MOMENTUM</span>
        <span className="np-label pressing">{share > 0.6 ? `${clubName(names.get(m.home) ?? "")} pressing` : share < 0.4 ? `${clubName(names.get(m.away) ?? "")} pressing` : "Even"}</span>
        <span className="momentum-cells">
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} style={{ background: i < Math.round(share * 30) ? shirts[0] : shirts[1] }} />
          ))}
        </span>
      </div>
    )}
    </>
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

/**
 * What the AI coaches of this match said: before kick-off, then at half-time
 * (shown from half-time on, so it does not give the first half away).
 */
function CoachTalk({ day, m, names, c }: { day: number; m: MatchResult; names: Map<string, string>; c: Clock }) {
  const roster = useAgents();
  const second = c.phase !== "before" && c.phase !== "first_half";
  const coaches = [m.home, m.away].filter((x) => roster.get(x)?.kind === "coach");
  const { data } = useData<AgentEntry[]>(() => (coaches.length ? agentFeed({ day, limit: 200 }) : Promise.resolve([])), [day, coaches.join(), second]);
  const lines = coaches.flatMap((club) => {
    const said = (data ?? []).filter((e) => e.agent === club && e.kind === "tactic" && (second || e.half !== 2));
    const last = said.sort((a, b) => b.at - a.at)[0];
    return last?.quote ? [{ club, e: last }] : [];
  });
  if (!lines.length) return null;
  return (
    <section className="paper panel coach-talk" aria-label="The coaches">
      {lines.map(({ club, e }) => (
        <p key={club}>
          <CoachFace id={club} size={56} />
          <span>
            <b>{roster.get(club)?.name}</b> <span className="ai-tag">AI COACH</span> <span className="note">{clubName(names.get(club) ?? "")}</span>
            <q>{e.quote}</q>
          </span>
        </p>
      ))}
    </section>
  );
}

import { useEffect, useState } from "react";
import { g, minute } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { clock, liveDay, scoreOf, visible } from "../lib/live.js";
import { league } from "../lib/near.js";
import type { Club, Lineup, MatchResult, Stand } from "../lib/types.js";
import { SkillBars, Sticker } from "./Sticker.js";

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** The home page: your player, your next match, what to do today, the league. */
export function Dashboard() {
  const { session, me, club, clubId, schedule, balance } = useGame();
  const now = useNow();
  const ld = schedule ? liveDay(schedule, now) : null;
  const { data } = useData(async () => {
    if (!schedule) return null;
    const day = schedule.match_day;
    const [table, fixtures, last, lineup, stand] = await Promise.all([
      league<Club[]>("table"),
      league<[string, string][]>("fixtures_of", { match_day: day }),
      day > 1 ? league<MatchResult[]>("results", { match_day: day - 1 }) : Promise.resolve([]),
      clubId ? league<Lineup>("lineup", { club_id: clubId }) : Promise.resolve(null),
      clubId ? league<Stand>("stand", { club_id: clubId }) : Promise.resolve(null),
    ]);
    const live = ld?.state === "live" ? await league<MatchResult[]>("results", { match_day: ld.day }) : [];
    return { table, fixtures, last, lineup, stand, live };
  }, [schedule?.match_day, schedule?.first_half_played, clubId, ld?.state]);
  const names = new Map((data?.table ?? []).map((c) => [c.manager, c.name]));
  const fixture = data?.fixtures.find(([h, a]) => h === clubId || a === clubId);
  const opponent = fixture ? (fixture[0] === clubId ? fixture[1] : fixture[0]) : null;
  const liveMatch = data?.live.find((m) => m.home === clubId || m.away === clubId) ?? data?.live[0];
  const lastMine = data?.last.find((m) => m.home === clubId || m.away === clubId);
  const inSlot = data?.lineup?.players.findIndex((p) => p?.token_id === me?.token_id) ?? -1;
  const chose = inSlot >= 0 && data?.lineup?.chosen[inSlot];

  const todo: { text: string; href: string; done?: boolean }[] = [];
  if (!session) todo.push({ text: "Sign in with your email: no wallet, no gas", href: "#/locker" });
  else if (!me) todo.push({ text: "Create your footballer", href: "#/locker" });
  else if (!club) todo.push({ text: "Sign for a club", href: "#/locker" });
  else {
    todo.push({ text: chose ? `You start: slot ${inSlot + 1}` : "Take your slot in the team", href: "#/team", done: !!chose });
    todo.push({
      text: me.last_trained_day >= (schedule?.match_day ?? 0) ? "Trained today" : "Train a skill (drill, up to +3)",
      href: "#/locker",
      done: me.last_trained_day >= (schedule?.match_day ?? 0),
    });
    todo.push({ text: "Take your seat in the stands", href: "#/stands" });
    if (BigInt(me.wallet) + BigInt(me.salary) > 0n) todo.push({ text: `Collect ${g(BigInt(me.wallet) + BigInt(me.salary))}`, href: "#/locker" });
  }

  return (
    <div className="dash">
      <aside className="dash-left">
        {me ? (
          <div className="paper panel profile">
            <Sticker p={me} />
            <h3>{me.name}</h3>
            <p className="note">
              {club ? club.name : "Free agent"} · {g(balance)}
            </p>
            <SkillBars p={me} />
          </div>
        ) : (
          <div className="paper panel profile">
            <h3>Your footballer</h3>
            <p className="note">A real player in a real squad: you train him, he plays, he earns.</p>
            <a className="cta small" href="#/locker">
              {session ? "CREATE HIM" : "SIGN IN"}
            </a>
          </div>
        )}
      </aside>

      <main className="dash-main">
        {ld?.state === "live" && liveMatch && schedule ? (
          <a className="hero live-hero" href="#/live">
            <span className="badge-live">LIVE</span>
            <LiveScore m={liveMatch} kickoff={ld.kickoff} now={now} names={names} />
            <span className="hero-cta">Follow the match →</span>
          </a>
        ) : (
          <a className="hero" href="#/live">
            <span className="eyebrow">MATCH DAY {schedule?.match_day ?? "…"} · KICK-OFF IN</span>
            <span className="countdown">{ld ? mmss(Math.max(0, ld.kickoff - now)) : "…"}</span>
            {club && opponent ? (
              <span className="hero-fixture">
                {club.name} <b>v</b> {names.get(opponent) ?? opponent}
              </span>
            ) : (
              <span className="hero-fixture">Eight clubs, every 30 minutes, live.</span>
            )}
          </a>
        )}

        <section className="paper panel">
          <span className="k">TODAY</span>
          <ul className="todo">
            {todo.map((t) => (
              <li key={t.text} className={t.done ? "done" : ""}>
                <a href={t.href}>
                  <span className="tick" aria-hidden="true">
                    {t.done ? "✓" : "›"}
                  </span>
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
          {data?.stand && (
            <div className="mini-stand">
              <span className="note">
                Your stand: {data.stand.present} of {data.stand.fans} fans · {data.stand.full_house ? "tifo complete!" : `${Math.max(0, data.stand.target - data.stand.present)} to go`}
              </span>
              <div className="bar">
                <div style={{ width: `${data.stand.fans ? Math.min(100, (100 * data.stand.present) / data.stand.target) : 0}%`, background: "var(--yellow)" }} />
              </div>
            </div>
          )}
        </section>

        {lastMine && (
          <section className="paper panel">
            <span className="k">LAST MATCH</span>
            <div className="score">
              <span className={lastMine.home === clubId ? "mine" : ""}>{names.get(lastMine.home)}</span>
              <strong>
                {lastMine.home_goals} - {lastMine.away_goals}
              </strong>
              <span className={lastMine.away === clubId ? "mine" : ""}>{names.get(lastMine.away)}</span>
            </div>
            <ul className="goals">
              {lastMine.goals.map((gl, i) => (
                <li key={i}>
                  {minute(gl.minute)} {gl.name}
                </li>
              ))}
            </ul>
            {lastMine.stats.man_of_the_match && <p className="note">Man of the match: {lastMine.stats.man_of_the_match.name}</p>}
          </section>
        )}
      </main>

      <aside className="dash-right">
        <section className="paper panel">
          <span className="k">DIVISION 3</span>
          <ol className="mini-table">
            {data?.table.map((c) => (
              <li key={c.manager} className={c.manager === clubId ? "mine" : ""}>
                <span>{c.name}</span>
                <b>{c.points}</b>
              </li>
            ))}
          </ol>
          <a className="link" href="#/match">
            Results and table
          </a>
        </section>
      </aside>
    </div>
  );
}

function LiveScore({ m, kickoff, now, names }: { m: MatchResult; kickoff: number; now: number; names: Map<string, string> }) {
  const { schedule } = useGame();
  const c = clock(m, kickoff, schedule!, now);
  const [h, a] = scoreOf(visible(m, c));
  return (
    <span className="hero-score">
      <span>{names.get(m.home)}</span>
      <b>
        {h} - {a}
      </b>
      <span>{names.get(m.away)}</span>
      <em>{c.label}</em>
    </span>
  );
}

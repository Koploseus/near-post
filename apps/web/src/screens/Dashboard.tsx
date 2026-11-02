import { useEffect, useState } from "react";
import { clubName, g, minute } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { clock, liveDay, scoreOf, visible } from "../lib/live.js";
import { league } from "../lib/near.js";
import { ROLE_NAME } from "../lib/pitch.js";
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

/**
 * Today: one thing to do now (it follows the match day: take your slot,
 * train, watch, vote at half-time), then the checklist, your last match and
 * your corner of the table. Logged out, what the game is in three lines.
 */
export function Dashboard() {
  const { session, me, club, clubId, schedule } = useGame();
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
  const slot = data?.lineup?.players.findIndex((p) => p?.token_id === me?.token_id) ?? -1;
  const chose = slot >= 0 && !!data?.lineup?.chosen[slot];
  const role = slot >= 0 && data?.lineup ? ROLE_NAME[data.lineup.roles[slot]!].toLowerCase() : null;
  const day = schedule?.match_day ?? 0;
  const trained = !!me && me.last_trained_day >= day;
  const owed = me ? BigInt(me.wallet) + BigInt(me.salary) : 0n;
  const c = liveMatch && schedule && ld?.state === "live" ? clock(liveMatch, ld.kickoff, schedule, now) : null;
  const halfTime = c?.phase === "half_time" || c?.phase === "waiting_second_half";

  // The one thing to do now.
  let next: { eyebrow: string; title: string; text: string; href: string; cta: string };
  if (!session) next = { eyebrow: "START", title: "Play a footballer in a real club", text: "Sign in with your email: no wallet, no gas, 30 seconds.", href: "#/locker", cta: "PLAY NOW" };
  else if (!me) next = { eyebrow: "STEP 1 OF 2", title: "Create your footballer", text: "Pick a name and a position: he is yours, minted in your name.", href: "#/locker", cta: "CREATE HIM" };
  else if (!club) next = { eyebrow: "STEP 2 OF 2", title: "Sign for a club", text: "Join a squad: everyone plays, eleven and one more.", href: "#/locker", cta: "PICK A CLUB" };
  else if (halfTime) next = { eyebrow: "HALF-TIME", title: "Change the game", text: "Vote the strategy for the second half, or move to another slot.", href: "#/team", cta: "TEAM SHEET" };
  else if (ld?.state === "live") next = { eyebrow: "LIVE", title: "Your match is on", text: "Every action, revealed as it happens.", href: "#/live", cta: "WATCH LIVE" };
  else if (!chose) next = { eyebrow: "BEFORE KICK-OFF", title: "Take your slot", text: role ? `For now you play ${role}. Pick the position you want.` : "Pick the position you want in the eleven.", href: "#/team", cta: "TEAM SHEET" };
  else if (!trained) next = { eyebrow: "BEFORE KICK-OFF", title: "Train a skill", text: "One session per match day: a football mini-game, up to +3.", href: "#/locker", cta: "TRAIN" };
  else if (owed > 0n) next = { eyebrow: "YOUR WALLET", title: `Collect ${g(owed)}`, text: "Your goals and your salary are waiting.", href: "#/locker", cta: "COLLECT" };
  else next = { eyebrow: "ALL SET", title: "Fill the stand", text: "Bring your club's fans in: a full stand pays every fan.", href: "#/stands", cta: "THE STANDS" };

  const checklist = club && me
    ? [
        { text: chose ? `You start: ${role}` : "Take your slot", href: "#/team", done: chose },
        { text: trained ? "Trained today" : "Train a skill (up to +3)", href: "#/locker", done: trained },
        {
          text: data?.stand?.full_house ? "Tifo complete" : `Stand: ${data?.stand?.present ?? 0} of ${data?.stand?.fans ?? 0} fans`,
          href: "#/stands",
          done: !!data?.stand?.full_house,
        },
        ...(owed > 0n ? [{ text: `Collect ${g(owed)}`, href: "#/locker", done: false }] : []),
      ]
    : [];

  const division = data?.table.find((x) => x.manager === clubId)?.division ?? 1;
  const mine = data?.table.filter((x) => x.division === division) ?? [];
  const at = Math.max(0, mine.findIndex((x) => x.manager === clubId));
  const from = Math.max(0, Math.min(at - 2, mine.length - 5));
  const around = mine.slice(from, from + 5);

  const nextCard = (
    <a className={`next-card${session ? "" : " landing"}`} href={next.href}>
      <span className="k">{next.eyebrow}</span>
      <strong>{next.title}</strong>
      <span className="next-text">{next.text}</span>
      <span className="cta">{next.cta}</span>
    </a>
  );

  return (
    <div className="today">
      <section className="today-main">
        {/* Logged out, what the game is comes first; logged in, the match does. */}
        {!session && nextCard}
        {/* The match: live score, or the countdown to kick-off. */}
        {ld?.state === "live" && liveMatch && schedule ? (
          <a className="hero live-hero" href="#/live">
            <span className="badge-live">LIVE</span>
            <LiveScore m={liveMatch} kickoff={ld.kickoff} now={now} names={names} />
          </a>
        ) : (
          <a className="hero" href="#/live">
            <span className="eyebrow">MATCH DAY {schedule?.season_day ?? day} · KICK-OFF IN</span>
            <span className="countdown">{ld ? mmss(Math.max(0, ld.kickoff - now)) : "…"}</span>
            {club && opponent ? (
              <span className="hero-fixture">
                {clubName(club.name)} <b>v</b> {clubName(names.get(opponent) ?? opponent)}
              </span>
            ) : (
              <span className="hero-fixture">{data?.table.length ?? "…"} clubs, a match day every 30 minutes, live.</span>
            )}
          </a>
        )}

        {session && nextCard}
        {!session && (
          <ul className="pitch-points">
            <li>
              <b>Your footballer, your club.</b> Mint him, sign for a squad, take your slot: eleven and one more, everyone plays.
            </li>
            <li>
              <b>Real football mini-games.</b> Penalties, through balls, dribbles, sprints, tackles: win them to raise his skills.
            </li>
            <li>
              <b>Goals mint G, fans burn it.</b> Fill the stand for a tifo, dress your player, climb the divisions.
            </li>
          </ul>
        )}

        {checklist.length > 0 && (
          <section className="paper panel">
            <span className="k">TODAY</span>
            <ul className="todo">
              {checklist.map((t) => (
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
          </section>
        )}

        {lastMine && (
          <a className="paper panel last-match" href={`#/game/${day - 1}/${data!.last.indexOf(lastMine)}`}>
            <span className="k">LAST MATCH</span>
            <span className="score-line">
              <span className={lastMine.home === clubId ? "mine" : ""}>{clubName(names.get(lastMine.home) ?? "")}</span>
              <strong>
                {lastMine.home_goals}-{lastMine.away_goals}
              </strong>
              <span className={lastMine.away === clubId ? "mine" : ""}>{clubName(names.get(lastMine.away) ?? "")}</span>
            </span>
            {lastMine.goals.length > 0 && <span className="note">{lastMine.goals.map((gl) => `${minute(gl.minute)} ${gl.name}`).join(" · ")}</span>}
            {lastMine.stats.man_of_the_match && <span className="note">Man of the match: {lastMine.stats.man_of_the_match.name}</span>}
          </a>
        )}
      </section>

      <aside className="today-side">
        {me && (
          <div className="paper panel profile">
            <Sticker p={me} />
            <h3>{me.name}</h3>
            <p className="note">{club ? club.name : "Free agent"}</p>
            <SkillBars p={me} />
          </div>
        )}
        {around.length > 0 && (
          <section className="paper panel">
            <span className="k">DIVISION {division}</span>
            <ol className="mini-table ranked">
              {around.map((x, i) => (
                <li key={x.manager} className={x.manager === clubId ? "mine" : ""}>
                  <i>{from + i + 1}</i>
                  <span>{x.name}</span>
                  <b>{x.points}</b>
                </li>
              ))}
            </ol>
            <a className="link" href="#/match">
              Full table and results →
            </a>
          </section>
        )}
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
      <span>{clubName(names.get(m.home) ?? "")}</span>
      <b>
        {h} - {a}
      </b>
      <span>{clubName(names.get(m.away) ?? "")}</span>
      <em>{c.label}</em>
    </span>
  );
}

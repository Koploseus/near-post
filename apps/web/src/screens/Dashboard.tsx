import { Cabinet } from "../floodlight/art.js";
import { Crest } from "./Crest.js";
import { useEffect, useState } from "react";
import { clubName, g, minute } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { inbox } from "../lib/people.js";
import type { Applicant, Condition } from "../lib/types.js";
import { serverNow } from "../lib/time.js";
import { clock, liveDay, scoreOf, visible } from "../lib/live.js";
import { league } from "../lib/near.js";
import { ROLE_NAME } from "../lib/pitch.js";
import type { Champion, Club, Lineup, MatchResult, Stand } from "../lib/types.js";
import { SkillBars } from "./Sticker.js";
import { Avatar, faceNumber } from "./Look.js";
import { Wall } from "./Wall.js";
import { ICON, Tile } from "./Icon.js";

function useNow(ms = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
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
  const { session, me, club, clubId, schedule, kickoffs } = useGame();
  const now = useNow();
  const ld = schedule ? liveDay(schedule, now) : null;
  const { data } = useData(async () => {
    if (!schedule) return null;
    const day = schedule.match_day;
    const [table, fixtures, last, lineup, stand, votes] = await Promise.all([
      league<Club[]>("table"),
      league<[string, string][]>("fixtures_of", { match_day: day }),
      day > 1 ? league<MatchResult[]>("results", { match_day: day - 1 }) : Promise.resolve([]),
      clubId ? league<Lineup>("lineup", { club_id: clubId }) : Promise.resolve(null),
      clubId ? league<Stand>("stand", { club_id: clubId }) : Promise.resolve(null),
      clubId ? league<[string, string][]>("project_votes", { club_id: clubId }).catch(() => []) : Promise.resolve([]),
    ]);
    const live = ld?.state === "live" ? await league<MatchResult[]>("results", { match_day: ld.day }) : [];
    return { table, fixtures, last, lineup, stand, live, votes };
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
  const voted = !!me && !!data?.votes.some(([v]) => v === me.token_id);
  const owed = me ? BigInt(me.wallet) + BigInt(me.salary) : 0n;
  const c = liveMatch && schedule && ld?.state === "live" ? clock(liveMatch, ld.kickoff, schedule, now, kickoffs[ld.day]) : null;
  const halfTime = c?.phase === "half_time" || c?.phase === "waiting_second_half";

  // The one thing to do now.
  let next: { eyebrow: string; title: string; text: string; href: string; cta: string };
  if (!session) next = { eyebrow: "START", title: "Play a footballer in a real club", text: "Sign in with your email: no wallet, no gas, 30 seconds.", href: "#/locker", cta: "PLAY NOW" };
  else if (!me) next = { eyebrow: "STEP 1 OF 2", title: "Create your footballer", text: "Pick a name and a position: he is yours, minted in your name.", href: "#/locker", cta: "CREATE HIM" };
  else if (!club) next = { eyebrow: "STEP 2 OF 2", title: "Sign for a club", text: "Join a squad: everyone plays, eleven and one more.", href: "#/locker", cta: "PICK A CLUB" };
  else if (halfTime) next = { eyebrow: "HALF-TIME", title: "Change the game", text: "Vote the strategy for the second half, or move to another slot.", href: "#/team", cta: "TEAM SHEET" };
  else if (ld?.state === "live") next = { eyebrow: "LIVE", title: "Your match is on", text: "Every action, revealed as it happens.", href: "#/live", cta: "WATCH LIVE" };
  else if (!chose) next = { eyebrow: "BEFORE KICK-OFF", title: "Take your slot", text: role ? `For now you play ${role}. Pick the position you want.` : "Pick the position you want in the eleven.", href: "#/team", cta: "TEAM SHEET" };
  else if (!trained) next = { eyebrow: "BEFORE KICK-OFF", title: "Train a skill", text: "One session per match day: a football mini-game, up to +3.", href: "#/training", cta: "TRAIN" };
  else if (owed > 0n) next = { eyebrow: "YOUR WALLET", title: `Collect ${g(owed)}`, text: "Your goals and your salary are waiting.", href: "#/locker", cta: "COLLECT" };
  else next = { eyebrow: "ALL SET", title: "Fill the stand", text: "Bring your club's fans in: a full stand pays every fan.", href: "#/stands", cta: "THE STANDS" };

  const today = schedule?.match_day ?? 0;
  const { data: life } = useData(() => (me ? league<Condition>("condition_of", { token_id: me.token_id }).catch(() => null) : Promise.resolve(null)), [me?.token_id, today]);
  const { data: box } = useData(() => (session && me ? inbox(session).catch(() => null) : Promise.resolve(null)), [session?.accountId, me?.token_id, today]);
  const { data: waiting } = useData(() => (clubId ? league<Applicant[]>("applicants", { club_id: clubId }).catch(() => []) : Promise.resolve([])), [clubId, today]);
  const injured = !!life && life.injured_until >= today;
  const onHoliday = !!life && life.holiday_until >= today;
  const duels = box?.duels.filter((d) => d.mine === null && !d.result).length ?? 0;
  const applicants = waiting?.length ?? 0;
  const SUGGESTIONS = [
    { text: "Tell him how to play: pick an instruction", href: "#/locker", done: !!life && life.instruction !== "balanced" },
    { text: "Challenge someone to a duel", href: "#/people/find", done: false },
    { text: "Put him on a diet for the week", href: "#/locker", done: !!life?.diet && life.diet_until >= today },
    { text: "Say hello on the terrace", href: "#/people", done: false },
    { text: "See where you rank", href: "#/ranks", done: false },
    { text: "Give a little to your club's treasury", href: "#/house", done: false },
    { text: "Scout your next opponent", href: "#/team", done: false },
  ];
  const suggestion = today ? SUGGESTIONS[today % SUGGESTIONS.length] : null;

  const checklist = club && me
    ? [
        { text: chose ? `You start: ${role}` : "Take your slot", href: "#/team", done: chose },
        { text: trained ? "Trained today" : "Train a skill (up to +3)", href: "#/training", done: trained },
        {
          text: data?.stand?.full_house
            ? "Tifo complete"
            : data?.stand?.fans
              ? `Stand: ${data.stand.present} of ${data.stand.fans} fans`
              : "No fans yet: bring the first one in",
          href: "#/stands",
          done: !!data?.stand?.full_house,
        },
        { text: voted ? "Your voice is in at the club house" : "Vote what the club builds next", href: "#/house", done: voted },
        ...(owed > 0n ? [{ text: `Collect ${g(owed)}`, href: "#/locker", done: false }] : []),
        ...(injured ? [{ text: `Injured: back on match day ${life!.injured_until + 1}`, href: "#/locker", done: false }] : []),
        ...(onHoliday ? [{ text: `On holiday until match day ${life!.holiday_until}`, href: "#/locker", done: true }] : []),
        ...(box?.unread ? [{ text: `${box.unread} new ${box.unread === 1 ? "message" : "messages"}`, href: "#/people/messages", done: false }] : []),
        ...(box?.requests.length ? [{ text: `${box.requests.length} friend ${box.requests.length === 1 ? "request" : "requests"}`, href: "#/people/friends", done: false }] : []),
        ...(duels ? [{ text: `${duels} ${duels === 1 ? "duel" : "duels"} to play`, href: "#/people/duels", done: false }] : []),
        ...(applicants ? [{ text: `${applicants} ${applicants === 1 ? "applicant" : "applicants"} to vote on`, href: "#/house", done: false }] : []),
        // One thing more, a different one each match day: the agenda's suggestion.
        ...(suggestion ? [suggestion] : []),
      ]
    : [];

  const division = data?.table.find((x) => x.manager === clubId)?.division ?? 1;
  const mine = data?.table.filter((x) => x.division === division) ?? [];
  const at = Math.max(0, mine.findIndex((x) => x.manager === clubId));
  const from = Math.max(0, Math.min(at - 2, mine.length - 5));
  const around = mine.slice(from, from + 5);
  const season = schedule?.season ?? 1;
  const { data: champs } = useData(() => (season > 1 ? league<Champion[]>("champions", { before: null, limit: 1 }) : Promise.resolve([])), [season]);

  const peopleNew = (box?.unread ?? 0) + (box?.requests.length ?? 0) + duels;
  const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
  const place = clubId && mine.length ? `${ord(at + 1)} of ${mine.length} in division ${division}` : null;
  const doors: { href: string; tone: string; icon: string; title: string; line: string; hot?: boolean; cab?: string }[] = [
    {
      href: "#/training",
      tone: "green",
      icon: ICON.training,
      cab: me ? DRILL_SKILL[me.position as keyof typeof DRILL_SKILL] : "shooting",
      title: "Training",
      line: !me ? "Five football mini-games, one session a match day" : trained ? "Done today. Back next match day" : `Today: ${DRILL_TITLE[me.position as keyof typeof DRILL_TITLE]}, up to +3 ${DRILL_SKILL[me.position as keyof typeof DRILL_SKILL]}`,
      hot: !!me && !!club && !trained,
    },
    { href: "#/team", tone: "paper", icon: ICON.club, title: "My club", line: club ? `${club.name}${place ? ` · ${place}` : ""}` : "Sign for a club: eleven and one more, everyone plays" },
    { href: "#/people", tone: "pink", icon: ICON.people, title: "People", line: peopleNew ? `${peopleNew} new: messages, friends, duels` : "Terrace, friends, messages, duels", hot: peopleNew > 0 },
    { href: "#/ranks", tone: "gold", icon: ICON.ranks, title: "Rankings", line: "The best players and clubs of the league" },
    {
      href: "#/stands",
      tone: "sky",
      icon: ICON.stands,
      title: "Stands & market",
      line: data?.stand && data.stand.target > 0 ? `Your stand: ${data.stand.present} of ${data.stand.target} fans for a full house` : "Fans make the money: fill a stand",
    },
    { href: "#/rules", tone: "yellow", icon: ICON.help, title: "How to play", line: "The rules in two minutes" },
  ];

  const nextCard = (
    <a className={`next-card${session ? "" : " landing"}${!me ? " with-art" : ""}`} href={next.href}>
      <span className="k">{next.eyebrow}</span>
      <strong>{next.title}</strong>
      <span className="next-text">{next.text}</span>
      <span className="cta">{next.cta}</span>
    </a>
  );

  return (
    <div className={`today${session ? " signed" : ""}${me ? " has-player" : ""}`}>
      {session && <PlayerColumn />}
      <section className="today-main">
        {me && (
          <p className="greeting">
            Hi <b>{me.name.split(" ")[0]}</b>
            {schedule ? ` · match day ${schedule.season_day ?? schedule.match_day} of ${schedule.season_days ?? 26}, season ${schedule.season ?? 1}` : ""}
          </p>
        )}
        {/* Logged out, what the game is comes first; logged in, the match does. */}
        {!session && nextCard}
        {!session && (
          <a className="try-banner" href="#/try">
            <span>
              <b>No account? Take five penalties first.</b> The shooting drill, in 3D, in your browser.
            </span>
            <span className="cta small">TRY IT</span>
          </a>
        )}
        {/* The match: live score, or the countdown to kick-off. */}
        {ld?.state === "live" && liveMatch && schedule ? (
          <a className="hero live-hero" href="#/live">
            <span className="badge-live">{c?.phase === "full_time" ? "FULL TIME" : "LIVE"}</span>
            <LiveScore m={liveMatch} kickoff={ld.kickoff} day={ld.day} now={now} names={names} />
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

        {/* The places of the game, as on the menu: what each one holds for you now. */}
        <nav className="doors" aria-label="Where to go">
          {doors.map((d) => (
            <a key={d.href} href={d.href} className={`door tone-${d.tone}${d.hot ? " hot" : ""}`}>
              {d.cab ? <Cabinet skill={d.cab} className="door-cab" /> : <Tile d={d.icon} />}
              <span className="door-text">
                <b>{d.title}</b>
                <span>{d.line}</span>
              </span>
              <span className="door-arrow" aria-hidden="true">
                ›
              </span>
            </a>
          ))}
        </nav>

        {!session && (
          <ul className="pitch-points">
            <li>
              <b>Your footballer, your club.</b> Mint him, sign for a squad, take your slot: eleven and one more, everyone plays.
            </li>
            <li>
              <b>Real football mini-games.</b> Penalties, through balls, dribbles, sprints, tackles: win them to raise his skills.
            </li>
            <li>
              <b>The fans make the money.</b> A goal pays only as much as its stand is full. Fill it for a tifo, or the club's treasury burns.
            </li>
          </ul>
        )}

        {checklist.length > 0 && (
          <section className="paper panel today-list">
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
        {clubId && <Wall clubId={clubId} compact />}
        {around.length > 0 && (
          <section className="paper panel">
            <span className="k">
              DIVISION {division} · SEASON {season} · DAY {schedule?.season_day ?? 1}/{schedule?.season_days ?? 26}
            </span>
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
        {champs && champs.length > 0 && (
          <a className="panel champions-banner mini" href="#/seasons">
            <span className="k">SEASON {champs[0]!.season} CHAMPIONS</span>
            {champs.map((c) => (
              <span key={c.division} className={c.club_id === clubId ? "mine" : ""}>
                <b>{c.name}</b> · Division {c.division} · {c.points} pts
              </span>
            ))}
            <span className="link">All seasons →</span>
          </a>
        )}
      </aside>
    </div>
  );
}

/**
 * Your player, down the left: him head to toe in his look, his club, his
 * rating, his money and what he won. The first thing you see of yourself.
 */
function PlayerColumn() {
  const { me, club, clubId, balance, schedule } = useGame();
  const { data: champs } = useData(() => league<Champion[]>("champions", { before: null, limit: 50 }).catch(() => []), [clubId]);
  // No footballer yet: the yellow "Create your footballer" card says it, with the art.
  if (!me) return null;
  const won = (champs ?? []).filter((c) => c.club_id === clubId);
  return (
    <aside className="today-player paper panel">
      <span className="k">YOUR PLAYER</span>
      <div className="avatar-stage">
        <Avatar look={me.look} n={faceNumber(me.token_id)} size={190} />
        <span className="avatar-rating">{me.overall}</span>
      </div>
      {/* A long name in one word is written smaller, so it stays whole on the card. */}
      <h3 className={Math.max(...me.name.split(" ").map((w) => w.length)) > 12 ? "long" : Math.max(...me.name.split(" ").map((w) => w.length)) > 8 ? "longish" : undefined}>{me.name}</h3>
      <p className="note">{club ? club.name : "Free agent"}</p>
      <dl className="player-facts">
        <dt>Goals</dt>
        <dd>{me.goals}</dd>
        <dt>Wallet</dt>
        <dd>{g(balance)}</dd>
        <dt>Energy</dt>
        <dd className={me.energy < 50 ? "low" : undefined}>{me.energy}</dd>
        {me.contract && schedule && (
          <>
            <dt>Contract</dt>
            <dd>{Math.max(0, me.contract.until_day - schedule.match_day + 1)} match days</dd>
          </>
        )}
      </dl>
      <span className="k">TROPHY CABINET</span>
      {won.length ? (
        <ul className="cabinet">
          {won.map((c) => (
            <li key={`${c.season}-${c.division}`} title={`Season ${c.season} champions, division ${c.division}`}>
              🏆<span>S{c.season} · D{c.division}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Empty, for now. Win the division.</p>
      )}
      <SkillBars p={me} />
      <a className="link" href="#/locker">
        Locker room and look →
      </a>
    </aside>
  );
}

/** The drill Training picks first for each position. */
const DRILL_SKILL = { Fw: "shooting", Mf: "passing", Df: "defending", Gk: "defending" } as const;
const DRILL_TITLE = { Fw: "Penalties", Mf: "Through balls", Df: "Tackles", Gk: "Tackles" } as const;

function LiveScore({ m, kickoff, day, now, names }: { m: MatchResult; kickoff: number; day: number; now: number; names: Map<string, string> }) {
  const { schedule, kickoffs } = useGame();
  const c = clock(m, kickoff, schedule!, now, kickoffs[day]);
  const [h, a] = scoreOf(visible(m, c));
  return (
    <span className="hero-score">
      <span className="hs-team">
        <Crest clubId={m.home} name={names.get(m.home) ?? ""} size={48} />
        {clubName(names.get(m.home) ?? "")}
      </span>
      <b>
        {h}-{a}
      </b>
      <span className="hs-team">
        <Crest clubId={m.away} name={names.get(m.away) ?? ""} size={48} />
        {clubName(names.get(m.away) ?? "")}
      </span>
      <em>{c.label}</em>
      <span className="cta small hs-watch">{c.phase === "full_time" ? "SEE THE MATCH" : "WATCH LIVE"}</span>
    </span>
  );
}

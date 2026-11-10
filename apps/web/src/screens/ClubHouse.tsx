import { type ReactNode, useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { type SeasonTicket, league, leagueCall, ticketsOf, voteWithTicket } from "../lib/near.js";
import type { Captain, Club, Player, Project, Rules } from "../lib/types.js";
import { Crest } from "./Crest.js";

const ONE_G = 1_000_000n;
const INK = "#1B2340";
const PAPER = "#F3EAD7";

/** The stand grows a tier per level; the next one is drawn as a plan. */
function StadiumArt({ level, max }: { level: number; max: number }) {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true">
      <rect x="6" y="72" width="108" height="8" fill="#2a7d4f" />
      {Array.from({ length: max }, (_, i) => {
        const built = i < level;
        const next = i === level;
        const y = 60 - i * 12;
        const inset = 8 + i * 7;
        return (
          <g key={i} opacity={built || next ? 1 : 0.18}>
            <rect
              x={inset}
              y={y}
              width={120 - inset * 2}
              height="11"
              fill={built ? "#2F5DA8" : "none"}
              stroke={INK}
              strokeWidth="2"
              strokeDasharray={built ? undefined : "4 3"}
            />
            {built && Array.from({ length: Math.floor((120 - inset * 2) / 9) }, (_, k) => <rect key={k} x={inset + 3 + k * 9} y={y + 3} width="5" height="5" fill={k % 3 === 1 ? "#F2B705" : PAPER} />)}
          </g>
        );
      })}
    </svg>
  );
}

/** The physio's bag, with a cross per level. */
function PhysioArt({ level, max }: { level: number; max: number }) {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true">
      <path d="M44 26 v-8 a6 6 0 0 1 6 -6 h20 a6 6 0 0 1 6 6 v8" fill="none" stroke={INK} strokeWidth="4" />
      <rect x="18" y="26" width="84" height="50" rx="6" fill="#C8202F" stroke={INK} strokeWidth="2.5" />
      <rect x="18" y="40" width="84" height="6" fill={INK} opacity=".18" />
      {Array.from({ length: max }, (_, i) => {
        const cx = 60 + (i - (max - 1) / 2) * 24;
        const on = i < level;
        return (
          <g key={i} opacity={on ? 1 : 0.3}>
            <circle cx={cx} cy="58" r="10" fill={on ? PAPER : "none"} stroke={PAPER} strokeWidth="2" />
            <path d={`M${cx - 5} 58 h10 M${cx} 53 v10`} stroke={on ? "#C8202F" : PAPER} strokeWidth="3.5" strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}

/** A training ground: one more cone per level. */
function AcademyArt({ level, max }: { level: number; max: number }) {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true">
      <rect x="6" y="58" width="108" height="22" fill="#2a7d4f" />
      <path d="M6 69 h108" stroke="#338a59" strokeWidth="10" />
      {Array.from({ length: max }, (_, i) => {
        const x = 16 + i * 20;
        const on = i < level;
        return (
          <g key={i} opacity={on ? 1 : 0.25}>
            <path d={`M${x} 66 l7 -26 l7 26 z`} fill={on ? "#F2B705" : "none"} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
            {on && <path d={`M${x + 3.4} 54 h7.2`} stroke={PAPER} strokeWidth="3" />}
            <rect x={x - 2} y="66" width="18" height="4" rx="1" fill={on ? "#F2B705" : "none"} stroke={INK} strokeWidth="2" />
          </g>
        );
      })}
      <circle cx="102" cy="30" r="9" fill={PAPER} stroke={INK} strokeWidth="2.5" />
      <path d="M102 24 l5 4 -2 6 h-6 l-2 -6 z" fill={INK} />
    </svg>
  );
}

/** The strongbox: the G stay in. */
function SaveArt() {
  return (
    <svg viewBox="0 0 120 84" aria-hidden="true">
      <rect x="24" y="14" width="72" height="60" rx="5" fill={INK} stroke={INK} strokeWidth="2" />
      <rect x="31" y="21" width="58" height="46" rx="3" fill="none" stroke={PAPER} strokeWidth="2" opacity=".6" />
      <circle cx="60" cy="44" r="13" fill="#F2B705" stroke={PAPER} strokeWidth="2.5" />
      <path d="M60 35 v18 M51 44 h18" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <rect x="30" y="74" width="10" height="5" fill={INK} />
      <rect x="80" y="74" width="10" height="5" fill={INK} />
    </svg>
  );
}

const PROJECTS: { id: Exclude<Project, "save">; name: string; does: (r: Rules) => string; art: (level: number, max: number) => ReactNode }[] = [
  { id: "stadium", name: "Stadium", does: (r) => `Fans get ${r.stadium_bonus_bps / 100}% more at a full house, per tier`, art: (l, m) => <StadiumArt level={l} max={m} /> },
  { id: "physio", name: "Physio", does: (r) => `Players get ${r.physio_energy} more energy back each match day`, art: (l, m) => <PhysioArt level={l} max={m} /> },
  { id: "academy", name: "Academy", does: (r) => `Academy players gain ${r.academy_bonus} in every skill`, art: (l, m) => <AcademyArt level={l} max={m} /> },
];

/** One square per voice, like the tifo: the count is the row's length. */
function Voices({ n, mine }: { n: number; mine: boolean }) {
  return (
    <span className="voices" aria-label={`${n} ${n === 1 ? "voice" : "voices"}`}>
      {n === 0 ? <span className="voices-none">no voice yet</span> : Array.from({ length: n }, (_, i) => <i key={i} className={mine && i === n - 1 ? "mine" : ""} />)}
      {n > 0 && <b>{n}</b>}
    </span>
  );
}

/**
 * The club house: what the club's treasury buys, voted each week by its
 * players and its season ticket holders, and the wage it offers, set by its
 * captain (or its manager, without one).
 */
export function ClubHouse({ clubId }: { clubId: string }) {
  const { session, me, schedule, refresh } = useGame();
  const { data, reload } = useData(async () => {
    const [club, rules, votes, captain] = await Promise.all([
      league<Club | null>("get_club", { club_id: clubId }),
      league<Rules>("rules"),
      league<[string, Project][]>("project_votes", { club_id: clubId }),
      league<Captain | null>("captain", { club_id: clubId }),
    ]);
    const leader = captain ? await league<Player | null>("get_player", { token_id: captain.token_id }) : null;
    return { club, rules, votes, captain, leads: captain ? leader?.controller : club?.manager };
  }, [clubId, schedule?.match_day]);
  const { data: tickets } = useData(() => (session ? ticketsOf(session.accountId).catch(() => [] as SeasonTicket[]) : Promise.resolve([] as SeasonTicket[])), [session?.accountId]);
  const [wage, setWage] = useState("");
  if (!data?.club || !data.rules.project_cost) return null;
  const { club, rules, votes } = data;
  const level = { stadium: club.stadium, physio: club.physio, academy: club.academy };
  const count = (p: Project) => votes.filter(([, v]) => v === p).length;
  const plays = !!session && !!me && me.owner === clubId;
  const myVote = plays ? votes.find(([v]) => v === me!.token_id)?.[1] : undefined;
  const ticket = tickets?.find((t) => t.club === clubId && t.season === schedule?.season);
  const ticketVote = ticket ? votes.find(([v]) => v === `ticket:${ticket.token_id}`)?.[1] : undefined;
  const cast = (p: Project) => async () => {
    if (plays) await leagueCall(session!, "vote_project", { project: p }, 30);
    else await voteWithTicket(session!, ticket!.token_id, p);
  };
  const can = plays || !!ticket;
  const mine = myVote ?? ticketVote;
  const week = rules.week_length;
  const left = schedule ? week - ((schedule.match_day - 1) % week) : week;
  const leads = !!session && data.leads === session.accountId;
  const plate = (id: Project, name: string, does: string, art: ReactNode, lvl: number | null, max: number | null, price: bigint | null) => (
    <li key={id} className={`plate${mine === id ? " mine" : ""}`}>
      <div className="plate-art">{art}</div>
      <div className="plate-body">
        <h3>
          {name}
          {lvl !== null && max !== null && (
            <span className="pips" aria-label={`Level ${lvl} of ${max}`}>
              {Array.from({ length: max }, (_, i) => (
                <i key={i} className={i < lvl ? "on" : ""} />
              ))}
            </span>
          )}
        </h3>
        <p>{does}</p>
        <Voices n={count(id)} mine={mine === id} />
      </div>
      <div className="plate-foot">
        {id !== "save" && <span className="price">{price === null ? "Complete" : g(price)}</span>}
        {can && (id === "save" || price !== null) && mine !== id && (
          <Action className="cta small" label={`Vote ${name.toLowerCase()}`} run={cast(id)} done={() => soon(reload)} success={`Your voice: ${name.toLowerCase()}`} />
        )}
        {mine === id && <span className="stamp">Your voice</span>}
      </div>
    </li>
  );
  return (
    <section className="clubhouse" aria-labelledby="clubhouse-title">
      <header className="clubhouse-head">
        <Crest clubId={clubId} name={club.name} size={56} />
        <div>
          <h2 id="clubhouse-title">{club.name} club house</h2>
          <p>
            Players and season ticket holders decide what the treasury buys. One voice each, counted in {left} match {left === 1 ? "day" : "days"}; the price burns.
          </p>
        </div>
        <dl className="treasury">
          <dt>In the treasury</dt>
          <dd>{g(club.treasury)}</dd>
        </dl>
      </header>
      <ul className="plates">
        {PROJECTS.map((p, i) => {
          const max = rules.project_max[i]!;
          const lvl = level[p.id];
          return plate(p.id, p.name, p.does(rules), p.art(lvl, max), lvl, max, lvl < max ? BigInt(rules.project_cost[i]!) * BigInt(lvl + 1) : null);
        })}
        {plate("save", "Save", "Keep it for wages and for next season", <SaveArt />, null, null, null)}
      </ul>
      {!can && <p className="clubhouse-note">Play for this club or hold one of its season tickets to have a voice.</p>}
      {ticket && !plays && <p className="clubhouse-note">You vote with your season ticket number {ticket.number}.</p>}

      <div className="wage paper">
        <div>
          <h3>Wage offered</h3>
          <p>
            Paid to each person at every match he starts. Miss {rules.unpaid_to_free} in a row and he walks free. Contracts already signed keep their wage.
          </p>
        </div>
        <strong className="wage-now">
          {g(club.wage)}
          <small>a match</small>
        </strong>
        {leads && (
          <div className="wage-row">
            <label htmlFor="new-wage">New wage, in G</label>
            <input id="new-wage" inputMode="numeric" value={wage} onChange={(e) => setWage(e.target.value.replace(/\D/g, ""))} placeholder="100000" />
            <Action
              className="cta small"
              label="Set the wage"
              disabled={wage === "" || BigInt(wage) * ONE_G > BigInt(rules.max_wage)}
              run={() => leagueCall(session!, "set_wage", { club_id: clubId, wage: (BigInt(wage) * ONE_G).toString() }, 30)}
              done={() => {
                setWage("");
                soon(reload);
                soon(refresh);
              }}
              success="The club's new wage"
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** The club house as a page: your club's, your season ticket's, or any club's to look at. */
export function ClubHousePage() {
  const { session, clubId, schedule } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const { data: tickets } = useData(() => (session ? ticketsOf(session.accountId).catch(() => [] as SeasonTicket[]) : Promise.resolve([] as SeasonTicket[])), [session?.accountId]);
  const [picked, setPicked] = useState<string | null>(null);
  const ticketClub = tickets?.find((t) => t.season === schedule?.season)?.club ?? null;
  const id = picked ?? clubId ?? ticketClub ?? table?.[0]?.manager ?? null;
  if (!id || !table) return <p className="sub">Opening the club house…</p>;
  return (
    <div className="clubhouse-page">
      <label className="seg-select">
        <span className="note">Club house of</span>
        <select value={id} onChange={(e) => setPicked(e.target.value)}>
          {table.map((c) => (
            <option key={c.manager} value={c.manager}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <ClubHouse clubId={id} />
    </div>
  );
}

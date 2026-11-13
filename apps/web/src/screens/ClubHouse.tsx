import { type ReactNode, useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { type SeasonTicket, league, leagueCall, ticketsOf, voteWithTicket } from "../lib/near.js";
import type { Captain, Club, Player, Project, Rules } from "../lib/types.js";
import { Crest } from "./Crest.js";
import { GiftBoard, Recruits } from "./ClubLife.js";

const ONE_G = 1_000_000n;





const PROJECTS: { id: Exclude<Project, "save">; name: string; does: (r: Rules) => string; art: (level: number, max: number) => ReactNode }[] = [
  { id: "stadium", name: "Stadium", does: (r) => `Fans get ${r.stadium_bonus_bps / 100}% more at a full house, per tier`, art: (l) => <ProjectArt src="/art/bg/bg-stadium-full.webp" level={l} /> },
  { id: "physio", name: "Physio", does: (r) => `Players get ${r.physio_energy} more energy back each match day`, art: (l) => <ProjectArt src="/art/coaches/coach-amara.webp" level={l} /> },
  { id: "academy", name: "Academy", does: (r) => `Academy players gain ${r.academy_bonus} in every skill`, art: (l) => <ProjectArt src="/art/bg/pitch-full.webp" level={l} /> },
];

/** The kit's picture for a project, with its level in a pixel tag. */
function ProjectArt({ src, level, contain }: { src: string; level?: number; contain?: boolean }) {
  return (
    <>
      <img src={src} alt="" className={contain ? "contain" : undefined} loading="lazy" />
      {level !== undefined && <span className="lv">LV {level}</span>}
    </>
  );
}

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
        {plate("save", "Save", "Keep it for wages and for next season", <ProjectArt src="/art/objects/coin.png" contain />, null, null, null)}
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
      <div className="house-more">
        <Recruits clubId={clubId} leads={leads} plays={plays} />
        <GiftBoard clubId={clubId} name={club.name} />
      </div>
    </section>
  );
}

/** The club house as a page: your club's and no other when you play for one; otherwise your season ticket's, or any club's to look at. */
export function ClubHousePage() {
  const { session, clubId, schedule } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const { data: tickets } = useData(() => (session ? ticketsOf(session.accountId).catch(() => [] as SeasonTicket[]) : Promise.resolve([] as SeasonTicket[])), [session?.accountId]);
  const [picked, setPicked] = useState<string | null>(null);
  const ticketClub = tickets?.find((t) => t.season === schedule?.season)?.club ?? null;
  // A player in a club is in his own club house: the others' are not his to walk into.
  const id = clubId ?? picked ?? ticketClub ?? table?.[0]?.manager ?? null;
  if (!id || !table) return <p className="sub">Opening the club house…</p>;
  if (clubId) return <div className="clubhouse-page"><ClubHouse clubId={clubId} /></div>;
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

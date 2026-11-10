import { useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { type SeasonTicket, league, leagueCall, ticketsOf, voteWithTicket } from "../lib/near.js";
import type { Captain, Club, Player, Project, Rules } from "../lib/types.js";

const PROJECTS: { id: Exclude<Project, "save">; name: string; does: (r: Rules) => string }[] = [
  { id: "stadium", name: "Stadium", does: (r) => `+${r.stadium_bonus_bps / 100}% full-house reward for the fans, per level` },
  { id: "physio", name: "Physio", does: (r) => `+${r.physio_energy} energy back per match day for its players, per level` },
  { id: "academy", name: "Academy", does: (r) => `+${r.academy_bonus} to every skill of its academy players, per level` },
];
const ONE_G = 1_000_000n;

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
  return (
    <section className="paper panel clubhouse" aria-labelledby="clubhouse-title">
      <span className="k">CLUB HOUSE · TREASURY {g(club.treasury)}</span>
      <h3 id="clubhouse-title">What should the treasury buy?</h3>
      <p className="note">
        The club's players and its season ticket holders vote, one voice each. In {left} match {left === 1 ? "day" : "days"} the project with the most votes is
        bought if the treasury can pay it; the G burns. A tie buys nothing.
      </p>
      <ul className="projects">
        {PROJECTS.map((p, i) => {
          const max = rules.project_max[i]!;
          const lvl = level[p.id];
          const price = lvl < max ? BigInt(rules.project_cost[i]!) * BigInt(lvl + 1) : null;
          return (
            <li key={p.id} className={mine === p.id ? "mine" : ""}>
              <div>
                <b>{p.name}</b> <span className="chip">LEVEL {lvl} / {max}</span>
                <p className="note">{p.does(rules)}</p>
              </div>
              <div className="project-vote">
                <span className="votes">{count(p.id)}</span>
                {price === null ? (
                  <span className="note">Top level</span>
                ) : can ? (
                  <Action className="cta small" label={`VOTE · ${g(price)}`} disabled={mine === p.id} run={cast(p.id)} done={() => soon(reload)} success={`Your voice: ${p.name.toLowerCase()}`} />
                ) : (
                  <span className="note">{g(price)}</span>
                )}
              </div>
            </li>
          );
        })}
        <li className={mine === "save" ? "mine" : ""}>
          <div>
            <b>Save</b>
            <p className="note">Keep the G in the treasury: for wages, and for the next season.</p>
          </div>
          <div className="project-vote">
            <span className="votes">{count("save")}</span>
            {can && <Action className="cta small" label="VOTE" disabled={mine === "save"} run={cast("save")} done={() => soon(reload)} success="Your voice: save" />}
          </div>
        </li>
      </ul>
      {!can && <p className="note">Play for this club or hold one of its season tickets to vote.</p>}
      {ticket && !plays && <p className="note">You vote with your season ticket #{ticket.number}.</p>}

      <h3>Wage</h3>
      <p className="note">
        The club offers <b>{g(club.wage)}</b> per match to the people who sign for it, paid from the treasury.{" "}
        {rules.unpaid_to_free} matches in a row unpaid, and a player is free. Contracts already signed keep their wage.
      </p>
      {leads && (
        <div className="wage-row">
          <label>
            <span className="k">NEW WAGE (G PER MATCH)</span>
            <input inputMode="numeric" value={wage} onChange={(e) => setWage(e.target.value.replace(/\D/g, ""))} placeholder="100000" aria-label="New wage in G per match" />
          </label>
          <Action
            className="cta small"
            label="SET THE WAGE"
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
    </section>
  );
}

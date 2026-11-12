import { useState } from "react";
import { Action } from "../lib/Action.js";
import { clubName, g, short } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { giveToClub, league, leagueCall } from "../lib/near.js";
import { ROLE_LABEL } from "../lib/pitch.js";
import type { Applicant, Club, Condition, Gift, Lineup, Player, Recruitment } from "../lib/types.js";
import { Crest } from "./Crest.js";
import { faceNumber, Head } from "./Look.js";

const ONE_G = 1_000_000n;

/**
 * How a club takes free agents: openly, or by a vote of its people on each
 * applicant. Who leads the club chooses; its players (and its leader) vote.
 */
export function Recruits({ clubId, leads, plays }: { clubId: string; leads: boolean; plays: boolean }) {
  const { session, schedule } = useGame();
  const { data, reload } = useData(
    () => Promise.all([league<Recruitment>("recruitment_of", { club_id: clubId }), league<Applicant[]>("applicants", { club_id: clubId })]),
    [clubId, schedule?.match_day],
  );
  if (!data) return null;
  const [mode, list] = data;
  const can = !!session && (plays || leads);
  return (
    <div className="recruits paper">
      <div>
        <h3>Recruitment</h3>
        <p>
          {mode === "vote"
            ? "By vote: a free agent applies, the club's players say yes or no, and he joins once the yes win."
            : "Open: any free agent who signs joins at once."}
        </p>
      </div>
      {leads && session && (
        <div className="formations" role="group" aria-label="How the club recruits">
          {(["open", "vote"] as Recruitment[]).map((m) =>
            m === mode ? (
              <span key={m} className="chip on">
                {m === "open" ? "Open" : "By vote"}
              </span>
            ) : (
              <Action
                key={m}
                className="chip"
                label={m === "open" ? "Open" : "By vote"}
                run={() => leagueCall(session, "set_recruitment", { club_id: clubId, recruitment: m }, 30)}
                done={() => soon(reload)}
                success={m === "open" ? "Anyone who signs joins" : "The squad votes on recruits"}
              />
            ),
          )}
        </div>
      )}
      {list.length > 0 && (
        <ul className="people">
          {list.map((a) => (
            <li key={a.token_id} className="person">
              <Head n={faceNumber(a.token_id)} size={40} />
              <span className="person-who">
                <b>
                  {a.name} <span className="squad-rating">{a.overall}</span>
                </b>
                <span className="note">
                  Asks for {a.days} match days · {a.yes} yes, {a.no} no{mode === "vote" ? (a.approved ? " · voted in, he can join" : "") : " · he can join"}
                </span>
              </span>
              {can && mode === "vote" && (
                <span className="person-acts">
                  <Action className="cta small" label="Yes" aria={`Yes to ${a.name}`} run={() => leagueCall(session!, "vote_recruit", { token_id: a.token_id, yes: true }, 30)} done={() => soon(reload)} success={`Yes to ${a.name}`} />
                  <Action className="chip" label="No" aria={`No to ${a.name}`} run={() => leagueCall(session!, "vote_recruit", { token_id: a.token_id, yes: false }, 30)} done={() => soon(reload)} success={`No to ${a.name}`} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 && mode === "vote" && <p className="note">Nobody is waiting for a vote.</p>}
    </div>
  );
}

/** Gifts to the club's treasury: anyone gives, the biggest givers are on the board. */
export function GiftBoard({ clubId, name }: { clubId: string; name: string }) {
  const { session, balance, refresh } = useGame();
  const { data: board, reload } = useData(() => league<Gift[]>("gifts_of", { club_id: clubId }), [clubId]);
  const [amount, setAmount] = useState("");
  const yocto = amount === "" ? 0n : BigInt(amount) * ONE_G;
  return (
    <div className="gifts paper">
      <div>
        <h3>Gifts to the treasury</h3>
        <p>Anyone can give G to {name}. A gift pays wages and projects like any other G of the treasury. It is not refunded.</p>
      </div>
      {session && (
        <div className="wage-row">
          <label htmlFor="gift-amount">Your gift, in G</label>
          <input id="gift-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="50000" />
          <Action
            className="cta small"
            label="Give"
            disabled={yocto === 0n || yocto > BigInt(balance)}
            run={() => giveToClub(session, clubId, yocto.toString())}
            done={() => {
              setAmount("");
              soon(reload);
              soon(refresh);
            }}
            success={`${g(yocto)} to ${name}`}
          />
        </div>
      )}
      {board && board.length > 0 ? (
        <ol className="mini-table ranked gift-board">
          {board.slice(0, 10).map((gift, i) => (
            <li key={gift.from} className={gift.from === session?.accountId ? "mine" : ""}>
              <i>{i + 1}</i>
              <span>{gift.from === session?.accountId ? "You" : short(gift.from)}</span>
              <b>{g(gift.amount)}</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="note">No gift yet. Be the first name on the board.</p>
      )}
    </div>
  );
}

/** The scout's report: the next opponent's formation, strategy and the slots its people took. */
export function Scout({ clubId }: { clubId: string }) {
  const { schedule } = useGame();
  const day = schedule?.match_day ?? 0;
  const { data } = useData(async () => {
    const fixtures = await league<[string, string][]>("fixtures_of", { match_day: day });
    const mine = fixtures.find(([h, a]) => h === clubId || a === clubId);
    if (!mine) return null;
    const rival = mine[0] === clubId ? mine[1] : mine[0];
    const [club, lineup] = await Promise.all([league<Club | null>("get_club", { club_id: rival }), league<Lineup>("lineup", { club_id: rival })]);
    return club ? { rival, club, lineup, home: mine[0] === clubId } : null;
  }, [clubId, day, schedule?.first_half_played]);
  if (!data) return null;
  const { rival, club, lineup, home } = data;
  const chosen = lineup.players.map((p, k) => (lineup.chosen[k] ? p : null));
  const people = chosen.filter((p): p is Player => !!p);
  const best = [...lineup.players].filter((p): p is Player => !!p).sort((a, b) => b.overall - a.overall)[0];
  return (
    <section className="paper panel scout" aria-labelledby="scout-title">
      <span className="k" id="scout-title">
        SCOUT REPORT · MATCH DAY {day}
      </span>
      <h3 className="sheet-title">
        <Crest clubId={rival} name={club.name} size={32} />
        {home ? "At home to" : "Away at"} {clubName(club.name)}
      </h3>
      <dl className="scout-facts">
        <div>
          <dt>Formation</dt>
          <dd>{lineup.formation}</dd>
        </div>
        <div>
          <dt>Leaning</dt>
          <dd>{lineup.strategy}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>
            {club.won}-{club.drawn}-{club.lost}
          </dd>
        </div>
        <div>
          <dt>Goals</dt>
          <dd>
            {club.goals_for}:{club.goals_against}
          </dd>
        </div>
      </dl>
      {people.length > 0 ? (
        <ul className="scout-slots">
          {chosen.map((p, k) =>
            p ? (
              <li key={k}>
                <b>{ROLE_LABEL[lineup.roles[k]!]}</b> {p.name} <span className="squad-rating">{p.overall}</span>
              </li>
            ) : null,
          )}
        </ul>
      ) : (
        <p className="note">None of its people took a slot yet. Its votes can still change until the half starts.</p>
      )}
      {best && (
        <p className="note">
          Watch {best.name}, rated {best.overall}.
        </p>
      )}
    </section>
  );
}

/** Who of the squad cannot play today: hurt, or away on holiday. */
export function Treatment({ clubId }: { clubId: string }) {
  const { schedule, me } = useGame();
  const day = schedule?.match_day ?? 0;
  const { data } = useData(async () => {
    const squad = (await league<Player[]>("squad", { account_id: clubId })).filter((p) => p.controller);
    if (squad.length === 0) return [];
    const cs = await league<Condition[]>("conditions_of", { token_ids: squad.map((p) => p.token_id) });
    return squad.map((p, i) => ({ p, c: cs[i]! })).filter(({ c }) => c.injured_until >= day || c.holiday_until >= day);
  }, [clubId, day]);
  if (!data || data.length === 0) return null;
  return (
    <section className="paper panel treatment" aria-labelledby="treatment-title">
      <span className="k" id="treatment-title">
        NOT AVAILABLE
      </span>
      <ul className="squad-list">
        {data.map(({ p, c }) => (
          <li key={p.token_id} className={`person${p.token_id === me?.token_id ? " is-me" : ""}`}>
            <Head look={p.look} n={faceNumber(p.token_id)} size={36} />
            <span>
              <b>{p.name}</b>
              <span className="note">{c.injured_until >= day ? `Injured, back on match day ${c.injured_until + 1}` : `On holiday until match day ${c.holiday_until}`}</span>
            </span>
            <span className={`status-tag ${c.injured_until >= day ? "bad" : "rest"}`}>{c.injured_until >= day ? "INJ" : "OFF"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

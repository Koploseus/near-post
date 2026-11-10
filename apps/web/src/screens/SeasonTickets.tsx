import { useState } from "react";
import { Action } from "../lib/Action.js";
import { clubName, g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { type Briefing, buySeasonTicket, fanzone, league, ticketsOf, withdrawTicket } from "../lib/near.js";
import type { Club } from "../lib/types.js";
import { ClubHouse } from "./ClubHouse.js";

const PRICE = (300_000n * 1_000_000n).toString();

/** A club's season tickets: buy one, see what yours hold, open the fan zone. */
export function SeasonTickets() {
  const { session, schedule, clubId, refresh } = useGame();
  const season = schedule?.season ?? 1;
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const [picked, setPicked] = useState<string | null>(null);
  const club = picked ?? clubId ?? table?.[0]?.manager ?? null;
  const info = table?.find((c) => c.manager === club);
  const { data: sold, reload: reloadSold } = useData(
    () => (club ? league<number>("season_tickets_sold", { club_id: club, season }) : Promise.resolve(0)),
    [club, season],
  );
  const { data: mine, reload } = useData(() => (session ? ticketsOf(session.accountId) : Promise.resolve([])), [session?.accountId, schedule?.match_day]);
  const names = new Map((table ?? []).map((c) => [c.manager, clubName(c.name)]));

  return (
    <div className="tickets">
      <section className="paper panel season-ticket" aria-labelledby="st-title">
        <span className="k">SEASON {season} · 50 PER CLUB</span>
        <h2 id="st-title">Season ticket</h2>
        <p className="lead">
          It earns 50k G at every full house of its club (×2 in a derby) and a fifth of what the club earns from goals and sales, shared between its tickets. It
          also votes what the treasury buys. Sell it, and its G, its earnings to come and its voice go with it.
        </p>
        <label className="field">
          <span>Club</span>
          <select value={club ?? ""} onChange={(e) => setPicked(e.target.value)}>
            {table?.map((c) => (
              <option key={c.manager} value={c.manager}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          <strong>{g(PRICE)}</strong> <span className="note">to {info ? clubName(info.name) : "the club"}'s treasury · {sold ?? "…"} of 50 sold</span>
        </p>
        {session && club ? (
          (sold ?? 0) < 50 ? (
            <Action
              label="BUY A SEASON TICKET"
              className="cta"
              run={() => buySeasonTicket(session, club, PRICE)}
              done={() => (reload(), reloadSold(), refresh())}
              success="Season ticket bought"
            />
          ) : (
            <span className="chip">SOLD OUT</span>
          )
        ) : (
          <a className="cta" href="#/locker">
            SIGN IN TO BUY ONE
          </a>
        )}
      </section>

      {session && (mine?.length ?? 0) > 0 && (
        <section className="paper panel" aria-labelledby="mine-title">
          <h3 id="mine-title">Your season tickets</h3>
          <ul className="ticket-list">
            {mine!.map((t) => (
              <li key={t.token_id} className="ticket">
                <span className="ticket-no">#{t.number}</span>
                <span>
                  <b>{names.get(t.club) ?? t.club}</b> <span className="note">Season {t.season}</span>
                </span>
                <span>
                  <b>{g(t.balance)}</b> <span className="note">held · {g(t.earned)} earned</span>
                </span>
                {BigInt(t.balance) > 0n && <Action label="WITHDRAW" className="cta small" run={() => withdrawTicket(session, t.token_id)} done={() => (reload(), refresh())} success="G withdrawn" />}
              </li>
            ))}
          </ul>
          <FanZone names={names} />
        </section>
      )}
      {session && mine?.filter((t) => t.season === season).slice(0, 1).map((t) => <ClubHouse key={t.token_id} clubId={t.club} />)}
    </div>
  );
}

/** For season ticket holders: the AI coach's briefing before each half. */
function FanZone({ names }: { names: Map<string, string> }) {
  const { session } = useGame();
  const [open, setOpen] = useState<Briefing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  return (
    <div className="fanzone">
      <span className="k">FAN ZONE · TICKET HOLDERS ONLY</span>
      {!open ? (
        <Action
          label="OPEN THE FAN ZONE"
          className="cta small"
          run={async () => {
            const r = await fanzone(session);
            if ("error" in r) setError(r.error === "no_season_ticket" ? "For season ticket holders." : "The fan zone did not open. Try again.");
            else setOpen(r.briefings);
          }}
        />
      ) : open.length === 0 ? (
        <p className="note">No briefing yet: the coach writes one before each half.</p>
      ) : (
        <ul className="briefings">
          {open.map((b) => (
            <li key={`${b.club}-${b.at}`}>
              <span className="note">
                {names.get(b.club) ?? b.club} · Day {b.day} · {b.half === 2 ? "half-time" : "before kick-off"}
              </span>
              <p>{b.briefing}</p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

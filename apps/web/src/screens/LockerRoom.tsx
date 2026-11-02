import { useState } from "react";
import { Action } from "../lib/Action.js";
import { g, positionLabel, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league, leagueCall, topUp, transferRegistration } from "../lib/near.js";
import type { Club, Player, Position } from "../lib/types.js";
import { SignIn } from "./SignIn.js";
import { SkillBars, Sticker } from "./Sticker.js";
import { Training } from "./Training.js";


export function LockerRoom() {
  const { session, me, club, loading } = useGame();
  if (!session) return <SignIn />;
  if (loading && !me) return <p className="sub">Loading your locker…</p>;
  if (!me) return <CreateFootballer />;
  if (!club) return <PickClub me={me} />;
  return <MyPlayer me={me} club={club} />;
}

function CreateFootballer() {
  const { session, refresh } = useGame();
  const [name, setName] = useState("");
  const [position, setPosition] = useState<Position>("Fw");
  return (
    <section className="paper panel" aria-labelledby="create-title">
      <span className="k">STEP 1 OF 2</span>
      <h2 id="create-title">Create your footballer</h2>
      <p className="note">He is minted as an NFT in your name. Ratings start between 40 and 60 for his position.</p>
      <div className="form">
        <label htmlFor="name">Name on the sticker</label>
        <input id="name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        <fieldset className="positions">
          <legend>Position</legend>
          {(["Gk", "Df", "Mf", "Fw"] as Position[]).map((p) => (
            <label key={p}>
              <input type="radio" name="position" checked={position === p} onChange={() => setPosition(p)} />
              {positionLabel[p]}
            </label>
          ))}
        </fieldset>
        <Action
          label="MINT MY FOOTBALLER"
          disabled={name.trim().length < 2}
          run={() => leagueCall(session!, "create_footballer", { name: name.trim(), position })}
          done={refresh}
        />
      </div>
    </section>
  );
}

function PickClub({ me }: { me: Player }) {
  const { session, refresh } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  return (
    <section className="paper panel" aria-labelledby="pick-title">
      <span className="k">STEP 2 OF 2</span>
      <h2 id="pick-title">Sign for a club</h2>
      <p className="note">
        {me.name} is a free agent. Give a club his registration (his NFT) and he joins its squad. You keep playing him,
        and his wallet stays yours, wherever he goes.
      </p>
      <div className="clubs">
        {(table ?? []).map((c) => (
          <div className="club-row" key={c.manager}>
            <span>
              <strong>{c.name}</strong> <span className="note">Division {c.division} · {c.points} pts · {c.fans} fans</span>
            </span>
            <Action label={`SIGN FOR ${c.name.toUpperCase()}`} className="cta small" run={() => transferRegistration(session!, me.token_id, c.manager)} done={() => setTimeout(refresh, 2500)} />
          </div>
        ))}
        {table?.length === 0 && <p className="note">No club yet.</p>}
      </div>
    </section>
  );
}

function MyPlayer({ me, club }: { me: Player; club: Club }) {
  const { session, schedule, balance, refresh } = useGame();
  const day = schedule?.match_day ?? 0;
  const { data: reported, reload } = useData(() => league<boolean>("is_reported", { token_id: me.token_id, match_day: day }), [me.token_id, day]);
  const owed = BigInt(me.wallet) + BigInt(me.salary);
  return (
    <div className="locker">
      <div className="paper panel me">
        <Sticker p={me} />
        <div className="me-info">
          <span className="k">{short(club.manager).toUpperCase()} · MATCH DAY {day}</span>
          <h2>{me.name}</h2>
          <dl className="stats">
            <dt>Club</dt>
            <dd>{club.name}</dd>
            <dt>Rating</dt>
            <dd>
              {me.overall} · attack {me.attack} · defence {me.defence}
            </dd>
            <dt>Goals</dt>
            <dd>{me.goals}</dd>
            <dt>His wallet</dt>
            <dd>{g(me.wallet)} goals · {g(me.salary)} salary</dd>
            <dt>Your G</dt>
            <dd>{g(balance)}</dd>
          </dl>
          <SkillBars p={me} />
        </div>
      </div>
      <div className="actions">
        <div className="paper panel">
          <h3>Match day {day}</h3>
          {reported ? (
            <p className="ok">You reported. If the captain picks you, you play.</p>
          ) : (
            <>
              <p className="note">Report before kick-off or an academy player takes your place.</p>
              <Action label="I'M FIT TO PLAY" run={() => leagueCall(session!, "report_for_match", {}, 30)} done={reload} />
            </>
          )}
        </div>
        <Training me={me} />
        <div className="paper panel">
          <h3>Collect</h3>
          <p className="note">Your goals are minted, your salary is paid from the club treasury.</p>
          <Action label={`COLLECT ${g(owed)}`} disabled={owed === 0n} run={() => leagueCall(session!, "claim_player", { token_id: me.token_id })} done={() => setTimeout(refresh, 2500)} />
        </div>
        <div className="paper panel">
          <h3>Gas</h3>
          <p className="note">Low on NEAR for transactions? The relay tops you up, twice a day.</p>
          <Action className="cta small" label="TOP UP MY GAS" run={() => topUp(session!.accountId)} />
        </div>
      </div>
    </div>
  );
}

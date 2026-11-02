import { useState } from "react";
import { Action } from "../lib/Action.js";
import { g, positionLabel, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { isGasless, league, leagueCall, signOut, topUp, transferRegistration } from "../lib/near.js";
import type { Club, Player, Position } from "../lib/types.js";
import { PasskeyIcon, SignIn } from "./SignIn.js";
import { passkeysAvailable, passkeysOf, saveWithPasskey } from "../lib/passkey.js";
import { SkillBars, Sticker } from "./Sticker.js";
import { Training } from "./Training.js";
import { Wardrobe } from "./Wardrobe.js";


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
          success={`${name.trim()} is born`}
        />
      </div>
    </section>
  );
}

function PickClub({ me }: { me: Player }) {
  const { session, refresh } = useGame();
  const { data } = useData(async () => {
    const table = await league<Club[]>("table");
    const squads = await Promise.all(table.map((c) => league<Player[]>("squad", { account_id: c.manager })));
    return table.map((c, i) => ({ c, people: squads[i]!.filter((p) => p.controller).length }));
  }, []);
  const table = data?.map((d) => d.c);
  return (
    <section className="paper panel" aria-labelledby="pick-title">
      <span className="k">STEP 2 OF 2</span>
      <h2 id="pick-title">Sign for a club</h2>
      <p className="note">
        {me.name} is a free agent. Give a club his registration (his NFT) and he joins its squad. You keep playing him,
        and his wallet stays yours, wherever he goes. A squad is eleven and one more: you take the place of its weakest
        academy player, and a club with twelve people is full.
      </p>
      <div className="clubs">
        {(data ?? []).map(({ c, people }) => (
          <div className="club-row" key={c.manager}>
            <span>
              <strong>{c.name}</strong>{" "}
              <span className="note">
                Division {c.division} · {c.points} pts · {c.fans} fans · {people} of 12 people
              </span>
            </span>
            {people >= 12 ? (
              <span className="chip">FULL</span>
            ) : (
              <Action label={`SIGN FOR ${c.name.toUpperCase()}`} className="cta small" run={() => transferRegistration(session!, me.token_id, c.manager)} done={() => setTimeout(refresh, 2500)} success={`Welcome to ${c.name}!`} />
            )}
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
  const { data: suspended } = useData(() => league<boolean>("is_suspended", { token_id: me.token_id, match_day: day }), [me.token_id, day]);
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
          {suspended ? (
            <p className="err">Suspended for this match day after a red card.</p>
          ) : (
            <p className="ok">You are in the squad: everyone plays by default, eleven and one more.</p>
          )}
          <p className="note">Pick your slot on the team sheet, or the best free slot for your role is yours. A red card suspends you for the next match day.</p>
        </div>
        <Training me={me} />
        <Wardrobe me={me} />
        <div className="paper panel">
          <h3>Collect</h3>
          <p className="note">Your goals are minted, your salary is paid from the club treasury.</p>
          <Action label={`COLLECT ${g(owed)}`} disabled={owed === 0n} run={() => leagueCall(session!, "claim_player", { token_id: me.token_id })} done={() => setTimeout(refresh, 2500)} success={`${g(owed)} on its way`} />
        </div>
        {!isGasless(session!.accountId) && (
          <div className="paper panel">
            <h3>Gas</h3>
            <p className="note">Low on NEAR for transactions? The relay tops you up, twice a day.</p>
            <Action className="cta small" label="TOP UP MY GAS" run={() => topUp(session!.accountId)} />
          </div>
        )}
        <Account />
      </div>
    </div>
  );
}

/** The account behind the game: its passkey backup, and signing out. */
function Account() {
  const { session, setSession, me } = useGame();
  const { data: passkeys, reload } = useData(() => (session ? passkeysOf(session.accountId) : Promise.resolve(0)), [session?.accountId]);
  if (!session) return null;
  return (
    <div className="paper panel account">
      <span className="k">ACCOUNT</span>
      {passkeys ? (
        <p className="ok">
          <PasskeyIcon /> Passkey on
        </p>
      ) : (
        <>
          <p className="note">Add a passkey to sign in on all your devices.</p>
          {passkeysAvailable() && (
            <Action
              className="cta small"
              label="ADD A PASSKEY"
              run={() => saveWithPasskey(session, me ? `${me.name} · NEAR Post` : session.accountId)}
              done={reload}
              success="Passkey added"
            />
          )}
        </>
      )}
      <p className="note">
        {isGasless(session.accountId) ? "Opened with your email: the game pays your gas. " : ""}
        <span title={session.accountId}>{short(session.accountId)}</span>
      </p>
      <button
        type="button"
        className="link"
        onClick={() => {
          signOut();
          setSession(null);
        }}
      >
        Sign out
      </button>
    </div>
  );
}

import { useState } from "react";
import { Action } from "../lib/Action.js";
import { g, positionLabel, short } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { call, isGasless, league, leagueCall, signForClub, signOut, topUp } from "../lib/near.js";
import { ClubHouse } from "./ClubHouse.js";
import { LEAGUE, PLAYERS } from "../lib/config.js";
import { Offers } from "./Market.js";
import type { Club, Player, Position, Rules } from "../lib/types.js";
import { PasskeyIcon, RecoveryKeySetup, SignIn } from "./SignIn.js";
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
      <p className="note">
        He is minted as an NFT in your name. Ratings start between 40 and 60 for his position. His first training is free, and your first match pays you a
        debut bonus.
      </p>
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
  const { data: rules } = useData(() => league<Rules>("rules"), []);
  const lengths = rules?.contract_days ?? [7, 13, 26, 52, 78];
  const [days, setDays] = useState(26);
  return (
    <section className="paper panel" aria-labelledby="pick-title">
      <span className="k">STEP 2 OF 2</span>
      <h2 id="pick-title">Sign for a club</h2>
      <FoundClub me={me} />
      <p className="note">
        {me.name} is a free agent. Give a club his registration (his NFT) and he joins its squad. You keep playing him,
        and his wallet stays yours, wherever he goes. A squad is eleven and one more: you take the place of its weakest
        academy player, and a club with twelve people is full.
      </p>
      <fieldset className="positions contract-days">
        <legend>Your contract, in match days</legend>
        {lengths.map((d) => (
          <label key={d}>
            <input type="radio" name="contract-days" checked={days === d} onChange={() => setDays(d)} />
            {d}
            {d === 26 ? " (a season)" : ""}
          </label>
        ))}
      </fieldset>
      <p className="note">
        The club pays you its wage at each match you start. When the contract ends, or after {rules?.unpaid_to_free ?? 3} matches in a row unpaid, your
        registration comes back to you by itself. Before that, another club takes you by paying your release clause (wage × days × {rules?.clause_factor ?? 2})
        if you agree. A contract without a wage can be left at any time.
      </p>
      <h3>Offers for {me.name}</h3>
      <Offers
        tokenId={me.token_id}
        accept={(o) =>
          call(session!, PLAYERS, "nft_approve", { token_id: me.token_id, account_id: LEAGUE, msg: JSON.stringify({ accept: o.id }) }, { deposit: 10n ** 22n, tgas: 250 }).then(() =>
            soon(refresh),
          )
        }
      />
      <div className="clubs">
        {(data ?? []).map(({ c, people }) => (
          <div className="club-row" key={c.manager}>
            <span>
              <strong>{c.name}</strong>{" "}
              <span className="note">
                Division {c.division} · {c.points} pts · {c.fans} fans · {people} of 12 people · pays {g(c.wage ?? "0")} a match
              </span>
            </span>
            {people >= 12 ? (
              <span className="chip">FULL</span>
            ) : (
              <Action
                label={`SIGN ${days} DAYS FOR ${c.name.toUpperCase()}`}
                className="cta small"
                run={() => signForClub(session!, me.token_id, c.manager, days)}
                done={() => soon(refresh)}
                success={`Welcome to ${c.name}!`}
              />
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
  const { data: resting, reload: reloadRest } = useData(() => league<boolean>("is_resting", { token_id: me.token_id, match_day: day }).catch(() => false), [me.token_id, day]);
  const { data: credits, reload: reloadCredits } = useData(() => league<string>("credits_of", { account_id: session!.accountId }), [session?.accountId, day]);
  const { data: rules } = useData(() => league<Rules>("rules"), []);
  const c = me.contract;
  const tired = me.energy < (rules?.tired_below ?? 50);
  return (
    <div className="locker">
      <div className="paper panel me">
        <Sticker p={me} />
        <div className="me-info">
          <span className="k">{club.name.toUpperCase()} · MATCH DAY {day}</span>
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
            <dt>Contract</dt>
            <dd>
              {c ? `${g(c.wage)} a match, until match day ${c.until_day}` : "none"}
              {c && c.unpaid > 0 ? ` · unpaid ${c.unpaid} of ${rules?.unpaid_to_free ?? 3}` : ""}
            </dd>
          </dl>
          <div className={`energy${tired ? " tired" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={me.energy} aria-label="Energy">
            <span className="k">ENERGY {me.energy}</span>
            <div className="bar">
              <div style={{ width: `${me.energy}%` }} />
              <i aria-hidden="true" />
            </div>
          </div>
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
          <p className={tired ? "err" : "note"}>
            {tired
              ? `Tired: under ${rules?.tired_below ?? 50} energy your skills drop, up to ${rules?.tired_malus_pct ?? 20}% at zero.`
              : `A match costs ${rules?.energy_match ?? 12} energy; each match day gives ${rules?.energy_per_day ?? 8} back.`}{" "}
            A day off gives {rules?.energy_rest ?? 17} more.
          </p>
          {resting ? (
            <p className="ok">You rest this match day. Take a slot on the team sheet to play after all.</p>
          ) : (
            <Action className="cta small" label="REST THIS MATCH DAY" run={() => leagueCall(session!, "rest_today", {}, 30)} done={() => soon(reloadRest)} success="You sit this one out" />
          )}
        </div>
        {c && (
          <div className="paper panel">
            <h3>Contract</h3>
            <p className="note">
              With {club.name} until match day {c.until_day}: {g(c.wage)} at each match you start. Release clause: {g(c.clause)}, paid by a club you gave your
              word to. When it ends your registration comes back to you.
            </p>
            {BigInt(c.wage) === 0n && (
              <Action className="cta small" label={`LEAVE ${club.name.toUpperCase()}`} run={() => leagueCall(session!, "leave_club", {}, 100)} done={() => soon(refresh)} success="You are a free agent" />
            )}
          </div>
        )}
        <ClubHouse clubId={me.owner} />
        <Training me={me} />
        <Wardrobe me={me} />
        <div className="paper panel">
          <h3>Collect</h3>
          <p className="note">Your goals are minted, your salary is paid from the club treasury.</p>
          <Action label={`COLLECT ${g(owed)}`} disabled={owed === 0n} run={() => leagueCall(session!, "claim_player", { token_id: me.token_id })} done={() => soon(refresh)} success={`${g(owed)} on its way`} />
          {BigInt(credits ?? "0") > 0n && (
            <Action
              className="cta small"
              label={`COLLECT YOUR BONUS · ${g(credits ?? "0")}`}
              run={() => leagueCall(session!, "claim", {}, 60)}
              done={() => {
                soon(reloadCredits);
                soon(refresh);
              }}
              success="In your wallet"
            />
          )}
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
          <PasskeyIcon /> Backed up: you can sign in on your other devices
        </p>
      ) : (
        <>
          <p className="note">Back up your key with a passkey or a recovery key to sign in on your other devices.</p>
          {passkeysAvailable() && (
            <Action
              className="cta small"
              label="ADD A PASSKEY"
              run={() => saveWithPasskey(session, me ? `${me.name} · NEAR Post` : session.accountId)}
              done={reload}
              success="Passkey added"
            />
          )}
          <RecoveryKeySetup session={session} username={session.accountId} onDone={reload} />
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

/** Or start your own: the club is your account, eleven academy kids sign at once, and your footballer joins them. */
function FoundClub({ me }: { me: Player }) {
  const { session, refresh } = useGame();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  if (!session) return null;
  if (!open)
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Or found your own club
      </button>
    );
  return (
    <div className="form found-club">
      <label htmlFor="club-name">Club name</label>
      <input id="club-name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
      <Action
        label="FOUND MY CLUB"
        disabled={name.trim().length < 1}
        run={async () => {
          await leagueCall(session, "create_club", { name: name.trim() }, 150);
          // His footballer is already the club's (the club is his account): bring him into the squad.
          await leagueCall(session, "recall_player", { token_id: me.token_id }, 30);
        }}
        done={() => soon(refresh)}
        success={`${name.trim()} is founded`}
      />
      <p className="note">You manage it: the formation (until the squad elects a captain), the market, the season tickets it sells.</p>
    </div>
  );
}

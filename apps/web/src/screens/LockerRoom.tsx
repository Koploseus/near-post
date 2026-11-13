import { HeroArt } from "../floodlight/art.js";
import { useEffect, useState } from "react";
import { Action } from "../lib/Action.js";
import { g, positionLabel, short } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { acceptOffer, call, isGasless, league, leagueCall, signForClub, signOut, topUp } from "../lib/near.js";
import { Crest, crestOf } from "./Crest.js";
import { serverNow } from "../lib/time.js";
import { EXPLORER, LEAGUE, PLAYERS } from "../lib/config.js";
import { Offers } from "./Market.js";
import type { Club, Player, Position, Rules } from "../lib/types.js";
import { PasskeyIcon, RecoveryKeySetup, SignIn } from "./SignIn.js";
import { passkeysAvailable, passkeysOf, saveWithPasskey } from "../lib/passkey.js";
import { Sticker } from "./Sticker.js";
import { Wardrobe } from "./Wardrobe.js";
import { FaceEditor } from "./FaceEditor.js";
import { Life } from "./Life.js";
import type { Applicant, Recruitment } from "../lib/types.js";


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
    const modes = await Promise.all(table.map((c) => league<Recruitment>("recruitment_of", { club_id: c.manager }).catch(() => "open" as Recruitment)));
    // Clubs that pay come first; the league table breaks the ties.
    return table
      .map((c, i) => ({ c, people: squads[i]!.filter((p) => p.controller).length, votes: modes[i] === "vote" }))
      .sort((a, b) => Number(BigInt(b.c.wage ?? "0") - BigInt(a.c.wage ?? "0")));
  }, []);
  const table = data?.map((d) => d.c);
  const { data: rules } = useData(() => league<Rules>("rules"), []);
  const lengths = rules?.contract_days ?? [7, 13, 26, 52, 78];
  const [days, setDays] = useState(26);
  // The club he gave his word to, when it votes on its recruits: how the vote stands.
  const { data: word, reload: reloadWord } = useData(async () => {
    const signing = await league<{ club: string; days: number } | null>("signing_of", { token_id: me.token_id }).catch(() => null);
    if (!signing) return null;
    const list = await league<Applicant[]>("applicants", { club_id: signing.club }).catch(() => [] as Applicant[]);
    return { club: signing.club, mine: list.find((a) => a.token_id === me.token_id) ?? null };
  }, [me.token_id]);
  useEffect(() => {
    const t = setInterval(reloadWord, 20_000);
    return () => clearInterval(t);
  }, [reloadWord]);
  return (
    <section className="paper panel signing" aria-labelledby="pick-title">
      <h2 id="pick-title">Sign for a club</h2>
      <p className="signing-lede">
        {me.name} is a free agent. A club gets his registration, his NFT, for the length you choose. You keep playing him and his wallet stays yours.
      </p>
      <div className="signing-terms">
        <div className="positions contract-days" role="group" aria-label="Your contract, in match days">
          {lengths.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
              {d}
              <small>{d === 26 ? "a season" : "days"}</small>
            </button>
          ))}
        </div>
        <ul>
          <li>The club pays its wage at each match you start.</li>
          <li>
            Unpaid {rules?.unpaid_to_free ?? 3} times in a row, or once the {days} days are played: he comes back to you by himself.
          </li>
          <li>Another club can take him earlier by paying the release clause, if you agree.</li>
        </ul>
      </div>
      <div className="clubs">
        {(data ?? []).map(({ c, people, votes }) => {
          const wage = BigInt(c.wage ?? "0");
          const applied = votes && word?.club === c.manager ? word.mine : null;
          return (
            <div className="club-row" key={c.manager}>
              <Crest clubId={c.manager} name={c.name} size={40} />
              <span className="club-who">
                <strong>{c.name}</strong>
                <span className="note">
                  Division {c.division}, {c.points} pts, {c.fans} fans, {people} of 12 people
                  {votes ? (applied?.approved ? ", voted you in" : ", votes on its recruits") : ""}
                </span>
              </span>
              <span className="club-pay">
                <b>{wage > 0n ? g(wage) : "No wage"}</b>
                <span className="note">{wage > 0n ? `a match, clause ${g(wage * BigInt(days) * BigInt(rules?.clause_factor ?? 2))}` : "leave when you like"}</span>
              </span>
              {people >= 12 ? (
                <span className="chip">FULL</span>
              ) : votes && !applied?.approved ? (
                applied ? (
                  <span className="chip applied" title="Its players vote on each recruit">
                    APPLIED · {applied.yes} YES, {applied.no} NO
                  </span>
                ) : (
                  <Action
                    label={`APPLY, ${days} DAYS`}
                    aria={`Apply to ${c.name} for ${days} days: its players vote`}
                    className="cta small"
                    run={() => leagueCall(session!, "sign_for", { club_id: c.manager, days }, 30)}
                    done={() => soon(reloadWord)}
                    success={`Applied to ${c.name}: its players vote`}
                  />
                )
              ) : (
                <Action
                  label={`SIGN ${days} DAYS`}
                  aria={`Sign ${days} days for ${c.name}`}
                  className="cta small"
                  run={() => signForClub(session!, me.token_id, c.manager, days)}
                  done={() => soon(refresh)}
                  success={`Welcome to ${c.name}!`}
                />
              )}
            </div>
          );
        })}
        {table?.length === 0 && <p className="note">No club yet.</p>}
      </div>
      <h3>Offers for {me.name}</h3>
      <Offers
        tokenId={me.token_id}
        accept={(o) =>
          acceptOffer(session!, me.token_id, o.id).then(() =>
            soon(refresh),
          )
        }
      />
      <FoundClub me={me} />
    </section>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Ten studs: full legs to empty. The notch is where tired starts. */
function EnergyGauge({ energy, tiredBelow }: { energy: number; tiredBelow: number }) {
  const lit = Math.ceil(energy / 10);
  const tired = energy < tiredBelow;
  return (
    <div className={`gauge${tired ? " tired" : ""}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={energy} aria-label="Energy">
      <div className="gauge-studs" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={`${i < lit ? "on" : ""}${i === Math.floor(tiredBelow / 10) ? " notch" : ""}`} />
        ))}
      </div>
      <span className="gauge-num">{energy}</span>
    </div>
  );
}

/** The next match, as the dressing-room board shows it: when, your legs, play or rest. */
function MatchBoard({ me, rules }: { me: Player; rules: Rules | null }) {
  const { session, schedule } = useGame();
  const day = schedule?.match_day ?? 0;
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const { data: suspended } = useData(() => league<boolean>("is_suspended", { token_id: me.token_id, match_day: day }), [me.token_id, day]);
  const { data: resting, reload } = useData(() => league<boolean>("is_resting", { token_id: me.token_id, match_day: day }).catch(() => false), [me.token_id, day]);
  const kickoff = Number(schedule?.kickoff_at_ms ?? 0);
  const before = !!schedule && !schedule.first_half_played && now < kickoff;
  const sheetOpen = before && now < kickoff - 60_000;
  const tiredBelow = rules?.tired_below ?? 50;
  const tired = me.energy < tiredBelow;
  // The chain plays a half in one go and the app reveals it: the last match can still be on screen.
  const lastEnds = schedule ? Number(schedule.last_kickoff_at_ms) + 2 * Number(schedule.half_ms) + Number(schedule.half_time_ms) : 0;
  const stillOn = before && Number(schedule?.last_kickoff_at_ms ?? 0) > 0 && now < lastEnds;
  return (
    <section className="matchboard" aria-label={`Match day ${day}`}>
      <p className="board-when">
        <span>Match day {day}</span>
        {before ? (
          <>
            <b>{clock(kickoff - now)}</b>
            <span>to kick-off</span>
            {stillOn && <a href="#/live">Match day {day - 1} is still on: watch it live</a>}
          </>
        ) : (
          <>
            <b>On now</b>
            <a href="#/live">Watch it live</a>
          </>
        )}
      </p>
      <div className="board-legs">
        <EnergyGauge energy={me.energy} tiredBelow={tiredBelow} />
        <p>
          {tired
            ? `Tired legs: your skills are down. A day off gives ${(rules?.energy_per_day ?? 8) + (rules?.energy_rest ?? 17)} back.`
            : `A match takes ${rules?.energy_match ?? 12}, a night gives ${rules?.energy_per_day ?? 8} back. Under ${tiredBelow} your skills drop.`}
        </p>
      </div>
      <p className={`board-status${suspended ? " bad" : resting ? " rest" : ""}`}>
        {suspended ? "Suspended after a red card" : resting ? "You rest this match day" : "You are in the squad"}
      </p>
      {!suspended && sheetOpen && session && (
        <div className="board-actions">
          <a className="cta small" href="#/team">
            {resting ? "Play after all" : "Pick my slot"}
          </a>
          {!resting && <Action className="chip" label="Rest today" run={() => leagueCall(session, "rest_today", {}, 30)} done={() => soon(reload)} success="You sit this one out" />}
        </div>
      )}
      {!sheetOpen && !suspended && <p className="board-closed">The team sheet is closed until the final whistle.</p>}
    </section>
  );
}

/** His contract, as the paper he signed: wage, days left, clause, and the three strikes that free him. */
function ContractSlip({ me, club, rules }: { me: Player; club: Club; rules: Rules | null }) {
  const { session, schedule, refresh } = useGame();
  const c = me.contract;
  if (!c) return null;
  const day = schedule?.match_day ?? c.from_day;
  const total = c.until_day - c.from_day + 1;
  const played = Math.min(total, Math.max(0, day - c.from_day));
  const strikes = rules?.unpaid_to_free ?? 3;
  const free = BigInt(c.wage) === 0n;
  return (
    <section className="slip" aria-label="Your contract">
      <header>
        <Crest clubId={club.manager} name={club.name} size={34} />
        <h3>Contract with {club.name}</h3>
      </header>
      <dl>
        <div>
          <dt>Wage</dt>
          <dd>{free ? "None" : `${g(c.wage)} a match`}</dd>
        </div>
        <div>
          <dt>Release clause</dt>
          <dd>{free ? "None" : g(c.clause)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>Match day {c.until_day}</dd>
        </div>
      </dl>
      <div className="slip-days" role="img" aria-label={`${total - played} of ${total} match days left`}>
        {Array.from({ length: Math.min(total, 78) }, (_, i) => (
          <i key={i} className={i < played ? "done" : ""} />
        ))}
      </div>
      {free ? (
        <p>
          No wage, no ties: leave whenever you like.{" "}
          <Action className="link" label={`Leave ${club.name}`} run={() => leagueCall(session!, "leave_club", {}, 100)} done={() => soon(refresh)} success="You are a free agent" />
        </p>
      ) : (
        <p className="strikes">
          Unpaid matches
          <span aria-label={`${c.unpaid} of ${strikes}`}>
            {Array.from({ length: strikes }, (_, i) => (
              <i key={i} className={i < c.unpaid ? "on" : ""} />
            ))}
          </span>
          {strikes} in a row and you are free.
        </p>
      )}
    </section>
  );
}

function MyPlayer({ me, club }: { me: Player; club: Club }) {
  const { session, schedule, balance, refresh } = useGame();
  const day = schedule?.match_day ?? 0;
  const owed = BigInt(me.wallet) + BigInt(me.salary);
  const { data: credits, reload: reloadCredits } = useData(() => league<string>("credits_of", { account_id: session!.accountId }), [session?.accountId, day]);
  const { data: rules } = useData(() => league<Rules>("rules"), []);
  const bonus = BigInt(credits ?? "0");
  return (
    <div className="locker">
      <div className="locker-top">
        <div className="locker-me">
          <HeroArt className="locker-hero" color={crestOf(club.manager).main} />
          <Sticker p={me} />
          <div className="locker-id">
            <h2>{me.name}</h2>
            <p>
              {positionLabel[me.position]} at {club.name}, {me.goals} {me.goals === 1 ? "goal" : "goals"}
            </p>
            <dl className="purse">
              <div>
                <dt>Your G</dt>
                <dd>{g(balance)}</dd>
              </div>
              <div>
                <dt>To collect</dt>
                <dd>{g(owed + bonus)}</dd>
              </div>
            </dl>
            {owed > 0n && (
              <Action className="cta small" label={`Collect ${g(owed)}`} run={() => leagueCall(session!, "claim_player", { token_id: me.token_id })} done={() => soon(refresh)} success={`${g(owed)} on its way`} />
            )}
            {bonus > 0n && (
              <Action
                className="cta small"
                label={`Collect your bonus, ${g(bonus)}`}
                run={() => leagueCall(session!, "claim", {}, 60)}
                done={() => {
                  soon(reloadCredits);
                  soon(refresh);
                }}
                success="In your wallet"
              />
            )}
            {owed + bonus === 0n && <p className="purse-note">Goals, wages and bonuses land here.</p>}
          </div>
        </div>
        <MatchBoard me={me} rules={rules} />
        <ContractSlip me={me} club={club} rules={rules} />
      </div>
      <a className="house-link" href="#/house">
        <Crest clubId={club.manager} name={club.name} size={30} />
        <span>
          <b>Club house</b> Vote what {club.name}'s treasury buys this week
        </span>
      </a>
      <div className="locker-work">
        <a className="paper panel training-door" href="#/training">
          <span className="k">TRAINING</span>
          <b>{me.last_trained_day >= day ? "Trained today. Back next match day." : "Today's session is waiting: up to +3 on a skill."}</b>
          <span className="cta small">{me.last_trained_day >= day ? "THE DRILLS" : "TRAIN"}</span>
        </a>
        <Life me={me} />
        <FaceEditor me={me} shirt={crestOf(club.manager).main} />
        <Wardrobe me={me} />
      </div>
    </div>
  );
}

/** The account behind the game: its passkey backup, and signing out. */
/** Your account, away from the football: backup, gas and signing out. */
export function AccountPage() {
  const { session } = useGame();
  if (!session) return <SignIn />;
  return (
    <div className="account-page">
      <a className="link" href="#/locker">
        ← Back to the locker room
      </a>
      <div className="account-grid">
      <Account />
      {!isGasless(session.accountId) && (
        <div className="paper panel">
          <span className="k">GAS</span>
          <p className="note">Low on NEAR for transactions? The relay tops you up, twice a day.</p>
          <Action className="cta small" label="Top up my gas" run={() => topUp(session.accountId)} />
        </div>
      )}
      </div>
    </div>
  );
}

function Account() {
  const { session, setSession, me } = useGame();
  const { data: passkeys, reload } = useData(() => (session ? passkeysOf(session.accountId) : Promise.resolve(0)), [session?.accountId]);
  if (!session) return null;
  return (
    <>
    <div className="paper panel account account-id">
      <span className="k">YOUR ACCOUNT</span>
      <p className="account-field">
        <small>ACCOUNT</small>
        <span title={session.accountId}>{short(session.accountId)}</span>
        <a className="link" href={`${EXPLORER}/address/${session.accountId}`} target="_blank" rel="noreferrer">
          Explorer ↗
        </a>
      </p>
      {isGasless(session.accountId) && <p className="note">Opened with your email: the game pays your gas.</p>}
      <button
        type="button"
        className="cta small danger"
        onClick={() => {
          signOut();
          setSession(null);
        }}
      >
        SIGN OUT
      </button>
    </div>
    <div className="paper panel account">
      <span className="k">BACKUP</span>
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
    </div>
    </>
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

import { useEffect, useMemo, useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { league, leagueCall } from "../lib/near.js";
import { serverNow } from "../lib/time.js";
import type { Club, Player, Rules, Stand, StandResult } from "../lib/types.js";
import { COLS, PATTERNS, ROWS, leading, paint, pictureColor } from "../tifo.js";
import { crestOf } from "./Crest.js";
import { faceNumber, Head } from "./Look.js";

const FOLLOW = "near-post.follows";
const remembered = () => {
  try {
    return localStorage.getItem(FOLLOW);
  } catch {
    return null;
  }
};
/** Which club this account supports, as far as this browser knows (the league has no view for it). */
const fanOf = (account: string) => {
  try {
    return localStorage.getItem(`near-post.fan.${account}`);
  } catch {
    return null;
  }
};
const setFan = (account: string, club: string) => {
  try {
    localStorage.setItem(`near-post.fan.${account}`, club);
  } catch {
    /* fine */
  }
};
/** The match days this browser took a seat in, so it offers only the claims it can make. */
const seatKey = (account: string, day: number) => `near-post.seat.${account}.${day}`;
const sat = (account: string, day: number) => {
  try {
    return localStorage.getItem(seatKey(account, day));
  } catch {
    return null;
  }
};
const setSat = (account: string, day: number, club: string) => {
  try {
    localStorage.setItem(seatKey(account, day), club);
  } catch {
    /* fine */
  }
};
/** What this browser already voted on a match day ("star" or "tifo"), so it asks once. */
const voted = (what: string, account: string, day: number) => {
  try {
    return localStorage.getItem(`near-post.${what}.${account}.${day}`) !== null;
  } catch {
    return false;
  }
};
const setVoted = (what: string, account: string, day: number) => {
  try {
    localStorage.setItem(`near-post.${what}.${account}.${day}`, "1");
  } catch {
    /* fine */
  }
};
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** A tifo pattern, small: every other square of the finished picture. */
function Mini({ pattern }: { pattern: number }) {
  const cells = [];
  for (let y = 0; y < ROWS; y += 2) for (let x = 0; x < COLS; x += 2) cells.push(<rect key={`${x}-${y}`} x={x / 2} y={y / 2} width="1" height="1" fill={pictureColor(x, y, pattern)} />);
  return (
    <svg viewBox={`0 0 ${COLS / 2} ${ROWS / 2}`} width="100%" aria-hidden="true" shapeRendering="crispEdges">
      {cells}
    </svg>
  );
}

const remember = (club: string) => {
  try {
    localStorage.setItem(FOLLOW, club);
  } catch {
    /* fine */
  }
};

/** The live stadium: the tifo of a club's stand, painted by the fans who came. */
/** Surname, or the full name when two players of the eleven share it. */
function shortName(name: string, all: string[]): string {
  const last = (n: string) => n.split(" ").slice(-1)[0] ?? n;
  const mine = last(name);
  return all.filter((n) => last(n) === mine).length > 1 ? name : mine;
}

export function Stands() {
  const { session, schedule, clubId, refresh } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  // With no club of your own, open on the busiest stand of the day, not an empty one.
  const { data: today } = useData(() => league<[string, Stand][]>("stands_today").catch(() => []), []);
  const busiest = today?.length ? [...today].sort((a, b) => b[1].present - a[1].present || b[1].fans - a[1].fans)[0]![0] : null;
  const [club, setClub] = useState<string | null>(() => remembered() ?? clubId);
  const current = club ?? clubId ?? busiest ?? table?.[0]?.manager ?? null;
  const { data: stand, reload } = useData(() => (current ? league<Stand>("stand", { club_id: current }) : Promise.resolve(null)), [current, schedule?.match_day]);
  const last = (schedule?.match_day ?? 1) - 1;
  const { data: lastStand } = useData(
    () => (current && last > 0 ? league<StandResult | null>("stand_result", { club_id: current, match_day: last }) : Promise.resolve(null)),
    [current, last],
  );
  const { data: credits, reload: reloadCredits } = useData(
    () => (session ? league<string>("credits_of", { account_id: session.accountId }) : Promise.resolve("0")),
    [session?.accountId, last],
  );
  const { data: rules } = useData(() => league<Rules>("rules"), []);
  const { data: eleven } = useData(() => (current ? league<Player[]>("starting_eleven", { club_id: current }) : Promise.resolve([])), [current, schedule?.match_day]);
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const [, bump] = useState(0);
  const info = table?.find((c) => c.manager === current);
  const day = stand?.match_day ?? last + 1;
  // The tifo the stand's fans are voting, and whose colours frame it: a derby winner's while its flag flies.
  const pattern = leading(stand?.tifo_votes);
  const flag = info?.flag && info.flag.until_day >= day ? info.flag : null;
  const border = useMemo(() => (flag ? { a: crestOf(flag.by).main, b: crestOf(flag.by).accent } : undefined), [flag?.by]);
  const squares = useMemo(() => paint(stand?.present ?? 0, stand?.fans ?? 0, pattern, border), [stand?.present, stand?.fans, pattern, border]);

  if (!table) return <p className="sub">Loading the stands…</p>;
  if (table.length === 0) return <p className="sub">No club yet.</p>;
  const need = stand ? Math.max(0, stand.target - stand.present) : 0;
  const pct = stand?.fans ? Math.round((stand.present / stand.fans) * 100) : 0;
  const color = stand?.full_house ? "var(--green-ok)" : "var(--yellow)";
  // What a fan present gets at a full house: more with each stadium level, and half more after an ola.
  const perFan = BigInt(rules?.full_house_mint_per_fan ?? "100000000000");
  const reward = perFan + (perFan * BigInt(info?.stadium ?? 0) * BigInt(rules?.stadium_bonus_bps ?? 1_000)) / 10_000n;
  const withOla = reward + (reward * BigInt(rules?.ola_bonus_bps ?? 5_000)) / 10_000n;
  // The ola: the last minutes before kick-off.
  const kickoff = Number(schedule?.kickoff_at_ms ?? 0);
  const olaWindow = Number(rules?.ola_window_ms ?? 300_000);
  const beforeKickoff = !schedule?.first_half_played && now < kickoff;
  const olaOpen = beforeKickoff && now >= kickoff - olaWindow;
  const olaMade = !!stand && stand.ola >= stand.ola_target && stand.ola_target > 0;
  const seated = !!session && !!current && sat(session.accountId, day) === current;
  const nameOf = (id: string) => table?.find((c) => c.manager === id)?.name ?? id;
  const starLead = [...(stand?.star_votes ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const starName = (token: string) => eleven?.find((p) => p.token_id === token)?.name ?? token;
  return (
    <div>
      <div className="head">
        <div>
          <span className="eyebrow">MATCH DAY {stand?.match_day ?? "…"} · {info?.name.toUpperCase()}</span>
          <h1>{stand?.full_house ? "TIFO COMPLETE!" : stand?.fans ? `${need} ${need === 1 ? "FAN" : "FANS"} TO GO` : "NO FANS YET"}</h1>
          <p className="sub">
            Fill the stand to 60% and every fan in it gets {g(reward)}. Leave it short and {g((BigInt(info?.treasury ?? "0") * 2n) / 100n)} of the club's treasury burns.
          </p>
          {flag && (
            <p className="flag-note">
              DERBY LOST · {nameOf(flag.by).toUpperCase()}'S COLOURS FLY HERE UNTIL MATCH DAY {flag.until_day}
            </p>
          )}
        </div>
        <label className="seg-select">
          <span className="note">Stand of</span>
          <select
            value={current ?? ""}
            onChange={(e) => {
              setClub(e.target.value);
              remember(e.target.value);
            }}
          >
            {table.map((c) => (
              <option key={c.manager} value={c.manager}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section className={`stand${stand?.full_house ? " done" : ""}`} aria-label="Tifo">
        {stand && stand.fans > 0 && (
          <div className={`ola-board${olaOpen ? " open" : ""}${olaMade ? " made" : ""}`}>
            <b>The ola</b>
            <p>
              {olaMade
                ? `${stand.ola} fans came in together. A full house now pays ${g(withOla)} each.`
                : olaOpen
                  ? `Take your seat now: ${stand.ola} of ${stand.ola_target} in the wave.`
                  : beforeKickoff
                    ? `${stand.ola_target} fans who sit down in the last ${Math.round(olaWindow / 60_000)} minutes make a full house pay ${g(withOla)} each.`
                    : `${stand.ola} of ${stand.ola_target} came in the last minutes: no wave today.`}
            </p>
            {beforeKickoff && !olaMade && (
              <span className="ola-clock">
                <strong>{clock(olaOpen ? kickoff - now : kickoff - olaWindow - now)}</strong>
                {olaOpen ? "left" : "to the window"}
              </span>
            )}
          </div>
        )}
        <div className="grid" role="img" aria-label={`Tifo of ${info?.name}: ${stand?.present ?? 0} of ${stand?.target ?? 0} fans needed`}>
          {squares.map((s) => (
            <div key={s.index} className={`sq${s.lit ? " lit" : ""}`} style={{ background: s.color, transitionDelay: `${(s.rank % 60) * 12}ms` }} />
          ))}
        </div>
        <div className="pitch" aria-hidden="true" />
      </section>
      <div className="row2">
        <section className="att" aria-label="Attendance">
          <strong style={{ fontSize: 18 }}>
            {stand?.present ?? 0} of {stand?.fans ?? 0} fans in the stand · <span style={{ color }}>{pct}%</span>
          </strong>
          <div className="bar">
            <div style={{ width: `${pct}%`, background: color }} />
            <i aria-hidden="true" />
          </div>
          {session && current ? (
            <>
              {seated ? (
                <p className="seat-stub">
                  <b>You are in.</b> {info?.name} counts you for match day {day}.
                </p>
              ) : (
              <div className="buttons">
                {fanOf(session.accountId) === current ? (
                  <Action
                    label={olaOpen ? "TAKE YOUR SEAT · JOIN THE OLA" : "TAKE YOUR SEAT"}
                    run={() => leagueCall(session, "check_in", {}, 60).then(() => setSat(session.accountId, last + 1, current))}
                    done={() => soon(reload)}
                    success="You are in the stand"
                  />
                ) : (
                  <Action
                    label={`SUPPORT ${(info?.name ?? "THIS CLUB").toUpperCase()} · TAKE YOUR SEAT`}
                    run={async () => {
                      await leagueCall(session, "follow", { club_id: current }, 30);
                      setFan(session.accountId, current);
                      await leagueCall(session, "check_in", {}, 60);
                      setSat(session.accountId, last + 1, current);
                    }}
                    done={() => soon(reload)}
                    success="You are a fan, and in the stand"
                  />
                )}
              </div>
              )}
              {((lastStand?.full_house && sat(session.accountId, last) === current) || BigInt(credits ?? "0") > 0n) && (
                <div className="buttons">
                  {lastStand?.full_house && sat(session.accountId, last) === current && (
                    <Action
                      label={`CLAIM THE FULL HOUSE OF MATCH DAY ${last}`}
                      className="cta small"
                      run={() => leagueCall(session, "claim_stand", { club_id: current, match_day: last }, 30)}
                      done={() => soon(reloadCredits)}
                      success="Claimed: collect it below"
                    />
                  )}
                  {BigInt(credits ?? "0") > 0n && (
                    <Action
                      label={`COLLECT ${g(credits ?? "0")}`}
                      className="cta small"
                      run={() => leagueCall(session, "claim", {}, 60)}
                      done={() => {
                        soon(reloadCredits);
                        soon(refresh);
                      }}
                      success="In your wallet"
                    />
                  )}
                </div>
              )}
              {seated && (!voted("tifo", session.accountId, day) || (!voted("star", session.accountId, day) && (eleven?.length ?? 0) > 0)) && (
                <div className="fan-votes">
                  {!voted("tifo", session.accountId, day) && (
                    <fieldset>
                      <legend>Which tifo should the stand show?</legend>
                      <div className="tifo-picks">
                        {PATTERNS.map((name, i) => (
                          <Action
                            key={name}
                            className={`tifo-pick${pattern === i && (stand?.tifo_votes[i] ?? 0) > 0 ? " leading" : ""}`}
                            label={
                              <>
                                <Mini pattern={i} />
                                <span>
                                  {name}
                                  {stand?.tifo_votes[i] ? <em>{stand.tifo_votes[i]}</em> : null}
                                </span>
                              </>
                            }
                            run={() => leagueCall(session, "vote_tifo", { pattern: i }, 30).then(() => setVoted("tifo", session.accountId, day))}
                            done={() => {
                              bump((n) => n + 1);
                              soon(reload);
                            }}
                            success={`${name} it is`}
                          />
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {!voted("star", session.accountId, day) && (eleven?.length ?? 0) > 0 && (
                    <fieldset>
                      <legend>Who is your star of the match? The most voted gets up to {g(rules?.fans_star_prize ?? "100000000000")}.</legend>
                      <div className="star-picks">
                        {eleven!.map((p) => {
                          const votes = stand?.star_votes.find(([t]) => t === p.token_id)?.[1] ?? 0;
                          return (
                            <Action
                              key={p.token_id}
                              className="star-pick"
                              aria={`Vote ${p.name}`}
                              label={
                                <>
                                  <Head look={p.look} n={faceNumber(p.token_id)} size={44} />
                                  <span>{shortName(p.name, eleven!.map((q) => q.name))}</span>
                                  {votes > 0 && <em>{votes}</em>}
                                </>
                              }
                              run={() => leagueCall(session, "vote_star", { token_id: p.token_id }, 30).then(() => setVoted("star", session.accountId, day))}
                              done={() => {
                                bump((n) => n + 1);
                                soon(reload);
                              }}
                              success={`Your star: ${p.name}`}
                            />
                          );
                        })}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}
              {starLead && (
                <p className="sub" style={{ fontSize: 14, margin: 0 }}>
                  The stand's star so far: <b>{starName(starLead[0])}</b>, {starLead[1]} {starLead[1] === 1 ? "vote" : "votes"}.
                </p>
              )}
            </>
          ) : (
            <a className="cta signin" href="#/locker">SIGN IN WITH EMAIL TO TAKE YOUR SEAT</a>
          )}
        </section>
        <details className="card rules">
          <summary>The rules of the stand</summary>
          <dl>
            <dt>Full house (60%)</dt>
            <dd style={{ color: "#1e7a47" }}>+{g(reward)} per fan</dd>
            <dt>With an ola</dt>
            <dd style={{ color: "#1e7a47" }}>+{g(withOla)} per fan</dd>
            <dt>Stadium level {info?.stadium ?? 0}</dt>
            <dd>+10% per level</dd>
            <dt>Fans' star</dt>
            <dd style={{ color: "#1e7a47" }}>up to +{g(rules?.fans_star_prize ?? "100000000000")} to the player</dd>
            <dt>Goal</dt>
            <dd style={{ color: "#1e7a47" }}>up to +600k G, as full as the stand is</dd>
            <dt>Derby</dt>
            <dd>×2</dd>
            <dt>Tifo not complete</dt>
            <dd style={{ color: "#b01e2b" }}>2% of treasury burns</dd>
            <dt>Season ticket</dt>
            <dd style={{ color: "#1e7a47" }}>+50k G per full house</dd>
          </dl>
          <span className="note">Fixed in the league contract. No method changes them.</span>
        </details>
      </div>
    </div>
  );
}

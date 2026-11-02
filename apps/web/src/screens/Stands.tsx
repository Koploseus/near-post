import { useMemo, useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league, leagueCall } from "../lib/near.js";
import type { Club, Stand } from "../lib/types.js";
import { paint } from "../tifo.js";

const FOLLOW = "near-post.follows";
const remembered = () => {
  try {
    return localStorage.getItem(FOLLOW);
  } catch {
    return null;
  }
};
const remember = (club: string) => {
  try {
    localStorage.setItem(FOLLOW, club);
  } catch {
    /* fine */
  }
};

/** The live stadium: the tifo of a club's stand, painted by the fans who came. */
export function Stands() {
  const { session, schedule, clubId, refresh } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const [club, setClub] = useState<string | null>(() => remembered() ?? clubId);
  const current = club ?? table?.[0]?.manager ?? null;
  const { data: stand, reload } = useData(() => (current ? league<Stand>("stand", { club_id: current }) : Promise.resolve(null)), [current, schedule?.match_day]);
  const info = table?.find((c) => c.manager === current);
  const squares = useMemo(() => paint(stand?.present ?? 0, stand?.fans ?? 0), [stand?.present, stand?.fans]);
  const last = (schedule?.match_day ?? 1) - 1;

  if (!table) return <p className="sub">Loading the stands…</p>;
  if (table.length === 0) return <p className="sub">No club yet.</p>;
  const need = stand ? Math.max(0, stand.target - stand.present) : 0;
  const pct = stand?.fans ? Math.round((stand.present / stand.fans) * 100) : 0;
  const color = stand?.full_house ? "var(--green-ok)" : "var(--yellow)";
  return (
    <div>
      <div className="head">
        <div>
          <span className="eyebrow">MATCH DAY {stand?.match_day ?? "…"} · {info?.name.toUpperCase()}</span>
          <h1>{stand?.full_house ? "TIFO COMPLETE!" : stand?.fans ? `${need} ${need === 1 ? "FAN" : "FANS"} TO GO` : "NO FANS YET"}</h1>
          <p className="sub">
            {stand?.present ?? 0} of {stand?.fans ?? 0} fans in. 60% completes the tifo: every fan present then gets 100k G. Otherwise 2% of
            the treasury ({g(info?.treasury ?? "0")}) burns. Streak: {info?.full_house_streak ?? 0}, best {info?.best_streak ?? 0}.
          </p>
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
              <div className="buttons">
                <Action label="TAKE YOUR SEAT" run={() => leagueCall(session, "check_in", {}, 60)} done={reload} success="You are in the stand" />
                <Action label="BECOME A FAN" className="cta small" run={() => leagueCall(session, "follow", { club_id: current }, 30)} done={reload} success="You are a fan now" />
              </div>
              {last > 0 && (
                <div className="buttons">
                  <Action label={`CLAIM MATCH DAY ${last}`} className="cta small" run={() => leagueCall(session, "claim_stand", { club_id: current, match_day: last }, 30)} />
                  <Action label="COLLECT MY CREDITS" className="cta small" run={() => leagueCall(session, "claim", {}, 60)} done={refresh} />
                </div>
              )}
              <p className="sub" style={{ fontSize: 14, margin: 0 }}>You follow one club at a time. Your first 4 visits each pay a 1M G welcome bonus.</p>
            </>
          ) : (
            <a className="cta signin" href="#/locker">SIGN IN WITH EMAIL TO TAKE YOUR SEAT</a>
          )}
        </section>
        <aside className="card" aria-label="Rules">
          <span className="k">THE RULES</span>
          <dl>
            <dt>Full house (60%)</dt>
            <dd style={{ color: "#1e7a47" }}>+100k G per fan</dd>
            <dt>Derby</dt>
            <dd>×2</dd>
            <dt>Tifo not complete</dt>
            <dd style={{ color: "#b01e2b" }}>2% of treasury burns</dd>
          </dl>
          <span className="note">Fixed in the league contract at launch. No one can change them.</span>
        </aside>
      </div>
    </div>
  );
}

import { Action } from "../lib/Action.js";
import { useData, useGame } from "../lib/game.js";
import { league, leagueCall } from "../lib/near.js";
import { FORMATIONS, ROLE_LABEL, ROLE_NAME, SPOTS } from "../lib/pitch.js";
import { useEffect, useState } from "react";
import { serverNow } from "../lib/time.js";
import type { Captain, Club, Lineup as LineupT, Player, Schedule, Strategy, Takers } from "../lib/types.js";
import { short } from "../lib/format.js";
import { Crest } from "./Crest.js";
import { SeasonStats } from "./SeasonStats.js";
import { faceNumber, Head } from "./Look.js";
import { Wall } from "./Wall.js";
import { usePresence } from "../lib/social.js";

const STRATEGIES: [Strategy, string][] = [
  ["defend", "Defend"],
  ["balanced", "Balanced"],
  ["attack", "Attack"],
];

/** Free slots are filled with the best of the squad this long before kick-off; until then, they stay empty. */
export const SLOTS_CLOSE_MS = 60_000;

/** Slots can be taken until a minute before the first half; after that the sheet shows the eleven that will play. */
export function slotsOpen(s: Pick<Schedule, "first_half_played" | "kickoff_at_ms">, now: number): boolean {
  return !s.first_half_played && now < Number(s.kickoff_at_ms) - SLOTS_CLOSE_MS;
}

/** The team sheet: the formation on a pitch, slots to take, the strategy vote. */
export function Lineup() {
  const { session, me, clubId, schedule } = useGame();
  // Your club's sheet; without one (or to look at another), any club's, read-only.
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const [picked, setPicked] = useState<string | null>(null);
  const sheetId = picked ?? clubId ?? table?.[0]?.manager ?? null;
  const ownSheet = !!clubId && sheetId === clubId;
  const sheetClub = table?.find((c) => c.manager === sheetId) ?? null;
  const { data: lineup, reload } = useData(
    () => (sheetId ? league<LineupT>("lineup", { club_id: sheetId }) : Promise.resolve(null)),
    [sheetId, schedule?.match_day, schedule?.first_half_played],
  );
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 5_000);
    return () => clearInterval(t);
  }, []);
  // Before kick-off, the sheet shows only the slots people chose; a minute
  // before, the free ones go to the best of the squad for the role.
  const open = !!schedule && slotsOpen(schedule, now);
  const online = usePresence(lineup?.players.map((p) => p?.controller) ?? []);
  const { data: captain } = useData(
    () => (sheetId ? league<Captain | null>("captain", { club_id: sheetId }) : Promise.resolve(null)),
    [sheetId],
  );
  if (!sheetId || !lineup)
    return (
      <div className="lineup-page">
        <p className="sub">Loading the team sheets…</p>
        <SeasonStats />
      </div>
    );
  const half = schedule?.first_half_played ? "second half" : "kick-off";
  const isCaptain = ownSheet && (captain ? me?.token_id === captain.token_id : session?.accountId === clubId);
  const shown = lineup.players.map((p, k) => (open && !lineup.chosen[k] ? null : p));
  const mine = shown.findIndex((p) => p && p.token_id === me?.token_id);
  return (
    <div className="lineup-page">
      {!ownSheet && (
        <section className="visit-bar">
          <label>
            <span>Team sheet of</span>
            <select value={sheetId} onChange={(e) => setPicked(e.target.value)}>
              {(table ?? []).map((c) => (
                <option key={c.manager} value={c.manager}>
                  {c.name} · Division {c.division}
                </option>
              ))}
            </select>
          </label>
          {!clubId ? (
            <a className="cta small" href="#/locker">
              {me ? "SIGN FOR A CLUB" : "PLAY: CREATE YOUR FOOTBALLER"}
            </a>
          ) : (
            <button type="button" className="chip" onClick={() => setPicked(null)}>
              Back to my club
            </button>
          )}
        </section>
      )}
      <section className="paper panel">
        <span className="k">TEAM SHEET · {half.toUpperCase()}</span>
        <h2 className="sheet-title">
          {sheetClub && <Crest clubId={sheetId} name={sheetClub.name} size={36} />}
          {sheetClub?.name ?? short(sheetId)}
        </h2>
        <p className="note">
          {!ownSheet
            ? "Every slot is taken by a real person or an AI footballer of this club. Sign for a club to take yours."
            : !open
            ? "The eleven is set: free slots went to the best of the squad for the role."
            : mine >= 0
              ? `You play ${ROLE_NAME[lineup.roles[mine]!].toLowerCase()} (slot ${mine + 1}). Tap another free slot to move.`
              : me
                ? "Tap a free slot to take it. Nobody can take a slot another player chose."
                : "Create your footballer in the locker room to take a slot."}
          {open && " One minute before kick-off, the free slots go to the best of the squad for the role."}
        </p>
        <div className="formations" role="group" aria-label="Formation">
          {FORMATIONS.map((f) =>
            isCaptain && session ? (
              <Action
                key={f}
                className={`chip${lineup.formation === f ? " on" : ""}`}
                label={f}
                run={() => leagueCall(session, "set_formation", { club_id: clubId, formation: f }, 30)}
                done={reload}
              />
            ) : (
              <span key={f} className={`chip${lineup.formation === f ? " on" : ""}`}>
                {f}
              </span>
            ),
          )}
          <span className="note">{isCaptain ? "You pick the formation." : `The ${captain ? `captain (${captain.name})` : "manager"} picks the formation.`}</span>
        </div>
      </section>
      <div className="pitch-wrap">
        <div className="pitch-v" role="group" aria-label={`${lineup.formation} on the pitch`}>
          <span className="pitch-line half" aria-hidden="true" />
          <span className="pitch-line circle" aria-hidden="true" />
          <span className="pitch-line box top" aria-hidden="true" />
          <span className="pitch-line box bottom" aria-hidden="true" />
          {lineup.roles.map((role, k) => {
            const p = shown[k];
            const [x, y] = SPOTS[lineup.formation][k]!;
            const you = p && p.token_id === me?.token_id;
            const takenByPerson = lineup.chosen[k] && !you;
            const label = `${ROLE_NAME[role]}: ${p ? `${p.name}, rated ${p.overall}` : "empty"}${lineup.chosen[k] ? ", chosen by a player" : ""}`;
            const body = (
              <>
                <span className="spot-disc">
                  {p ? <Head look={p.look} n={faceNumber(p.token_id)} size={46} /> : <span className="spot-free">+</span>}
                  <span className="spot-rating">{p?.overall ?? ROLE_LABEL[role]}</span>
                  {p && !!p.controller && online.has(p.controller) && <span className="online-dot" title="Online now" />}
                </span>
                <span className="spot-name">
                  <b>{ROLE_LABEL[role]}</b> {you ? "YOU" : p ? p.name.split(" ").slice(-1)[0] : "free"}
                </span>
              </>
            );
            const cls = `spot${you ? " you" : ""}${p?.controller ? " person" : ""}${p ? "" : " free"}`;
            return ownSheet && open && me && session && !takenByPerson && !you ? (
              <span key={k} className="spot-pos" style={{ left: `${x}%`, top: `${y}%` }}>
                <Action className={cls} label={body} run={() => leagueCall(session, "take_slot", { slot: k }, 30)} done={reload} aria={label} success={`You play ${ROLE_NAME[role].toLowerCase()}`} />
              </span>
            ) : (
              <span key={k} className="spot-pos" style={{ left: `${x}%`, top: `${y}%` }}>
                <span className={cls} aria-label={label} role="img">
                  {body}
                </span>
              </span>
            );
          })}
        </div>
        <aside className="paper panel strategy">
          <span className="k">STRATEGY FOR THE {half.toUpperCase()}</span>
          <p className="note">Players vote; most votes wins, a tie plays balanced. Attack shoots more and leaves gaps at the back.</p>
          <div className="formations">
            {STRATEGIES.map(([s, label]) =>
              ownSheet && me && session ? (
                <Action
                  key={s}
                  className={`chip${lineup.strategy === s ? " on" : ""}`}
                  label={label}
                  run={() => leagueCall(session, "vote_strategy", { strategy: s }, 30)}
                  done={reload}
                />
              ) : (
                <span key={s} className={`chip${lineup.strategy === s ? " on" : ""}`}>
                  {label}
                </span>
              ),
            )}
          </div>
          <p className="note">Now: {lineup.strategy}. Players in slots: {lineup.chosen.filter(Boolean).length} of 11</p>
          <SetPieces clubId={sheetId} leader={isCaptain} />
        </aside>
      </div>
      <Wall clubId={sheetId} />
      <SeasonStats />
    </div>
  );
}

/** Who takes free kicks and penalties: the captain names them, else the best shooter on the pitch. */
function SetPieces({ clubId, leader }: { clubId: string; leader: boolean }) {
  const { session } = useGame();
  const { data, reload } = useData(
    () => Promise.all([league<Takers>("takers", { club_id: clubId }), league<Player[]>("squad", { account_id: clubId })]),
    [clubId],
  );
  const [pick, setPick] = useState<Takers>({ free_kick: null, penalty: null });
  useEffect(() => {
    if (data) setPick(data[0]);
  }, [data]);
  if (!data) return null;
  const [takers, squad] = data;
  const byShooting = [...squad].sort((a, b) => b.skills.shooting - a.skills.shooting);
  const nameOf = (t: string | null) => (t ? (squad.find((p) => p.token_id === t)?.name ?? "someone who left") : "the best shooter on the pitch");
  const rows: [keyof Takers, string][] = [
    ["free_kick", "Free kicks"],
    ["penalty", "Penalties"],
  ];
  return (
    <div className="set-pieces">
      <span className="k">SET PIECES</span>
      {rows.map(([k, label]) =>
        leader && session ? (
          <label key={k} className="taker">
            <span>{label}</span>
            <select value={pick[k] ?? ""} onChange={(e) => setPick({ ...pick, [k]: e.target.value || null })}>
              <option value="">Best shooter on the pitch</option>
              {byShooting.map((p) => (
                <option key={p.token_id} value={p.token_id}>
                  {p.name} · shooting {p.skills.shooting}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p key={k} className="note">
            {label}: {nameOf(takers[k])}
          </p>
        ),
      )}
      {leader && session && (pick.free_kick !== takers.free_kick || pick.penalty !== takers.penalty) && (
        <Action className="cta small" label="SAVE TAKERS" run={() => leagueCall(session, "set_takers", { club_id: clubId, free_kick: pick.free_kick, penalty: pick.penalty }, 30)} done={reload} success="Set-piece takers named" />
      )}
    </div>
  );
}

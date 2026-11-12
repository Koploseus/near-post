import { Cabinet, HeroArt } from "../floodlight/art.js";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { type Click, type Drill as DrillT, drill } from "../../../relay/src/drill.js";
import { Action } from "../lib/Action.js";
import { DribbleGame, PassesGame, SprintGame, TacklesGame } from "./Games.js";
import { PenaltyGame } from "./Penalty.js";
import { SKILLS, g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { attestDrill, finishTraining, league, leagueCall, startDrill, train } from "../lib/near.js";
import { serverNow } from "../lib/time.js";
import type { Player, Schedule, Skill, Ticket } from "../lib/types.js";

const TRAINING = "400000000000";
const SAVED = "near-post.attested";

interface Attested {
  ticket: number;
  hits: number;
  rounds: number;
  points: number;
  signature: string;
}

/**
 * When the current match day closes (its second half), and with it any
 * training session paid during it. Before kick-off, the second half is due
 * a half and half-time after kick-off; after the first half, it is scheduled.
 */
export function dayEndsAt(s: Schedule): number {
  return s.first_half_played ? Number(s.next_match_at_ms) : Number(s.kickoff_at_ms) + Number(s.half_ms) + Number(s.half_time_ms);
}
/** Too close to the end of the match day to pay for a session: a drill and its submission take a few minutes. */
export const TRAIN_CUTOFF_MS = 3 * 60_000;
const minutes = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min` : `${Math.max(0, Math.floor(ms / 1000))} s`);

/** The score of a drill survives a reload until it is submitted. */
const loadAttested = (ticket: number): Attested | null => {
  try {
    const a = JSON.parse(localStorage.getItem(SAVED) ?? "null") as Attested | null;
    return a?.ticket === ticket ? a : null;
  } catch {
    return null;
  }
};
const saveAttested = (a: Attested | null) => {
  try {
    if (a) localStorage.setItem(SAVED, JSON.stringify(a));
    else localStorage.removeItem(SAVED);
  } catch {
    /* in memory only */
  }
};

/**
 * Training: pay 400k G for one skill, play the drill, and the relay's signed
 * score adds 0 to 3 points on chain.
 */
export function Training({ me }: { me: Player }) {
  const { session, schedule, balance, refresh } = useGame();
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 5_000);
    return () => clearInterval(t);
  }, []);
  const left = schedule ? dayEndsAt(schedule) - now : Infinity;
  const late = left < TRAIN_CUTOFF_MS;
  const day = schedule?.match_day ?? 0;
  const { data: last, reload } = useData(() => league<Ticket | null>("training_ticket", { token_id: me.token_id }), [me.token_id, day]);
  // A session lasts one match day: an older ticket can no longer be finished.
  const ticket = last && last.match_day === day ? last : null;
  const lapsed = last && last.match_day < day ? last : null;
  const [skill, setSkill] = useState<Skill>(me.position === "Fw" ? "shooting" : me.position === "Mf" ? "passing" : "defending");
  const [run, setRun] = useState<{ drill: DrillT } | null>(null);
  const [attested, setAttested] = useState<Attested | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAttested(ticket ? loadAttested(ticket.id) : null), [ticket]);
  if (!session) return null;

  const skillName = (k: Skill) => SKILLS.find(([s]) => s === k)![2];

  if (run && ticket) {
    const finish = async (clicks: Click[]) => {
      setRun(null);
      try {
        const a = await attestDrill(me.token_id, clicks);
        const saved = { ticket: ticket.id, ...a };
        saveAttested(saved);
        setAttested(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    return game(run.drill, finish);
  }

  return (
    <div className="paper panel training">
      <h3>Training</h3>
      {ticket ? (
        attested ? (
          <>
            <div className={`drill-result${attested.points ? " passed" : ""}`}>
              <HeroArt className="drill-hero" pose={attested.points ? "cheer" : "idle"} />
              <span className="drill-title">{attested.points ? "DRILL PASSED!" : "NOT THIS TIME"}</span>
              <p className="big-score">
                {attested.hits} / {attested.rounds} · <strong>+{attested.points}</strong> {skillName(ticket.skill)}
              </p>
            </div>
            <p className={left < TRAIN_CUTOFF_MS ? "err" : "note"}>
              The relay signed your score. Submit it before this match day ends{Number.isFinite(left) ? `, in ${minutes(left)}` : ""}.
            </p>
            <Action
              label={attested.points ? `ADD ${attested.points} ${skillName(ticket.skill).toUpperCase()}` : "CLOSE THE SESSION (NO POINT)"}
              run={() => finishTraining(session, me.token_id, attested.points, attested.signature)}
              success={`+${attested.points} ${skillName(ticket.skill).toLowerCase()}`}
              done={() => {
                saveAttested(null);
                reload();
                soon(refresh);
              }}
            />
          </>
        ) : (
          <>
            <p className="note">
              Paid: {HOW[ticket.skill]} Score 90% to gain 3 points, 70% for 2, 50% for 1. It gets harder as the skill rises.
            </p>
            {Number.isFinite(left) && <p className={left < TRAIN_CUTOFF_MS ? "err" : "note"}>Play and submit within {minutes(left)}: the session ends with this match day.</p>}
            <Action
              label="START THE DRILL"
              run={async () => {
                setError(null);
                const s = await startDrill(me.token_id);
                if (s.attested) {
                  // Played already (another tab, or a reload): the relay kept the score.
                  const saved = { ticket: s.ticket.id, ...s.attested };
                  saveAttested(saved);
                  setAttested(saved);
                  return;
                }
                setRun({ drill: drill(s.ticket.seed, s.level, s.ticket.skill) });
              }}
            />
          </>
        )
      ) : me.last_trained_day >= day && !lapsed ? (
        <p className="note">Trained this match day. Back after the next match.</p>
      ) : (
        <>
          {lapsed && <p className="note">Your last session ended with match day {lapsed.match_day} before you finished it.</p>}
          <p className="note">
            {me.free_trainings > 0 ? "Your first session is free. " : "400k G, burned. "}Pick a skill, then play the drill. A session costs 15 energy (you have{" "}
            {me.energy}).
          </p>
          <Cabinet skill={skill} className="training-cabinet" />
          <div className="skill-pick" role="radiogroup" aria-label="Skill to train">
            {SKILLS.map(([k, label, name]) => (
              <button key={k} type="button" role="radio" aria-checked={skill === k} onClick={() => setSkill(k)} title={name}>
                <b>{me.skills[k]}</b>
                {label}
              </button>
            ))}
          </div>
          {me.free_trainings > 0 ? (
            <Action
              label={`TRAIN ${skillName(skill).toUpperCase()} · FREE`}
              disabled={late || me.energy < 15}
              run={() => leagueCall(session, "train_free", { token_id: me.token_id, skill }, 60)}
              success="Session booked: play the drill"
              done={() => {
                soon(reload);
                soon(refresh);
              }}
            />
          ) : (
            <Action
              label={`TRAIN ${skillName(skill).toUpperCase()} · 400k G`}
              disabled={BigInt(balance) < BigInt(TRAINING) || late || me.energy < 15}
              run={() => train(session, me.token_id, skill, TRAINING)}
              success="Session booked: play the drill"
              done={() => soon(reload)}
            />
          )}
          {me.energy < 15 && <p className="note">Too tired to train: rest a match day.</p>}
          {me.free_trainings === 0 && BigInt(balance) < BigInt(TRAINING) && (
            <p className="note">You have {g(balance)}. Your first match pays a debut bonus; goals and wages follow.</p>
          )}
          {late ? (
            <p className="note">This match day ends in {minutes(left)}, too soon to play a session: training opens again with the next one.</p>
          ) : (
            Number.isFinite(left) && <p className="note">{minutes(left)} left in this match day to pay, play and submit.</p>
          )}
        </>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const PENALTIES = "five penalties. Press on the ball, drag to where you aim in the goal, release. A firm swipe beats the keeper; a flick drifts, a slow shot gives him time.";
const HOW: Record<string, string> = {
  shooting: PENALTIES,
  physical: PENALTIES,
  passing: "five through balls. Drag from the ball to where your running teammate will be, away from the defenders.",
  dribbling: "eight defenders slide in. Swipe left or right (or ← →) once each one commits, before he gets to you.",
  pace: "five races to a ball played into space. After GO, press left and right in turn (or ← →) to sprint.",
  defending: "six duels. The attacker cuts left or right, sometimes after a feint: swipe to his side (or ← →) as he cuts.",
};

/** The penalties in 3D (three.js, loaded only for this drill); the 2D game where WebGL is missing. */
const PenaltyGame3D = lazy(() => import("./Penalty3D.js").then((m) => ({ default: m.PenaltyGame3D })));
function webgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The canvas game for a drill. */
function game(d: DrillT, onDone: (trace: Click[]) => void): ReactNode {
  switch (d.game) {
    case "penalties":
      return webgl() ? (
        <Suspense fallback={<div className="pen3d-loading">Warming up…</div>}>
          <PenaltyGame3D setup={d.setup} onDone={onDone} />
        </Suspense>
      ) : (
        <PenaltyGame setup={d.setup} onDone={onDone} />
      );
    case "passes":
      return <PassesGame setup={d.setup} onDone={onDone} />;
    case "dribble":
      return <DribbleGame setup={d.setup} onDone={onDone} />;
    case "sprint":
      return <SprintGame setup={d.setup} onDone={onDone} />;
    case "tackles":
      return <TacklesGame setup={d.setup} onDone={onDone} />;
  }
}

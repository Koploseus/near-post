import { type ReactNode, useEffect, useState } from "react";
import { type Click, type Drill as DrillT, drill } from "../../../relay/src/drill.js";
import { Action } from "../lib/Action.js";
import { DribbleGame, PassesGame, SprintGame, TacklesGame } from "./Games.js";
import { PenaltyGame } from "./Penalty.js";
import { SKILLS, g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { attestDrill, finishTraining, league, startDrill, train } from "../lib/near.js";
import type { Player, Skill, Ticket } from "../lib/types.js";

const TRAINING = "400000000000";
const SAVED = "near-post.attested";

interface Attested {
  ticket: number;
  hits: number;
  rounds: number;
  points: number;
  signature: string;
}

/** The score of a drill survives a reload until it is submitted. */
const loadAttested = (ticket: number): Attested | null => {
  try {
    const a = JSON.parse(sessionStorage.getItem(SAVED) ?? "null") as Attested | null;
    return a?.ticket === ticket ? a : null;
  } catch {
    return null;
  }
};
const saveAttested = (a: Attested | null) => {
  try {
    if (a) sessionStorage.setItem(SAVED, JSON.stringify(a));
    else sessionStorage.removeItem(SAVED);
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
  const day = schedule?.match_day ?? 0;
  const { data: ticket, reload } = useData(() => league<Ticket | null>("training_ticket", { token_id: me.token_id }), [me.token_id, day]);
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
            <p className="big-score">
              {attested.hits} / {attested.rounds} · <strong>+{attested.points}</strong> {skillName(ticket.skill)}
            </p>
            <p className="note">The relay signed your score. Submit it before the next match day.</p>
            <Action
              label={`ADD ${attested.points} ${skillName(ticket.skill).toUpperCase()}`}
              run={() => finishTraining(session, me.token_id, attested.points, attested.signature)}
              done={() => {
                saveAttested(null);
                reload();
                setTimeout(refresh, 2500);
              }}
            />
          </>
        ) : (
          <>
            <p className="note">
              Paid: {HOW[ticket.skill]} Score 90% to gain 3 points, 70% for 2, 50% for 1. It gets harder as the skill rises.
            </p>
            <Action
              label="START THE DRILL"
              run={async () => {
                setError(null);
                const s = await startDrill(me.token_id);
                setRun({ drill: drill(s.ticket.seed, s.level, s.ticket.skill) });
              }}
            />
          </>
        )
      ) : me.last_trained_day >= day ? (
        <p className="note">Trained this match day. Back after the next match.</p>
      ) : (
        <>
          <p className="note">400k G, burned. Pick a skill, then play the drill.</p>
          <div className="skill-pick" role="radiogroup" aria-label="Skill to train">
            {SKILLS.map(([k, label, name]) => (
              <button key={k} type="button" role="radio" aria-checked={skill === k} onClick={() => setSkill(k)} title={name}>
                <b>{me.skills[k]}</b>
                {label}
              </button>
            ))}
          </div>
          <Action
            label={`TRAIN ${skillName(skill).toUpperCase()} · 400k G`}
            disabled={BigInt(balance) < BigInt(TRAINING)}
            run={() => train(session, me.token_id, skill, TRAINING)}
            done={() => setTimeout(reload, 2500)}
          />
          {BigInt(balance) < BigInt(TRAINING) && <p className="note">You have {g(balance)}.</p>}
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

const PENALTIES = "five penalties. Press on the ball, drag to where you aim in the goal, release: a quick swipe shoots harder but drifts more.";
const HOW: Record<string, string> = {
  shooting: PENALTIES,
  physical: PENALTIES,
  passing: "five through balls. Drag from the ball to where your running teammate will be, away from the defenders.",
  dribbling: "eight defenders slide in. Swipe left or right (or ← →) once each one commits, before he gets to you.",
  pace: "five races to a ball played into space. After GO, press left and right in turn (or ← →) to sprint.",
  defending: "six duels. The attacker cuts left or right, sometimes after a feint: swipe to his side (or ← →) as he cuts.",
};

/** The canvas game for a drill. */
function game(d: DrillT, onDone: (trace: Click[]) => void): ReactNode {
  switch (d.game) {
    case "penalties":
      return <PenaltyGame setup={d.setup} onDone={onDone} />;
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

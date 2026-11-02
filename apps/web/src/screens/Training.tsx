import { useEffect, useRef, useState } from "react";
import { type Click, FIELD, type Target, drill, duration, hits, points } from "../../../relay/src/drill.js";
import { Action } from "../lib/Action.js";
import { SKILLS, g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { attestDrill, finishTraining, league, startDrill, train } from "../lib/near.js";
import type { Player, Skill, Ticket } from "../lib/types.js";

const TRAINING = "400000000000";
const SAVED = "near-post.attested";

interface Attested {
  ticket: number;
  hits: number;
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
  const [run, setRun] = useState<{ targets: Target[] } | null>(null);
  const [attested, setAttested] = useState<Attested | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAttested(ticket ? loadAttested(ticket.id) : null), [ticket]);
  if (!session) return null;

  const skillName = (k: Skill) => SKILLS.find(([s]) => s === k)![2];

  if (run && ticket) {
    return (
      <Drill
        targets={run.targets}
        onDone={async (clicks) => {
          setRun(null);
          try {
            const a = await attestDrill(me.token_id, clicks);
            const saved = { ticket: ticket.id, ...a };
            saveAttested(saved);
            setAttested(saved);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    );
  }

  return (
    <div className="paper panel training">
      <h3>Training</h3>
      {ticket ? (
        attested ? (
          <>
            <p className="big-score">
              {attested.hits} / 12 hits · <strong>+{attested.points}</strong> {skillName(ticket.skill)}
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
              Paid: a {skillName(ticket.skill).toLowerCase()} drill. Hit the targets as they pop up: 11 hits give 3 points, 9 give 2, 6
              give 1. It gets harder as the skill rises.
            </p>
            <Action
              label="START THE DRILL"
              run={async () => {
                setError(null);
                const s = await startDrill(me.token_id);
                setRun({ targets: drill(s.ticket.seed, s.level) });
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

/** The drill itself: targets pop up on a pitch; clicks are recorded for the relay. */
function Drill({ targets, onDone }: { targets: Target[]; onDone: (clicks: Click[]) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const clicks = useRef<Click[]>([]);
  const [now, setNow] = useState(0);
  const [start] = useState(() => performance.now());
  const end = duration(targets);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now() - start;
      setNow(t);
      if (t >= end) onDone(clicks.current);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const up = targets.filter((t) => now >= t.appearAt && now <= t.appearAt + t.ttl);
  const hit = hits(targets, clicks.current);
  return (
    <div className="drill-wrap">
      <div className="drill-head">
        <span>
          {hit} / {targets.length} hits · +{points(hit)}
        </span>
        <span>{Math.max(0, Math.ceil((end - now) / 1000))}s</span>
      </div>
      <div
        ref={field}
        className="drill"
        style={{ aspectRatio: `${FIELD.w} / ${FIELD.h}` }}
        onPointerDown={(e) => {
          const box = field.current!.getBoundingClientRect();
          clicks.current.push({
            t: Math.round(performance.now() - start),
            x: Math.round(((e.clientX - box.left) / box.width) * FIELD.w),
            y: Math.round(((e.clientY - box.top) / box.height) * FIELD.h),
          });
        }}
        role="application"
        aria-label="Training drill: click the targets as they appear"
      >
        {up.map((t) => (
          <span
            key={t.appearAt}
            className="target"
            style={{
              left: `${((t.x - t.r) / FIELD.w) * 100}%`,
              top: `${((t.y - t.r) / FIELD.h) * 100}%`,
              width: `${((2 * t.r) / FIELD.w) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

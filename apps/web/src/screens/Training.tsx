import { useEffect, useRef, useState } from "react";
import { type Click, type Drill as DrillT, FIELD, GOAL, LANES, PASSER, ballOut, drill, hits, keeperX, laneAt, mateAt, outcomes, points } from "../../../relay/src/drill.js";
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
    return (
      <Drill
        d={run.drill}
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
              Paid: {HOW[ticket.skill]} 90% of the rounds give 3 points, 70% give 2, 50% give 1. It gets harder as the skill rises.
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

const HOW: Record<string, string> = {
  shooting: "a penalty session. Click a spot in the goal; the keeper dives after a moment, so wait to read him, but not too long.",
  physical: "a penalty session. Click a spot in the goal; the keeper dives after a moment, so wait to read him, but not too long.",
  passing: "through balls. Click where the pass should go: in front of your running teammate, away from the defenders.",
  dribbling: "a slalom. Click to switch side and pass each cone on the free side.",
  pace: "a slalom at speed. Click to switch side and pass each cone on the free side.",
  defending: "tackles. Click when the attacker pushes the ball away from his feet (the ball turns green).",
};

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** A drill on a pitch: what to do depends on the skill (see drill.ts). Clicks are recorded for the relay. */
function Drill({ d, onDone }: { d: DrillT; onDone: (clicks: Click[]) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const clicks = useRef<Click[]>([]);
  const [t, setT] = useState(0);
  const [start] = useState(() => performance.now());

  useEffect(() => {
    field.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    const tick = () => {
      const now = performance.now() - start;
      setT(now);
      if (now >= d.end) onDone(clicks.current);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const res = outcomes(d, clicks.current);
  const doneRounds = (d.rounds as { start?: number; at?: number; window?: number }[]).filter((r) => (r.at ?? r.start! + r.window!) < t).length;
  const hit = res.slice(0, doneRounds).filter(Boolean).length;
  const title = { penalties: "Penalties", passes: "Through balls", slalom: "Slalom", tackles: "Tackles" }[d.game];
  return (
    <div className="drill-wrap">
      <div className="drill-head">
        <span>
          {title} · {hit} / {d.rounds.length} · +{points(hit, d.rounds.length)}
        </span>
        <span>{Math.max(0, Math.ceil((d.end - t) / 1000))}s</span>
      </div>
      <div
        ref={field}
        className={`drill ${d.game}`}
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
        aria-label={`Training drill: ${title}`}
      >
        <Scene d={d} t={t} clicks={clicks.current} res={res} />
      </div>
    </div>
  );
}

function Scene({ d, t, clicks, res }: { d: DrillT; t: number; clicks: Click[]; res: boolean[] }) {
  const at = (x: number, y: number) => ({ left: pct(x, FIELD.w), top: pct(y, FIELD.h) });
  if (d.game === "penalties") {
    const i = d.rounds.findIndex((k) => t < k.start + k.window + 900);
    const k = d.rounds[Math.max(0, i)]!;
    const shot = clicks.find((c) => c.t >= k.start + 120 && c.t <= k.start + k.window);
    const flight = shot ? Math.min(1, (t - shot.t) / 380) : 0;
    const ball = shot ? { x: 500 + (shot.x - 500) * flight, y: 520 + (shot.y - 520) * flight } : { x: 500, y: 520 };
    const over = shot && flight >= 1;
    return (
      <>
        <span className="goal-frame" style={{ ...at(GOAL.left, GOAL.top), width: pct(GOAL.right - GOAL.left, FIELD.w), height: pct(GOAL.bottom - GOAL.top, FIELD.h) }} />
        <span className="pen-spot" style={at(500, 520)} />
        <span className={`keeper${t >= k.diveAt ? (k.diveX < 500 ? " dive left" : " dive right") : ""}`} style={{ ...at(keeperX(k, t), GOAL.bottom - 4), width: pct(190, FIELD.w) }}>
          <svg viewBox="0 0 190 150" aria-hidden="true">
            <path d="M20 40 L70 70 M170 40 L120 70" stroke="#F2B705" strokeWidth="16" strokeLinecap="round" />
            <circle cx="16" cy="36" r="13" fill="#fffaf0" stroke="#1B2340" strokeWidth="4" />
            <circle cx="174" cy="36" r="13" fill="#fffaf0" stroke="#1B2340" strokeWidth="4" />
            <rect x="66" y="56" width="58" height="60" rx="14" fill="#F2B705" stroke="#1B2340" strokeWidth="5" />
            <circle cx="95" cy="36" r="20" fill="#C68B5E" stroke="#1B2340" strokeWidth="4" />
            <path d="M76 116 L70 148 M114 116 L120 148" stroke="#1B2340" strokeWidth="14" strokeLinecap="round" />
          </svg>
        </span>
        <span className="d-ball" style={at(ball.x, ball.y)} />
        {over && i >= 0 && <span className={`verdict ${res[i] ? "ok" : "no"}`}>{res[i] ? "GOAL!" : "SAVED"}</span>}
        {!shot && t >= k.start && t <= k.start + k.window && <span className="hint">Shoot!</span>}
      </>
    );
  }
  if (d.game === "passes") {
    const i = d.rounds.findIndex((p) => t < p.start + p.window + 800);
    const p = d.rounds[Math.max(0, i)]!;
    const mate = mateAt(p, Math.max(p.start, t));
    const pass = clicks.find((c) => c.t >= p.start + 120 && c.t <= p.start + p.window);
    const flight = pass ? Math.min(1, ((t - pass.t) * 1.3) / Math.hypot(pass.x - PASSER.x, pass.y - PASSER.y)) : 0;
    const ball = pass ? { x: PASSER.x + (pass.x - PASSER.x) * flight, y: PASSER.y + (pass.y - PASSER.y) * flight } : PASSER;
    return (
      <>
        {p.defenders.map((df, n) => (
          <span key={n} className="d-player red" style={at(df.x, df.y)} />
        ))}
        <span className="d-player blue" style={at(mate.x, mate.y)} />
        <span className="d-player blue you" style={at(PASSER.x, PASSER.y + 20)} />
        <span className="d-ball" style={at(ball.x, ball.y)} />
        {pass && flight >= 1 && i >= 0 && <span className={`verdict ${res[i] ? "ok" : "no"}`}>{res[i] ? "ON HIS FEET" : "CUT OUT"}</span>}
      </>
    );
  }
  if (d.game === "slalom") {
    const lane = laneAt(clicks, t);
    const speed = 0.35; // field units per ms on screen
    return (
      <>
        <span className="lane-line" style={{ left: "50%" }} />
        {d.rounds.map((c, n) => {
          const y = 500 - (c.at - t) * speed;
          if (y < -40 || y > 640) return null;
          return <span key={n} className={`cone${t > c.at ? (res[n] ? " passed" : " hit") : ""}`} style={at(LANES[c.side], y)} />;
        })}
        <span className="d-player blue you" style={at(LANES[lane], 500)} />
        <span className="d-ball small" style={at(LANES[lane] + 18, 480)} />
      </>
    );
  }
  const i = d.rounds.findIndex((r) => t < r.start + r.window + 700);
  const duel = d.rounds[Math.max(0, i)]!;
  const p = Math.min(1, Math.max(0, (t - duel.start) / duel.window));
  const y = 80 + p * 340;
  const out = ballOut(duel, t);
  const tried = clicks.find((c) => c.t >= duel.start + 120 && c.t <= duel.start + duel.window);
  return (
    <>
      <span className="d-player red" style={at(500, y)} />
      <span className={`d-ball${out >= duel.need ? " free" : ""}`} style={at(500, y + 30 + out * 90)} />
      <span className="d-player blue you" style={at(500, 520)} />
      {tried && i >= 0 && t > tried.t + 200 && <span className={`verdict ${res[i] ? "ok" : "no"}`}>{res[i] ? "CLEAN TACKLE" : "FOUL!"}</span>}
    </>
  );
}

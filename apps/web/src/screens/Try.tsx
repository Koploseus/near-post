import { lazy, Suspense, useState } from "react";
import { goals, penalties, penaltySetup, type PenaltySetup, type Press } from "../../../relay/src/penalty.js";

/** three.js is only loaded by those who play. */
const PenaltyGame3D = lazy(() => import("./Penalty3D.js").then((m) => ({ default: m.PenaltyGame3D })));

const seed = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Try the game without an account: five penalties in 3D against the keeper
 * of a level-50 footballer. Nothing is sent: the same rules as the training
 * drill, which in the game is paid, replayed by the relay and signed.
 */
export function Try() {
  const [setup, setSetup] = useState<PenaltySetup | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const play = () => {
    setScore(null);
    setSetup(penaltySetup(seed(), 50));
  };
  const done = (s: PenaltySetup) => (trace: Press[]) => {
    setScore(goals(penalties(s, trace)));
    setSetup(null);
  };

  return (
    <div className="try">
      <header className="try-head">
        <span className="eyebrow">TRY IT · NO ACCOUNT</span>
        <h1>Take five penalties</h1>
        <p className="sub">The shooting drill of NEAR Post. In the game, every point you score here trains your footballer.</p>
      </header>
      {setup ? (
        <Suspense fallback={<div className="pen3d-loading">Warming up…</div>}>
          <PenaltyGame3D key={setup.kicks[0]!.phase} setup={setup} onDone={done(setup)} />
        </Suspense>
      ) : (
        <div className="panel paper try-card">
          {score === null ? (
            <>
              <span className="k">HOW TO SHOOT</span>
              <p>Press on the ball, drag to where you aim, release. A firm swipe beats the keeper; a flick drifts, a slow shot gives him time.</p>
            </>
          ) : (
            <>
              <span className="k">FULL TIME</span>
              <p className="big-score">
                <strong>{score} / 5</strong> {score >= 4 ? "Ice cold." : score >= 2 ? "Not bad. Again?" : "The keeper wins this one."}
              </p>
              <p>In the game, a drill like this one costs 400k G and gives your footballer up to +3 in the skill you train.</p>
            </>
          )}
          <div className="try-actions">
            <button className="cta" onClick={play}>
              {score === null ? "KICK OFF" : "PLAY AGAIN"}
            </button>
            <a className="cta ghost" href="#/locker">
              CREATE MY FOOTBALLER
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

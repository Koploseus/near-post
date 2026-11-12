/**
 * How an agent plays a drill: he produces presses and releases like a person
 * would, from what a person sees on the screen (the runs of the teammate and
 * the defenders, the attacker's cut once it starts, the GO of a race), with
 * hands as good as he is rated. He is not shown what the seed hides (the
 * keeper's guess, the shot's drift, which way a feint ends).
 *
 * His trace then goes through the same replay as anyone's (drill.ts): the
 * score is what the game gives it, not a number drawn for him.
 */

import { type Click, type Drill, replay } from "../drill.js";
import { PASSER, SCREEN, mateAt, passes, sprints } from "../games.js";
import { BALL, penalties, toScreen } from "../penalty.js";

/** `roll` gives numbers in [0, 1). */
type Roll = () => number;

/** Hands: 0 (rated 30 or less) to 1 (rated 90 or more). */
const hands = (rating: number) => Math.min(1, Math.max(0, (rating - 30) / 60));
/** A number around `mid`, `spread` either way. */
const about = (roll: Roll, mid: number, spread: number) => mid + (roll() * 2 - 1) * spread;
/** How long he takes to react to what he sees, in ms: 170 for the best hands, 330 for the worst, 70 either way. */
const reaction = (q: number, roll: Roll) => Math.max(90, about(roll, 330 - 160 * q, 70));
/** Now and then he switches off for a round, less often with better hands. */
const lapse = (q: number, roll: Roll) => roll() < 0.06 + 0.16 * (1 - q);

const swipe = (t: number, ms: number, from: { x: number; y: number }, to: { x: number; y: number }): Click[] => {
  const inside = (p: { x: number; y: number }) => ({ x: Math.min(SCREEN.w, Math.max(0, Math.round(p.x))), y: Math.min(SCREEN.h, Math.max(0, Math.round(p.y))) });
  return [
    { t: Math.round(t), ...inside(from) },
    { t: Math.round(t + ms), ...inside(to), up: true },
  ];
};

/** The presses and releases of one drill, played by hands rated `rating` (1 to 99). */
export function play(d: Drill, rating: number, roll: Roll = Math.random): Click[] {
  const q = hands(rating);
  const out: Click[] = [];
  switch (d.game) {
    case "penalties": {
      // Each kick: a moment to breathe, then a firm shot at a corner, more or less well placed.
      for (let k = 0; k < d.setup.kicks.length; k++) {
        const start = penalties(d.setup, out)[k]!.start;
        const side = roll() < 0.5 ? -1 : 1;
        // Better hands place it nearer the corner and hit it harder, which leaves the keeper less time.
        const aim = toScreen(side * about(roll, 2.2 + 0.4 * q, 1.4 * (1 - q) + 0.2), about(roll, 1.0 + 0.5 * q, 0.9 * (1 - q) + 0.2));
        out.push(...swipe(start + about(roll, 1_300, 500), about(roll, 330 - 150 * q, 40), BALL, aim));
      }
      return out;
    }
    case "passes": {
      // Each round: he waits for the run, then plays the ball to where his teammate will be, as well as his hands allow.
      for (let k = 0; k < d.setup.length; k++) {
        const round = d.setup[k]!;
        const start = passes(d.setup, out)[k]!.start;
        const ms = about(roll, 240, 50);
        let best: Click[] | null = null;
        if (lapse(q, roll)) continue;
        // Poorer hands look less before they play: sometimes the first run they see, cut out or not.
        const blind = roll() < 0.5 * (1 - q);
        for (let wait = 500; wait <= 4_500 && !best; wait += 250) {
          const t = start + wait;
          // Where the teammate will be when the ball gets there: two passes of the estimate are enough.
          let to = mateAt(round.mate, t + ms - start);
          for (let i = 0; i < 3; i++) {
            const dist = Math.hypot(to.x - PASSER.x, to.y - PASSER.y);
            const power = Math.min(1, Math.max(0, (dist / Math.max(50, ms) - 0.25) / 1.5));
            to = mateAt(round.mate, t + ms + dist / (0.45 + 0.85 * power) - start);
          }
          const tried = swipe(t, ms, PASSER, to);
          // He sees the defenders' runs like anyone: he does not play a pass that is plainly cut out.
          if (blind || passes(d.setup, [...out, ...tried])[k]!.pass?.result === "received") best = swipe(t, ms, PASSER, { x: about(roll, to.x, 55 * (1 - q) + 16), y: about(roll, to.y, 55 * (1 - q) + 16) });
        }
        if (best) out.push(...best);
      }
      return out;
    }
    case "dribble": {
      // Each defender: he steps out of the lane once the man commits, as fast as he reacts.
      let lane = 0;
      for (const c of d.setup) {
        if (lapse(q, roll)) continue;
        const to = lane === 0 ? (roll() < 0.5 ? -1 : 1) : 0;
        const t = c.commitAt + reaction(q, roll) - 40;
        out.push(...swipe(t, 70, { x: 500, y: 400 }, { x: 500 + (to - lane) * 90, y: 400 }));
        lane = to;
      }
      return out;
    }
    case "sprint": {
      // Each race: off at GO after his reaction, left and right in turn, at the pace of his hands; a tired stride now and then.
      for (let k = 0; k < d.setup.length; k++) {
        const race = sprints(d.setup, out)[k]!;
        let t = race.go + reaction(q, roll);
        let side = roll() < 0.5 ? -1 : 1;
        const stride = 126 - 28 * q;
        for (let n = 0; n < 60 && t < race.go + 8_500; n++) {
          if (roll() < 0.02 + 0.05 * (1 - q)) side = -side; // the same foot twice: a stumble
          out.push({ t: Math.round(t), x: side < 0 ? 250 : 750, y: 450 });
          side = -side;
          t += about(roll, stride, 28);
        }
      }
      return out;
    }
    case "tackles": {
      // Each duel: he goes when he sees the cut. A feint can send him the wrong way, less often with better hands.
      for (const duel of d.setup) {
        if (lapse(q, roll)) continue;
        const fooled = duel.feintAt !== null && roll() < 0.55 * (1 - q) + 0.1;
        const t = fooled ? duel.feintAt! + reaction(q, roll) : duel.cutAt + reaction(q, roll) - 80;
        const side = fooled ? -duel.side : duel.side;
        out.push(...swipe(t - 70, 70, { x: 500, y: 400 }, { x: 500 + side * 90, y: 400 }));
      }
      return out;
    }
  }
}

/** A drill played by an agent: his trace, and what the game's own replay makes of it. */
export function played(d: Drill, rating: number, roll: Roll = Math.random): { clicks: Click[]; hits: number; rounds: number } {
  const clicks = play(d, rating, roll).sort((a, b) => a.t - b.t);
  const won = replay(d, clicks).won;
  return { clicks, hits: won.filter(Boolean).length, rounds: won.length };
}

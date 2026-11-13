import { SPOTS } from "./pitch.js";
import type { EventKind, Formation, MatchEvent } from "./types.js";

/**
 * The live pitch, drawn from the match's own events. The contract records
 * the moments that matter (shots, corners, fouls, cards, set pieces), each
 * with its second, its side and the player's slot; this module builds the
 * ball's path through them: a build-up toward each shot by the side that
 * takes it, the shot itself from the shooter's feet, the ball in the net or
 * in the keeper's hands, the corner from the flag, the free kick from where
 * the foul was. Between events the side that will act next has the ball, so
 * what is drawn leads to what happened. Both elevens follow the ball as
 * blocks; the keepers stay in their goal.
 *
 * Coordinates: x 0 to 100 from the home goal to the away goal (home attacks
 * to the right), y 0 to 100 across. Seconds are match seconds.
 */

export type V = [number, number];
export type Side = 0 | 1;

export interface Key {
  t: number;
  ball: V;
  /** Who has the ball (or will take the set piece). */
  side: Side;
  /** The player on the ball, by slot. */
  carrier?: number;
  /** The ball is dead (a goal, a foul, a set piece being placed). */
  dead?: boolean;
  /** The set piece being placed: the elevens line up for it. */
  set?: "corner" | "penalty" | "free_kick";
}

/** A small deterministic noise from a number (no Math.random: every viewer sees the same). */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** How far a player with the ball gets in a match second, in pitch units (about 14 a second on the screen). */
const REACH = 3;

/** `d` from the goal side `s` attacks (side 0 attacks x = 100). */
const ahead = (s: Side, d: number) => (s === 0 ? 100 - d : d);
const clampY = (y: number) => Math.min(96, Math.max(4, y));

/** The keys of one half, in time order. `events` are that half's, in order. */
export function keyframes(events: MatchEvent[], start: number, end: number, kickOff: Side): Key[] {
  const keys: Key[] = [{ t: start, ball: [50, 50], side: kickOff, dead: true }];
  const last = () => keys[keys.length - 1]!;
  /** What follows an event (a goal kick, the walk back to the centre) is over before the next event starts. */
  let bound = end;
  const push = (k: Key) => {
    if (k.t > bound) k = { ...k, t: bound };
    if (k.t < last().t) k = { ...k, t: last().t };
    keys.push({ ...k, ball: [Math.min(100, Math.max(0, k.ball[0])), clampY(k.ball[1])] });
  };

  /** Open play from the last key to `t`, the ball moving toward `toward` for side `s` (and lost on the way when long). */
  const play = (t: number, s: Side, to: V) => {
    const from = last();
    const gap = t - from.t;
    if (gap <= 6) return;
    // A long spell: the other side has it for a while first.
    if (gap > 150) {
      const o = (1 - s) as Side;
      const mid = from.t + gap * 0.45;
      play(mid, o, [ahead(o, 40 + noise(mid) * 15), 20 + noise(mid + 1) * 60]);
    }
    const f = last();
    const n = Math.max(1, Math.min(6, Math.round((t - f.t) / 25)));
    for (let i = 1; i <= n; i++) {
      const at = f.t + ((t - f.t) * i) / (n + 1);
      const p = i / (n + 1);
      // Passes: forward overall, side to side on the way.
      const x = f.ball[0] + (to[0] - f.ball[0]) * p;
      const y = f.ball[1] + (to[1] - f.ball[1]) * p + (noise(at) - 0.5) * 34;
      push({ t: at, ball: [x, y], side: s });
    }
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const t = e.second;
    const s: Side = e.home ? 0 : 1;
    const k: EventKind = e.kind;
    const y0 = 30 + noise(t) * 40;
    const next = events[i + 1];
    const soon = next ? next.second - t : end - t;
    bound = Math.max(t + 0.5, t + soon - 4);
    /** The next event is a shot by `side`, within twenty match seconds. */
    const shotNext = (side: Side) => !!next && soon < 20 && (next.kind === "goal" || next.kind === "saved" || next.kind === "missed") && (next.home ? 0 : 1) === side;
    switch (k) {
      case "goal":
      case "saved":
      case "missed": {
        const fromSetPiece = last().dead && t - last().t <= 3;
        if (!fromSetPiece) {
          const before = keys.length;
          play(t - 3, s, [ahead(s, 22), y0]);
          // The shooter is in the move from the pass before: he does not appear at the ball at the last second.
          for (let j = Math.max(before, keys.length - 2); j < keys.length; j++) if (keys[j]!.side === s && t - keys[j]!.t < 60) keys[j] = { ...keys[j]!, carrier: e.player };
          // He shoots from where he can have got to: the match runs four and a half times faster than the picture, and a
          // man with the ball covers about three units a match second. With little time since the last key, it is a long shot.
          const from = last();
          const reach = Math.max(0, t - 2 - from.t) * REACH;
          const far = Math.abs(from.ball[0] - ahead(s, 0));
          const d = Math.max(13 + noise(t + 2) * 8, Math.min(38, far - reach));
          const y = from.ball[1] + Math.max(-reach * 0.6, Math.min(reach * 0.6, y0 - from.ball[1]));
          push({ t: t - 2, ball: [ahead(s, d), y], side: s, carrier: e.player });
        }
        if (k === "goal") {
          push({ t, ball: [ahead(s, -0.5), 46 + noise(t + 3) * 8], side: s, dead: true });
          push({ t: t + 35, ball: [ahead(s, -0.5), 50], side: s, dead: true });
          push({ t: t + 45, ball: [50, 50], side: (1 - s) as Side, dead: true });
        } else if (k === "saved") {
          push({ t, ball: [ahead(s, 3), 46 + noise(t + 4) * 8], side: (1 - s) as Side, carrier: 0 });
          if (shotNext(s)) {
            // Parried: the ball comes back out to the side that shot, and it shoots again.
            push({ t: t + 2, ball: [ahead(s, 11 + noise(t + 13) * 5), 36 + noise(t + 14) * 28], side: s, carrier: next!.player });
          } else if (events[i + 1]?.kind !== "corner") {
            push({ t: t + 10, ball: [ahead(s, 4), 50], side: (1 - s) as Side, carrier: 0 });
            push({ t: t + 16, ball: [ahead(s, 50), 25 + noise(t + 5) * 50], side: (1 - s) as Side });
          }
        } else {
          push({ t, ball: [ahead(s, -1), noise(t + 6) < 0.5 ? 34 : 66], side: (1 - s) as Side, dead: true });
          if (shotNext(s)) {
            // Off a defender and back to them: they go again at once.
            push({ t: t + 2, ball: [ahead(s, 14 + noise(t + 15) * 6), 30 + noise(t + 16) * 40], side: s, carrier: next!.player });
          } else if (events[i + 1]?.kind !== "corner") {
            push({ t: t + 12, ball: [ahead(s, 6), 50], side: (1 - s) as Side, carrier: 0, dead: true });
            push({ t: t + 17, ball: [ahead(s, 52), 25 + noise(t + 7) * 50], side: (1 - s) as Side });
          }
        }
        break;
      }
      case "own_goal": {
        // Credited to `s`: the ball goes into the other side's net, off a defender.
        play(t - 2, s, [ahead(s, 10), 50]);
        push({ t, ball: [ahead(s, -0.5), 50], side: s, dead: true });
        push({ t: t + 35, ball: [ahead(s, -0.5), 50], side: s, dead: true });
        push({ t: t + 45, ball: [50, 50], side: (1 - s) as Side, dead: true });
        break;
      }
      case "corner": {
        const top = noise(t + 8) < 0.5;
        push({ t, ball: [ahead(s, 0.5), top ? 1 : 99], side: s, carrier: e.player, dead: true, set: "corner" });
        push({ t: t + 4, ball: [ahead(s, 0.5), top ? 1 : 99], side: s, carrier: e.player, dead: true, set: "corner" });
        push({ t: t + 6, ball: [ahead(s, 8), 44 + noise(t + 9) * 12], side: s });
        break;
      }
      case "foul": {
        // `home` is the side that fouled: the other side had the ball here.
        const victim = (1 - s) as Side;
        play(t, victim, [ahead(victim, 35 + noise(t + 10) * 25), y0]);
        const at = last().ball;
        push({ t: t + 0.5, ball: at, side: victim, dead: true });
        const next = events[i + 1];
        const setPiece = next && (next.kind === "penalty" || next.kind === "free_kick");
        if (!setPiece) push({ t: t + 18, ball: at, side: victim, dead: true });
        break;
      }
      case "yellow":
      case "red": {
        const at = last().ball;
        push({ t: t + 6, ball: at, side: last().side, dead: true });
        break;
      }
      case "penalty": {
        // The ball is on the spot as soon as the foul is given: the taker and the others have the time to get there.
        push({ t: Math.min(t - 12, last().t + 2), ball: [ahead(s, 11), 50], side: s, carrier: e.player, dead: true, set: "penalty" });
        push({ t, ball: [ahead(s, 11), 50], side: s, carrier: e.player, dead: true, set: "penalty" });
        break;
      }
      case "tackle": {
        // `home` is the tackler's side: the other side was running at him.
        const runner = (1 - s) as Side;
        play(t, runner, [ahead(runner, 30 + noise(t + 12) * 35), y0]);
        push({ t: t + 1, ball: last().ball, side: s, carrier: e.player });
        break;
      }
      case "assist":
        break; // drawn with its goal
      case "free_kick": {
        const y = 32 + noise(t + 11) * 36;
        push({ t: Math.min(t - 12, last().t + 2), ball: [ahead(s, 24), y], side: s, carrier: e.player, dead: true, set: "free_kick" });
        push({ t, ball: [ahead(s, 24), y], side: s, carrier: e.player, dead: true, set: "free_kick" });
        break;
      }
    }
  }
  // After the last event: open play to the whistle.
  bound = end;
  let t = last().t;
  let s = last().side;
  while (end - t > 60) {
    const to = t + 60 + noise(t) * 60;
    play(Math.min(end, to), s, [ahead(s, 30 + noise(to) * 30), 20 + noise(to + 1) * 60]);
    s = (1 - s) as Side;
    t = last().t;
  }
  push({ t: end, ball: last().ball, side: last().side, dead: true });
  return keys;
}

/** The ball at second `s`: between two keys, eased. */
export function frameAt(keys: Key[], s: number): Key {
  if (!keys.length) return { t: s, ball: [50, 50], side: 0, dead: true };
  if (s <= keys[0]!.t) return keys[0]!;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (s < b.t) {
      const a = keys[i - 1]!;
      const p = (s - a.t) / Math.max(0.001, b.t - a.t);
      const q = p * p * (3 - 2 * p);
      const ball: V = [a.ball[0] + (b.ball[0] - a.ball[0]) * q, a.ball[1] + (b.ball[1] - a.ball[1]) * q];
      // Between two keys the ball is still the leaving side's (a pass, a shot on its way).
      const k: Key = { t: s, ball, side: a.side };
      const carrier = a.carrier;
      if (carrier !== undefined) k.carrier = carrier;
      if (a.dead && b.dead) k.dead = true;
      if (a.set && a.set === b.set) k.set = a.set;
      return k;
    }
  }
  return keys[keys.length - 1]!;
}

export interface Shape {
  /**
   * How much the side is attacking, 0 to 1. By default 1 for the side on the
   * ball and 0 for the other; the live pitch eases it over a second or so, so
   * that a block does not jump when the ball changes feet.
   */
  attack?: number;
  /**
   * The ball is on the centre spot and play is stopped: both elevens are in
   * their own half and the side without the ball stays out of the centre
   * circle. "kickoff": the side on the ball has a man on it. "rest": nobody
   * has it (before the match, at half-time, after the whistle).
   */
  restart?: "kickoff" | "rest";
  /** A set piece is being placed (the key's `set`): the elevens line up for it. */
  set?: "corner" | "penalty" | "free_kick";
  /** Where the eleven reads the play to be: the ball a moment ago (the live pitch follows it with a short delay). By default, the ball. */
  block?: V;
  /** The slot that went to the ball (or pressed) last time: he keeps going unless another is clearly nearer. */
  prefer?: number;
}

const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const within = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));

/** The slot nearest to a point, with a head start for the one who was going already. */
function nearest(out: V[], x: number, y: number, prefer?: number): number {
  let best = 1;
  let d = Infinity;
  for (let k = 1; k < 11; k++) {
    const dd = Math.hypot(out[k]![0] - x, out[k]![1] - y) - (k === prefer ? 5 : 0);
    if (dd < d) (d = dd), (best = k);
  }
  return best;
}

/**
 * Where the eleven of `side` stand when the ball is at `ball` and `possession`
 * has it: the formation as a block around the play, wider when attacking.
 * The side on the ball has its forwards ahead of it; the other side is goal
 * side of the ball, its back line between the ball and its goal. The keeper
 * is in his goal; the player on the ball is on it.
 */
export function positions(formation: Formation, side: Side, ball: V, possession: Side, carrier?: number, shape: Shape = {}): V[] {
  // Work as if attacking to the right, then turn the result for the away side.
  const bx = side === 0 ? ball[0] : 100 - ball[0];
  const by = side === 0 ? ball[1] : 100 - ball[1];
  const has = possession === side;
  const att = within(0, 1, shape.attack ?? (has ? 1 : 0));
  const spots = SPOTS[formation];
  /** How far up the pitch a slot plays, 0 (back line) to 1 (front line). */
  const rank = (sy: number) => within(0, 1, (76 - sy) / 62);
  const turn = (out: V[]): V[] => (side === 0 ? out : out.map(([x, y]) => [100 - x, 100 - y] as V));

  if (shape.restart) {
    // Everyone in his own half; without the ball, behind the centre circle.
    const kicking = shape.restart === "kickoff" && has;
    const front = kicking ? 46 : 38;
    const out: V[] = spots.map(([sx, sy], k) => (k === 0 ? [3, 50] : [mix(12, front, rank(sy)), clampY(50 + (100 - sx - 50) * 0.86)]));
    if (kicking) {
      // The one who plays highest and most central takes it, a team-mate beside him.
      const order = [...Array(10).keys()].map((i) => i + 1).sort((a, b) => out[b]![0] - Math.abs(out[b]![1] - 50) * 0.3 - (out[a]![0] - Math.abs(out[a]![1] - 50) * 0.3));
      const taker = carrier !== undefined && carrier > 0 && carrier < 11 ? carrier : order[0]!;
      const mate = order.find((k) => k !== taker)!;
      out[taker] = [48.8, 51.5];
      out[mate] = [47.5, 60];
    }
    return turn(out);
  }

  // The block is placed around where the play is (`shape.block`: the ball, or the ball as the eleven has read it).
  const gx = shape.block ? (side === 0 ? shape.block[0] : 100 - shape.block[0]) : bx;
  const gy = shape.block ? (side === 0 ? shape.block[1] : 100 - shape.block[1]) : by;
  // Attacking: the back line some way behind the ball, the forwards ahead of it, never past the last defender's line.
  // Defending: goal side of the ball, the back line between it and the goal, down to the edge of the six-yard box.
  const back = mix(within(7, 46, gx - 22), within(18, 62, gx - 26), att);
  const front = mix(within(24, 70, gx + 8), within(46, 92, gx + 20), att);
  const width = mix(0.66, 0.9, att);
  const lean = mix(0.3, 0.2, att);
  const out: V[] = spots.map(([sx, sy], k) => {
    // The keeper comes off his line a little when his side is camped up the pitch.
    if (k === 0) return [3 + within(0, 5, (gx - 45) * 0.12), 50 + (by - 50) * 0.12];
    return [mix(back, front, rank(sy)), clampY(50 + (100 - sx - 50) * width + (gy - 50) * lean)];
  });
  if (shape.set) {
    const taker = has ? (carrier !== undefined && carrier > 0 && carrier < 11 ? carrier : nearest(out, bx, by)) : -1;
    // The others, the ones who play highest first.
    const rest = [...Array(10).keys()].map((i) => i + 1).filter((k) => k !== taker).sort((a, b) => rank(spots[b]![1]) - rank(spots[a]![1]) || a - b);
    const near = by < 50 ? 1 : -1; // towards the ball's side of the pitch
    const place = (list: V[]) => rest.forEach((k, i) => list[i] && (out[k] = [list[i]![0], clampY(list[i]![1])]));
    if (shape.set === "corner") {
      if (has) {
        out[taker] = [98.5, by < 50 ? 2.5 : 97.5];
        // Five in the box, two on its edge, two who stay back.
        place([[89, 44], [93, 58], [86, 66], [95, 36], [88, 54], [80, 40], [79, 62], [62, 36], [60, 64]]);
      } else {
        // The box is packed; one on the near post, one on the edge, one left up the pitch.
        out[0] = [1.5, 50 - near * 3];
        place([[42, 50], [21, 52], [3, 50 - near * 9], [4, 47], [9, 60], [13, 40], [7, 34], [14, 51], [10, 68], [5, 56]]);
      }
    } else if (shape.set === "penalty") {
      // Everyone but the taker and the keeper outside the box, behind the ball.
      if (has) {
        out[taker] = [bx - 2.5, by + 0.5];
        place([[77, 28], [77, 72], [75, 40], [75, 60], [73, 50], [74, 16], [74, 84], [62, 42], [50, 55]]);
      } else {
        out[0] = [1, 50];
        // (Between the attackers along the edge of the box, not on top of them.)
        place([[44, 50], [34, 38], [34, 62], [20, 22], [20, 78], [19.5, 34], [19.5, 66], [19.5, 45], [19.5, 55], [26, 50]]);
      }
    } else if (has) {
      out[taker] = [bx - 2, by + 0.8];
    } else {
      // A wall of four, ten yards from the ball, between it and the goal.
      const wx = Math.max(6, bx - 9);
      const four = [...rest].sort((a, b) => Math.hypot(out[a]![0] - wx, out[a]![1] - by) - Math.hypot(out[b]![0] - wx, out[b]![1] - by)).slice(0, 4);
      const lean = (50 - by) * 0.18;
      four.forEach((k, i) => (out[k] = [wx, clampY(by + lean + (i - 1.5) * 2.6)]));
    }
    return turn(out);
  }
  if (has) {
    // The man named is on the ball; nobody named: the nearest outfield player goes to it.
    const k = carrier !== undefined && carrier > 0 && carrier < 11 ? carrier : nearest(out, bx, by, shape.prefer);
    out[k] = [bx - 1.2, by + 1.5];
  } else {
    // Out of possession: one presses, goal side of the ball.
    out[nearest(out, bx, by, shape.prefer)] = [bx - 4, by - 3];
  }
  return turn(out);
}

/** The slot of `side` that is at the ball in `out` (on it, or pressing): what to hand back as `prefer` next time. */
export function atBall(out: V[], ball: V): number {
  let best = 1;
  let d = Infinity;
  for (let k = 1; k < 11; k++) {
    const dd = Math.hypot(out[k]![0] - ball[0], out[k]![1] - ball[1]);
    if (dd < d) (d = dd), (best = k);
  }
  return best;
}

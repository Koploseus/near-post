import { SPOTS } from "./pitch.js";
import type { EventKind, Formation, MatchEvent } from "./types.js";

/**
 * The live pitch, drawn from the match's own events. The contract records
 * the moments that matter (shots, corners, fouls, cards, tackles, set
 * pieces), each with its second, its side and the player's slot; this module
 * writes the football between them: who has the ball, where he takes it,
 * whom he passes to, until the ball is where the next event happens, at the
 * feet of the player the event names. A move is a chain of beats: a player
 * carries the ball a second or two, then passes it to a team-mate standing
 * where his formation puts him; the ball changes sides when a pass is cut
 * out. A shot is struck from the shooter's feet, a corner comes in from the
 * flag, a free kick is taken where the foul was.
 *
 * It is a picture only: nothing here changes a result, and every viewer sees
 * the same (no randomness but a noise seeded by the match's seconds).
 *
 * Coordinates: x 0 to 100 from the home goal to the away goal (home attacks
 * to the right), y 0 to 100 across. Seconds are match seconds; the picture
 * shows `rate` of them in a real second, and the speeds of the ball and of
 * the man carrying it are set in real seconds, so they look right on screen.
 */

export type V = [number, number];
export type Side = 0 | 1;

export interface Key {
  t: number;
  ball: V;
  /** Who has the ball (or will take the set piece). */
  side: Side;
  /** The player on the ball, by slot (0: the keeper). */
  carrier?: number;
  /** The ball is dead (a goal, a foul, a set piece being placed). */
  dead?: boolean;
  /** The set piece being placed: the elevens line up for it ("kickoff": after a goal, each goes back to its half). */
  set?: "corner" | "penalty" | "free_kick" | "kickoff";
  /** How the ball goes from this key to the next: at the carrier's feet, passed, or struck at goal. */
  move?: "carry" | "pass" | "shot";
}

/** The ball at one moment (`frameAt`). */
export interface Frame extends Key {
  /** The ball is on its way between two players (or to the goal): from where, to where, how far along (0 to 1). */
  flight?: { from: V; to: V; p: number };
  /** The one the ball is going to, or is about to be passed to, where he gets it, and in how many match seconds. */
  next?: { side: Side; k: number; at: V; in: number };
}

export interface Plan {
  /** The formations of the home and away sides in this half. By default 4-4-2. */
  formations?: [Formation, Formation];
  /** Match seconds shown in a real second. */
  rate?: number;
  /** A slot nobody plays in this half. */
  absent?: (side: Side, slot: number) => boolean;
}

/** A small deterministic noise from a number (no Math.random: every viewer sees the same). */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** `d` from the goal side `s` attacks (side 0 attacks x = 100). */
const ahead = (s: Side, d: number) => (s === 0 ? 100 - d : d);
const clampY = (y: number) => Math.min(96, Math.max(4, y));
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
const within = (lo: number, hi: number, v: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mixV = (a: V, b: V, p: number): V => [mix(a[0], b[0], p), mix(a[1], b[1], p)];
/** From `a`, `d` toward `b` (and no further than `b`). */
const toward = (a: V, b: V, d: number): V => {
  const l = dist(a, b);
  return l < 0.001 || d <= 0 ? [a[0], a[1]] : mixV(a, b, Math.min(1, d / l));
};

/** The keys of one half, in time order. `list` are that half's events. */
export function keyframes(list: MatchEvent[], start: number, end: number, kickOff: Side, plan: Plan = {}): Key[] {
  const events = [...list].sort((a, b) => a.second - b.second);
  const f = plan.formations ?? (["4-4-2", "4-4-2"] as [Formation, Formation]);
  const rate = plan.rate ?? 4.5;
  /** Real seconds, in match seconds. */
  const real = (s: number) => s * rate;
  // Pitch units a match second: a man with the ball, a pass along the ground, a long ball.
  const CARRY = 5 / rate;
  const LONG = 36 / rate;
  /** A pass along the ground: the longer, the harder it is hit. */
  const pace = (len: number) => Math.min(36, 15 + len * 0.55) / rate;

  const reds = events.filter((e) => e.kind === "red").map((e) => ({ side: e.home ? 0 : 1, k: e.player, t: e.second }));
  /** The slot is played, and its player has not been sent off. */
  const here = (side: Side, k: number, t: number) => !plan.absent?.(side, k) && !reds.some((r) => r.side === side && r.k === k && r.t <= t);
  /** Where the eleven of `side` stands with the ball at `ball` and `has` on it: the block alone, nobody sent to the ball. */
  const shape = (side: Side, ball: V, has: Side) => positions(f[side], side, ball, has, undefined, { free: true });
  /** The outfield player of `side` whose place is nearest to `p`. */
  const nearestOf = (side: Side, p: V, t: number, has: Side, except = -1) => {
    const out = shape(side, p, has);
    let best = 1;
    let d = Infinity;
    for (let k = 1; k < 11; k++) {
      if (k === except || !here(side, k, t)) continue;
      const dd = dist(out[k]!, p);
      if (dd < d) (d = dd), (best = k);
    }
    return best;
  };
  /** Who kicks off for `side`: the one the kick-off shape puts on the ball. */
  const kicker = (side: Side, t: number) => {
    const out = positions(f[side], side, [50, 50], side, undefined, { restart: "kickoff" });
    let best = 1;
    let d = Infinity;
    for (let k = 1; k < 11; k++) {
      if (!here(side, k, t)) continue;
      const dd = dist(out[k]!, [50, 50]);
      if (dd < d) (d = dd), (best = k);
    }
    return best;
  };

  const keys: Key[] = [{ t: start, ball: [50, 50], side: kickOff, carrier: kicker(kickOff, start), dead: true }];
  const last = () => keys[keys.length - 1]!;
  /** The last kick-off: when, and whose. */
  let kickoff = { t: start, side: kickOff };
  /**
   * Where the eleven of `side` is at `t`, as far as the keys so far tell: around
   * the ball where it is now, not yet stepped up if it has just won it, and
   * still coming out of its own half after a kick-off. A pass goes to where
   * a player can be, not to where he would be in a settled side.
   */
  const placed = (side: Side, t: number): V[] => {
    const cur = last();
    let i = keys.length - 1;
    while (i > 0 && keys[i - 1]!.side === cur.side) i--;
    const att = cur.side === side ? within(0, 1, (t - keys[i]!.t) / real(1.6)) : 0;
    // (The elevens follow the ball with a delay: the block is around where the ball was a moment ago.)
    const was = frameAt(keys, Math.max(start, t - real(1.3))).ball;
    const block: V = side === cur.side ? was : [side === 0 ? Math.min(was[0], cur.ball[0]) : Math.max(was[0], cur.ball[0]), was[1]];
    const out = positions(f[side], side, cur.ball, cur.side, undefined, { free: true, attack: att, block });
    const p = within(0, 1, (t - kickoff.t - real(0.7)) / real(3.5));
    if (p >= 1) return out;
    const lined = positions(f[side], side, [50, 50], kickoff.side, undefined, { restart: "kickoff" });
    return out.map((v, k) => mixV(lined[k]!, v, p));
  };
  /** The outfield player of `side` who is nearest to `p` now. */
  const closest = (side: Side, p: V, t: number, except = -1) => {
    const out = placed(side, t);
    let best = 1;
    let d = Infinity;
    for (let k = 1; k < 11; k++) {
      if (k === except || !here(side, k, t)) continue;
      const dd = dist(out[k]!, p);
      if (dd < d) (d = dd), (best = k);
    }
    return best;
  };
  /** What follows an event (a goal kick, the walk back to the centre) is over before the next event starts. */
  let bound = end;
  const push = (k: Key) => {
    if (k.t > bound) k = { ...k, t: bound };
    if (k.t < last().t) k = { ...k, t: last().t };
    keys.push({ ...k, ball: [within(0, 100, k.ball[0]), clampY(k.ball[1])] });
  };
  /** Changes the last key. */
  const tag = (patch: Partial<Key>) => {
    keys[keys.length - 1] = { ...last(), ...patch };
  };
  /** The man on the ball takes it to `ball`. */
  const carryTo = (t: number, ball: V) => {
    const c = last();
    tag({ move: "carry" });
    push({ t, ball, side: c.side, ...(c.carrier !== undefined ? { carrier: c.carrier } : {}) });
  };
  /** The ball is played to `ball`, where `carrier` of `side` gets it. */
  const passTo = (t: number, ball: V, side: Side, carrier?: number) => {
    tag({ move: "pass" });
    push({ t, ball, side, ...(carrier !== undefined ? { carrier } : {}) });
  };
  /** The same key a little later: he stands on the ball. */
  const wait = (t: number) => {
    const { move: _, ...c } = last();
    push({ ...c, t });
  };

  /**
   * Side `s` plays the ball from where it is to `to`, where it is at `until`:
   * a carry and a pass at a time, each to a team-mate standing where his
   * formation puts him, forward overall and from side to side on the way.
   * The last ball goes to `final` (by default the one whose place is there),
   * from `via` when there is time; with `lose` it is cut out by the other side.
   */
  const chain = (until: number, s: Side, to: V, o: { final?: number; via?: number; lose?: boolean } = {}) => {
    const other = (1 - s) as Side;
    let waited = false;
    /** He has just run with the ball; who gave him the ball, and from where. */
    let ran = false;
    let gave: { k: number; from: V } | null = null;
    /** The one credited with the last pass has the ball: his next ball is the last. */
    let direct = false;
    const via = o.via !== undefined && o.via > 0 && o.via !== o.final ? o.via : -1;
    for (let guard = 0; guard < 400; guard++) {
      let cur = last();
      const left = until - cur.t;
      if (left < real(0.3)) return;
      if (cur.carrier === undefined || cur.side !== s) {
        tag({ side: s, carrier: closest(s, cur.ball, cur.t) });
        cur = last();
      }
      const c = cur.carrier!;
      if (cur.dead && !waited) {
        // A dead ball: he puts it down and looks up before he plays it.
        waited = true;
        wait(cur.t + Math.min(real(0.7), left * 0.4));
        continue;
      }
      waited = true;
      const seed = cur.t * 1.37 + keys.length * 0.61;
      const dir = s === 0 ? 1 : -1;
      // The tempo: patient at the back, quick near the goal.
      const far = Math.abs(ahead(s, 0) - cur.ball[0]);
      const zone = far > 66 ? { hold: [1.2, 1.9], pace: 2.6 } : far > 36 ? { hold: [0.6, 1.5], pace: CARRY * rate } : { hold: [0.35, 0.8], pace: 5.6 };
      const n = Math.max(1, Math.round(left / real(zone.hold[0]! + zone.hold[1]! / 2 + 0.75)));
      if (n > 3 && !direct && !cur.dead && !ran && far < 72 && far > 24 && noise(seed + 4) < 0.17) {
        // He takes it on himself: a run with the ball.
        const T = real(1.8 + noise(seed + 4.5) * 1.2);
        ran = true;
        carryTo(cur.t + T, [cur.ball[0] + dir * (7 / rate) * T, clampY(cur.ball[1] + (noise(seed + 4.7) - 0.5) * 10)]);
        continue;
      }
      if (n > 1 && !direct) {
        // An ordinary beat: a step of the way, with a change of side or a ball back now and then.
        const calm = Math.min(1, (n - 1) / 3);
        // (A kick-off is played back to a midfielder.)
        const centre = !!cur.dead && dist(cur.ball, [50, 50]) < 1.5;
        // Now and then the play is switched to the other wing, or given back to the one who passed (he has run on).
        const swap = !centre && n > 2 && noise(seed + 5) < 0.14;
        const wall = !centre && !swap && n > 2 && !!gave && gave.k !== c && gave.k !== o.final && here(s, gave.k, cur.t) && noise(seed + 6) < 0.2;
        const want: V = centre
          ? [50 - (s === 0 ? 1 : -1) * (9 + noise(seed) * 5), 34 + noise(seed + 1) * 32]
          : swap
            ? [within(5, 95, cur.ball[0] + dir * (4 + noise(seed) * 8)), cur.ball[1] < 50 ? 74 + noise(seed + 1) * 14 : 12 + noise(seed + 1) * 14]
            : wall
              ? [within(5, 95, gave!.from[0] + dir * (8 + noise(seed) * 4)), clampY(gave!.from[1] + (noise(seed + 1) - 0.5) * 8)]
              : [
              within(5, 95, cur.ball[0] + (to[0] - cur.ball[0]) / n + (noise(seed) - 0.5) * 22 * calm),
                  clampY(cur.ball[1] + (to[1] - cur.ball[1]) / n + (noise(seed + 1) - 0.5) * 52 * calm),
                ];
        // Where each team-mate can be when the ball gets there: between his place now and his place with the ball there.
        const now = placed(s, cur.t);
        const then = shape(s, want, s);
        const spots = now.map((v, k) => mixV(v, then[k]!, 0.5));
        // He holds it a moment; the ball is then played into a team-mate's run, a step ahead of him and
        // no further from where he is now than he can run before it gets there.
        const hold = cur.dead ? 0 : real(wall ? 0.35 : zone.hold[0]! + noise(seed + 2) * zone.hold[1]!);
        const run = 3 + (7 / rate) * (Math.min(hold, real(1.3)) + real(0.6));
        const meet = (k: number): V => {
          const m = wall ? want : mixV(spots[k]!, want, 0.4);
          return toward(now[k]!, [within(3, 97, m[0] + (centre ? 0 : dir * 2.5)), m[1]], run);
        };
        let best = -1;
        let score = Infinity;
        // (With two balls to go, the next one goes to the one credited with the last pass.)
        if (n === 2 && via > 0 && via !== c && here(s, via, cur.t)) best = via;
        else if (wall) best = gave!.k;
        else
          for (let k = 1; k < 11; k++) {
            if (k === c || k === o.final || !here(s, k, cur.t)) continue;
            const p = meet(k);
            const len = dist(cur.ball, p);
            const sc = dist(p, want) + noise(seed + k * 7.3) * 8 + (len < 12 ? (12 - len) * 4 : 0) + (len > 36 && !swap ? len - 36 : 0);
            if (sc < score) (score = sc), (best = k);
          }
        if (best >= 0) {
          const at = meet(best);
          const from = toward(cur.ball, [cur.ball[0] + dir * 20, mix(cur.ball[1], at[1], 0.5)], Math.min((zone.pace / rate) * hold, Math.max(0, dist(cur.ball, at) - 10)));
          const flight = Math.max(real(0.35), dist(from, at) / pace(dist(from, at)));
          if (cur.t + hold + flight <= until - real(1.2)) {
            if (hold > 0) carryTo(cur.t + hold, from);
            gave = { k: c, from: last().ball };
            ran = false;
            passTo(last().t + flight, at, s, best);
            continue;
          }
        }
      }
      // The last ball of the move.
      if (!o.lose && o.final === c) {
        carryTo(until, toward(cur.ball, to, CARRY * left));
        return;
      }
      if (!o.lose && !direct && via > 0 && via !== c && here(s, via, cur.t) && left >= real(0.8)) {
        // Through the one who is credited with the last pass.
        const mid = mixV(placed(s, cur.t)[via]!, mixV(cur.ball, to, 0.5), 0.5);
        passTo(cur.t + Math.max(real(0.35), Math.min(left * 0.45, dist(cur.ball, mid) / pace(dist(cur.ball, mid)))), mid, s, via);
        direct = true;
        continue;
      }
      const len = dist(cur.ball, to);
      let flight = Math.max(real(0.35), len / pace(len));
      let hold = left - flight;
      if (hold < 0) (flight = left), (hold = 0);
      if (hold > 0.01) {
        if (cur.dead) wait(cur.t + hold);
        else carryTo(cur.t + hold, toward(cur.ball, to, Math.min(CARRY * hold * 0.6, len * 0.3)));
      }
      if (o.lose) {
        // Cut out by the one of the other side who is nearest to where it was going.
        const j = closest(other, to, cur.t);
        passTo(until, mixV(to, placed(other, cur.t)[j]!, 0.7), other, j);
      } else if (o.final !== undefined) passTo(until, to, s, o.final);
      else {
        // To the one who is nearest to there, as far that way as he can get in the time.
        const j = closest(s, to, cur.t, c);
        passTo(until, toward(placed(s, cur.t)[j]!, to, 3 + (7 / rate) * Math.min(left, real(1.9))), s, j);
      }
      return;
    }
  };

  /**
   * Open play from the last key to `until`, when side `s` has the ball at
   * `to` (at the feet of `final`, after a touch of `touch` seconds). Over a
   * long while the ball changes sides on the way, a spell each; if the other
   * side has it now, it loses it first.
   */
  const openPlay = (until: number, s: Side, to: V, o: { final?: number; via?: number; touch?: number } = {}) => {
    const cur = last();
    const touch = Math.min(o.touch ?? 0, Math.max(0, (until - cur.t) * 0.4));
    const recv = until - touch;
    const at: V = [to[0] - (s === 0 ? 1 : -1) * CARRY * touch, to[1]];
    // The spells of possession, the last one first.
    const spells: { side: Side; end: number }[] = [{ side: s, end: recv }];
    let from = recv - (55 + noise(recv) * 65);
    let side = s;
    while (from - cur.t > 40) {
      side = (1 - side) as Side;
      spells.unshift({ side, end: from });
      from -= 60 + noise(from) * 70;
    }
    if (spells[0]!.side !== cur.side) {
      const gap = spells[0]!.end - cur.t;
      spells.unshift({ side: cur.side, end: cur.t + gap * (gap > 40 ? 0.45 : 0.35) });
    }
    for (const sp of spells.slice(0, -1)) {
      const b = last().ball;
      if (sp.end - last().t < real(0.5)) {
        // No time for a pass: the ball is won off him.
        const taker = (1 - sp.side) as Side;
        push({ t: sp.end, ball: [b[0], b[1]], side: taker, carrier: closest(taker, b, last().t) });
        continue;
      }
      const tx = within(8, 92, b[0] + (sp.side === 0 ? 1 : -1) * (12 + noise(sp.end) * 28));
      chain(sp.end, sp.side, [tx, 15 + noise(sp.end + 1) * 70], { lose: true });
    }
    chain(recv, s, at, { ...(o.final !== undefined ? { final: o.final } : {}), ...(o.via !== undefined ? { via: o.via } : {}) });
    if (touch > 0 && last().side === s && until - last().t > 0.01) carryTo(until, toward(last().ball, to, CARRY * (until - last().t)));
  };

  /** A goal for `s` at `t`: the ball in the net, then on the centre spot for the other side (sooner when the next event is close). */
  const restartAfter = (t: number, s: Side, y: number) => {
    const def = (1 - s) as Side;
    const at = Math.max(t + 0.5, Math.min(t + 45, bound));
    push({ t, ball: [ahead(s, -0.5), y], side: def, dead: true, set: "kickoff" });
    push({ t: Math.max(t, at - 10), ball: [ahead(s, -0.5), 50], side: def, dead: true, set: "kickoff" });
    push({ t: at, ball: [50, 50], side: def, carrier: kicker(def, t), dead: true, set: "kickoff" });
    kickoff = { t: last().t, side: def };
  };

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const t = e.second;
    const s: Side = e.home ? 0 : 1;
    const def = (1 - s) as Side;
    const k: EventKind = e.kind;
    const y0 = 30 + noise(t) * 40;
    // (An assist is told with its goal: what comes next is the event after it.)
    const next = events.slice(i + 1).find((n) => n.kind !== "assist");
    const soon = next ? next.second - t : end - t;
    /** The next event is a shot by `side`, within twenty match seconds. */
    const shotNext = (side: Side) => !!next && soon < 20 && (next.kind === "goal" || next.kind === "saved" || next.kind === "missed") && (next.home ? 0 : 1) === side;
    bound = Math.max(t + 0.5, t + soon - (shotNext(s) ? 2 : 4));
    /**
     * How far from the goal it attacks the side that has the ball after this event is, when `base` is
     * where it would be otherwise: with a shot coming within seconds, the ball is already near the goal
     * of the side that will shoot (the match runs faster than the picture: nobody crosses the pitch in two seconds).
     */
    const before = (owner: Side, base: number) => {
      if (!next || soon > 45 || !(next.kind === "goal" || next.kind === "saved" || next.kind === "missed")) return base;
      return (next.home ? 0 : 1) === owner ? Math.min(base, 22 + soon * 1.5) : Math.max(base, 82 - soon * 0.7);
    };
    /** From where the ball is, as far toward `to` as the players can follow before `t`. */
    const reachable = (to: V): V => toward(last().ball, to, 8 + Math.max(0, t - last().t) * 2.4);
    switch (k) {
      case "goal":
      case "saved":
      case "missed": {
        const strike = t - 2;
        const lead = strike - last().t;
        const spot: V = [ahead(s, 13 + noise(t + 2) * 9), y0];
        const setPiece = !!last().dead && !!last().set && last().side === s;
        if (setPiece) {
          // Struck from where the ball was placed.
        } else if (lead >= real(0.5)) {
          // He shoots from where the ball can have got to: with little time, it is a long shot.
          const from = reachable(spot);
          const aim: V = Math.abs(from[0] - ahead(s, 0)) > 40 ? [ahead(s, 40), from[1]] : from;
          const told = events[i + 1];
          const assist = k === "goal" && told?.kind === "assist" && told.second === t && told.home === e.home ? told.player : undefined;
          openPlay(strike, s, aim, { final: e.player, touch: real(0.6), ...(assist !== undefined ? { via: assist } : {}) });
        } else if (last().side !== s || last().carrier !== e.player) {
          if (lead > 0.3 && !last().dead) passTo(strike, toward(last().ball, spot, 4 + lead * 2.4), s, e.player);
          else push({ t: last().t, ball: last().ball, side: s, carrier: e.player });
        }
        if (last().t < strike) wait(strike);
        if (last().carrier !== e.player && !setPiece) tag({ side: s, carrier: e.player });
        tag({ move: "shot" });
        if (k === "goal") {
          restartAfter(t, s, 46 + noise(t + 3) * 8);
        } else if (k === "saved") {
          push({ t, ball: [ahead(s, 3), 46 + noise(t + 4) * 8], side: def, carrier: 0 });
          if (shotNext(s)) {
            // Parried: the ball comes back out to the side that shot, and it shoots again.
            passTo(t + 2, [ahead(s, 11 + noise(t + 13) * 5), 36 + noise(t + 14) * 28], s, next!.player);
          } else if (next?.kind === "corner" && (next.home ? 0 : 1) === s) {
            // Tipped behind.
            tag({ move: "pass" });
            push({ t: t + 1.5, ball: [ahead(s, -1), noise(t + 6) < 0.5 ? 30 : 70], side: s, carrier: next.player, dead: true, set: "corner" });
          } else wait(t + 9);
        } else {
          if (shotNext(s)) {
            // Blocked, and back to them: they go again at once.
            push({ t, ball: [ahead(s, 7), 42 + noise(t + 6) * 16], side: s });
            passTo(t + 2, [ahead(s, 14 + noise(t + 15) * 6), 30 + noise(t + 16) * 40], s, next!.player);
          } else {
            // Wide: a goal kick, or a corner when it came off a defender.
            const corner = next?.kind === "corner" && (next.home ? 0 : 1) === s;
            if (corner) push({ t, ball: [ahead(s, -1), noise(t + 6) < 0.5 ? 34 : 66], side: s, carrier: next.player, dead: true, set: "corner" });
            else {
              push({ t, ball: [ahead(s, -1), noise(t + 6) < 0.5 ? 34 : 66], side: def, dead: true });
              push({ t: t + 12, ball: [ahead(s, 6), 50], side: def, carrier: 0, dead: true });
            }
          }
        }
        break;
      }
      case "own_goal": {
        // Credited to `s`: the ball goes into the other side's net, off a defender.
        if (t - 2 - last().t >= real(0.5)) openPlay(t - 2, s, [ahead(s, 12), 40 + noise(t) * 20]);
        tag({ move: "shot" });
        restartAfter(t, s, 50);
        break;
      }
      case "corner": {
        const top = last().ball[1] < 50;
        const flag: V = [ahead(s, 0.5), top ? 1 : 99];
        push({ t, ball: flag, side: s, carrier: e.player, dead: true, set: "corner" });
        const header = shotNext(s);
        // Swung into the box: onto the head of the one who shoots next, or headed away.
        // (With a shot seconds later it is taken at once, to the near post.)
        const quick = header && soon < 9;
        const leave = quick ? t + 0.3 : t + Math.min(3, soon * 0.3);
        const land = header ? Math.max(leave + 1, Math.min(leave + 3.8, next!.second - 2)) : leave + 3.8;
        const box: V = quick ? [ahead(s, 5 + noise(t + 9) * 3), top ? 36 + noise(t + 9.5) * 6 : 58 + noise(t + 9.5) * 6] : [ahead(s, 7 + noise(t + 9) * 5), 42 + noise(t + 9.5) * 16];
        push({ t: leave, ball: flag, side: s, carrier: e.player, dead: true, set: "corner" });
        if (header) passTo(land, box, s, next!.player);
        else {
          // Headed away by the defender who is nearest to it in the box.
          const lined = positions(f[def], def, flag, s, undefined, { set: "corner" });
          let j = 1;
          let d = Infinity;
          for (let n = 1; n < 11; n++) if (here(def, n, t) && dist(lined[n]!, box) < d) (d = dist(lined[n]!, box)), (j = n);
          passTo(land, mixV(box, lined[j]!, 0.6), def, j);
        }
        break;
      }
      case "foul": {
        // `home` is the side that fouled: the other side had the ball here.
        const victim = def;
        const kick = next && (next.kind === "penalty" || next.kind === "free_kick") ? next : undefined;
        // Where the set piece it gives will be taken.
        const where: V = kick?.kind === "penalty" ? [ahead(victim, 9 + noise(t + 10) * 5), 36 + noise(t + 11) * 28] : kick ? [ahead(victim, 24), 32 + noise(kick.second + 11) * 36] : [ahead(victim, before(victim, 35 + noise(t + 10) * 25)), y0];
        openPlay(t, victim, kick ? where : reachable(where), { touch: real(1.2) });
        const { move: _, ...down } = last();
        push({ ...down, t: t + 0.5, side: victim, dead: true });
        if (!kick) wait(t + 18);
        break;
      }
      case "yellow":
      case "red": {
        const { move: _, ...c } = last();
        push({ ...c, t: t + 6, dead: true });
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
        // After it the tackler's side has the ball, that far from the goal it attacks.
        const where: V = [ahead(s, before(s, 35 + noise(t + 12) * 35)), y0];
        openPlay(t, def, reachable(where), { touch: real(1.2) });
        push({ t: t + 1, ball: last().ball, side: s, carrier: e.player });
        break;
      }
      case "assist":
        break; // drawn with its goal: the last pass is his
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
  if (end - last().t > real(1.5)) {
    const s = last().side;
    openPlay(end - 0.5, s, [ahead(s, 30 + noise(end) * 30), 20 + noise(end + 1) * 60]);
  }
  const { move: _, ...c } = last();
  push({ ...c, t: end, dead: true });
  return keys;
}

/** The ball at second `s`: between two keys, on its way from one to the next. */
export function frameAt(keys: Key[], s: number): Frame {
  if (!keys.length) return { t: s, ball: [50, 50], side: 0, dead: true };
  if (s <= keys[0]!.t) return keys[0]!;
  if (s >= keys[keys.length - 1]!.t) return keys[keys.length - 1]!;
  // The first key after `s`.
  let lo = 1;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t > s) hi = mid;
    else lo = mid + 1;
  }
  const a = keys[lo - 1]!;
  const b = keys[lo]!;
  const p = (s - a.t) / Math.max(0.001, b.t - a.t);
  // A ball that is carried, passed or struck goes at an even pace; anything else (a ball fetched, put down) eases.
  const q = a.move ? p : p * p * (3 - 2 * p);
  // Between two keys the ball is still the leaving side's (a pass, a shot on its way).
  const k: Frame = { t: s, ball: mixV(a.ball, b.ball, q), side: a.side };
  if (a.dead && b.dead) k.dead = true;
  if (a.set && a.set === b.set) k.set = a.set;
  if (a.move) k.move = a.move;
  if (a.move === "pass" || a.move === "shot") {
    k.flight = { from: a.ball, to: b.ball, p };
    if (b.carrier !== undefined) k.next = { side: b.side, k: b.carrier, at: b.ball, in: b.t - s };
  } else {
    if (a.carrier !== undefined) k.carrier = a.carrier;
    // He is about to pass: the one he will find is already on the move.
    const c = keys[lo + 1];
    if (b.move === "pass" && c && c.carrier !== undefined && c.t - s < 16) k.next = { side: c.side, k: c.carrier, at: c.ball, in: c.t - s };
  }
  return k;
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
  set?: "corner" | "penalty" | "free_kick" | "kickoff";
  /** Where the eleven reads the play to be: the ball a moment ago (the live pitch follows it with a short delay). By default, the ball. */
  block?: V;
  /** The slot that went to the ball (or pressed) last time: he keeps going unless another is clearly nearer. */
  prefer?: number;
  /** Nobody of this side is sent to the ball: it is on its way from one player to another. */
  free?: boolean;
  /** Where the side without the ball closes down: where a pass is going. By default, the ball. */
  press?: V;
}


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
  const back = mix(within(7, 46, gx - 22), within(16, 60, gx - 31), att);
  const front = mix(within(24, 70, gx + 8), within(46, 92, gx + 21.5), att);
  const width = mix(0.7, 0.97, att);
  const lean = mix(0.3, 0.2, att);
  const out: V[] = spots.map(([sx, sy], k) => {
    // The keeper comes off his line a little when his side is camped up the pitch.
    if (k === 0) return [3 + within(0, 5, (gx - 45) * 0.12), 50 + (by - 50) * 0.12];
    return [mix(back, front, rank(sy)), clampY(50 + (100 - sx - 50) * width + (gy - 50) * lean)];
  });
  if (shape.set && shape.set !== "kickoff") {
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
  if (shape.free) return turn(out);
  if (has) {
    if (carrier === 0) {
      // The keeper has it, in his hands or at his feet.
      out[0] = [within(1, 16, bx), by];
    } else {
      // The man named is on the ball; nobody named: the nearest outfield player goes to it.
      const k = carrier !== undefined && carrier > 0 && carrier < 11 ? carrier : nearest(out, bx, by, shape.prefer);
      out[k] = [bx - 1.2, by + 1.5];
    }
  } else {
    // Out of possession: one closes down, goal side of the ball (or of where it is going).
    const px = shape.press ? (side === 0 ? shape.press[0] : 100 - shape.press[0]) : bx;
    const py = shape.press ? (side === 0 ? shape.press[1] : 100 - shape.press[1]) : by;
    const first = nearest(out, px, py, shape.prefer);
    out[first] = [px - 3, py - 2];
    // And another covers him, between the ball and the goal.
    let second = -1;
    let d = Infinity;
    for (let k = 1; k < 11; k++) {
      const dd = Math.hypot(out[k]![0] - (px - 9), out[k]![1] - py);
      if (k !== first && dd < d) (d = dd), (second = k);
    }
    if (second > 0 && d < 16) out[second] = [Math.max(4, px - 9), clampY(py + (50 - py) * 0.25)];
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

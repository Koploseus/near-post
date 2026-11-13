import { useEffect, useMemo, useRef } from "react";
import { type Frame, type V, atBall, frameAt, keyframes, positions } from "../lib/flow.js";
import { type Clock, HALF_SECONDS } from "../lib/live.js";
import { BOT, type MatchEvent, type MatchResult, type Player } from "../lib/types.js";
import { ball as drawBall, sprite } from "./art.js";
import { play } from "../lib/sound.js";

/**
 * The live match as a TV broadcast: a camera on the touchline follows the
 * ball along a pitch larger than the screen, and the 22 players run to the
 * places the match's own events put them (lib/flow.ts: the same ball path
 * and the same blocks as the small pitch). Tackles, fouls, saves and goals
 * play as they are revealed. It is a view only: nothing here is recorded.
 */

const CW = 960;
const CH = 540;
/** The pitch's length in world pixels (the screen shows about a third of it). */
const PW = 2300;
const FAR = 208;
const NEAR = 522;
/** Match seconds per real second (a 45-minute half is shown in ten minutes). */
const RATE = 4.5;
const PLAYER_H = 68;

const STADIUM = typeof Image !== "undefined" ? Object.assign(new Image(), { src: "/art/bg/bg-stadium-full.webp" }) : null;

type G = CanvasRenderingContext2D;
type Ev = MatchEvent & { half: 0 | 1 };
type Act = "slide" | "down" | "joy" | "dive" | "hold" | "beaten" | "sad" | null;
/** How the final whistle feels from where you sit: your club won, lost, drew, or it was not your match. */
type Mood = "win" | "lose" | "draw" | "neutral";

interface Body {
  x: number;
  y: number;
  /** Speed in pitch units per second, and the way he faces (1 right, -1 left). */
  v: number;
  face: number;
  phase: number;
  /** Where he is heading, eased with his own reaction time. */
  tx: number;
  ty: number;
  /** His own character: a seed for his roaming, his reaction time (s) and his top speed. */
  seed: number;
  lag: number;
  top: number;
}

/** No Math.random: every viewer sees the same players. */
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function TvPitch({ m, shown, c, players, shirts, mine, myClub, gain = 0 }: { m: MatchResult; shown: Ev[]; c: Clock; players: Map<string, Player>; shirts: [string, string]; /** Your footballer's token id: he gets a gold marker. */ mine?: string | null; /** Your club: the final whistle is a win, a defeat or a draw for you. */ myClub?: string | null; /** Whole G that came into your wallet over this match (0: nothing to show). */ gain?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const second = c.phase === "second_half" || c.phase === "full_time";
  const half = second ? 1 : 0;
  const keys = useMemo(() => {
    const evs = half === 0 ? m.events.slice(0, m.first_half_events) : m.events.slice(m.first_half_events);
    const start = half === 0 ? 0 : HALF_SECONDS;
    const end = m.half_ends[half] ?? start + HALF_SECONDS;
    return keyframes(evs, start, end, half === 0 ? 0 : 1, {
      formations: [m.formations[half * 2] ?? m.formations[0]!, m.formations[half * 2 + 1] ?? m.formations[1]!],
      rate: RATE,
      absent: (side, k) => half === 1 && m.elevens[2 + side]?.[k] === "",
    });
  }, [m, half]);
  const stopped = c.phase === "half_time" || c.phase === "waiting_second_half" || c.phase === "full_time" || c.phase === "before";

  // What the loop reads: always the latest props, without restarting it.
  const live = useRef({ m, shown, c, players, shirts, keys, half, second, stopped, mine, myClub, gain });
  live.current = { m, shown, c, players, shirts, keys, half, second, stopped, mine, myClub, gain };

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const bodies: Body[][] = [0, 1].map((side) => Array.from({ length: 11 }, (_, k) => {
        const seed = side * 11 + k + 1;
        return { x: 50, y: 50, v: 0, face: 1, phase: 0, tx: 50, ty: 50, seed, lag: 0.25 + rnd(seed) * 0.6, top: 7.5 + rnd(seed + 40) * 3.5 };
      }),
    );
    // The ball belongs to a player: at his feet, or on its way to the next one.
    let holder: { side: 0 | 1; k: number } = { side: 0, k: 1 };
    let wantHolder = { side: 0 as 0 | 1, k: 1, since: 0 };
    let bp: V = [50, 50];
    let flight = 0;
    let placed = false;
    /** How much each side is attacking (0 to 1, eased), and who of each was at the ball last. */
    const attack = [0, 0];
    const lastAtBall: (number | undefined)[] = [undefined, undefined];
    /** Where the play is, as the elevens have read it. */
    let read: V = [50, 50];
    /** The one who has just passed runs on for a moment. */
    let gave: { side: 0 | 1; k: number; until: number } | null = null;
    let wasFlying = false;
    let cur = live.current.c.second;
    let cam = PW / 2;
    let zoom = 1;
    let ballAt: V = [50, 50];
    let placedBall = false;
    let last = performance.now();
    let raf = 0;
    /** When the final whistle was first seen here. */
    let endedAt: number | null = null;
    /** When your pay for the match was first known here: it counts up from then. */
    let paidAt: number | null = null;
    /** The last ball heard leaving a foot (its path), so each kick sounds once. */
    let heardKick = "";
    /** The stand has stirred for this attack (it stirs again once the ball is back in midfield). */
    let stirred = false;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      // The match second, running smoothly between the clock's whole seconds.
      const target = L.c.second;
      if (L.stopped || Math.abs(target - cur) > 14) cur = target;
      else cur = Math.min(target + 1, cur + dt * RATE * (cur < target - 3 ? 2 : 1));

      const at: Frame = L.stopped ? { t: cur, ball: [50, 50], side: 0, dead: true } : frameAt(L.keys, cur);
      // The ball leaving a foot: every shot (hard), the long balls, and one short pass in two (soft), so the
      // match is heard without a kick every second. Only as it leaves the foot: a ball already halfway is silent.
      if (!L.stopped && at.flight && at.flight.p < 0.3) {
        const { from, to } = at.flight;
        const id = `${from[0].toFixed(1)},${from[1].toFixed(1)}>${to[0].toFixed(1)},${to[1].toFixed(1)}`;
        if (id !== heardKick) {
          heardKick = id;
          const far = Math.hypot(to[0] - from[0], to[1] - from[1]);
          const coin = Math.floor(from[0] * 7 + from[1] * 13) % 2 === 0;
          if (at.move === "shot") play("kick", 0.85 + 0.15 * ((from[1] * 10) % 1));
          else if (far > 30) play("kick", 0.5 + Math.min(0.2, (far - 30) / 100));
          else if (coin) play("kick", 0.15 + far / 150);
        }
      }
      // The stand stirs when the ball, in open play, gets near either box; once per attack.
      if (!L.stopped && !at.dead) {
        const [bx, by] = at.ball;
        if (!stirred && (bx < 20 || bx > 80) && by > 20 && by < 80) {
          stirred = true;
          play("stir");
        } else if (bx > 30 && bx < 70) stirred = false;
      }
      const f = [L.m.formations[L.second ? 2 : 0] ?? L.m.formations[0]!, L.m.formations[L.second ? 3 : 1] ?? L.m.formations[1]!];
      // Stopped, or the ball on the centre spot for a kick-off: each eleven in its own half.
      // (After a goal they go back to their half while the ball is fetched.)
      const restart = L.stopped ? ("rest" as const) : at.set === "kickoff" || (at.dead && Math.hypot(at.ball[0] - 50, at.ball[1] - 50) < 1.5) ? ("kickoff" as const) : undefined;
      // The elevens read the play with a delay: a pass does not send twenty players running at once.
      if (!placed || restart) read = [at.ball[0], at.ball[1]];
      else read = [read[0] + (at.ball[0] - read[0]) * Math.min(1, dt / 1.5), read[1] + (at.ball[1] - read[1]) * Math.min(1, dt / 1.5)];
      // The side without the ball drops at once when the ball goes at its goal, and steps up again in its own time.
      const blockOf = (side: 0 | 1): V => (side === at.side ? read : [side === 0 ? Math.min(read[0], at.ball[0]) : Math.max(read[0], at.ball[0]), read[1]]);
      const targets = ([0, 1] as const).map((side) => {
        // A side takes a second or so to turn from defending to attacking: the blocks do not jump with the ball.
        const want = at.side === side ? 1 : 0;
        attack[side] = placed ? attack[side]! + (want - attack[side]!) * Math.min(1, dt / 1.4) : want;
        // A ball on its way belongs to nobody: the side that has it lets it run, the other closes down the one it is going to.
        const flying = !!at.flight && !at.dead;
        // A dead ball is nobody's to chase, but the one who will play it.
        const idle = !!at.dead && !(at.side === side && at.carrier !== undefined);
        const out = positions(f[side]!, side, at.ball, at.side, at.side === side ? at.carrier : undefined, {
          attack: attack[side]!,
          block: blockOf(side),
          ...(at.set && at.set !== "kickoff" ? { set: at.set } : {}),
          ...(lastAtBall[side] !== undefined ? { prefer: lastAtBall[side]! } : {}),
          ...(restart ? { restart } : {}),
          ...((flying && at.side === side) || idle ? { free: true } : {}),
          ...(flying && at.side !== side && at.move === "pass" ? { press: at.flight!.to } : {}),
        });
        if (!restart && !flying) lastAtBall[side] = atBall(out, at.ball);
        return out;
      });
      // Without the ball, each one picks up the opponent in his zone and stands goal side of him.
      if (!restart && !at.set && !at.dead) {
        const d = (1 - at.side) as 0 | 1;
        const press = atBall(targets[d]!, at.flight && at.move === "pass" ? at.flight.to : at.ball);
        const goalSide = d === 0 ? -1 : 1;
        for (let k = 1; k < 11; k++) {
          if (k === press) continue;
          const me = targets[d]![k]!;
          let best: V | null = null;
          let bd = 12;
          for (let j = 1; j < 11; j++) {
            const a = targets[at.side]![j]!;
            const dd = Math.hypot(a[0] - me[0], (a[1] - me[1]) * 0.7);
            if (dd < bd) (bd = dd), (best = a);
          }
          if (best) targets[d]![k] = [me[0] + (best[0] + goalSide * 4.5 - me[0]) * 0.3, me[1] + (best[1] + (me[1] < best[1] ? -2 : 2) - me[1]) * 0.3];
        }
      }
      const gone = (side: number, k: number) =>
        (L.second && L.m.elevens[2 + side]?.[k] === "") || L.shown.some((e) => e.kind === "red" && e.half === L.half && Number(!e.home) === side && e.player === k);

      // What the events of this half ask of the players right now.
      const acts: Act[][] = [Array<Act>(11).fill(null), Array<Act>(11).fill(null)];
      /** Places the events send a player to, instead of his place in the block. */
      const orders: (V | undefined)[][] = [Array<V | undefined>(11).fill(undefined), Array<V | undefined>(11).fill(undefined)];
      let shot = false;
      let cheer = -1;
      // The final whistle: the winners run together and jump, the beaten side hangs its head; after a draw they line up and shake hands.
      const ended = L.c.phase === "full_time";
      if (!ended) endedAt = null;
      else endedAt ??= now;
      const since = endedAt === null ? -1 : (now - endedAt) / 1000;
      const won: 0 | 1 | null = L.m.home_goals > L.m.away_goals ? 0 : L.m.away_goals > L.m.home_goals ? 1 : null;
      const mySide = L.myClub && L.myClub === L.m.home ? 0 : L.myClub && L.myClub === L.m.away ? 1 : null;
      // (A test that looks at each ending sets `window.__npMood`.)
      const asked = (window as unknown as { __npMood?: Mood }).__npMood;
      const mood: Mood | null = !ended ? null : (asked ?? (won === null ? "draw" : mySide === null ? "neutral" : mySide === won ? "win" : "lose"));
      if (ended) {
        for (let k = 1; k < 11; k++) {
          if (won === null) {
            orders[0]![k] = [46.4, 12 + k * 7.6];
            orders[1]![k] = [53.6, 12 + k * 7.6];
          } else {
            const lost = (1 - won) as 0 | 1;
            const a = (k / 10) * Math.PI * 2;
            orders[won]![k] = [(won === 0 ? 37 : 63) + 8 * Math.cos(a), 50 + 13 * Math.sin(a)];
            acts[won]![k] = "joy";
            acts[lost]![k] = "sad";
          }
        }
        if (won !== null && mood !== "lose" && since < 18) cheer = since % 5.5;
        else if (won !== null) cheer = since; // (the players still jump; the stand has gone quiet)
      }
      let caption = "";
      if (!L.stopped)
        for (const e of L.m.events.slice(L.half === 0 ? 0 : L.m.first_half_events, L.half === 0 ? L.m.first_half_events : undefined)) {
          const d = cur - e.second;
          if (d < -26 || d > 40) continue;
          const s = e.home ? 0 : 1;
          const o = 1 - s;
          // The one who is about to shoot makes his run to where he will shoot from: he is there when the ball comes.
          if (d < -2 && (e.kind === "goal" || e.kind === "saved" || e.kind === "missed") && e.player > 0 && !gone(s, e.player)) {
            const spot = frameAt(L.keys, e.second - 2);
            if (spot.side === s && !(at.side === s && at.carrier === e.player)) orders[s]![e.player] = [spot.ball[0] - (s === 0 ? 1.2 : -1.2), spot.ball[1] + 1.5];
          }
          if (d < -3) continue;
          if (e.kind === "tackle" && d > -4 && d < 5) {
            // He closes the man on the ball down, then goes to ground.
            if (d < 1.5) orders[s]![e.player] = [bp[0], bp[1]];
            if (d > -0.6) acts[s]![e.player] = "slide";
            if (d > -0.6) caption = "TACKLE";
          } else if (e.kind === "foul" && d > -4 && d < 0) {
            orders[s]![e.player] = [bp[0], bp[1]];
            if (d > -0.7) acts[s]![e.player] = "slide";
          } else if (e.kind === "foul" && d >= 0 && d < 10) {
            // The one on the ball goes down.
            let best = 1;
            let bd = Infinity;
            for (let k = 1; k < 11; k++) {
              const b = bodies[o]![k]!;
              const dd = (b.x - bp[0]) ** 2 + (b.y - bp[1]) ** 2;
              if (dd < bd) [bd, best] = [dd, k];
            }
            acts[o]![best] = "down";
            caption = "FOUL";
          } else if (e.kind === "goal" || e.kind === "own_goal") {
            if (d > -2 && d < 0) acts[o]![0] = "dive";
            if (d > -2.2 && d < 1) shot = true;
            if (d >= 0 && d < 24 && at.dead) {
              // They run to the scorer and jump together.
              const sc = bodies[s]![e.kind === "goal" && e.player > 0 ? e.player : 9]!;
              for (let k = 1; k < 11; k++) {
                acts[s]![k] = "joy";
                if (d > 1.5 && bodies[s]![k] !== sc) orders[s]![k] = [sc.x + 5 * Math.cos(k * 2.4) * (0.6 + (k % 3) * 0.3), Math.min(96, Math.max(4, sc.y + 7 * Math.sin(k * 2.4)))];
                else if (bodies[s]![k] === sc) orders[s]![k] = [sc.x, sc.y];
              }
              acts[o]![0] = d < 20 ? "beaten" : null;
              cheer = d / RATE;
              caption = "GOAL!";
            }
          } else if (e.kind === "saved") {
            if (d > -2.2 && d < 1) shot = true;
            if (d > -2 && d < 1.5) acts[o]![0] = "dive";
            else if (d >= 1.5 && d < 10) acts[o]![0] = "hold";
            if (d >= 0 && d < 8) caption = "SAVED!";
          } else if (e.kind === "missed") {
            if (d > -2.2 && d < 1) shot = true;
            if (d >= 0 && d < 8) caption = "WIDE!";
          }
          else if (e.kind === "corner" && d >= 0 && d < 6) caption = "CORNER";
          else if (e.kind === "penalty" && d >= -12 && d < 0) caption = "PENALTY";
          else if (e.kind === "free_kick" && d >= -12 && d < 0) caption = "FREE KICK";
          else if (e.kind === "yellow" && d >= 0 && d < 6) caption = "YELLOW CARD";
          else if (e.kind === "red" && d >= 0 && d < 6) caption = "RED CARD";
        }

      // The one the ball is going to (or is about to be played to) goes to meet it.
      if (!L.stopped && at.next && !gone(at.next.side, at.next.k) && !(at.move === "shot" && at.next.k !== 0)) orders[at.next.side]![at.next.k] = [at.next.at[0], at.next.at[1]];

      // Everyone runs to his place, each in his own way.
      const time = now / 1000;
      const live2 = !L.stopped && !at.dead;
      const flyingNow = live2 && !!at.flight && at.move === "pass";
      if (flyingNow && !wasFlying && at.side === holder.side) gave = { side: holder.side, k: holder.k, until: now + 1700 };
      wasFlying = flyingNow;
      /** The receiver times his run: he gets there as the ball does, still moving. */
      const eta = at.next ? Math.max(0.2, at.next.in / RATE) : 0;
      for (const side of [0, 1] as const)
        for (let k = 0; k < 11; k++) {
          const b = bodies[side]![k]!;
          let [tx, ty] = targets[side]![k]!;
          const o = orders[side]![k];
          if (o) [tx, ty] = o;
          else if (k > 0 && live2 && Math.hypot(tx - at.ball[0], ty - at.ball[1]) > 7) {
            // Away from the ball he roams around his place; the forwards of the side on the ball make runs.
            // (Nobody stands still in a match: he is always on the move, a few steps one way and the other.)
            tx += 2.4 * Math.sin(time * 0.47 + b.seed * 1.7) + 1.2 * Math.sin(time * 0.93 + b.seed * 3.1);
            ty += 3.0 * Math.sin(time * 0.39 + b.seed * 2.3) + 1.4 * Math.sin(time * 0.81 + b.seed);
            if (at.side === side && k >= 7) tx += (side === 0 ? 1 : -1) * 5 * Math.max(0, Math.sin(time * 0.4 + b.seed * 5));
            // He has just passed: he runs on.
            if (gave && gave.side === side && gave.k === k && now < gave.until && at.side === side) tx += (side === 0 ? 1 : -1) * 8;
            ty = Math.min(97, Math.max(3, ty));
          }
          if (!placed) [b.x, b.y, b.tx, b.ty] = [tx, ty, tx, ty];
          // He reads the play with his own delay.
          const ease = Math.min(1, dt / (o || (live2 && side === at.side && k === at.carrier) ? 0.12 : b.lag));
          b.tx += (tx - b.tx) * ease;
          b.ty += (ty - b.ty) * ease;
          const dx = b.tx - b.x;
          const dy = b.ty - b.y;
          const d = Math.hypot(dx, dy);
          // The man on the ball keeps up with it (the match runs faster than the picture); far from his place, a player sprints.
          const onBall = live2 && side === at.side && k === at.carrier && k > 0;
          const meeting = !!o && !!at.next && at.next.side === side && at.next.k === k && k > 0;
          const want = meeting ? Math.min(12.5, Math.max(2.6, d / eta)) : Math.min(k === 0 ? 5 : onBall ? 15 : o || at.set ? 12 : d > 10 ? b.top * 1.3 : b.top, d * 2.4);
          b.v += (want - b.v) * Math.min(1, dt * 5);
          if (d > 0.01) {
            const stepLen = Math.min(d, b.v * dt);
            b.x += (dx / d) * stepLen;
            b.y += (dy / d) * stepLen;
            if (Math.abs(dx) > 0.5) b.face = Math.sign(dx);
          }
          if (b.v < 0.6) b.face = Math.abs(at.ball[0] - b.x) > 2 ? Math.sign(at.ball[0] - b.x) : side === 0 ? 1 : -1; // standing: he watches the ball
          b.phase += dt * (2.6 + b.v * 1.25);
        }
      placed = true;

      // Who has the ball: the player the move names; nobody while it is on its way.
      const flying = !L.stopped && !!at.flight;
      if (!flying) {
        if (at.carrier !== undefined && !gone(at.side, at.carrier)) holder = { side: at.side, k: at.carrier };
        else {
          // Nobody named: the player of the side on it who is nearest to where the play is.
          let nk = 1;
          let nd = Infinity;
          for (let k = 1; k < 11; k++) {
            if (gone(at.side, k)) continue;
            const b = bodies[at.side]![k]!;
            const dd = Math.hypot(b.x - at.ball[0], b.y - at.ball[1]);
            if (dd < nd) [nd, nk] = [dd, k];
          }
          if (wantHolder.side !== at.side || wantHolder.k !== nk) wantHolder = { side: at.side, k: nk, since: now };
          if (holder.side !== wantHolder.side || now - wantHolder.since > 220) holder = { side: wantHolder.side, k: wantHolder.k };
        }
      }
      // A pass, a shot, a set piece or a ball out of play goes where the match says; otherwise it is at his feet.
      const hb = bodies[holder.side]![holder.k]!;
      const loose = L.stopped || at.dead || shot || flying || at.ball[0] < 2.5 || at.ball[0] > 97.5 || Math.hypot(hb.x - at.ball[0], hb.y - at.ball[1]) > 16;
      const feet: V = [hb.x + hb.face * (1.3 + 0.5 * Math.sin(hb.phase * 1.6)) * Math.min(1, hb.v / 3 + 0.4), hb.y + 0.6];
      const dest: V = loose ? [at.ball[0], at.ball[1]] : feet;
      const gx = dest[0] - bp[0];
      const gy = dest[1] - bp[1];
      const gd = Math.hypot(gx, gy);
      const speed = loose ? 75 : gd > 3 ? 34 : 60;
      if (gd <= speed * dt || !placedBall) bp = dest;
      else bp = [bp[0] + (gx / gd) * speed * dt, bp[1] + (gy / gd) * speed * dt];
      placedBall = true;
      // In the air on the way: a pass skims, a long ball or a shot rises.
      flight = shot && gd > 2.5 ? Math.min(1, flight + dt * 5) : Math.max(0, flight - dt * 6);
      const far = at.flight && at.move === "pass" ? Math.hypot(at.flight.to[0] - at.flight.from[0], at.flight.to[1] - at.flight.from[1]) : 0;
      const arc = far > 0 ? Math.sin(Math.PI * at.flight!.p) * (far > 30 ? 26 : far > 20 ? 9 : 1.5) : 0;
      const owned = !loose && gd < 2.5;
      ballAt = bp;
      // For a test that watches a whole match (it sets `window.__npPitch` first): what is drawn, in pitch units.
      const watch = window as unknown as { __npPitch?: unknown };
      if ("__npPitch" in watch)
        watch.__npPitch = { second: cur, stopped: L.stopped, side: at.side, dead: !!at.dead, key: at.ball, carrier: at.carrier ?? null, move: at.move ?? null, flight: at.flight ?? null, next: at.next ?? null, ball: bp, holder, loose, caption, match: L.m, half: L.half, read, targets, bodies: bodies.map((team, side) => team.map((b, k) => (gone(side, k) ? null : [b.x, b.y, b.v]))) };

      // The camera: on the ball, a little ahead of it, closer near the goals.
      const lead = at.dead ? 0 : (at.side === 0 ? 1 : -1) * 4;
      const wantCam = Math.min(PW - 330, Math.max(330, ((bp[0] * 0.7 + at.ball[0] * 0.3 + lead) / 100) * PW));
      cam += (wantCam - cam) * Math.min(1, dt * 2.2);
      const near = Math.min(1, Math.max(0, (Math.abs(bp[0] - 50) - 26) / 14));
      zoom += (1 + 0.16 * near - zoom) * Math.min(1, dt * 1.5);

      const scaleAt = (y: number) => 0.74 + 0.46 * (y / 100);
      const P = (x: number, y: number): [number, number, number] => {
        const s = scaleAt(y);
        return [CW / 2 + ((x / 100) * PW - cam) * s, FAR + (NEAR - FAR) * (y / 100) ** 1.12, s];
      };

      g.setTransform(el.width / CW, 0, 0, el.height / CH, 0, 0);
      g.fillStyle = "#120C30";
      g.fillRect(0, 0, CW, CH);
      g.save();
      g.translate(CW / 2, CH * 0.6);
      g.scale(zoom, zoom);
      g.translate(-CW / 2, -CH * 0.6);

      stand(g, cam, cheer, now);
      pitch(g, P);
      goal(g, P, 0);
      goal(g, P, 100);

      // Players and ball, the farthest first.
      const list: { y: number; draw: () => void }[] = [];
      let myBody: Body | null = null;
      for (const side of [0, 1] as const)
        for (let k = 0; k < 11; k++) {
          if (gone(side, k)) continue;
          const b = bodies[side]![k]!;
          const act = acts[side]![k]!;
          // Who plays this slot this half: his own face, and a gold marker if he is yours.
          const id = (L.second ? L.m.elevens[2 + side] : undefined)?.[k] || L.m.elevens[side]?.[k];
          const p = id && id !== BOT ? L.players.get(id) : undefined;
          const who = { face: p ? Number(p.token_id.replace(/\D/g, "")) || 0 : 7 + side * 11 + k, hair: p?.look?.hair ?? null, mine: !!id && id === L.mine };
          if (who.mine) myBody = b;
          list.push({ y: b.y, draw: () => player(g, P, b, k === 0, L.shirts[side], act, cheer, side, who, now) });
        }
      const lift = Math.max(arc, flight * 20 * (0.55 + 0.45 * Math.abs(Math.sin(now / 170))));
      list.push({
        y: bp[1] + 0.4,
        draw: () => {
          const [bx, by, s] = P(Math.min(101, Math.max(-1, bp[0])), bp[1]);
          g.fillStyle = "rgba(0,0,0,.3)";
          g.beginPath();
          g.ellipse(bx, by, 7 * s, 3 * s, 0, 0, Math.PI * 2);
          g.fill();
          drawBall(g, bx, by - 6 * s - lift * s, 6.5 * s, owned && hb.v < 1 ? 0 : now / 90, false);
        },
      });
      list.sort((a, b) => a.y - b.y).forEach((e) => e.draw());

      // The name of the player on the ball.
      if (owned) {
        const id = (L.second ? L.m.elevens[2 + holder.side] : undefined)?.[holder.k] || L.m.elevens[holder.side]?.[holder.k];
        const name = id && id !== BOT ? L.players.get(id)?.name : undefined;
        if (name) {
          const [x, y, s] = P(hb.x, hb.y);
          tag(g, name, x, y - (PLAYER_H + 12) * s, L.shirts[holder.side]);
        }
      }
      g.restore();

      if (mood) finale(g, mood, since, now, won === null ? ["#F2B705", "#F3EAD7"] : [L.shirts[won]!, "#F2B705", "#F3EAD7"], L.m.home_goals, L.m.away_goals);
      const paid = (window as unknown as { __npGain?: number }).__npGain ?? L.gain; // (a test sets `window.__npGain`)
      if (!mood || paid <= 0) paidAt = null;
      else {
        paidAt ??= now;
        pay(g, paid, (now - paidAt) / 1000, now);
      }
      if (caption) lowerThird(g, caption);
      radar(g, bodies, ballAt, L.shirts, gone, cam, myBody);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} className="tv-pitch" width={CW * 2} height={CH * 2} aria-hidden="true" />;
}

type Proj = (x: number, y: number) => [number, number, number];

/** The stand behind the far touchline: it slides slower than the pitch, and bounces after a goal. */
function stand(g: G, cam: number, cheer: number, now: number) {
  const top = FAR - 26;
  if (STADIUM?.complete && STADIUM.naturalWidth) {
    const sw = STADIUM.naturalWidth;
    const sh = sw * 0.175;
    const w = (top + 8) / 0.175;
    const hop = cheer >= 0 && cheer < 6 ? Math.abs(Math.sin(now / 110)) * 5 : 0;
    const off = -(((cam * 0.5) % (2 * w)) + 2 * w) % (2 * w);
    for (let i = 0, x = off; x < CW + w; i++, x += w) {
      if (x + w < -w) continue;
      g.save();
      // Every other copy is mirrored, so the picture joins itself.
      if (i % 2) {
        g.translate(x + w, 0);
        g.scale(-1, 1);
      } else g.translate(x, 0);
      g.drawImage(STADIUM, 0, STADIUM.naturalHeight * 0.3, sw, sh, 0, -hop - 6, w, top + 8 + hop);
      g.restore();
    }
  }
  // The boards along the far touchline.
  g.fillStyle = "#0B0820";
  g.fillRect(-40, top - 2, CW + 80, 26);
  g.fillStyle = "#251A57";
  g.fillRect(-40, top + 1, CW + 80, 20);
  g.font = "700 14px 'Pixelify Sans', system-ui";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const step = 210;
  const first = Math.floor((cam * 0.74 - CW) / step);
  for (let i = first; i < first + 14; i++) {
    const x = CW / 2 + i * step - cam * 0.74;
    g.fillStyle = i % 2 ? "#F2B705" : "#F3EAD7";
    g.fillText(i % 2 ? "$G" : "NEAR POST", x, top + 16);
  }
}

function pitch(g: G, P: Proj) {
  g.fillStyle = "#3F9E22";
  g.fillRect(-60, FAR - 4, CW + 120, CH - FAR + 60);
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as V[]) {
      const [sx, sy] = P(x, y);
      g.lineTo(sx, sy);
    }
    g.closePath();
  };
  for (let i = 0; i < 20; i++) {
    g.fillStyle = i % 2 ? "#4AB226" : "#5BC72E";
    quad(i * 5, 0, i * 5 + 5, 100);
    g.fill();
  }
  g.strokeStyle = "rgba(243,234,215,.9)";
  g.lineWidth = 2.5;
  g.lineJoin = "round";
  quad(0, 0, 100, 100);
  g.stroke();
  quad(50, 0, 50, 100);
  g.stroke();
  for (const x of [0, 100]) {
    const dir = x === 0 ? 1 : -1;
    quad(x, 20.4, x + dir * 15.7, 79.6);
    g.stroke();
    quad(x, 36.5, x + dir * 5.2, 63.5);
    g.stroke();
    const [sx, sy, s] = P(x + dir * 10.5, 50);
    g.fillStyle = "rgba(243,234,215,.9)";
    g.beginPath();
    g.ellipse(sx, sy, 3 * s, 1.6 * s, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  for (let a = 0; a <= 40; a++) {
    const [sx, sy] = P(50 + 8.7 * Math.cos((a / 40) * Math.PI * 2), 50 + 13.5 * Math.sin((a / 40) * Math.PI * 2));
    g.lineTo(sx, sy);
  }
  g.stroke();
}

/** A goal on the line x = 0 or x = 100: posts, bar and net. */
function goal(g: G, P: Proj, x: number) {
  const back = x === 0 ? -2.6 : 102.6;
  const [ax, ay, as] = P(x, 44.6);
  const [bx, by, bs] = P(x, 55.4);
  const [cx, cy] = P(back, 44.6);
  const [dx, dy] = P(back, 55.4);
  const ha = 62 * as;
  const hb = 62 * bs;
  g.fillStyle = "rgba(243,234,215,.16)";
  g.strokeStyle = "rgba(243,234,215,.5)";
  g.lineWidth = 1;
  for (const poly of [
    [[cx, cy - ha * 0.9], [dx, dy - hb * 0.9], [dx, dy], [cx, cy]],
    [[ax, ay - ha], [cx, cy - ha * 0.9], [cx, cy], [ax, ay]],
    [[bx, by - hb], [dx, dy - hb * 0.9], [dx, dy], [bx, by]],
    [[ax, ay - ha], [bx, by - hb], [dx, dy - hb * 0.9], [cx, cy - ha * 0.9]],
  ]) {
    g.beginPath();
    for (const [px, py] of poly) g.lineTo(px!, py!);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.strokeStyle = "#FFFFFF";
  g.lineWidth = 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(ax, ay - ha);
  g.lineTo(bx, by - hb);
  g.lineTo(bx, by);
  g.stroke();
  g.lineCap = "butt";
}

function player(g: G, P: Proj, b: Body, keeper: boolean, shirt: string, act: Act, cheer: number, side: number, who: { face: number; hair: string | null; mine: boolean }, now: number) {
  const [x, y, s] = P(b.x, b.y);
  if (x < -80 || x > CW + 80) return;
  const h = PLAYER_H * s;
  if (who.mine) {
    // Yours: a gold ring on the grass.
    g.strokeStyle = "#F2B705";
    g.lineWidth = 3 * s;
    g.beginPath();
    g.ellipse(x, y, 22 * s, 8 * s, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = "rgba(0,0,0,.28)";
  g.beginPath();
  g.ellipse(x, y, (act === "slide" || act === "down" || act === "beaten" || act === "dive" ? 26 : 15) * s, 5 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(x, y + 2 * s);
  let ok: boolean;
  if (keeper) {
    const n = act === "dive" ? 1 : act === "hold" ? 3 : act === "beaten" ? 4 : 0;
    ok = sprite(g, "keeper", shirt, n, (n === 1 ? 0.62 : n === 4 ? 0.45 : 1) * h * 1.06, side === 1, who.face, who.hair);
  } else if (act === "joy") {
    g.translate(0, -Math.abs(Math.sin(cheer * 7 + b.phase)) * 9 * s);
    ok = sprite(g, "top", shirt, 5, h * 1.04, b.face < 0, who.face, who.hair);
  } else if (act === "slide") ok = sprite(g, "rivalFront", shirt, 4, h * 0.72, b.face > 0, who.face, who.hair);
  else if (act === "down") ok = sprite(g, "rivalFront", shirt, 5, h * 0.7, b.face > 0, who.face, who.hair);
  else if (act === "sad" && b.v < 1.3) ok = sprite(g, "rivalSide", shirt, 5, h * 0.84, b.face < 0, who.face, who.hair);
  else if (b.v > 1.3) ok = sprite(g, "rivalSide", shirt, 1 + (Math.floor(b.phase) % 4), h, b.face < 0, who.face, who.hair);
  else ok = sprite(g, "top", shirt, 0, h, b.face < 0, who.face, who.hair);
  if (!ok) {
    // Until the art has loaded: a shirt and a head.
    g.fillStyle = "#0B0820";
    g.fillRect(-9 * s, -44 * s, 18 * s, 44 * s);
    g.fillStyle = keeper ? "#45D483" : shirt;
    g.fillRect(-7 * s, -42 * s, 14 * s, 24 * s);
    g.fillStyle = "#E9B98F";
    g.fillRect(-6 * s, -56 * s, 12 * s, 12 * s);
  }
  g.restore();
  if (who.mine) {
    // And a gold arrow above his head.
    const ty = y - h * (act === "slide" || act === "down" ? 0.8 : 1.08) - 6 * s - Math.abs(Math.sin(now / 260)) * 5 * s;
    g.fillStyle = "#0B0820";
    g.beginPath();
    g.moveTo(x - 11 * s, ty - 14 * s);
    g.lineTo(x + 11 * s, ty - 14 * s);
    g.lineTo(x, ty + 3 * s);
    g.fill();
    g.fillStyle = "#F2B705";
    g.beginPath();
    g.moveTo(x - 7 * s, ty - 12 * s);
    g.lineTo(x + 7 * s, ty - 12 * s);
    g.lineTo(x, ty - 1 * s);
    g.fill();
  }
}

function tag(g: G, text: string, x: number, y: number, colour: string) {
  g.font = "700 13px 'Pixelify Sans', system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const w = g.measureText(text).width + 14;
  g.fillStyle = "#0B0820";
  g.fillRect(x - w / 2 - 2, y - 11, w + 4, 22);
  g.fillStyle = colour;
  g.fillRect(x - w / 2, y - 9, w, 18);
  g.fillStyle = "#F3EAD7";
  g.fillText(text, x, y + 1);
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x - 5, y + 11);
  g.lineTo(x + 5, y + 11);
  g.lineTo(x, y + 17);
  g.fill();
}

/** A small deterministic noise (the same show for everyone). */
const fx = (n: number) => {
  const x = Math.sin(n * 91.345 + 47.853) * 24634.6345;
  return x - Math.floor(x);
};

/**
 * The final whistle, over the picture. A win: fireworks over the stand and confetti in the winners'
 * colours. A defeat: the light goes down and it rains. A draw: a little confetti, no fireworks.
 * Then the word, big, with the score.
 */
function finale(g: G, mood: Mood, since: number, now: number, colours: string[], home: number, away: number) {
  const t = now / 1000;
  if (mood === "lose") {
    g.fillStyle = "rgba(11, 8, 32, .42)";
    g.fillRect(0, 0, CW, CH);
    g.fillStyle = "rgba(160, 190, 255, .5)";
    for (let i = 0; i < 90; i++) {
      const x = (fx(i) * (CW + 120) + t * 60) % (CW + 120) - 60;
      const y = (fx(i + 200) * CH + t * (520 + fx(i + 400) * 240)) % CH;
      g.fillRect(x, y, 2, 12);
    }
  } else {
    // Fireworks, the first twenty seconds: a burst every half second, above the stand.
    if (mood !== "draw" && since < 20)
      for (let i = Math.max(0, Math.floor(since / 0.5) - 3); i <= Math.floor(since / 0.5); i++) {
        const age = since - i * 0.5;
        if (age < 0 || age > 1.6) continue;
        // (On either side of the word, not behind it.)
        const cx = i % 2 ? 40 + fx(i * 3.1) * 210 : CW - 250 + fx(i * 3.1) * 210;
        const cy = 36 + fx(i * 7.7) * 170;
        const colour = colours[i % colours.length]!;
        const rise = Math.min(1, age / 0.25);
        if (rise < 1) {
          g.fillStyle = "#F3EAD7";
          g.fillRect(cx - 2, CH * 0.5 + (cy - CH * 0.5) * rise, 4, 10);
          continue;
        }
        const a2 = age - 0.25;
        const fade = Math.max(0, 1 - a2 / 1.35);
        // The flash, then the sparks with their tails, on a patch of night so that they show against the crowd.
        g.globalAlpha = fade * 0.55;
        g.fillStyle = "#0B0820";
        g.beginPath();
        g.arc(cx, cy, 30 + 120 * (1 - Math.exp(-a2 * 2.6)), 0, Math.PI * 2);
        g.fill();
        if (a2 < 0.12) {
          g.globalAlpha = 1;
          g.fillStyle = "#FFFFFF";
          g.fillRect(cx - 14, cy - 14, 28, 28);
        }
        for (let p = 0; p < 40; p++) {
          const ang = (p / 40) * Math.PI * 2 + fx(i + p) * 0.3;
          const sp = 80 + fx(i * 13 + p) * 100;
          for (let tail = 0; tail < 3; tail++) {
            const at = Math.max(0, a2 - tail * 0.05);
            const d = sp * (1 - Math.exp(-at * 2.6));
            g.globalAlpha = fade * (1 - tail * 0.3);
            g.fillStyle = tail === 0 && p % 3 === 0 ? "#FFFFFF" : colour;
            const size = 9 - tail * 2;
            g.fillRect(Math.round((cx + Math.cos(ang) * d) / 4) * 4, Math.round((cy + Math.sin(ang) * d + at * at * 40) / 4) * 4, size, size);
          }
        }
        g.globalAlpha = 1;
      }
    // Confetti: thick after a win, a sprinkle after a draw.
    const pieces = mood === "draw" ? 36 : since < 25 ? 130 : 50;
    for (let i = 0; i < pieces; i++) {
      const speed = 70 + fx(i + 50) * 90;
      const y = ((fx(i) * (CH + 60) + t * speed) % (CH + 60)) - 30;
      const x = fx(i + 100) * CW + Math.sin(t * (1 + fx(i + 150) * 2) + i) * 18;
      g.fillStyle = colours[i % colours.length]!;
      const w = Math.abs(Math.sin(t * 5 + i)) * 7 + 2;
      g.fillRect(x, y, w, 6);
    }
  }
  // The word drops in, with a bounce.
  const word = mood === "win" ? "VICTORY!" : mood === "lose" ? "DEFEAT" : mood === "draw" ? "DRAW" : "FULL TIME";
  const sub = mood === "win" ? "What a win. Enjoy it." : mood === "lose" ? "Heads up. The next one is yours." : mood === "draw" ? "A point each." : "";
  const p = Math.min(1, Math.max(0, (since - 0.3) / 0.5));
  if (p <= 0) return;
  const bounce = p < 1 ? 1 + 0.25 * Math.sin(p * Math.PI) : 1 + (mood === "win" ? 0.03 * Math.sin(t * 4) : 0);
  g.save();
  g.translate(CW / 2, 150 - (1 - p) * 120);
  g.scale(bounce, bounce);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "700 96px 'Pixelify Sans', system-ui";
  const w = Math.max(g.measureText(word).width + 80, 420);
  g.fillStyle = "#0B0820";
  g.fillRect(-w / 2 - 6, -66, w + 12, sub ? 178 : 142);
  g.fillStyle = mood === "win" ? "#F2B705" : mood === "lose" ? "#251A57" : mood === "draw" ? "#2F5DA8" : "#C8202F";
  g.fillRect(-w / 2, -60, w, sub ? 166 : 130);
  g.fillStyle = "#0B0820";
  g.fillText(word, 5, 6);
  g.fillStyle = mood === "win" ? "#C8202F" : "#F3EAD7";
  g.fillText(word, 0, 0);
  g.font = "400 30px 'Press Start 2P', monospace";
  g.fillStyle = mood === "win" ? "#0B0820" : "#F2B705";
  g.fillText(`${home} - ${away}`, 0, 66 - 4);
  if (sub) {
    g.font = "700 19px 'Archivo', system-ui";
    g.fillStyle = mood === "win" ? "#0B0820" : "#F3EAD7";
    g.fillText(sub, 0, 92);
  }
  g.restore();
}

const COIN = typeof Image !== "undefined" ? Object.assign(new Image(), { src: "/art/objects/coin.png" }) : null;

/** What the match put in your wallet: a coin and the amount counting up, under the word. */
function pay(g: G, amount: number, since: number, now: number) {
  const p = Math.min(1, Math.max(0, (since - 0.4) / 1.6));
  if (since < 0.4) return;
  const shownAmount = Math.round(amount * (1 - (1 - p) ** 3));
  const text = `+${shownAmount.toLocaleString("en-US")} G`;
  const pop = p < 1 ? 1 : 1 + 0.05 * Math.sin(now / 160);
  g.save();
  g.translate(CW / 2, 300);
  g.scale(pop, pop);
  g.font = "400 30px 'Press Start 2P', monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const w = g.measureText(`+${amount.toLocaleString("en-US")} G`).width + 110;
  g.fillStyle = "#0B0820";
  g.fillRect(-w / 2 - 5, -37, w + 10, 96);
  g.fillStyle = "#251A57";
  g.fillRect(-w / 2, -32, w, 86);
  if (COIN?.complete && COIN.naturalWidth) g.drawImage(COIN, -w / 2 + 12, -26, 52, 52);
  g.fillStyle = "#F2B705";
  g.fillText(text, 30, 0);
  g.font = "700 15px 'Archivo', system-ui";
  g.fillStyle = "#F3EAD7";
  g.fillText("in your wallet since kick-off", 0, 38);
  g.restore();
  // Coins fall while it counts.
  if (p < 1 && COIN?.complete && COIN.naturalWidth)
    for (let i = 0; i < 9; i++) {
      const a = (since * 1.4 + i / 9) % 1;
      g.globalAlpha = 1 - a;
      g.drawImage(COIN, CW / 2 - w / 2 + (i / 8) * (w - 26), 190 + a * 80, 26, 26);
    }
  g.globalAlpha = 1;
}

/** The word of the moment, bottom left, as on TV. */
function lowerThird(g: G, text: string) {
  g.font = "700 26px 'Pixelify Sans', system-ui";
  g.textAlign = "left";
  g.textBaseline = "middle";
  const w = g.measureText(text).width + 36;
  g.fillStyle = "#0B0820";
  g.fillRect(20, CH - 66, w + 6, 46);
  g.fillStyle = text === "GOAL!" ? "#F2B705" : "#C8202F";
  g.fillRect(23, CH - 63, w, 40);
  g.fillStyle = text === "GOAL!" ? "#0B0820" : "#F3EAD7";
  g.fillText(text, 41, CH - 42);
}

/** The whole pitch, small, with the part the camera shows. */
function radar(g: G, bodies: Body[][], ball: V, shirts: [string, string], gone: (side: number, k: number) => boolean, cam: number, mine: Body | null) {
  const w = 168;
  const h = 84;
  const x0 = CW - w - 20;
  const y0 = CH - h - 20;
  g.fillStyle = "#0B0820";
  g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
  g.fillStyle = "rgba(46,125,34,.92)";
  g.fillRect(x0, y0, w, h);
  g.strokeStyle = "rgba(243,234,215,.55)";
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  g.beginPath();
  g.moveTo(x0 + w / 2, y0);
  g.lineTo(x0 + w / 2, y0 + h);
  g.stroke();
  // What the camera sees.
  const view = (CW / 0.95 / PW) * w;
  g.strokeStyle = "#F2B705";
  g.strokeRect(Math.max(x0, x0 + (cam / PW) * w - view / 2), y0 + 1, Math.min(view, w), h - 2);
  for (const side of [0, 1] as const)
    for (let k = 0; k < 11; k++) {
      if (gone(side, k)) continue;
      const b = bodies[side]![k]!;
      g.fillStyle = "#0B0820";
      g.fillRect(x0 + (b.x / 100) * w - 3, y0 + (b.y / 100) * h - 3, 6, 6);
      g.fillStyle = b === mine ? "#F2B705" : shirts[side];
      g.fillRect(x0 + (b.x / 100) * w - (b === mine ? 3 : 2), y0 + (b.y / 100) * h - (b === mine ? 3 : 2), b === mine ? 6 : 4, b === mine ? 6 : 4);
    }
  g.fillStyle = "#FFFFFF";
  g.fillRect(x0 + (Math.min(100, Math.max(0, ball[0])) / 100) * w - 2, y0 + (ball[1] / 100) * h - 2, 4, 4);
}

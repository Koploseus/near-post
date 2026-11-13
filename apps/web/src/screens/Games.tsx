import { useEffect, useRef, useState } from "react";
import {
  type Challenge,
  type Duel,
  type PassRound,
  PASSER,
  PASS_ROUND_MS,
  type Press,
  type Race,
  SET_MS,
  SPRINT_M,
  defenderAt,
  dribble,
  laneAt,
  mateAt,
  passes,
  rivalAt,
  runnerAt,
  sprints,
  tackles,
} from "../../../relay/src/games.js";
import { drillSounds, holdAmbience, once } from "../lib/sound.js";
import { BLUE, H, INK, PAPER, RED, W, YELLOW, artReady, ball, banner, easeOut, figure, grass, hint, sideRunner, stands, topPlayer } from "./art.js";

type G = CanvasRenderingContext2D;
type Drag = { from: { x: number; y: number }; at: { x: number; y: number } };
/** What a game draws for one frame and tells back: each round won, lost or still open, and when it ends. */
type Frame = (g: G, t: number, trace: Press[], drag: Drag | null) => { dots: (boolean | null)[]; end: number };

const YOU = { shirt: BLUE, number: "8" };
const MATE = { shirt: BLUE, number: "9" };
const THEM = { shirt: RED, hair: "#5a3a1a" };

/**
 * A training game on a canvas. Presses (and releases, for swipes) are
 * recorded with their time and handed back at the end; ←/→ are presses on
 * the left or right half (a sidestep for swipe games).
 */
function CanvasGame(props: {
  title: string;
  help: string;
  rounds: number;
  /** Only presses count (sprint): no releases are recorded. */
  taps?: boolean;
  /** Arrow keys: presses on each half, or sideways swipes. */
  keys?: "taps" | "swipes";
  frame: Frame;
  onDone: (trace: Press[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const trace = useRef<Press[]>([]);
  const drag = useRef<Drag | null>(null);
  const [start] = useState(() => performance.now());
  const [dots, setDots] = useState<(boolean | null)[]>(Array(props.rounds).fill(null));
  const now = () => Math.round(performance.now() - start);

  // The stand's murmur and the drill's sounds while it is on screen.
  useEffect(() => {
    const [stand, words] = [holdAmbience(), drillSounds()];
    return () => (stand(), words());
  }, []);

  useEffect(() => {
    canvas.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    let finished = false;
    const loop = () => {
      const c = canvas.current;
      const g = c?.getContext("2d");
      const t = performance.now() - start;
      if (c && g) {
        g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
        const r = props.frame(g, t, trace.current, drag.current);
        setDots((prev) => (prev.join() === r.dots.join() ? prev : r.dots));
        if (!finished && t >= r.end) {
          finished = true;
          props.onDone(trace.current);
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const key = (e: KeyboardEvent) => {
      if (!props.keys || e.repeat || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const side = e.key === "ArrowLeft" ? -1 : 1;
      const t = now();
      if (props.keys === "taps") trace.current.push({ t, x: W / 2 + side * 250, y: H / 2 });
      else trace.current.push({ t, x: W / 2, y: H / 2 }, { t, x: W / 2 + side * 120, y: H / 2, up: true });
    };
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const at = (e: React.PointerEvent) => {
    const b = canvas.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - b.left) / b.width) * W), y: Math.round(((e.clientY - b.top) / b.height) * H) };
  };
  const won = dots.filter((d) => d === true).length;

  return (
    <div className="drill-wrap">
      <div className="drill-head">
        <span>
          {props.title} · {won} / {props.rounds}
        </span>
        <span className="pen-dots" aria-label="Rounds">
          {dots.map((s, i) => (
            <i key={i} className={s === null ? "" : s ? "in" : "out"} />
          ))}
        </span>
      </div>
      <canvas
        ref={canvas}
        className="game-canvas"
        width={W * 2}
        height={H * 2}
        role="application"
        aria-label={`${props.title}: ${props.help}`}
        onPointerDown={(e) => {
          const p = at(e);
          trace.current.push({ t: now(), ...p });
          if (!props.taps) {
            (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
            drag.current = { from: p, at: p };
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) drag.current = { ...drag.current, at: at(e) };
        }}
        onPointerUp={(e) => {
          if (props.taps) return;
          trace.current.push({ t: now(), ...at(e), up: true });
          drag.current = null;
        }}
      />
      <p className="note pen-help">{props.help}</p>
    </div>
  );
}

/** Index of the round being played at `t` (the last one once all are over). */
function current<T extends { end: number }>(rounds: T[], t: number): number {
  const i = rounds.findIndex((r) => t < r.end);
  return i < 0 ? rounds.length - 1 : i;
}

// ------------------------------------------------------------ through balls

const PASS_VERDICT = { received: "ON HIS FEET!", cut: "CUT OUT!", overhit: "TOO LONG!", short: "TOO SHORT!" } as const;

export function PassesGame({ setup, onDone }: { setup: PassRound[]; onDone: (trace: Press[]) => void }) {
  const frame: Frame = (g, t, trace, drag) => {
    const plays = passes(setup, trace);
    const i = current(plays, t);
    const p = plays[i]!;
    const round = setup[i]!;
    const ms = Math.max(0, t - p.start);
    const pass = p.pass && t >= p.pass.up.t ? p.pass : null;
    if (pass) once(`pass:${p.start}`, "kick", (pass.speed - 0.45) / 0.85);
    const resolveAt = (q: (typeof plays)[number]) => (q.pass ? q.pass.up.t + q.pass.flight * q.pass.cutF : q.end);
    const dots = plays.map((q, k) => (t >= resolveAt(q) || t >= q.end ? q.pass?.result === "received" : k < i ? false : null));

    topPitch(g, t);
    // The ball's path, once played.
    let bx: number = PASSER.x;
    let by: number = PASSER.y;
    let spin = 0;
    const mate = mateAt(round.mate, ms);
    if (pass) {
      const f = (t - pass.up.t) / pass.flight;
      const dx = pass.up.x - PASSER.x;
      const dy = pass.up.y - PASSER.y;
      spin = (t - pass.up.t) / 60;
      if (pass.result === "cut" && f >= pass.cutF) spin = 0;
      else if (f < 1) [bx, by] = [PASSER.x + dx * f, PASSER.y + dy * f];
      else if (pass.result === "received") [bx, by] = [mate.x, mate.y - 20];
      else if (pass.result === "overhit") {
        const more = Math.min(0.45, (f - 1) * 0.6);
        [bx, by] = [PASSER.x + dx * (1 + more), PASSER.y + dy * (1 + more)];
      } else [bx, by] = [pass.up.x, pass.up.y];
    }
    // The teammate makes his run, defenders shift across (one carries the ball away if he cut it out).
    const got = pass?.result === "received" && t >= pass.up.t + pass.flight;
    topPlayer(g, mate.x, mate.y, MATE, Math.atan2(round.mate.vx, -round.mate.vy), got ? 0 : t / 75, 1, got ? "joy" : undefined);
    round.defenders.forEach((d, n) => {
      let at = defenderAt(d, ms);
      if (pass?.result === "cut" && pass.cutBy === n) {
        const when = pass.up.t + pass.flight * pass.cutF;
        if (t >= when) {
          const from = defenderAt(d, when - p.start);
          at = { x: from.x, y: from.y + 0.12 * (t - when) };
          [bx, by] = [at.x, at.y + 20];
        }
      }
      const won = pass?.result === "cut" && pass.cutBy === n && t >= pass.up.t + pass.flight * pass.cutF;
      topPlayer(g, at.x, at.y, THEM, Math.PI, t / 110 + n, 1, won ? "joy" : undefined);
    });
    topPlayer(g, PASSER.x, PASSER.y + 26, YOU, 0, 0, 1, pass && t - pass.up.t < 350 ? "pass" : undefined);
    ball(g, bx, by, 10, spin, false);

    if (drag && !p.pass && Math.hypot(drag.from.x - PASSER.x, drag.from.y - PASSER.y) <= PASSER.grab) aimLine(g, PASSER, drag.at);
    else if (!p.pass && t < p.end) {
      // His run, as a hint, and the time left to play the ball.
      g.save();
      g.setLineDash([6, 10]);
      g.strokeStyle = "rgba(243,234,215,.45)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(mate.x, mate.y);
      const ahead = mateAt(round.mate, ms + 1_200);
      g.lineTo(ahead.x, ahead.y);
      g.stroke();
      g.restore();
      const left = 1 - ms / PASS_ROUND_MS;
      cells(g, 350, 580, 300, 12, Math.max(0, left), left > 0.3 ? YELLOW : RED);
      hint(g, i === 0 && ms < 3_500 ? "Drag from the ball to where he will be, release" : `Pass ${i + 1} of ${plays.length}`, 470);
    }
    if (p.pass && t >= resolveAt(p)) {
      const r = p.pass.result;
      banner(g, PASS_VERDICT[r], r === "received", t - resolveAt(p), 420);
    }
    return { dots, end: plays[plays.length - 1]!.end };
  };
  return <CanvasGame title="Through balls" help="Drag from the ball to where your teammate will be and release, away from the defenders. A quick swipe plays it harder: harder to cut out, harder to control." rounds={setup.length} frame={frame} onDone={onDone} />;
}

/** A meter in square cells (the kit never draws a smooth bar): `p` 0..1 of them lit. */
function cells(g: G, x: number, y: number, w: number, h: number, p: number, on: string) {
  const n = 10;
  const gap = 3;
  const cw = (w - gap * (n - 1)) / n;
  g.fillStyle = "#0B0820";
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  for (let k = 0; k < n; k++) {
    g.fillStyle = k < Math.round(p * n) ? on : "#251A57";
    g.fillRect(x + k * (cw + gap), y, cw, h);
  }
}

/** The final third seen from above: you attack upwards. */
function topPitch(g: G, t: number) {
  for (let y = 0, n = 0; y < H; y += 60, n++) {
    g.fillStyle = n % 2 ? "#4AB226" : "#5BC72E";
    g.fillRect(0, y, W, 60);
  }
  g.strokeStyle = "rgba(243,234,215,.9)";
  g.lineWidth = 3;
  g.strokeRect(14, -10, W - 28, H + 20);
  g.strokeRect(210, -10, 580, 200);
  g.strokeRect(390, -10, 220, 80);
  g.beginPath();
  g.arc(500, 135, 95, 0.62, Math.PI - 0.62);
  g.stroke();
  g.fillStyle = PAPER;
  g.beginPath();
  g.arc(500, 135, 4, 0, Math.PI * 2);
  g.fill();
  // The goal and its keeper.
  g.fillStyle = "rgba(255,255,255,.25)";
  g.fillRect(450, 0, 100, 8);
  g.strokeStyle = "#fffaf0";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(450, 0);
  g.lineTo(450, 10);
  g.moveTo(550, 0);
  g.lineTo(550, 10);
  g.stroke();
  topPlayer(g, 500 + Math.sin(t / 700) * 22, 26, { shirt: YELLOW }, Math.PI, 0, 0.9);
}

function aimLine(g: G, from: { x: number; y: number }, to: { x: number; y: number }) {
  g.save();
  g.setLineDash([10, 9]);
  g.strokeStyle = "rgba(255,255,255,.85)";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(to.x, to.y);
  g.stroke();
  g.setLineDash([]);
  g.lineWidth = 3;
  g.beginPath();
  g.arc(to.x, to.y, 26, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

// ------------------------------------------------------------ dribble

/** Screen place of a point `s` deep (0 far, 1 at your feet) in lane `lane` (-1..1, fractional). */
function depth(s: number, lane: number, bottom = 585) {
  const y = 205 + (bottom - 205) * Math.max(0, s) ** 1.5;
  return { x: 500 + lane * 230 * (0.25 + 0.75 * s), y, scale: 0.1 + 0.52 * s };
}

export function DribbleGame({ setup, onDone }: { setup: Challenge[]; onDone: (trace: Press[]) => void }) {
  const frame: Frame = (g, t, trace) => {
    const play = dribble(setup, trace);
    const lane = (at: number) => [0, 37, 73, 110].reduce((sum, d) => sum + laneAt(trace, at + d), 0) / 4;
    const you = lane(t);
    const dots = play.challenges.map((c) => (t >= c.arriveAt ? c.dodged : null));
    const lost = play.challenges.find((c) => !c.dodged && t >= c.arriveAt && t < c.arriveAt + 900);

    stands(g, t, -1);
    grass(g, 182, lost ? 0 : t / 420);
    g.strokeStyle = "rgba(243,234,215,.5)";
    g.lineWidth = 3;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(500 + side * 120, 182);
      g.lineTo(500 + side * 760, H);
      g.stroke();
    }

    // Defenders coming in, the farthest first.
    const shown = play.challenges
      .filter((c) => t >= c.commitAt - 1_500 && t < c.arriveAt + 900)
      .map((c) => {
        let s: number;
        if (t < c.commitAt) s = 0.62 * ((t - (c.commitAt - 1_500)) / 1_500);
        else if (t < c.arriveAt) s = 0.62 + 0.38 * ((t - c.commitAt) / (c.arriveAt - c.commitAt));
        else s = c.dodged ? 1 + 0.6 * ((t - c.arriveAt) / 900) : 1;
        const tracked = t < c.commitAt ? lane(t - 250) + c.from * 1.2 * (1 - s / 0.62) : c.target;
        return { c, s, lane: tracked };
      })
      .sort((a, b) => a.s - b.s);
    const draw = (d: (typeof shown)[number]) => {
      const p = depth(d.s, d.lane);
      const slide = d.s >= 0.62 ? easeOut((t - d.c.commitAt) / (d.c.arriveAt - d.c.commitAt)) : 0;
      figure(g, p.x, p.y, p.scale, THEM, { back: false, stride: slide ? 0 : t / 70, lean: slide ? -d.c.from * 0.4 : 0, slide });
    };
    shown.filter((d) => d.s < 1).forEach(draw);

    // You, with the ball in front of you.
    const me = depth(1, you);
    const bx = lost ? me.x + lost.from * -400 * easeOut((t - lost.arriveAt) / 600) : me.x + 14;
    // The illustrated player already has the ball at his feet; the ball is drawn when it gets away.
    if (lost || !artReady(true)) ball(g, bx + 26, me.y - 22 - Math.abs(Math.sin(t / 170)) * 7, 13, t / 90, true);
    figure(g, me.x, me.y + 10, 0.6, { ...YOU, number: "10" }, { back: true, stride: lost ? 0 : t / 80, lean: lost ? lost.from : (lane(t + 60) - you) * 0.6, act: lost ? "down" : "ball" });
    shown.filter((d) => d.s >= 1).forEach(draw);

    const resolved = [...play.challenges].reverse().find((c) => t >= c.arriveAt && t < c.arriveAt + 900);
    if (resolved) banner(g, resolved.dodged ? "OLÉ!" : "TACKLED!", resolved.dodged, t - resolved.arriveAt, 260);
    else if (t < setup[0]!.commitAt) hint(g, "Swipe left or right (← →) as he slides in", 110);
    const next = play.challenges.findIndex((c) => t < c.arriveAt);
    if (next >= 0 && !resolved && t >= setup[0]!.commitAt) hint(g, `Defender ${next + 1} of ${setup.length}`, 110);
    return { dots, end: play.end };
  };
  return <CanvasGame title="Dribble" help="Defenders come in with slide tackles. Swipe left or right (or ← →) once he commits, before he gets to you. Stay in your lane until then." rounds={setup.length} keys="swipes" frame={frame} onDone={onDone} />;
}

// ------------------------------------------------------------ sprint

const START_X = 90;
const BALL_X = 900;
const PX_PER_M = (BALL_X - START_X) / SPRINT_M;

export function SprintGame({ setup, onDone }: { setup: Race[]; onDone: (trace: Press[]) => void }) {
  const frame: Frame = (g, t, trace) => {
    const races = sprints(setup, trace);
    const i = current(races, t);
    const r = races[i]!;
    const race = setup[i]!;
    const ms = t - r.go;
    const over = r.go + (r.won ? r.you! : r.rival);
    const dots = races.map((q) => (t >= q.go + (q.won ? q.you! : q.rival) ? q.won : null));
    const me = runnerAt(trace, r.go, Math.max(0, Math.min(ms, over - r.go)));
    const dYou = Math.min(SPRINT_M, me.d);
    const dRival = Math.min(SPRINT_M, rivalAt(race, Math.min(ms, over - r.go)));
    const rivalV = Math.min(1, (rivalAt(race, ms + 10) - rivalAt(race, ms)) * 10);

    stands(g, t, r.won && t >= over ? t - over : -1);
    // The pitch from the side: a touchline, the stripes and the lanes.
    g.fillStyle = "#5BC72E";
    g.fillRect(0, 182, W, H - 182);
    for (let x = 0, n = 0; x < W; x += 90, n++) {
      g.fillStyle = n % 2 ? "#4AB226" : "#5BC72E";
      g.beginPath();
      g.moveTo(x, 182);
      g.lineTo(x + 90, 182);
      g.lineTo(x + 90 + 60, H);
      g.lineTo(x + 60, H);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = "rgba(243,234,215,.85)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(START_X, 400);
    g.lineTo(START_X + 20, 590);
    g.stroke();

    // The ball, played into space at GO, then at the feet of whoever gets there.
    const roll = ms > 0 ? easeOut(ms / 1_500) : 0;
    let bx = BALL_X - 260 * (1 - roll);
    let by = 500;
    if (t >= over) {
      const win = r.won ? 560 : 440;
      bx = BALL_X + 30 * easeOut((t - over) / 500);
      by = win;
    }
    const ended = t >= over ? (r.won ? "won" : "lost") : undefined;
    sideRunner(g, START_X + 40 + dRival * PX_PER_M * 0.96, 440, 0.78, THEM, dRival * 1.15, ms < 0 ? 0 : rivalV, { rival: true, set: ms < 0, end: ended });
    ball(g, bx, by, 13, ms > 0 ? (bx - BALL_X) / 13 : 0, true);
    sideRunner(g, START_X + dYou * PX_PER_M, 568, 1, YOU, dYou * 1.15, me.v / 10, { set: ms < 0, end: ended });

    // Foot pads: the one to press next glows.
    const last = [...trace].reverse().find((p) => !p.up && p.t >= r.go && p.t <= t);
    const nextSide = last ? (last.x < W / 2 ? 1 : -1) : 0;
    for (const side of [-1, 1]) {
      const x = side < 0 ? 20 : W - 220;
      const pressed = last && (last.x < W / 2 ? -1 : 1) === side && t - last.t < 120;
      g.fillStyle = pressed ? YELLOW : nextSide === side && ms > 0 && t < over ? "rgba(242,183,5,.45)" : "rgba(18,25,51,.55)";
      g.beginPath();
      g.roundRect(x, 196, 200, 46, 10);
      g.fill();
      g.fillStyle = pressed ? INK : PAPER;
      g.font = "700 22px 'Pixelify Sans', system-ui";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(side < 0 ? "◀  LEFT" : "RIGHT  ▶", x + 100, 220);
    }
    // Speed.
    cells(g, 380, 206, 240, 18, me.v / 10, me.v > 8 ? YELLOW : PAPER);

    if (ms < 0) {
      const early = trace.some((p) => !p.up && p.t >= r.start && p.t < r.go && t - p.t < 700);
      banner(g, ms < -SET_MS / 2 ? "READY…" : "SET…", false, t - r.start, 330);
      if (early) hint(g, "Wait for GO: that one did not count", 400);
      else if (i === 0) hint(g, "After GO, press left and right in turn (← →)", 400);
    } else if (t < over) {
      if (ms < 600) banner(g, "GO!", true, ms, 330);
    } else banner(g, r.won ? "FIRST TO IT!" : "TOO SLOW!", r.won, t - over, 330);
    return { dots, end: races[races.length - 1]!.end };
  };
  return <CanvasGame title="Sprint" help="Race the defender to the ball. After GO, press left and right in turn (or ← →): the faster the rhythm, the faster you run. The same side twice is a stumble." rounds={setup.length} taps keys="taps" frame={frame} onDone={onDone} />;
}

// ------------------------------------------------------------ tackles

export function TacklesGame({ setup, onDone }: { setup: Duel[]; onDone: (trace: Press[]) => void }) {
  const frame: Frame = (g, t, trace) => {
    const duels = tackles(setup, trace);
    const i = current(duels, t);
    const d = duels[i]!;
    const resolveAt = (x: (typeof duels)[number]) => (x.tackle ? x.tackle.at + 150 : x.start + x.run);
    const dots = duels.map((x) => (t >= resolveAt(x) ? x.won : null));
    const ms = t - d.start;
    const end = d.start + d.run;

    stands(g, t, -1);
    grass(g, 182, 0);
    g.strokeStyle = "rgba(243,234,215,.6)";
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(500, 470, 300, 70, 0, Math.PI, Math.PI * 2);
    g.stroke();

    // The attacker: runs at you, maybe shapes one way, then cuts.
    let s = t < d.cutAt ? 0.72 * Math.max(0, ms / (d.cutAt - d.start)) : 0.72 + 0.43 * ((t - d.cutAt) / (end - d.cutAt));
    let offset = 0;
    let lean = 0;
    if (d.feintAt !== null && t >= d.feintAt && t < d.feintAt + 380) {
      const f = Math.sin(Math.PI * ((t - d.feintAt) / 380));
      offset = -d.side * 0.35 * f;
      lean = -d.side * 0.3 * f;
    }
    if (t >= d.cutAt) {
      const c = easeOut((t - d.cutAt) / 450);
      offset = d.side * 1.4 * c;
      lean = d.side * 0.3 * (1 - c);
    }
    const won = d.won && d.tackle && t >= d.tackle.at;
    if (won) s = Math.min(s, 0.82);
    const a = depth(Math.min(s, 1.05), offset, 560);
    const behind = s < 0.95;

    // You, from behind, sliding in when you go for it.
    const me = () => {
      const p = d.tackle ? easeOut((t - (d.tackle.at - 60)) / 250) : 0;
      const side = d.tackle?.side ?? 0;
      figure(g, 500 + side * 150 * p, 600, 0.62, { ...YOU, number: "4" }, { back: true, stride: 0, lean: side, slide: p });
    };
    const attacker = () => {
      figure(g, a.x, a.y, a.scale, THEM, { back: false, stride: won ? 0 : t / 75, lean: won ? -d.tackle!.side * 0.5 : lean, act: won ? "beaten" : "ball" });
      // The ball runs just ahead of his leading foot, on the side he goes.
      let bx = a.x + (t >= d.cutAt ? d.side : 0.4) * 34 * a.scale;
      let by = a.y - 6 * a.scale;
      if (won) {
        const k = easeOut((t - d.tackle!.at) / 700);
        bx += d.tackle!.side * 240 * k;
        by += 40 * k - Math.sin(Math.PI * k) * 90;
      }
      // The illustrated attacker has the ball at his feet until you win it.
      if (won || !artReady(false)) ball(g, bx, by, Math.max(5, 22 * a.scale), t / 80, true);
    };
    if (behind) {
      attacker();
      me();
    } else {
      me();
      attacker();
    }

    if (t >= resolveAt(d)) {
      const text = d.won
        ? "CLEAN TACKLE!"
        : !d.tackle
          ? "HE'S THROUGH!"
          : d.tackle.side !== d.side
            ? d.feintAt !== null && d.tackle.at < d.cutAt
              ? "SOLD BY THE FEINT!"
              : "WRONG WAY!"
            : d.tackle.at < d.cutAt - 130
              ? "TOO EARLY!"
              : "TOO LATE!";
      banner(g, text, d.won, t - resolveAt(d), 260);
    } else if (i === 0 && ms < 1_800) hint(g, "Swipe to the side he cuts to (← →), as he cuts", 110);
    else hint(g, `Duel ${i + 1} of ${duels.length}`, 110);
    return { dots, end: duels[duels.length - 1]!.end };
  };
  return <CanvasGame title="Tackles" help="An attacker runs at you and cuts left or right, sometimes after a feint. Swipe to his side (or ← →) as he cuts: too early and he goes the other way, too late and he is gone." rounds={setup.length} keys="swipes" frame={frame} onDone={onDone} />;
}

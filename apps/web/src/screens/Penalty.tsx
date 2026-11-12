import { useEffect, useRef, useState } from "react";
import {
  BALL,
  GOAL_M,
  GOAL_SCREEN,
  type Kick,
  type PenaltySetup,
  type Press,
  goals,
  penalties,
  sway,
  toScreen,
} from "../../../relay/src/penalty.js";
import { H, INK, SKIN, W, ball, banner, hint, shadow, stands } from "./art.js";

const KEEPER = "#F2B705";
const SHIRT = "#2F5DA8";

const VERDICT: Record<string, string> = {
  goal: "GOAL!",
  saved: "SAVED!",
  wide: "WIDE!",
  over: "OVER THE BAR!",
  post: "OFF THE POST!",
  none: "TOO LATE",
};

/**
 * The penalty game, drawn on a canvas from behind the ball. Press on the
 * ball, drag to where you aim in the goal and let go: a quick swipe is a hard
 * shot. The outcome comes from penalty.ts, the same code the relay replays.
 */
export function PenaltyGame({ setup, onDone }: { setup: PenaltySetup; onDone: (trace: Press[]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const trace = useRef<Press[]>([]);
  const aiming = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [start] = useState(() => performance.now());
  const [score, setScore] = useState<(boolean | null)[]>(Array(setup.kicks.length).fill(null));

  useEffect(() => {
    canvas.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    let finished = false;
    const frame = () => {
      const t = performance.now() - start;
      const kicks = penalties(setup, trace.current);
      draw(canvas.current, kicks, t, setup, aiming.current, pointer.current);
      const done = kicks.map((k) => (k.shot && t >= k.shot.up + k.shot.flight ? k.shot.result === "goal" : t >= k.end ? false : null));
      setScore((prev) => (prev.join() === done.join() ? prev : done));
      const last = kicks[kicks.length - 1]!;
      // Over once the last kick is shot and replayed (or timed out).
      if (!finished && t >= last.end) {
        finished = true;
        onDone(trace.current);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const at = (e: React.PointerEvent) => {
    const b = canvas.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - b.left) / b.width) * W), y: Math.round(((e.clientY - b.top) / b.height) * H) };
  };
  const now = () => Math.round(performance.now() - start);

  return (
    <div className="drill-wrap">
      <div className="drill-head">
        <span>
          Penalties · {goals(penalties(setup, trace.current))} goal{goals(penalties(setup, trace.current)) === 1 ? "" : "s"}
        </span>
        <span className="pen-dots" aria-label="Kicks">
          {score.map((s, i) => (
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
        aria-label="Penalty: press on the ball, drag to where you aim in the goal, release. A quick swipe shoots harder."
        onPointerDown={(e) => {
          const p = at(e);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          trace.current.push({ t: now(), ...p });
          if (Math.hypot(p.x - BALL.x, p.y - BALL.y) <= BALL.grab) aiming.current = p;
        }}
        onPointerMove={(e) => {
          pointer.current = at(e);
        }}
        onPointerUp={(e) => {
          trace.current.push({ t: now(), ...at(e), up: true });
          aiming.current = null;
        }}
      />
      <p className="note pen-help">Press on the ball, drag to where you aim, release. A firm swipe beats the keeper; a flick drifts, a slow shot gives him time.</p>
    </div>
  );
}

function draw(
  c: HTMLCanvasElement | null,
  kicks: Kick[],
  t: number,
  setup: PenaltySetup,
  aim: { x: number; y: number } | null,
  pointer: { x: number; y: number } | null,
) {
  const g = c?.getContext("2d");
  if (!c || !g) return;
  g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
  const i = Math.max(0, kicks.findIndex((k) => t < k.end));
  const k = kicks[i] ?? kicks[kicks.length - 1]!;
  const shot = k.shot && t >= k.shot.up ? k.shot : null;
  const landed = shot ? Math.min(1, (t - shot.up) / shot.flight) : 0;
  const scored = shot && landed >= 1 && shot.result === "goal";

  stands(g, t, scored ? t - (shot!.up + shot!.flight) : -1);
  pitch(g);
  goalBack(g);

  // The keeper: swaying, then diving.
  const p = setup.kicks[i]!;
  let kx = sway(p.phase, Math.max(0, (shot ? shot.up : t) - k.start));
  let dive = 0;
  let lift = 0;
  if (shot) {
    const d = Math.min(1, Math.max(0, (t - shot.keeper.reactAt) / Math.max(1, shot.keeper.reachAt - shot.keeper.reactAt)));
    const ease = 1 - (1 - d) * (1 - d);
    kx = shot.keeper.from + (shot.keeper.to - shot.keeper.from) * ease;
    dive = Math.sign(shot.keeper.to - shot.keeper.from || 0.01) * Math.min(1, Math.abs(shot.keeper.to - shot.keeper.from) / 1.2) * ease;
    lift = Math.min(shot.target.y, 1.6) * ease * (Math.abs(dive) > 0.3 ? 1 : 0.4);
  }
  keeper(g, kx, dive, lift, t);
  goalFront(g, scored ? Math.min(1, (t - (shot!.up + shot!.flight)) / 300) : 0, shot);

  // The ball.
  if (!shot) {
    ball(g, BALL.x, BALL.y, 19, 0);
    taker(g, 0);
  } else {
    const to = toScreen(shot.target.x, shot.target.y);
    let bx: number;
    let by: number;
    let r: number;
    if (landed < 1) {
      bx = BALL.x + (to.x - BALL.x) * landed;
      by = BALL.y + (to.y - BALL.y) * landed - Math.sin(landed * Math.PI) * 30;
      r = 19 - 11 * landed;
      shadow(g, bx, BALL.y + (GOAL_SCREEN.bottom + 4 - BALL.y) * landed, r);
    } else {
      const after = Math.min(1, (t - shot.up - shot.flight) / 700);
      if (shot.result === "goal") [bx, by, r] = [to.x + (to.x - 500) * 0.06 * after, to.y - 8 * after + 30 * after * after, 8];
      else if (shot.result === "saved") [bx, by, r] = [to.x + Math.sign(to.x - 500 || 1) * 160 * after, to.y - 60 * Math.sin(after * Math.PI) + 40 * after, 8 + 3 * after];
      else if (shot.result === "post") [bx, by, r] = [to.x - Math.sign(to.x - 500 || 1) * 90 * after, to.y + 120 * after, 8 + 4 * after];
      else [bx, by, r] = [to.x + (to.x - 500) * 0.5 * after, to.y - 50 * after, 8 - 3 * after];
    }
    taker(g, Math.min(1, (t - shot.up + 250) / 350));
    ball(g, bx, by, Math.max(4, r), (t - shot.up) / 40);
    if (landed >= 1) banner(g, VERDICT[shot.result]!, shot.result === "goal", t - shot.up - shot.flight);
  }

  // Aiming: the line from the ball and the power of the swipe so far.
  if (aim && pointer && !k.shot) {
    g.save();
    g.setLineDash([10, 9]);
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(BALL.x, BALL.y);
    g.lineTo(pointer.x, pointer.y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(255,255,255,.9)";
    g.beginPath();
    g.arc(pointer.x, pointer.y, 9, 0, Math.PI * 2);
    g.fill();
    g.restore();
  } else if (!k.shot && t < k.end) {
    hint(g, i === 0 && t - k.start < 4000 ? "Press on the ball, drag to your target, release" : `Penalty ${i + 1} of ${kicks.length}`);
  }
}

export function pitch(g: CanvasRenderingContext2D) {
  // Mowing stripes in perspective: bands grow towards the viewer.
  let y = 182;
  for (let n = 0; y < H; n++) {
    const h = 12 + n * 7;
    g.fillStyle = n % 2 ? "#4AB226" : "#5BC72E";
    g.fillRect(0, y, W, h);
    y += h;
  }
  g.strokeStyle = "rgba(243,234,215,.9)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, GOAL_SCREEN.bottom);
  g.lineTo(W, GOAL_SCREEN.bottom);
  // Six-yard box and penalty area, in perspective.
  g.moveTo(232, GOAL_SCREEN.bottom);
  g.lineTo(206, 372);
  g.lineTo(794, 372);
  g.lineTo(768, GOAL_SCREEN.bottom);
  g.moveTo(120, GOAL_SCREEN.bottom);
  g.lineTo(40, 470);
  g.lineTo(960, 470);
  g.lineTo(880, GOAL_SCREEN.bottom);
  g.stroke();
  // The arc beyond the area.
  g.beginPath();
  g.ellipse(500, 470, 140, 40, 0, 0, Math.PI);
  g.stroke();
  // The spot.
  g.fillStyle = "#F3EAD7";
  g.beginPath();
  g.ellipse(BALL.x, BALL.y + 14, 9, 4, 0, 0, Math.PI * 2);
  g.fill();
}

const BACK = { left: 322, right: 678, top: 190, bottom: 318 };

export function goalBack(g: CanvasRenderingContext2D) {
  // The inside of the goal: dark, then the net.
  g.fillStyle = "rgba(14,20,40,.55)";
  g.beginPath();
  g.moveTo(GOAL_SCREEN.left, GOAL_SCREEN.top);
  g.lineTo(BACK.left, BACK.top);
  g.lineTo(BACK.right, BACK.top);
  g.lineTo(GOAL_SCREEN.right, GOAL_SCREEN.top);
  g.lineTo(GOAL_SCREEN.right, GOAL_SCREEN.bottom);
  g.lineTo(GOAL_SCREEN.left, GOAL_SCREEN.bottom);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.35)";
  g.lineWidth = 1;
  for (let x = BACK.left; x <= BACK.right; x += 14) {
    g.beginPath();
    g.moveTo(x, BACK.top);
    g.lineTo(x, BACK.bottom);
    g.stroke();
  }
  for (let y = BACK.top; y <= BACK.bottom; y += 13) {
    g.beginPath();
    g.moveTo(BACK.left, y);
    g.lineTo(BACK.right, y);
    g.stroke();
  }
  // Side nets.
  for (const [a, b] of [
    [GOAL_SCREEN.left, BACK.left],
    [GOAL_SCREEN.right, BACK.right],
  ] as const) {
    for (let s = 0; s <= 1; s += 0.2) {
      g.beginPath();
      g.moveTo(a + (b - a) * s, GOAL_SCREEN.top + (BACK.top - GOAL_SCREEN.top) * s);
      g.lineTo(a + (b - a) * s, GOAL_SCREEN.bottom + (BACK.bottom - GOAL_SCREEN.bottom) * s);
      g.stroke();
    }
  }
}

export function goalFront(g: CanvasRenderingContext2D, bulge: number, shot: { target: { x: number; y: number } } | null) {
  if (bulge > 0 && shot) {
    // The net bulges where the ball went in.
    const p = toScreen(shot.target.x, shot.target.y);
    g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - bulge * 0.5)})`;
    g.lineWidth = 2;
    for (let r = 10; r < 60; r += 12) {
      g.beginPath();
      g.ellipse(p.x, p.y - 8, r * (0.6 + bulge), r * 0.6 * (0.6 + bulge), 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  g.strokeStyle = "#fffaf0";
  g.lineWidth = 9;
  g.lineCap = "square";
  g.beginPath();
  g.moveTo(GOAL_SCREEN.left, GOAL_SCREEN.bottom);
  g.lineTo(GOAL_SCREEN.left, GOAL_SCREEN.top);
  g.lineTo(GOAL_SCREEN.right, GOAL_SCREEN.top);
  g.lineTo(GOAL_SCREEN.right, GOAL_SCREEN.bottom);
  g.stroke();
  g.lineCap = "butt";
}

/** The keeper, `x` metres from the centre of his line; `dive` -1..1 leans him over; `lift` metres up. */
export function keeper(g: CanvasRenderingContext2D, x: number, dive: number, lift: number, t: number) {
  const base = toScreen(x, 0);
  const s = (GOAL_SCREEN.bottom - GOAL_SCREEN.top) / GOAL_M.height; // px per metre
  const bounce = dive === 0 ? Math.abs(Math.sin(t / 260)) * 3 : 0;
  g.save();
  g.translate(base.x, base.y - lift * s * 0.55 - bounce);
  g.rotate(dive * 1.25);
  // Shadow is drawn unrotated by the caller's ground; keep it simple here.
  const limb = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const spread = dive === 0 ? 0 : 1;
  // Legs.
  limb(-10, -48, -18 - spread * 6, -4, 13, INK);
  limb(10, -48, 18 + spread * 6, -4, 13, INK);
  limb(-18 - spread * 6, -10, -19 - spread * 6, 0, 13, "#fffaf0");
  limb(18 + spread * 6, -10, 19 + spread * 6, 0, 13, "#fffaf0");
  // Arms: out low when waiting, stretched when diving.
  const reach = dive === 0 ? 0 : 1;
  limb(-20, -82, -46 - reach * 6, -60 - reach * 52, 11, KEEPER);
  limb(20, -82, 46 + reach * 6, -60 - reach * 52, 11, KEEPER);
  g.fillStyle = "#fffaf0";
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.arc(sx * (48 + reach * 6), -58 - reach * 54, 8.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // Body and shorts.
  g.fillStyle = KEEPER;
  g.beginPath();
  g.roundRect(-22, -98, 44, 52, 10);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.fillRect(-20, -52, 40, 12);
  // Head.
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(0, -110, 13, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#2A1A10";
  g.beginPath();
  g.arc(0, -114, 13, Math.PI, 0);
  g.fill();
  g.restore();
}

/** The penalty taker, seen from behind at the bottom left; `kick` 0..1 swings his leg. */
export function taker(g: CanvasRenderingContext2D, kick: number) {
  const k = Math.max(0, Math.min(1, kick));
  g.save();
  g.translate(390 + 40 * k, 640 - 10 * k);
  const limb = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  limb(26, -112, 40 + 60 * k, -40 - 30 * k, 22, "#fffaf0"); // kicking leg
  limb(-14, -112, -20, -20, 22, "#fffaf0");
  g.fillStyle = INK;
  g.fillRect(-30, -150, 70, 44);
  g.fillStyle = SHIRT;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-36, -236, 82, 92, 16);
  g.fill();
  g.stroke();
  g.fillStyle = "#F2B705";
  g.font = "900 40px 'Archivo Black', system-ui";
  g.textAlign = "center";
  g.fillText("9", 5, -176);
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(5, -258, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2A1A10";
  g.beginPath();
  g.arc(5, -262, 22, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  g.restore();
}

import { useEffect, useRef } from "react";
import { BALL, GOAL_SCREEN, toScreen } from "../../../relay/src/penalty.js";
import { BLUE, H, INK, RED, W, ball, banner, easeOut, figure, grass, hint, shadow, stands } from "./art.js";
import { goalBack, goalFront, keeper, pitch, taker } from "./Penalty.js";

export type HighlightKind = "goal" | "own_goal" | "penalty_goal" | "penalty_saved" | "penalty_missed" | "free_kick_goal" | "free_kick_saved" | "free_kick_missed" | "red";

export interface HighlightMoment {
  kind: HighlightKind;
  /** Who did it, and for which club. */
  name: string;
  team: string;
  /** Varies the scene (corner, side, height). */
  seed: number;
}

export const HIGHLIGHT_MS = 3_800;
const STRIKE = 900;
const FLIGHT = 520;

const TITLE: Record<HighlightKind, string> = {
  goal: "GOAL!",
  own_goal: "OWN GOAL!",
  penalty_goal: "GOAL!",
  penalty_saved: "SAVED!",
  penalty_missed: "MISSED!",
  free_kick_goal: "WHAT A FREE KICK!",
  free_kick_saved: "SAVED!",
  free_kick_missed: "OVER THE BAR!",
  red: "SENT OFF!",
};

/**
 * A three-second replay of a big moment of the live match, drawn like the
 * training games: the shot from behind the taker, the keeper's dive, the
 * net, the crowd; or the referee's red card.
 */
export function Highlight({ m, onEnd }: { m: HighlightMoment; onEnd: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const frame = () => {
      const t = performance.now() - start;
      const c = canvas.current;
      const g = c?.getContext("2d");
      if (c && g) {
        g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
        if (m.kind === "red") redCard(g, t, m);
        else shot(g, t, m);
      }
      if (t >= HIGHLIGHT_MS) onEnd();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);
  return (
    <button type="button" className="highlight" onClick={onEnd} aria-label={`${TITLE[m.kind]} ${m.name}, ${m.team}. Tap to skip.`}>
      <canvas ref={canvas} width={W * 2} height={H * 2} />
    </button>
  );
}

function shot(g: CanvasRenderingContext2D, t: number, m: HighlightMoment) {
  const side = m.seed % 2 ? 1 : -1;
  const free = m.kind.startsWith("free_kick");
  const pen = m.kind.startsWith("penalty");
  const scored = m.kind.endsWith("goal");
  const saved = m.kind.endsWith("saved");
  // Where the ball crosses the line (metres from the centre, up from the grass).
  const target = scored
    ? { x: side * (2.4 + (m.seed % 7) / 8), y: 0.4 + ((m.seed >> 3) % 5) / 4 }
    : saved
      ? { x: side * (1.2 + (m.seed % 5) / 6), y: 0.6 + ((m.seed >> 2) % 3) / 4 }
      : free
        ? { x: side * 1.5, y: 2.9 }
        : { x: side * 4.3, y: 0.9 };
  const flying = t >= STRIKE;
  const f = Math.min(1, Math.max(0, (t - STRIKE) / FLIGHT));
  const after = t - STRIKE - FLIGHT;
  const cheer = scored && after > 0 ? after : -1;
  stands(g, t, cheer);
  pitch(g);
  goalBack(g);

  // The keeper sways, then dives: the right way when he saves it.
  const dive = flying ? easeOut((t - STRIKE - 120) / 380) : 0;
  const to = saved ? target.x : scored ? -side * 1.6 : side * 0.8;
  const kx = flying ? to * dive : 0.4 * Math.sin(t / 300);
  const end = after > 0 ? { result: scored ? "goal" : saved ? "saved" : "wide", ms: after } : undefined;
  keeper(g, kx, flying ? Math.sign(to) * Math.min(1, Math.abs(to) / 1.2) * dive : 0, flying ? Math.min(target.y, 1.5) * dive : 0, t, end);
  goalFront(g, scored && after > 0 ? Math.min(1, after / 300) : 0, scored ? { target } : null);

  // A free kick has a wall, which jumps as the ball goes.
  if (free) {
    const jump = flying && f < 1 ? Math.sin(f * Math.PI) * 18 : 0;
    for (let i = 0; i < 4; i++) figure(g, 455 + i * 32, 420 - jump, 0.3, { shirt: RED }, { back: false });
  }

  const to2 = toScreen(target.x, target.y);
  if (!flying) {
    ball(g, BALL.x, BALL.y, 19, 0);
    taker(g, Math.max(0, (t - STRIKE + 300) / 300));
  } else {
    let bx: number;
    let by: number;
    let r: number;
    if (f < 1) {
      // A free kick bends round the wall.
      const curve = free ? Math.sin(f * Math.PI) * -side * 70 : 0;
      bx = BALL.x + (to2.x - BALL.x) * f + curve;
      by = BALL.y + (to2.y - BALL.y) * f - Math.sin(f * Math.PI) * (free ? 90 : 30);
      r = 19 - 11 * f;
      shadow(g, bx, BALL.y + (GOAL_SCREEN.bottom + 4 - BALL.y) * f, r);
    } else {
      const a = Math.min(1, after / 700);
      if (scored) [bx, by, r] = [to2.x + (to2.x - 500) * 0.06 * a, to2.y - 8 * a + 30 * a * a, 8];
      else if (saved) [bx, by, r] = [to2.x + side * 160 * a, to2.y - 60 * Math.sin(a * Math.PI) + 40 * a, 8 + 3 * a];
      else [bx, by, r] = [to2.x + (to2.x - 500) * 0.5 * a, to2.y - 50 * a, 8 - 3 * a];
    }
    taker(g, 1, end);
    ball(g, bx, by, Math.max(4, r), (t - STRIKE) / 40);
  }
  if (after > 0) banner(g, TITLE[m.kind], scored, after, 92);
  else hint(g, pen ? `PENALTY · ${m.name}` : free ? `FREE KICK · ${m.name}` : `${m.name} shoots`, 128);
  if (after > 250) hint(g, `${m.name} · ${m.team}`, 160);
}

function redCard(g: CanvasRenderingContext2D, t: number, m: HighlightMoment) {
  stands(g, t, -1);
  grass(g, 182, 0);
  // The player walks off, head down; the referee shows red.
  const walk = easeOut((t - 1_400) / 2_200);
  figure(g, 640 + walk * 300, 560, 0.62, { shirt: m.seed % 2 ? RED : BLUE }, { back: false, stride: walk > 0 ? t / 140 : 0, lean: 0.12 });
  const up = easeOut((t - 300) / 450);
  const rx = 400;
  const ry = 585;
  figure(g, rx, ry, 0.72, { shirt: "#141414", socks: "#141414", hair: "#3b3b3b" }, { back: false });
  // His arm up, the card in his hand.
  const s = 0.72;
  const shoulder = { x: rx + 38 * s, y: ry - 236 * s };
  const hand = { x: shoulder.x + 30 * s + 40 * s * up, y: shoulder.y + 40 * s - 150 * s * up };
  g.strokeStyle = "#141414";
  g.lineWidth = 16 * s;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(shoulder.x, shoulder.y);
  g.lineTo(hand.x, hand.y);
  g.stroke();
  g.save();
  g.translate(hand.x, hand.y - 18);
  g.rotate(0.15);
  g.fillStyle = RED;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-16, -26, 32, 44, 4);
  g.fill();
  g.stroke();
  g.restore();
  if (t > 900) banner(g, TITLE.red, false, t - 900, 250);
  if (t > 1_150) hint(g, `${m.name} · ${m.team}`, 330);
}

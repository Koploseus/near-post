/**
 * Canvas drawing shared by the training games: the stands, the ball, the
 * banners and the players seen from behind, from the front, from the side
 * and from above. Everything is drawn on a 1000 × 600 logical screen.
 */

export const W = 1000;
export const H = 600;
export const SKIN = "#C68B5E";
export const HAIR = "#2A1A10";
export const INK = "#1B2340";
export const PAPER = "#F3EAD7";
export const RED = "#C8202F";
export const YELLOW = "#F2B705";
export const BLUE = "#2F5DA8";
export const WHITE = "#fffaf0";

type G = CanvasRenderingContext2D;

/** A fixed crowd: where each fan sits and the colour he wears. */
const CROWD = (() => {
  const fans: { x: number; y: number; c: string; p: number }[] = [];
  const colours = [PAPER, RED, YELLOW, BLUE, INK, "#e2d6ba"];
  let seed = 7;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 9; row++) {
    const y = 26 + row * 15;
    for (let x = 6 + (row % 2) * 7; x < W; x += 14) fans.push({ x: x + r() * 4, y: y + r() * 3, c: colours[Math.floor(r() * colours.length)]!, p: r() * 6 });
  }
  return fans;
})();

/** Night sky, the crowd (jumping for `cheer` ms after a goal) and the boards, down to y = 182. */
export function stands(g: G, t: number, cheer: number) {
  const sky = g.createLinearGradient(0, 0, 0, 170);
  sky.addColorStop(0, "#0e1428");
  sky.addColorStop(1, INK);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, 175);
  for (const f of CROWD) {
    const jump = cheer >= 0 && cheer < 2500 ? Math.abs(Math.sin(cheer / 120 + f.p)) * 6 : Math.sin(t / 600 + f.p) * 0.8;
    g.fillStyle = f.c;
    g.beginPath();
    g.arc(f.x, f.y - jump, 4.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#121933";
  g.fillRect(0, 160, W, 22);
  g.fillStyle = YELLOW;
  g.font = "900 13px 'Archivo Black', system-ui";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (let x = 90; x < W; x += 200) g.fillText(x % 400 === 90 ? "NEAR POST" : "GOALARS", x, 176);
}

/** Grass seen from the stands: stripes that grow towards the viewer and scroll by `run` (0..1 per stripe). */
export function grass(g: G, top = 182, run = 0) {
  g.fillStyle = "#3a8c5c";
  g.fillRect(0, top, W, H - top);
  const n = 9;
  for (let k = -1; k < n; k++) {
    const u0 = (k + (run % 1)) / n;
    const u1 = (k + 0.5 + (run % 1)) / n;
    const y0 = top + (H - top) * Math.max(0, u0) ** 1.7;
    const y1 = top + (H - top) * Math.max(0, u1) ** 1.7;
    g.fillStyle = "#2e7d4f";
    g.fillRect(0, y0, W, Math.max(0, y1 - y0));
  }
}

export function shadow(g: G, x: number, y: number, r: number) {
  g.fillStyle = "rgba(0,0,0,.28)";
  g.beginPath();
  g.ellipse(x, y + r * 0.6, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
  g.fill();
}

/** A football at (x, y); `ground` draws its shadow under it. */
export function ball(g: G, x: number, y: number, r: number, spin: number, ground = y > 400) {
  if (ground) shadow(g, x, y, r);
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  g.fillStyle = "#fff";
  g.strokeStyle = "#111";
  g.lineWidth = Math.max(1, r / 9);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  const patch = (cx: number, cy: number, pr: number) => {
    g.beginPath();
    for (let a = 0; a < 5; a++) {
      const ang = -Math.PI / 2 + (a * 2 * Math.PI) / 5;
      g.lineTo(cx + Math.cos(ang) * pr, cy + Math.sin(ang) * pr);
    }
    g.closePath();
    g.fill();
  };
  patch(0, 0, r * 0.32);
  for (let a = 0; a < 5; a++) {
    const ang = -Math.PI / 2 + (a * 2 * Math.PI) / 5;
    patch(Math.cos(ang) * r * 0.78, Math.sin(ang) * r * 0.78, r * 0.2);
  }
  g.restore();
}

/** The big word after each round, popping in. */
export function banner(g: G, text: string, good: boolean, since: number, y = 250) {
  const pop = Math.min(1, since / 220);
  g.save();
  g.translate(W / 2, y);
  g.scale(0.4 + 0.6 * pop + (pop < 1 ? 0.15 * Math.sin(pop * Math.PI) : 0), 0.4 + 0.6 * pop);
  g.font = "900 72px 'Archivo Black', system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.lineJoin = "round";
  g.strokeStyle = good ? RED : INK;
  g.strokeText(text, 0, 0);
  g.fillStyle = good ? YELLOW : PAPER;
  g.fillText(text, 0, 0);
  g.restore();
}

/** A small caption in a dark pill. */
export function hint(g: G, text: string, y = 392) {
  g.save();
  g.font = "800 20px Archivo, system-ui";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  const w = g.measureText(text).width + 28;
  g.fillStyle = "rgba(18,25,51,.78)";
  g.beginPath();
  g.roundRect(W / 2 - w / 2, y - 25, w, 36, 8);
  g.fill();
  g.fillStyle = PAPER;
  g.fillText(text, W / 2, y);
  g.restore();
}

function limb(g: G, x1: number, y1: number, x2: number, y2: number, w: number, c: string) {
  g.strokeStyle = c;
  g.lineWidth = w;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

export interface Look {
  shirt: string;
  shorts?: string;
  socks?: string;
  number?: string;
  hair?: string;
}

/**
 * A player standing or running, feet at (x, y), about 280 px tall at scale 1,
 * seen from behind (`back`) or from the front. `stride` is the running cycle
 * in radians; `lean` tilts him (radians, + to the right); `slide` 0..1 puts
 * him down in a sliding tackle towards the side of `lean`.
 */
export function figure(g: G, x: number, y: number, scale: number, look: Look, o: { back: boolean; stride?: number; lean?: number; slide?: number }) {
  const s = o.stride ?? 0;
  const lean = o.lean ?? 0;
  const slide = Math.max(0, Math.min(1, o.slide ?? 0));
  const swing = Math.sin(s);
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  shadow(g, 0, -6, 46);
  if (slide > 0) {
    // Down on the grass: the whole body turns towards the slide, one leg out.
    g.translate(Math.sign(lean || 1) * 40 * slide, -10 * slide);
    g.rotate(Math.sign(lean || 1) * (Math.PI / 2.3) * slide);
  } else g.rotate(lean);
  const bob = Math.abs(swing) * 6;
  g.translate(0, -bob);
  // Legs: thigh+shin as one stroke, sock, boot.
  const legs = [
    [-16, swing],
    [16, -swing],
  ] as const;
  for (const [hx, ph] of legs) {
    const fx = hx * 1.2 + (slide > 0 && hx * (lean || 1) > 0 ? hx * 3 * slide : 0);
    const fy = -6 - Math.max(0, ph) * 34;
    limb(g, hx, -118, fx, fy - 30, 24, SKIN);
    limb(g, fx, fy - 34, fx, fy - 4, 22, look.socks ?? WHITE);
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(fx, fy, 15, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Shorts.
  g.fillStyle = look.shorts ?? INK;
  g.beginPath();
  g.roundRect(-36, -158, 72, 48, 8);
  g.fill();
  // Arms swing against the legs.
  for (const [sx, ph] of [
    [-1, -swing],
    [1, swing],
  ] as const) {
    const hx = sx * 50 + ph * 10;
    const hy = -170 + Math.abs(ph) * 6 - (slide > 0 ? 40 * slide : 0);
    limb(g, sx * 38, -236, sx * 44 + ph * 6, -196, 18, look.shirt);
    limb(g, sx * 44 + ph * 6, -196, hx, hy, 15, SKIN);
  }
  // Shirt.
  g.fillStyle = look.shirt;
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-40, -246, 80, 96, 18);
  g.fill();
  g.stroke();
  if (o.back && look.number) {
    g.fillStyle = YELLOW;
    g.font = "900 40px 'Archivo Black', system-ui";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.fillText(look.number, 0, -184);
  } else if (!o.back) {
    // A collar and a small crest.
    g.fillStyle = WHITE;
    g.beginPath();
    g.moveTo(-14, -246);
    g.lineTo(0, -230);
    g.lineTo(14, -246);
    g.closePath();
    g.fill();
    g.fillStyle = YELLOW;
    g.beginPath();
    g.arc(-18, -214, 6, 0, Math.PI * 2);
    g.fill();
  }
  // Head.
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(0, -270, 23, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = look.hair ?? HAIR;
  g.beginPath();
  if (o.back) g.arc(0, -272, 24, 0, Math.PI * 2);
  else g.arc(0, -276, 23, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  if (!o.back) {
    g.fillStyle = INK;
    g.beginPath();
    g.arc(-8, -268, 2.6, 0, Math.PI * 2);
    g.arc(8, -268, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * A runner seen from the side, facing right, feet at (x, y), about 200 px
 * tall at scale 1. `phase` is the running cycle; `speed` 0..1 sets the lean
 * and how far the limbs reach.
 */
export function sideRunner(g: G, x: number, y: number, scale: number, look: Look, phase: number, speed: number) {
  const reach = 0.25 + 0.75 * Math.max(0, Math.min(1, speed));
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  shadow(g, 0, -4, 40);
  g.translate(0, -Math.abs(Math.sin(phase)) * 8 * reach);
  const hip = { x: 0, y: -92 };
  const leg = (ph: number, front: boolean) => {
    const a = Math.sin(ph) * 0.9 * reach;
    const knee = { x: hip.x + Math.sin(a) * 46, y: hip.y + Math.cos(a) * 46 };
    const bend = Math.max(0, -Math.cos(ph)) * 1.4 * reach;
    const foot = { x: knee.x + Math.sin(a - bend) * 46, y: knee.y + Math.cos(a - bend) * 46 };
    limb(g, hip.x, hip.y, knee.x, knee.y, 17, SKIN);
    limb(g, knee.x, knee.y, foot.x, foot.y - 4, 15, look.socks ?? WHITE);
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(foot.x + 6, foot.y, 12, 6, 0, 0, Math.PI * 2);
    g.fill();
    void front;
  };
  const arm = (ph: number) => {
    const a = -Math.sin(ph) * 1.0 * reach;
    const sh = { x: 6, y: -160 };
    const el = { x: sh.x + Math.sin(a) * 30, y: sh.y + Math.cos(a) * 30 };
    const hand = { x: el.x + Math.sin(a + 1.3) * 26, y: el.y + Math.cos(a + 1.3) * 26 };
    limb(g, sh.x, sh.y, el.x, el.y, 13, look.shirt);
    limb(g, el.x, el.y, hand.x, hand.y, 11, SKIN);
  };
  g.rotate(0.05 + 0.18 * reach);
  leg(phase + Math.PI, false);
  arm(phase);
  g.fillStyle = look.shorts ?? INK;
  g.beginPath();
  g.roundRect(-20, -112, 42, 34, 8);
  g.fill();
  g.fillStyle = look.shirt;
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.beginPath();
  g.roundRect(-22, -176, 46, 70, 14);
  g.fill();
  g.stroke();
  leg(phase, true);
  arm(phase + Math.PI);
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(8, -192, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = look.hair ?? HAIR;
  g.beginPath();
  g.arc(5, -196, 17, Math.PI * 0.9, Math.PI * 1.9);
  g.fill();
  g.restore();
}

/** A player seen from above at (x, y), facing `angle` (radians, 0 = up the pitch). */
export function topPlayer(g: G, x: number, y: number, look: Look, angle: number, phase: number, size = 1) {
  g.save();
  g.translate(x, y);
  g.scale(size, size);
  g.fillStyle = "rgba(0,0,0,.25)";
  g.beginPath();
  g.ellipse(5, 6, 22, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.rotate(angle);
  const step = Math.sin(phase) * 9;
  // Feet below the body, one forward and one back.
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(-8, -step, 5, 8, 0, 0, Math.PI * 2);
  g.ellipse(8, step, 5, 8, 0, 0, Math.PI * 2);
  g.fill();
  // Arms.
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(-20, step * 0.7, 5, 0, Math.PI * 2);
  g.arc(20, -step * 0.7, 5, 0, Math.PI * 2);
  g.fill();
  // Shoulders.
  g.fillStyle = look.shirt;
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.beginPath();
  g.ellipse(0, 0, 19, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // Head.
  g.fillStyle = look.hair ?? HAIR;
  g.beginPath();
  g.arc(0, 1, 8.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = SKIN;
  g.beginPath();
  g.arc(0, -3, 5, Math.PI, 0);
  g.fill();
  g.restore();
  if (look.number) {
    g.save();
    g.font = "900 13px 'Archivo Black', system-ui";
    g.textAlign = "center";
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.strokeText(look.number, x, y + 30 * size);
    g.fillStyle = PAPER;
    g.fillText(look.number, x, y + 30 * size);
    g.restore();
  }
}

/** 0..1 eased out (fast, then slowing). */
export function easeOut(p: number) {
  const c = Math.max(0, Math.min(1, p));
  return 1 - (1 - c) * (1 - c);
}

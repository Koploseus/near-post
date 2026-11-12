/**
 * Canvas drawing shared by the training games: the stands, the ball, the
 * banners and the players seen from behind, from the front, from the side
 * and from above. Everything is drawn on a 1000 × 600 logical screen.
 */
import { type Pose, pixelGrid } from "../floodlight/PixelPlayer.js";

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
/** The kit's floodlit grass. */
export const GRASS = "#5BC72E";
export const GRASS_DARK = "#4AB226";

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

/** The kit's stadium (bg-stadium-full.webp), loaded once; the procedural crowd draws until it is ready. */
const STADIUM = typeof Image !== "undefined" ? Object.assign(new Image(), { src: "/art/bg/bg-stadium-full.webp" }) : null;

/** Night sky, the crowd (jumping for `cheer` ms after a goal) and the boards, down to y = 182. */
export function stands(g: G, t: number, cheer: number) {
  const jumping = cheer >= 0 && cheer < 2500;
  if (STADIUM?.complete && STADIUM.naturalWidth) {
    // The stand of the illustration, cropped to the band above the boards; it bounces after a goal.
    const hop = jumping ? Math.abs(Math.sin(cheer / 120)) * 5 : 0;
    const sw = STADIUM.naturalWidth;
    const sh = (sw * 175) / W;
    g.drawImage(STADIUM, 0, STADIUM.naturalHeight * 0.3, sw, sh, 0, -hop, W, 175 + hop);
  } else {
    const sky = g.createLinearGradient(0, 0, 0, 170);
    sky.addColorStop(0, "#120C30");
    sky.addColorStop(1, "#1A1240");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, 175);
    for (const f of CROWD) {
      const jump = jumping ? Math.abs(Math.sin(cheer / 120 + f.p)) * 6 : Math.sin(t / 600 + f.p) * 0.8;
      g.fillStyle = f.c;
      g.fillRect(f.x - 4, f.y - jump - 4, 8, 8);
    }
  }
  // The boards: night, with the pixel lettering.
  g.fillStyle = "#0B0820";
  g.fillRect(0, 158, W, 26);
  g.fillStyle = "#251A57";
  g.fillRect(0, 161, W, 20);
  g.fillStyle = YELLOW;
  g.font = "700 15px 'Pixelify Sans', system-ui";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (let x = 90; x < W; x += 200) g.fillText(x % 400 === 90 ? "NEAR POST" : "GOALARS", x, 177);
}

/** Grass seen from the stands: stripes that grow towards the viewer and scroll by `run` (0..1 per stripe). */
export function grass(g: G, top = 182, run = 0) {
  g.fillStyle = GRASS;
  g.fillRect(0, top, W, H - top);
  const n = 9;
  for (let k = -1; k < n; k++) {
    const u0 = (k + (run % 1)) / n;
    const u1 = (k + 0.5 + (run % 1)) / n;
    const y0 = top + (H - top) * Math.max(0, u0) ** 1.7;
    const y1 = top + (H - top) * Math.max(0, u1) ** 1.7;
    g.fillStyle = GRASS_DARK;
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
  g.font = "700 76px 'Pixelify Sans', system-ui";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // The kit's outlined title: a deep drop, then a hard outline.
  g.lineJoin = "miter";
  g.fillStyle = "#150A3D";
  g.fillText(text, 0, 9);
  g.lineWidth = 12;
  g.strokeStyle = "#2A1466";
  g.strokeText(text, 0, 0);
  g.fillStyle = good ? "#FFD23F" : PAPER;
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
  g.fillStyle = "#0B0820";
  g.fillRect(W / 2 - w / 2 - 3, y - 28, w + 6, 42);
  g.fillStyle = "#251A57";
  g.fillRect(W / 2 - w / 2, y - 25, w, 36);
  g.fillStyle = PAPER;
  g.fillText(text, W / 2, y);
  g.restore();
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
  const lean = o.lean ?? 0;
  const slide = Math.max(0, Math.min(1, o.slide ?? 0));
  const s = o.stride ?? 0;
  const pose: Pose = o.back ? "back" : slide > 0 ? "kick" : s && Math.sin(s) > 0 ? "run" : "idle";
  shadow(g, x, y - 6 * scale, 46 * scale);
  g.save();
  g.translate(x, y);
  if (slide > 0) {
    // Down on the grass: the whole body turns towards the slide.
    g.translate(Math.sign(lean || 1) * 40 * slide * scale, -10 * slide * scale);
    g.rotate(Math.sign(lean || 1) * (Math.PI / 2.3) * slide);
  } else g.rotate(lean * 0.6);
  // The running cycle: the stride leg swaps sides.
  pixelSprite(g, look, pose, 280 * scale, !o.back && !!s && Math.sin(s / 2) > 0);
  g.restore();
}

/**
 * A runner seen from the side, facing right, feet at (x, y), about 200 px
 * tall at scale 1. `phase` is the running cycle; `speed` 0..1 sets the lean
 * and how far the limbs reach.
 */
export function sideRunner(g: G, x: number, y: number, scale: number, look: Look, phase: number, speed: number) {
  const reach = 0.25 + 0.75 * Math.max(0, Math.min(1, speed));
  shadow(g, x, y - 4 * scale, 34 * scale);
  g.save();
  g.translate(x, y - Math.abs(Math.sin(phase)) * 8 * reach * scale);
  g.rotate(0.04 + 0.12 * reach);
  pixelSprite(g, look, speed > 0.05 ? "run" : "idle", 200 * scale, Math.sin(phase) > 0);
  g.restore();
}

/** A player seen from above at (x, y), facing `angle` (radians, 0 = up the pitch): drawn as the kit's pixel footballer. */
export function topPlayer(g: G, x: number, y: number, look: Look, angle: number, phase: number, size = 1) {
  shadow(g, x, y + 22 * size, 20 * size);
  g.save();
  g.translate(x, y + 30 * size);
  const moving = Math.abs(Math.sin(phase)) > 0.3;
  pixelSprite(g, look, Math.abs(angle) > Math.PI / 2 ? "idle" : moving ? "run" : "idle", 74 * size, Math.sin(phase) > 0 || Math.sin(angle) < 0);
  g.restore();
  if (look.number) {
    g.save();
    g.font = "700 15px 'Pixelify Sans', system-ui";
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.lineWidth = 4;
    g.strokeStyle = "#0B0820";
    g.strokeText(look.number, x, y + 48 * size);
    g.fillStyle = PAPER;
    g.fillText(look.number, x, y + 48 * size);
    g.restore();
  }
}

/** One look, one pose: the 34 x 46 pixel rig, painted once on its own canvas. */
const SPRITES = new Map<string, HTMLCanvasElement | null>();
function spriteOf(look: Look, pose: Pose, flip: boolean): HTMLCanvasElement | null {
  const key = `${look.shirt}|${look.shorts ?? ""}|${look.hair ?? ""}|${look.number ?? ""}|${pose}|${flip ? 1 : 0}`;
  if (SPRITES.has(key)) return SPRITES.get(key)!;
  let c: HTMLCanvasElement | null = null;
  if (typeof document !== "undefined") {
    const n = [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1_000_003, 7);
    const grid = pixelGrid({ n, shirt: look.shirt, shorts: look.shorts, pose, flip, colors: look.hair ? { hair: look.hair } : undefined });
    c = document.createElement("canvas");
    c.width = grid[0]?.length ?? 34;
    c.height = grid.length;
    const x = c.getContext("2d");
    grid.forEach((row, j) =>
      row.forEach((col, i) => {
        if (!col || !x) return;
        x.fillStyle = col;
        x.fillRect(i, j, 1, 1);
      }),
    );
  }
  SPRITES.set(key, c);
  return c;
}

/** Draws the sprite with its feet at the origin, `h` px tall, crisp. */
function pixelSprite(g: G, look: Look, pose: Pose, h: number, flip: boolean) {
  const c = spriteOf(look, pose, flip);
  if (!c) return;
  const w = (h * c.width) / c.height;
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(c, -w / 2, -h, w, h);
  g.imageSmoothingEnabled = smooth;
}

/** 0..1 eased out (fast, then slowing). */
export function easeOut(p: number) {
  const c = Math.max(0, Math.min(1, p));
  return 1 - (1 - c) * (1 - c);
}

/**
 * Canvas drawing shared by the training games: the stands, the ball, the
 * banners and the players seen from behind, from the front, from the side
 * and from above. Everything is drawn on a 1000 × 600 logical screen.
 */
import { SKINS, type View, faceOf, headCanvas } from "../lib/face.js";
import { BACK_RUN_CYCLE, itemPaint, type Pose, RUN_CYCLE, pixelGrid } from "../floodlight/PixelPlayer.js";

/** The frame of a 4-frame cycle at `phase` (radians, one cycle per 2π). */
const frameAt = (cycle: Pose[], phase: number) => cycle[Math.floor((((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4]!;

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
  /** His footballer number: his own face is drawn over the head of the art. */
  face?: number;
  hairItem?: string | null;
}

// ------------------------------------------------------------ illustrated players (art/players, art/penalty)

/**
 * Six-frame strips drawn in GUS, feet at the bottom of each cell. The kit is
 * key-blue (hue 205-260) and is repainted in the shirt colour of the look.
 * Until a strip has loaded, the pixel rig draws instead.
 */
const SHEETS = {
  /** Seen from behind: run with the ball (2), cut with the ball (leans right), slide (to the left), down on all fours, pass. */
  heroBack: "/art/players/hero-back.webp",
  /** From the side, facing right: crouched start, run (4), arms up. */
  heroSide: "/art/players/hero-side.webp",
  /** From the side, facing right: crouched start, run (4), beaten. */
  rivalSide: "/art/players/rival-side.webp",
  /** Facing you: stance, run (2), run with the ball, slide (to the left), sat down beaten. */
  rivalFront: "/art/players/rival-front.webp",
  /** From above: standing, run (2), pass, control, arms up. */
  top: "/art/players/top.webp",
  /** Seen from behind: hands on hips (frame 0). */
  shooter: "/art/penalty/shooter.webp",
  /** The keeper: ready, dive low, dive high, ball held, beaten, fist pump (his kit is not repainted). */
  keeper: "/art/penalty/keeper.webp",
} as const;
export type Sheet = keyof typeof SHEETS;

const IMAGES = new Map<Sheet, HTMLImageElement>();
const PAINTED = new Map<string, HTMLCanvasElement>();
function sheetFor(sheet: Sheet, shirt: string): HTMLCanvasElement | null {
  if (typeof Image === "undefined" || typeof document === "undefined") return null;
  let img = IMAGES.get(sheet);
  if (!img) {
    img = Object.assign(new Image(), { src: SHEETS[sheet] });
    IMAGES.set(sheet, img);
  }
  if (!img.complete || !img.naturalWidth) return null;
  const key = `${sheet}|${shirt}`;
  let c = PAINTED.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const [tr, tg, tb] = [1, 3, 5].map((i) => parseInt(shirt.slice(i, i + 2), 16) / 255) as [number, number, number];
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3]! < 8) continue;
      const r = px[i]! / 255;
      const g = px[i + 1]! / 255;
      const b = px[i + 2]! / 255;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx !== b || mx - mn < 0.35 * mx) continue;
      const h = 60 * ((r - g) / (mx - mn) + 4);
      if (h < 205 || h > 260) continue;
      const k = Math.min(1.25, mx / 0.9); // keep the shading
      px[i] = Math.min(255, tr * 255 * k);
      px[i + 1] = Math.min(255, tg * 255 * k);
      px[i + 2] = Math.min(255, tb * 255 * k);
    }
    x.putImageData(d, 0, 0);
    PAINTED.set(key, c);
  }
  return c;
}

/** True once the strip of players seen from behind (`back`) or facing you has loaded: the picture then shows the ball at their feet. */
export function artReady(back: boolean): boolean {
  const img = IMAGES.get(back ? "heroBack" : "rivalFront");
  return !!img && img.complete && img.naturalWidth > 0;
}

/**
 * Where the head is in each frame: centre x (share of the cell's width),
 * centre y and size (shares of its height), and how the head is seen. A
 * footballer's own face (lib/face.ts) is drawn there, over the head of the art.
 */
const HEADS: Record<Sheet, { view: View; at: [number, number, number][] }> = {
  rivalSide: { view: "side", at: [[0.77, 0.35, 0.36], [0.685, 0.18, 0.36], [0.707, 0.18, 0.36], [0.724, 0.19, 0.36], [0.674, 0.165, 0.36], [0.65, 0.26, 0.36]] },
  rivalFront: { view: "front", at: [[0.5, 0.26, 0.35], [0.52, 0.2, 0.35], [0.474, 0.2, 0.35], [0.487, 0.165, 0.35], [0.73, 0.4, 0.35], [0.59, 0.4, 0.35]] },
  top: { view: "front", at: [[0.523, 0.218, 0.43], [0.555, 0.25, 0.43], [0.582, 0.25, 0.43], [0.512, 0.212, 0.43], [0.484, 0.188, 0.43], [0.512, 0.2, 0.43]] },
  heroBack: { view: "back", at: [[0.503, 0.09, 0.3], [0.494, 0.09, 0.3], [0.34, 0.18, 0.3], [0.304, 0.225, 0.3], [0.174, 0.42, 0.3], [0.47, 0.115, 0.3]] },
  heroSide: { view: "side", at: [[0.77, 0.44, 0.37], [0.62, 0.27, 0.37], [0.68, 0.215, 0.37], [0.66, 0.26, 0.37], [0.72, 0.25, 0.37], [0.535, 0.2, 0.37]] },
  shooter: { view: "back", at: [[0.498, 0.115, 0.33], [0.512, 0.115, 0.33], [0.444, 0.14, 0.33], [0.457, 0.11, 0.33], [0.492, 0.11, 0.33], [0.498, 0.11, 0.33]] },
  keeper: { view: "front", at: [[0.491, 0.314, 0.35], [0.26, 0.49, 0.33], [0.329, 0.289, 0.35], [0.5, 0.2, 0.35], [0.17, 0.71, 0.33], [0.454, 0.224, 0.35]] },
};

/** Frame `n` of a strip, `h` px tall, feet at the origin. False until the strip has loaded. */
function art(g: G, sheet: Sheet, look: Look, n: number, h: number, flip: boolean): boolean {
  const c = sheetFor(sheet, look.shirt);
  if (!c) return false;
  const cw = c.width / 6;
  const w = (h * cw) / c.height;
  g.save();
  if (flip) g.scale(-1, 1);
  g.drawImage(c, n * cw, 0, cw, c.height, -w / 2, -h, w, h);
  if (look.face !== undefined) {
    // His own face, over the head of the picture.
    const { view, at } = HEADS[sheet];
    const [hx, hy, hs] = at[n]!;
    const size = hs * h;
    const was = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    const head = headCanvas(faceOf(look.face), view, look.hairItem);
    if (head.width > 64) {
      // The drawn head: 64 px wide in a 128 px frame, its middle at (64, 72).
      const f = size * 1.42;
      g.imageSmoothingEnabled = true;
      g.drawImage(head, -w / 2 + hx * w - f / 2, -h + hy * h - f * 0.565, f, f);
    } else g.drawImage(head, -w / 2 + hx * w - size / 2, -h + hy * h - size * 0.56, size, size);
    g.imageSmoothingEnabled = was;
  }
  g.restore();
  return true;
}

/** Frame `n` of a strip in a shirt colour, `h` px tall, feet at the origin (the live match draws its 22 players with it). False until loaded. */
export function sprite(g: G, sheet: Sheet, shirt: string, n: number, h: number, flip = false, face?: number, hairItem?: string | null): boolean {
  return art(g, sheet, { shirt, ...(face === undefined ? {} : { face, hairItem: hairItem ?? null }) }, n, h, flip);
}

/** Your own footballer: his face goes on the player you control in the drills. */
let HERO: { face: number; hairItem: string | null } | null = null;
export function setHero(face: number | null, hairItem?: string | null) {
  HERO = face === null ? null : { face, hairItem: hairItem ?? null };
}
const hero = (look: Look): Look => (HERO ? { ...look, ...HERO } : look);

/** What he wears from his wardrobe (item ids, as in lib/types Look). */
export interface Worn {
  hair?: string | null;
  boots?: string | null;
  band?: string | null;
  socks?: string | null;
  pads?: string | null;
  gloves?: string | null;
  wrist?: string | null;
  tape?: string | null;
}

const AVATARS = new Map<string, HTMLCanvasElement>();
/**
 * A footballer head to toe, facing you (the first frame of the "rivalFront"
 * strip, 314 x 320), with his own face and what he wears: each item repaints
 * its part of the picture (boots, socks, shin pads, tape, gloves, wristbands)
 * in its colours and pattern; the headband goes across his forehead.
 * Null until the art has loaded. `key` must change when his face does.
 */
export function avatarCanvas(shirt: string, face: number, worn: Worn | null | undefined, key: string | number): HTMLCanvasElement | null {
  if (!sheetFor("rivalFront", shirt)) return null;
  const id = `${shirt}|${face}|${key}|${JSON.stringify(worn ?? {})}`;
  let c = AVATARS.get(id);
  if (c) return c;
  const W = 314;
  const H = 320;
  c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.translate(W / 2, H);
  art(g, "rivalFront", { shirt, face, hairItem: worn?.hair ?? null }, 0, H, false);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const d = g.getImageData(0, 0, W, H);
  const p = d.data;
  const tone = [1, 3, 5].map((k) => parseInt((SKINS[faceOf(face).skin] ?? SKINS[1]!).slice(k, k + 2), 16));
  // Repaints a pixel in an item's colour, keeping the light and shade of the picture (`ref` = how bright the part is drawn).
  const put = (i: number, item: string, x: number, y: number, v: number, ref: number) => {
    const col = itemPaint(item, Math.floor(x / 7), Math.floor(y / 7))!;
    const k = Math.min(1.35, Math.max(0.45, v / ref));
    for (let ch = 0; ch < 3; ch++) p[i + ch] = Math.min(255, parseInt(col.slice(1 + ch * 2, 3 + ch * 2), 16) * k);
  };
  for (let y = 130; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (p[i + 3]! < 40) continue;
      const r = p[i]! / 255;
      const gg = p[i + 1]! / 255;
      const b = p[i + 2]! / 255;
      const v = Math.max(r, gg, b);
      const sat = v ? (v - Math.min(r, gg, b)) / v : 0;
      const skin = r > gg && gg > b && sat > 0.18 && sat < 0.62 && v > 0.6;
      if (y >= 284 && v > 0.09 && v < 0.4 && sat < 0.5) {
        if (worn?.boots) put(i, worn.boots, x, y, v, 0.2);
      } else if (y >= 246 && y < 294 && sat < 0.32 && v > 0.55) {
        const item = worn?.tape && y >= 279 ? worn.tape : worn?.pads && y < 266 ? worn.pads : worn?.socks;
        if (item) put(i, item, x, y, v, 0.95);
      } else if (skin && y < 205 && (x < 64 || x > 250) && worn?.gloves) {
        put(i, worn.gloves, x, y, v, 0.9);
      } else if (skin && y < 205 && (x < 78 || x > 236) && worn?.wrist) put(i, worn.wrist, x, y, v, 0.9);
      if (skin && p[i] === Math.round(r * 255) && p[i + 1] === Math.round(gg * 255)) {
        // Bare skin: the tone of his face.
        const k = v / 0.93;
        for (let ch = 0; ch < 3; ch++) p[i + ch] = Math.min(255, tone[ch]! * k);
      }
    }
  g.putImageData(d, 0, 0);
  if (worn?.band) {
    g.fillStyle = "#1B1030";
    g.fillRect(117, 64, 80, 12);
    for (let x = 0; x < 76; x += 4) {
      g.fillStyle = itemPaint(worn.band, Math.floor(x / 4), 0)!;
      g.fillRect(119 + x, 66, 4, 8);
    }
  }
  AVATARS.set(id, c);
  return c;
}

/** Which of two frames, alternating with a running cycle (radians). */
const step = (phase: number) => (Math.floor(((phase % (2 * Math.PI)) + 2 * Math.PI) / Math.PI) % 2 === 0 ? 0 : 1);
/** Which of four frames of a running cycle (radians). */
const step4 = (phase: number) => Math.floor((((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) % 4;

/**
 * A player standing or running, feet at (x, y), about 280 px tall at scale 1,
 * seen from behind (`back`: you) or from the front (the other side). `stride`
 * is the running cycle in radians; `lean` tilts him (radians, + to the right);
 * `slide` 0..1 puts him down in a sliding tackle towards the side of `lean`.
 * `act`: "ball" when the ball is at his feet, "beaten" or "down" when he lost.
 * Returns true when the picture already shows the ball at his feet.
 */
export function figure(g: G, x: number, y: number, scale: number, look: Look, o: { back: boolean; stride?: number; lean?: number; slide?: number; act?: "ball" | "beaten" | "down" }): boolean {
  const lean = o.lean ?? 0;
  const slide = Math.max(0, Math.min(1, o.slide ?? 0));
  const s = o.stride ?? 0;
  shadow(g, x, y - 6 * scale, 46 * scale);
  g.save();
  g.translate(x, y);
  const h = 270 * scale;
  let drawn = false;
  let ball = false;
  if (o.back) {
    // You, from behind.
    if (slide > 0) {
      g.translate(Math.sign(lean || 1) * 40 * slide * scale, 0);
      drawn = art(g, "heroBack", hero(look), 3, h * 0.95, lean > 0);
    } else if (o.act === "down") drawn = art(g, "heroBack", hero(look), 4, h * 0.8, lean > 0);
    else if (s || o.act === "ball") {
      const cut = Math.abs(lean) > 0.2;
      g.rotate(lean * 0.25);
      drawn = art(g, "heroBack", hero(look), cut ? 2 : step(s), h, cut && lean < 0);
      ball = drawn;
    } else drawn = art(g, "shooter", hero(look), 0, h, false);
  } else {
    // The other side, facing you.
    if (slide > 0) {
      g.translate(Math.sign(lean || 1) * 40 * slide * scale, 0);
      drawn = art(g, "rivalFront", look, 4, h * 0.85, lean > 0);
    } else if (o.act === "beaten" || o.act === "down") drawn = art(g, "rivalFront", look, 5, h * 0.8, lean > 0);
    else {
      g.rotate(lean * 0.4);
      if (o.act === "ball") {
        drawn = art(g, "rivalFront", look, 3, h, step(s) === 1);
        ball = drawn;
      } else drawn = art(g, "rivalFront", look, s ? 1 + step(s) : 0, h, false);
    }
  }
  if (!drawn) {
    // The pixel rig, until the art has loaded.
    const pose: Pose = slide > 0 ? "slide" : s ? frameAt(o.back ? BACK_RUN_CYCLE : RUN_CYCLE, s) : o.back ? "back" : "idle";
    if (slide > 0) g.rotate(Math.sign(lean || 1) * 0.12 * slide);
    else g.rotate(lean * 0.6);
    pixelSprite(g, look, pose, 280 * scale, slide > 0 && lean > 0);
  }
  g.restore();
  return ball;
}

/**
 * A runner seen from the side, facing right, feet at (x, y), about 200 px
 * tall at scale 1. `phase` is the running cycle; `speed` 0..1 sets the lean
 * and how far the limbs reach. `o.rival` is the other side; `o.set` crouched
 * on the line before GO; `o.end` once the race is over.
 */
export function sideRunner(g: G, x: number, y: number, scale: number, look: Look, phase: number, speed: number, o: { rival?: boolean; set?: boolean; end?: "won" | "lost" } = {}) {
  const reach = 0.25 + 0.75 * Math.max(0, Math.min(1, speed));
  shadow(g, x, y - 4 * scale, 34 * scale);
  g.save();
  const running = !o.set && !o.end && speed > 0.05;
  g.translate(x, y - (running ? Math.abs(Math.sin(phase)) * 6 * reach * scale : 0));
  const sheet: Sheet = o.rival ? "rivalSide" : "heroSide";
  const n = o.set ? 0 : o.end && (o.rival ? o.end === "lost" : o.end === "won") ? 5 : running ? 1 + step4(phase) : 1;
  if (!art(g, sheet, o.rival ? look : hero(look), n, (n === 0 ? 170 : 215) * scale, false)) {
    g.rotate(0.04 + 0.12 * reach);
    // The rig runs to the left of the picture: mirrored to face right.
    pixelSprite(g, look, speed > 0.05 ? frameAt(RUN_CYCLE, phase) : "idle", 200 * scale, true);
  }
  g.restore();
}

/** A player seen from above at (x, y), facing `angle` (radians, 0 = up the pitch); `act` "pass" or "joy". */
export function topPlayer(g: G, x: number, y: number, look: Look, angle: number, phase: number, size = 1, act?: "pass" | "joy") {
  shadow(g, x, y + 22 * size, 20 * size);
  g.save();
  g.translate(x, y + 30 * size);
  const n = act === "pass" ? 3 : act === "joy" ? 5 : phase ? 1 + step(phase) : 0;
  if (!art(g, "top", look, n, 84 * size, Math.sin(angle) < 0)) {
    pixelSprite(g, look, Math.abs(angle) > Math.PI / 2 || !phase ? "idle" : frameAt(RUN_CYCLE, phase), 74 * size, Math.sin(angle) > 0);
  }
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
    // The face comes from the look only, so he keeps his skin and hair from one frame to the next.
    const n = [...`${look.shirt}|${look.shorts ?? ""}|${look.hair ?? ""}|${look.number ?? ""}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1_000_003, 7);
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

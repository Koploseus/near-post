/**
 * A footballer's face: what he picks himself (skin, haircut and its colour,
 * eyes, brows, beard, mouth), packed in one number. Accessories stay items.
 * Until he picks one, his face comes from his token number, so no two
 * footballers look alike. The same face is drawn in the menus (front), on
 * the pitch (side, back) and on the players of the live match.
 */

export interface Face {
  skin: number;
  hair: number;
  colour: number;
  /** Which of the eight drawn faces (shape, eyes, brows, mouth). */
  kind: number;
  beard: number;
}

export const SKINS = ["#F3C9A5", "#E7B48C", "#D49A6E", "#B97A50", "#8E5A3A", "#6A4028"];
export const HAIR_COLOURS = ["#1E1512", "#3B2416", "#6B4422", "#A8742E", "#D9B45B", "#F1E2A8", "#B5482B", "#8C8C96"];
/** The haircuts anyone can pick. The others (afro, mohawk, ponytail, bun, dreads, flat-top, flames) are wardrobe items. */
export const HAIRCUTS = ["Short", "Side parting", "Curly", "Buzz cut", "Spiky", "Long", "Bald", "Quiff"];
const CUTS = ["short", "side", "curly", "buzz", "spiky", "long", "bald", "quiff"];
export const KINDS = 8;
export const BEARDS = ["None", "Moustache", "Goatee", "Full beard", "Short beard"];

/** How many choices each part has, in packing order. */
const SIZES: [keyof Face, number][] = [
  ["skin", SKINS.length],
  ["hair", HAIRCUTS.length],
  ["colour", HAIR_COLOURS.length],
  ["kind", KINDS],
  ["beard", BEARDS.length],
];
export const FACE_MAX = SIZES.reduce((n, [, s]) => n * s, 1);

export function packFace(f: Face): number {
  let n = 0;
  for (let i = SIZES.length - 1; i >= 0; i--) n = n * SIZES[i]![1] + (((f[SIZES[i]![0]] % SIZES[i]![1]) + SIZES[i]![1]) % SIZES[i]![1]);
  return n;
}

export function unpackFace(code: number): Face {
  let n = Math.abs(Math.trunc(code)) % FACE_MAX;
  const f = {} as Face;
  for (const [k, s] of SIZES) {
    f[k] = n % s;
    n = Math.floor(n / s);
  }
  return f;
}

const hash = (n: number, salt: number) => {
  const x = Math.sin((n + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** The face a footballer is born with, from his number. */
export function bornFace(n: number): Face {
  const pick = (salt: number, size: number) => Math.floor(hash(n, salt) * size);
  const beard = hash(n, 6);
  return {
    skin: pick(1, SKINS.length),
    hair: [0, 1, 2, 3, 4, 5, 7, 0, 1, 2, 4, 7][pick(2, 12)]!,
    colour: [0, 0, 1, 1, 2, 2, 3, 4, 6][pick(3, 9)]!,
    kind: pick(4, KINDS),
    beard: beard < 0.66 ? 0 : 1 + Math.floor(((beard - 0.66) / 0.34) * 4),
  };
}

// ------------------------------------------------------------ the faces players picked

const picked = new Map<number, number>();
const listeners = new Set<() => void>();
let version = 0;

/** The faces saved on the relay, by footballer number (faceNumber(token_id)). */
export function setFaces(map: Record<string, number>) {
  picked.clear();
  for (const [token, code] of Object.entries(map)) picked.set(Number(token.replace(/\D/g, "")) || 0, code);
  version++;
  listeners.forEach((l) => l());
}
export function setFace(n: number, code: number) {
  picked.set(n, code);
  version++;
  listeners.forEach((l) => l());
}
export const subscribeFaces = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const facesVersion = () => version;

/** His face: the one he picked, or the one he was born with. */
export function faceOf(n: number): Face {
  const code = picked.get(n);
  return code === undefined ? bornFace(n) : unpackFace(code);
}

// ------------------------------------------------------------ drawing

export type View = "front" | "back" | "side";
/** The head is drawn on a 30 x 30 grid of big pixels (side: facing right). */
export const HEAD = 30;
const INK = "#1B1030";

const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

/** Wardrobe haircuts (look.hair) replace the cut, and some its colour. */
function cutOf(face: Face, item?: string | null): { cut: string; colour: string } {
  const base = CUTS[face.hair] ?? "short";
  const colour = HAIR_COLOURS[face.colour] ?? HAIR_COLOURS[0]!;
  const style = item ? item.split(".").pop()! : "";
  if (!style) return { cut: base, colour };
  if (style === "bleached") return { cut: base === "bald" ? "short" : base, colour: "#F4EBC4" };
  if (style === "fire") return { cut: "fire", colour: "#D8362A" };
  if (style === "curls") return { cut: "curly", colour };
  if (["afro", "mohawk", "ponytail", "bun", "dreads", "flattop", "buzz", "short"].includes(style)) return { cut: style, colour };
  return { cut: base, colour };
}

// ------------------------------------------------------------ the drawn heads (art/faces)

/**
 * The heads are drawn in GUS and stacked here: a bald face (eight of them,
 * the skin repainted), a beard, a haircut (both drawn on a green mannequin,
 * so they sit on any face, and tinted). Each part is a strip of three views
 * (front, side facing right, back) of FRAME x FRAME pixels: the head is
 * 64 px wide in the middle, its jaw at y = 106.
 */
export const FRAME = 128;
const PARTS = new Map<string, HTMLImageElement>();
const NAMES = [...Array.from({ length: KINDS }, (_, i) => `face-${i}`), ...["short", "side", "curly", "buzz", "spiky", "long", "quiff", "afro", "mohawk", "ponytail", "bun", "dreads", "flattop", "fire"].map((c) => `hair-${c}`), "beard-1", "beard-2", "beard-3", "beard-4"];
let loading = false;
let loaded = false;
function loadParts() {
  if (loading || typeof Image === "undefined") return;
  loading = true;
  let left = NAMES.length;
  for (const name of NAMES) {
    const img = new Image();
    img.onload = img.onerror = () => {
      if (--left === 0) {
        loaded = NAMES.every((k) => (PARTS.get(k)?.naturalWidth ?? 0) > 0);
        version++;
        listeners.forEach((l) => l());
      }
    };
    img.src = `/art/faces/${name}.webp`;
    PARTS.set(name, img);
  }
}
/** True once every part has loaded (until then the heads are drawn in code). */
export const artReady = () => (loadParts(), loaded);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** One view of a part, on its own canvas, repainted: "skin" to a tone, "tint" to a hair colour. */
function part(name: string, view: number, mode: "skin" | "tint", colour: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = FRAME;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(PARTS.get(name)!, view * FRAME, 0, FRAME, FRAME, 0, 0, FRAME, FRAME);
  const d = x.getImageData(0, 0, FRAME, FRAME);
  const p = d.data;
  const [tr, tg, tb] = rgb(colour);
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3]! < 8) continue;
    const r = p[i]! / 255;
    const g = p[i + 1]! / 255;
    const b = p[i + 2]! / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mode === "tint") {
      if (mx < 0.24) continue; // the outline stays dark
      const k = mx / 0.55;
      p[i] = Math.min(255, tr * k);
      p[i + 1] = Math.min(255, tg * k);
      p[i + 2] = Math.min(255, tb * k);
    } else {
      // Skin: warm, lit pixels (not the eyes, the teeth, the brows or the outline).
      const sat = mx ? (mx - mn) / mx : 0;
      if (mx < 0.34 || sat < 0.12 || sat > 0.8 || mx !== r) continue;
      const h = (60 * ((g - b) / (mx - mn || 1)) + 360) % 360;
      if (h > 48 && h < 325) continue;
      const k = mx / 0.9;
      // The cheeks and the shade keep a little of their pink.
      const rosy = h >= 325 || h < 12 ? 0.25 : 0;
      p[i] = Math.min(255, tr * k * (1 + rosy * 0.12));
      p[i + 1] = Math.min(255, tg * k * (1 - rosy * 0.25));
      p[i + 2] = Math.min(255, tb * k * (1 - rosy * 0.1));
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}

const DRAWN = new Map<string, HTMLCanvasElement>();
/** The whole head, one view, FRAME x FRAME. Call only when artReady(). */
function drawnHead(face: Face, view: View, item?: string | null): HTMLCanvasElement {
  const key = `${packFace(face)}|${view}|${item ?? ""}`;
  let c = DRAWN.get(key);
  if (!c) {
    const v = view === "front" ? 0 : view === "side" ? 1 : 2;
    const { cut, colour } = cutOf(face, item);
    c = document.createElement("canvas");
    c.width = c.height = FRAME;
    const x = c.getContext("2d")!;
    x.drawImage(part(`face-${face.kind % KINDS}`, v, "skin", SKINS[face.skin] ?? SKINS[1]!), 0, 0);
    if (face.beard > 0) x.drawImage(part(`beard-${face.beard}`, v, "tint", colour), 0, 0);
    if (cut !== "bald") x.drawImage(part(`hair-${cut}`, v, "tint", colour), 0, 0);
    DRAWN.set(key, c);
  }
  return c;
}

const URLS = new Map<string, string>();
/** The head as an image address (for the menus), or null until the art has loaded. */
export function headURL(face: Face, view: View, item?: string | null): string | null {
  if (!artReady()) return null;
  const key = `${packFace(face)}|${view}|${item ?? ""}`;
  let u = URLS.get(key);
  if (!u) {
    u = drawnHead(face, view, item).toDataURL();
    URLS.set(key, u);
  }
  return u;
}

/**
 * The head as a grid of colours (null = empty), HEAD wide and HEAD tall.
 * `item` is the haircut he wears from his wardrobe, if any.
 */
export function headGrid(face: Face, view: View, item?: string | null): (string | null)[][] {
  const g: (string | null)[][] = Array.from({ length: HEAD }, () => Array<string | null>(HEAD).fill(null));
  const px = (x: number, y: number, c: string | null) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < HEAD && y < HEAD) g[y]![x] = c;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
  };
  // (The code-drawn head: only until the art has loaded.)
  const eyes = face.kind % 4;
  const brows = face.kind % 3;
  const mouth = (face.kind >> 1) % 3;
  const beard = [0, 2, 3, 4, 1][face.beard] ?? 0;
  const skin = SKINS[face.skin] ?? SKINS[0]!;
  const skinS = mix(skin, "#7A2A3A", 0.24);
  const { cut, colour } = cutOf(face, item);
  const hairL = mix(colour, "#FFFFFF", 0.22);
  const hairD = mix(colour, "#000000", 0.3);
  const CX = 14.5;
  const CY = 16.5;
  const RX = 10.2;
  const RY = 9.8;
  const inHead = (x: number, y: number, grow = 0) => ((x - CX) / (RX + grow)) ** 2 + ((y - CY) / (RY + grow)) ** 2 <= 1;

  // Hair behind the head (long cuts, afro, ponytail, bun).
  const behind = (x: number, y: number): boolean => {
    if (cut === "afro") return (x - CX) ** 2 / 14.2 ** 2 + (y - 12.5) ** 2 / 12.2 ** 2 <= 1;
    if (cut === "long" || cut === "dreads") return inHead(x, y, 2.3) && y < 25 ? true : Math.abs(x - CX) > 6.5 && Math.abs(x - CX) < 12.5 && y >= 16 && y < 28.5;
    if (cut === "bun") return (x - CX) ** 2 + (y - 4.2) ** 2 <= 11;
    if (cut === "ponytail") return view === "side" ? x < 5 && y > 9 && y < 22 && x > 0.5 + Math.abs(y - 15) * 0.25 : view === "back" ? Math.abs(x - CX) < 2.6 && y > 20 && y < 29 : x > 24.5 && x < 28.5 && y > 11 && y < 21;
    if (cut === "spiky") return y < 10 && y > 2 && inHead(x, y + 3.2, 0.6) && (Math.round(x) % 4 !== 0 || y > 5.5);
    if (cut === "quiff") return view === "side" ? x > 12 && x < 24 && y > 2.5 && y < 9 && (x - 18) ** 2 / 36 + (y - 7) ** 2 / 20 <= 1 : (x - CX - 1) ** 2 / 46 + (y - 6.5) ** 2 / 15 <= 1;
    if (cut === "mohawk") return view === "side" ? y > 1.5 && y < 12 && x > 5 && x < 22 && inHead(x, y + 4.2, 0.4) : Math.abs(x - CX) < 2.6 && y > 1.5 && y < (view === "back" ? 24 : 11);
    if (cut === "curly") return inHead(x, y, 1.9) && y < 15 && (Math.round(x * 1.3 + y) % 3 !== 0 || inHead(x, y, 1));
    return false;
  };
  for (let y = 0; y < HEAD; y++) for (let x = 0; x < HEAD; x++) if (behind(x, y)) px(x, y, cut === "dreads" && Math.round(x) % 3 === 0 ? hairD : colour);

  // Neck, ears, head.
  if (view !== "side") rect(11, 25, 8, 5, skinS);
  else rect(10, 25, 7, 5, skinS);
  if (view === "front" || view === "back") {
    rect(3, 15, 2, 4, skin);
    rect(25, 15, 2, 4, skin);
  }
  for (let y = 0; y < HEAD; y++)
    for (let x = 0; x < HEAD; x++)
      if (inHead(x, y)) px(x, y, !inHead(x + 1.6, y - 1.2) || y > 24.5 ? skinS : skin);

  // The hair on the head.
  const fringe = cut === "side" ? (x: number) => 11.2 + (x - 5) * 0.16 : cut === "curly" ? (x: number) => 11.5 + (Math.round(x) % 2) : cut === "long" || cut === "dreads" ? (x: number) => 11 + Math.abs(x - CX) * 0.12 : () => 10.6;
  const onTop = (x: number, y: number): boolean => {
    if (cut === "bald" || cut === "mohawk") return false;
    if (!inHead(x, y, 0.9)) return false;
    if (view === "back") return y < (cut === "buzz" ? 20 : 22.5) || (cut === "long" || cut === "dreads" ? true : false);
    if (view === "side") return y < fringe(x) - (x > 20 ? (x - 20) * 0.5 : 0) || (x < 10.5 - Math.max(0, y - 17) * 0.9 && y < 23);
    // Front: a fringe, and the temples.
    return y < fringe(x) || (Math.abs(x - CX) > 8.3 && y < 16.5);
  };
  for (let y = 0; y < HEAD; y++)
    for (let x = 0; x < HEAD; x++)
      if (onTop(x, y)) {
        const c = cut === "buzz" ? mix(colour, skin, 0.45) : (x - 11) ** 2 / 26 + (y - 8.6) ** 2 / 3 <= 1 ? hairL : cut === "dreads" && Math.round(x) % 3 === 0 ? hairD : colour;
        px(x, y, c);
      }

  // The face.
  if (view === "front") {
    const beardC = mix(colour, skin, 0.12);
    if (beard === 1) for (let y = 20; y < 27; y++) for (let x = 5; x < 25; x++) if (inHead(x, y) && (y > 22 || Math.abs(x - CX) > 6)) px(x, y, mix(skin, colour, 0.3));
    if (beard === 4) for (let y = 17; y < 27; y++) for (let x = 4; x < 26; x++) if (inHead(x, y) && (y > 21.5 || Math.abs(x - CX) > 7.2)) px(x, y, beardC);
    if (beard === 3) for (let y = 22; y < 27; y++) for (let x = 11; x < 19; x++) if (inHead(x, y)) px(x, y, beardC);
    eye(8.5, 16);
    eye(18.5, 16);
    brow(8, 13.5, 1);
    brow(18, 13.5, -1);
    px(14, 20, skinS);
    px(15, 20, skinS);
    if (beard === 2 || beard === 4) rect(11, 21, 8, 1 + (beard === 2 ? 1 : 0), beard === 2 ? beardC : hairD);
    const my = beard === 2 ? 24 : 23;
    if (mouth === 0) {
      rect(12, my, 6, 1, INK);
      px(11, my - 1, INK);
      px(18, my - 1, INK);
    } else if (mouth === 1) rect(12, my, 6, 1, INK);
    else {
      rect(11, my - 1, 8, 3, INK);
      rect(12, my - 1, 6, 1, "#FFFFFF");
      rect(13, my + 1, 4, 1, "#C8505A");
    }
  } else if (view === "side") {
    const beardC = mix(colour, skin, 0.12);
    if (beard === 1) for (let y = 20; y < 27; y++) for (let x = 12; x < 26; x++) if (inHead(x, y) && y > 21) px(x, y, mix(skin, colour, 0.3));
    if (beard === 4) for (let y = 18; y < 27; y++) for (let x = 11; x < 26; x++) if (inHead(x, y) && (y > 21.5 || x < 14)) px(x, y, beardC);
    if (beard === 3) for (let y = 22; y < 27; y++) for (let x = 17; x < 24; x++) if (inHead(x, y)) px(x, y, beardC);
    rect(11, 15, 2, 4, skinS); // ear
    eye(19.5, 16);
    brow(19, 13.5, -1);
    px(25, 19, skin);
    px(25, 20, skinS);
    if (beard === 2 || beard === 4) rect(19, 21, 5, 1, hairD);
    if (mouth === 2) {
      rect(19, 22, 5, 2, INK);
      rect(20, 22, 4, 1, "#FFFFFF");
    } else rect(19, 23, 5, 1, INK);
    if (mouth === 0) px(19, 22, INK);
  }

  function eye(x: number, y: number) {
    if (eyes === 0) {
      rect(x, y, 3, 4, INK);
      px(x + 1, y, "#FFFFFF");
    } else if (eyes === 1) rect(x, y + 1, 3, 2, INK);
    else if (eyes === 2) {
      rect(x - 0.5, y - 0.5, 4, 5, "#FFFFFF");
      rect(x + 0.5, y + 0.5, 2, 3, INK);
    } else {
      rect(x, y + 1, 3, 3, INK);
      rect(x - 0.5, y, 4, 1, skinS);
    }
  }
  function brow(x: number, y: number, dir: number) {
    const c = cut === "bald" || face.colour >= 4 ? hairD : colour;
    if (brows === 0) rect(x, y, 4, 1, c);
    else if (brows === 1) rect(x, y - 1, 4, 2, c);
    else {
      rect(x, y, 4, 1, c);
      px(dir > 0 ? x : x + 3, y - 1, c);
      px(dir > 0 ? x + 3 : x, y + 1, c);
    }
  }

  // A dark outline around everything.
  const out = g.map((r) => r.slice());
  for (let y = 0; y < HEAD; y++)
    for (let x = 0; x < HEAD; x++)
      if (!g[y]![x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy!]?.[x + dx!])) out[y]![x] = INK;
  return out;
}

const CANVASES = new Map<string, HTMLCanvasElement>();
/** The head painted once on a small canvas (for the games and the live match). */
export function headCanvas(face: Face, view: View, item?: string | null): HTMLCanvasElement {
  if (artReady()) return drawnHead(face, view, item); // FRAME wide: the drawn head
  const key = `${packFace(face)}|${view}|${item ?? ""}`;
  let c = CANVASES.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = HEAD;
    const x = c.getContext("2d")!;
    headGrid(face, view, item).forEach((row, j) =>
      row.forEach((col, i) => {
        if (!col) return;
        x.fillStyle = col;
        x.fillRect(i, j, 1, 1);
      }),
    );
    CANVASES.set(key, c);
  }
  return c;
}

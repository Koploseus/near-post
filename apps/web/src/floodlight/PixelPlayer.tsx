/**
 * The footballer in pixel art ("Floodlight Pixel"): one rig for the whole app.
 *
 * A 34 × 46 grid drawn in code, so every footballer wears his own look: skin
 * and hair colour from his number (as Look.tsx does), the club's shirt, and
 * every wardrobe item (wardrobe.rs CATALOG): 12 haircuts, headbands, boots,
 * socks, shin pads, tape, gloves and wristbands, with their patterns.
 *
 * Drop-in: <PixelAvatar> takes Avatar's props, <PixelHead> takes Head's props,
 * <PixelBust> is the sticker portrait. Output is one SVG with one path per
 * colour (crispEdges), memoised per look, so a pitch full of heads is cheap.
 */
import type { Look } from "../lib/types.js";

// Same palettes as Look.tsx, so a footballer keeps his skin and hair colour.
const SKIN = ["#C68B5E", "#E9B98F", "#B37650", "#F0C6A0", "#8A5A3B", "#DDA77C"];
const HAIR = ["#2A1A10", "#7A4B23", "#111111", "#C9A15A", "#1A1210", "#3B2416"];

const INK = "#0B0820";
const W = 34;
const H = 46;
const TOP = 4; // rows above the head, for buns, mohawks, flat-tops and fire

export type Pose =
  | "idle"
  | "idle2" // breathing frame: head down one row
  | "run" // run cycle, contact (near leg forward)
  | "stride" // run cycle, passing (feet together, body up one row)
  | "run2" // run cycle, contact (far leg forward)
  | "kick"
  | "cheer"
  | "back" // seen from behind (shooter)
  | "backRun"
  | "backRun2"
  | "backKick" // wind-up seen from behind: kicking leg drawn back, arms wide
  | "backHands" // seen from behind, hands on the head: a miss
  | "slide" // sliding tackle, low
  | "keeper" // ready crouch, arms wide, gloves up
  | "stretch" // arms straight up, legs together: rotate it for a dive
  | "catch"; // ball held at the chest

/** Frame sequences. Play at ~8 fps (run) or ~2 fps (idle). */
export const RUN_CYCLE: Pose[] = ["run", "stride", "run2", "stride"];
export const BACK_RUN_CYCLE: Pose[] = ["backRun", "back", "backRun2", "back"];
export const IDLE_CYCLE: Pose[] = ["idle", "idle", "idle2", "idle2"];

export interface PixelOpts {
  look?: Look | null;
  /** Face number (faceNumber(token_id)): skin, hair colour, eyes and mouth. */
  n: number;
  /** Shirt colour (club main colour). */
  shirt?: string;
  /** Shirt stripe and default socks (club second colour). */
  shirt2?: string;
  shorts?: string;
  pose?: Pose;
  flip?: boolean;
  /** Mock-ups only: force colours instead of deriving them from n and the look. */
  colors?: { skin?: string; hair?: string; boots?: string; band?: string };
}

// ------------------------------------------------------------------ colours

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  return "#" + pa.map((v, i) => Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}
const shade = (c: string) => mix(c, INK, 0.28);
const light = (c: string) => mix(c, "#FFFFFF", 0.32);

const styleOf = (id: string | null | undefined) => (id ? (id.split(".")[1] ?? null) : null);

/** Kit item colours (socks, pads, gloves, wrist, tape, band), by style. */
const SOLID: Record<string, string> = {
  white: "#F7F4EC",
  black: "#26262C",
  navy: "#1B2340",
  grey: "#8B8F9C",
  red: "#C8202F",
  blue: "#2F5DA8",
  yellow: "#F2B705",
  neon: "#B8FF2E",
  grip: "#3F8A3A",
  laurel: "#3F8A3A",
  camo: "#5B6B3A",
  carbon: "#2B2F3A",
  gold: "#F2B705",
  chrome: "#D9DDE4",
  galaxy: "#3A1A78",
  flame: "#FF7A1A",
  "two-tone": "#FF7A1A",
  hooped: "#C8202F",
  striped: "#C8202F",
  checked: "#1B2340",
  tifo: "#C8202F",
};

/** The colour of a patterned item at a grid pixel (x, y). */
let forcedBand = "";
function paint(style: string, x: number, y: number): string {
  switch (style) {
    case "__band":
      return forcedBand;
    case "hooped":
      return y % 2 ? "#F7F4EC" : "#C8202F";
    case "striped":
      return x % 2 ? "#F7F4EC" : "#C8202F";
    case "checked":
      return (x + y) % 2 ? "#F7F4EC" : "#1B2340";
    case "tifo":
      return ["#C8202F", "#F2B705", "#2F5DA8", "#F7F4EC"][x % 4]!;
    case "two-tone":
      return x % 4 < 2 ? "#FF7A1A" : "#1B2340";
    case "camo":
      return (x * 7 + y * 3) % 5 < 2 ? "#2F3A1C" : "#5B6B3A";
    case "carbon":
      return (x + y) % 2 ? "#3A4050" : "#2B2F3A";
    case "galaxy":
      return (x * 5 + y * 3) % 7 === 0 ? "#FF9EF0" : (x + y) % 3 ? "#3A1A78" : "#2A1466";
    case "flame":
      return y % 3 === 0 ? "#F2B705" : y % 3 === 1 ? "#FF7A1A" : "#C8202F";
    case "chrome":
      return y % 2 ? "#9AA3B2" : "#E8ECF2";
    case "gold":
      return y % 3 === 0 ? "#FFE45C" : "#F2B705";
    case "grip":
      return (x + y) % 2 ? "#3F8A3A" : "#2E6B2A";
    default:
      return SOLID[style] ?? "#8B8F9C";
  }
}

const BOOTS: Record<string, [string, string]> = {
  black: ["#26262C", "#55555E"],
  white: ["#F7F4EC", "#C9C4B6"],
  navy: ["#1B2340", "#2F5DA8"],
  red: ["#C8202F", "#FF8A94"],
  blue: ["#2F5DA8", "#9CC0FF"],
  yellow: ["#F2B705", "#1B2340"],
  neon: ["#B8FF2E", "#FF2EA6"],
  "two-tone": ["#FF7A1A", "#1B2340"],
  camo: ["#5B6B3A", "#2F3A1C"],
  gold: ["#F2B705", "#FFF3B0"],
  chrome: ["#D9DDE4", "#7B8494"],
  galaxy: ["#3A1A78", "#FF9EF0"],
};

// ------------------------------------------------------------------ grid

type Grid = (string | null)[][];

/** The raw grid (rows of colours or null), for previews and tests. */
export function pixelGrid(o: PixelOpts): (string | null)[][] {
  return draw(o);
}

function draw(o: PixelOpts): Grid {
  const look = o.look ?? undefined;
  // Token numbers can be huge (past 2^31): keep a small non-negative integer, or `n >> 1` goes negative.
  const n = Math.abs(Math.trunc(o.n || 0)) % 1_000_003;
  const back = o.pose === "back" || o.pose === "backRun" || o.pose === "backRun2" || o.pose === "backKick" || o.pose === "backHands";
  // The body motion, with the back view folded onto its front-view twin.
  const pose: Pose = o.pose === "back" ? "idle" : o.pose === "backRun" ? "run" : o.pose === "backRun2" ? "run2" : (o.pose ?? "idle");
  const skin = o.colors?.skin ?? SKIN[n % SKIN.length]!;
  const skinS = mix(skin, "#7A2430", 0.28);
  const hairStyle = styleOf(look?.hair) ?? "short";
  const hairBase = o.colors?.hair ?? (hairStyle === "bleached" ? "#F1DE9A" : hairStyle === "fire" ? "#C8202F" : HAIR[(n >> 1) % HAIR.length]!);
  const kit = o.shirt ?? "#C8202F";
  const kit2 = o.shirt2 ?? "#F3EAD7";
  const shorts = o.shorts ?? kit2;
  const socks = styleOf(look?.socks);
  const pads = styleOf(look?.pads);
  const tape = styleOf(look?.tape);
  const pose0: Pose = o.pose ?? "idle";
  // Keepers wear white gloves unless the look says otherwise.
  const gloves = styleOf(look?.gloves) ?? (pose0 === "keeper" || pose0 === "stretch" || pose0 === "catch" ? "white" : null);
  const wrist = styleOf(look?.wrist);
  const band = o.colors?.band ? "__band" : styleOf(look?.band);
  const [boot, bootL] = o.colors?.boots ? [o.colors.boots, light(o.colors.boots)] : (BOOTS[styleOf(look?.boots) ?? ""] ?? ["#1B2340", "#3B4A7A"]);

  forcedBand = o.colors?.band ?? "";
  const G: Grid = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const px = (x: number, y: number, c: string | null) => {
    const gx = x + 1;
    const gy = y + 1 + TOP;
    if (gx >= 0 && gx < W && gy >= 0 && gy < H) G[gy]![gx] = c;
  };
  const rect = (x: number, y: number, w: number, h: number, c: string | null | ((x: number, y: number) => string)) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, typeof c === "function" ? c(x + i, y + j) : c);
  };

  const jump = pose === "cheer" ? -2 : 0;
  // Body offset (torso, shorts, arms) and head offset, per pose.
  const by = pose === "cheer" ? -2 : pose === "stride" ? -1 : pose === "slide" ? 4 : pose === "keeper" ? 2 : 0;
  const hx = pose === "run" || pose === "run2" || pose === "stride" ? 1 : pose === "slide" ? -2 : 0;
  const hy = by + (pose === "idle2" ? 1 : 0);
  const inHead = (x: number, y: number, dx = 0, dy = 0) => ((x - 15.5 - hx - dx) / 9.2) ** 2 + ((y - 10.5 - hy - dy) / 8.7) ** 2 <= 1;

  // Hands (gloves) and the row above them (wristband).
  const hand = (x: number, y: number, w: number, h: number, back: boolean) => {
    rect(x, y, w, h, gloves ? (gx, gy) => (back ? shade(paint(gloves, gx, gy)) : paint(gloves, gx, gy)) : back ? skinS : skin);
  };
  const wristRow = (x: number, y: number, w: number) => {
    if (wrist) rect(x, y, w, 1, (gx, gy) => paint(wrist, gx, gy));
  };

  // ---------------------------------------------------------------- behind the head
  const hairAt = (lx: number, ly: number) => (hairStyle === "buzz" ? mix(hairBase, skin, 0.35) : (lx - 11.5) ** 2 / 20 + (ly - 4.6) ** 2 / 1.6 <= 1 ? light(hairBase) : hairBase);
  if (hairStyle === "afro") {
    for (let y = -4; y < 16; y++)
      for (let x = 1; x < 31; x++)
        if (((x - 15.5 - hx) / 13.5) ** 2 + ((y - 6 - hy) / 9.6) ** 2 <= 1) px(x, y, (x * 3 + y * 5) % 7 === 0 ? light(hairBase) : hairBase);
  }
  if (hairStyle === "ponytail") {
    const side = (x: number) => x; // drawn on the right; flip mirrors it
    rect(side(24) + hx, 4 + hy, 3, 3, hairBase);
    rect(side(25) + hx, 7 + hy, 3, 5, hairBase);
    rect(side(26) + hx, 12 + hy, 2, 4, hairBase);
    px(side(26) + hx, 8 + hy, light(hairBase));
    px(side(26) + hx, 13 + hy, light(hairBase));
  }
  if (hairStyle === "dreads") {
    for (const x of [4, 6, 25, 27]) for (let y = 6; y < 18; y++) px(x + hx, y + hy, y % 3 === 0 ? light(hairBase) : hairBase);
  }

  // ---------------------------------------------------------------- arms behind the body
  if (pose === "idle" || pose === "idle2" || pose === "stride") {
    rect(6, 21, 3, 5, kit);
    wristRow(6, 25, 3);
    hand(6, 26, 3, 3, false);
    rect(9, 21, 1, 8, INK);
    rect(23, 21, 3, 5, shade(kit));
    wristRow(23, 25, 3);
    hand(23, 26, 3, 3, true);
    rect(22, 21, 1, 8, INK);
    if (pose === "stride") {
      // Elbows bent: hands come up a row and in.
      rect(6, 25 + by, 3, 4, null);
      rect(23, 25 + by, 3, 4, null);
      rect(6, 21 + by, 3, 3, kit);
      wristRow(6, 24 + by, 3);
      hand(6, 25 + by, 3, 3, false);
      rect(23, 21 + by, 3, 3, shade(kit));
      wristRow(23, 24 + by, 3);
      hand(23, 25 + by, 3, 3, true);
    }
  } else if (pose === "run2") {
    rect(6, 22, 4, 3, kit);
    hand(5, 25, 3, 3, false);
    rect(22, 21, 5, 3, shade(kit));
    hand(26, 18, 4, 4, true);
    px(26, 23, INK);
  } else if (pose === "backKick") {
    rect(3, 21, 7, 3, kit);
    wristRow(1, 20, 2);
    hand(0, 20, 3, 3, false);
    rect(22, 21, 7, 3, shade(kit));
    hand(29, 20, 3, 3, true);
  } else if (pose === "slide") {
    rect(5, 24 + 1, 5, 3, kit);
    hand(2, 21, 4, 4, false);
    rect(22, 26, 3, 6, shade(kit));
    hand(23, 32, 4, 3, true);
  } else if (pose === "keeper") {
    rect(4, 23, 6, 3, kit);
    rect(2, 19, 3, 5, skin);
    wristRow(2, 19, 3);
    hand(1, 14, 5, 5, false);
    rect(22, 23, 6, 3, shade(kit));
    rect(27, 19, 3, 5, skinS);
    wristRow(27, 19, 3);
    hand(26, 14, 5, 5, true);
  } else if (pose === "stretch") {
    rect(6, 17, 3, 4, kit);
    rect(5, 4, 3, 13, skin);
    wristRow(5, 4, 3);
    hand(4, -1, 5, 5, false);
    rect(23, 17, 3, 4, shade(kit));
    rect(24, 4, 3, 13, skinS);
    wristRow(24, 4, 3);
    hand(23, -1, 5, 5, true);
  } else if (pose === "backHands") {
    rect(6, 19, 4, 3, kit);
    rect(5, 7, 3, 12, skinS);
    wristRow(5, 7, 3);
    rect(22, 19, 4, 3, shade(kit));
    rect(24, 7, 3, 12, skinS);
    wristRow(24, 7, 3);
  } else if (pose === "catch") {
    rect(7, 21, 3, 4, kit);
    rect(22, 21, 3, 4, shade(kit));
  } else if (pose === "run") {
    rect(5, 21, 5, 3, kit);
    hand(2, 19, 4, 4, false);
    px(5, 23, INK);
    rect(22, 22, 4, 3, shade(kit));
    hand(25, 25, 3, 3, true);
  } else if (pose === "kick") {
    rect(5, 21, 5, 3, kit);
    hand(1, 22, 4, 3, false);
    rect(22, 20, 4, 3, shade(kit));
    hand(25, 17, 3, 4, true);
  } else {
    rect(3, 19 + by, 7, 4, kit);
    rect(1, 12 + by, 3, 8, skin);
    wristRow(1, 12 + by, 3);
    hand(0, 8 + by, 4, 4, false);
    rect(22, 19 + by, 7, 4, shade(kit));
    rect(28, 12 + by, 3, 8, skinS);
    wristRow(28, 12 + by, 3);
    hand(28, 8 + by, 4, 4, true);
  }

  // ---------------------------------------------------------------- torso and shorts
  rect(10, 20 + by, 12, 10, kit);
  rect(20, 20 + by, 2, 10, shade(kit));
  if (back) {
    rect(13, 22 + by, 6, 5, kit2);
    rect(15, 23 + by, 2, 3, kit);
  } else {
    rect(15, 20 + by, 2, 10, kit2);
    rect(11, 20 + by, 4, 1, shade(kit));
    rect(17, 20 + by, 3, 1, shade(kit));
    rect(15, 20 + by, 2, 1, shade(kit2));
  }
  rect(10, 30 + by, 12, 4, shorts);
  rect(20, 30 + by, 2, 4, shade(shorts));
  rect(15, 33 + by, 2, 1, INK);
  if (pose === "catch") {
    for (let y = 20; y < 30; y++)
      for (let x = 10; x < 22; x++) {
        const d = ((x - 15.5) / 5) ** 2 + ((y - 24.5) / 4.6) ** 2;
        if (d <= 1) px(x, y, d > 0.72 ? "#C9C4B6" : "#F7F4EC");
      }
    rect(14, 23, 3, 2, INK);
    px(11, 22, INK);
    px(20, 26, INK);
    px(12, 27, INK);
    hand(8, 22, 3, 5, false);
    hand(21, 22, 3, 5, true);
  }

  // ---------------------------------------------------------------- legs: skin, socks (pads, tape), boots
  const sock = (gx: number, gy: number, back: boolean) => {
    const c = socks ? paint(socks, gx, gy) : kit2;
    return back ? shade(c) : c;
  };
  const leg = (x: number, y: number, back: boolean, rows = 3) => {
    rect(x, y, 4, 1, back ? skinS : skin);
    rect(x, y + 1, 4, rows, (gx, gy) => sock(gx, gy, back));
    if (pads) rect(x + 1, y + 1, 2, Math.min(2, rows), (gx, gy) => (back ? shade(paint(pads, gx, gy)) : paint(pads, gx, gy)));
    if (tape) rect(x, y + rows, 4, 1, (gx, gy) => (back ? shade(paint(tape, gx, gy)) : paint(tape, gx, gy)));
  };
  const bootAt = (x: number, y: number, w: number, h: number, lx: number, lw: number) => {
    rect(x, y, w, h, boot);
    rect(lx, y, lw, 1, bootL);
  };
  if (pose === "run2") {
    leg(10, 34, true);
    bootAt(8, 38, 6, 2, 8, 2);
    rect(14, 34, 4, 1, skin);
    rect(17, 35, 4, 2, (gx, gy) => sock(gx, gy, false));
    bootAt(20, 33, 4, 4, 20, 1);
  } else if (pose === "stride") {
    leg(11, 33, false);
    bootAt(10, 37, 5, 2, 10, 2);
    leg(16, 33, true, 2);
    bootAt(17, 36, 4, 2, 19, 2);
  } else if (pose === "backKick") {
    leg(11, 34, false);
    bootAt(10, 38, 5, 2, 10, 2);
    rect(17, 34, 4, 1, skinS);
    rect(18, 35, 4, 1, (gx, gy) => sock(gx, gy, true));
    rect(20, 32, 4, 3, (gx, gy) => sock(gx, gy, true));
    bootAt(22, 28, 4, 4, 22, 1);
  } else if (pose === "slide") {
    rect(6, 36, 5, 2, skin);
    rect(1, 36, 5, 2, (gx, gy) => sock(gx, gy, false));
    if (pads) rect(2, 36, 2, 1, (gx, gy) => paint(pads, gx, gy));
    bootAt(-1, 35, 3, 3, -1, 1);
    rect(17, 37, 4, 1, skinS);
    rect(20, 38, 4, 2, (gx, gy) => sock(gx, gy, true));
    bootAt(24, 38, 5, 2, 27, 2);
  } else if (pose === "keeper") {
    leg(8, 36, false, 1);
    bootAt(6, 38, 6, 2, 6, 2);
    leg(20, 36, true, 1);
    bootAt(20, 38, 6, 2, 24, 2);
  } else if (pose === "stretch") {
    leg(12, 34, false, 4);
    bootAt(12, 39, 4, 1, 12, 2);
    leg(16, 34, true, 4);
    bootAt(16, 39, 4, 1, 18, 2);
  } else if (pose === "run") {
    leg(10, 34, false);
    bootAt(8, 38, 6, 2, 8, 2);
    rect(17, 34, 4, 1, skinS);
    rect(19, 35, 4, 2, (gx, gy) => sock(gx, gy, true));
    bootAt(22, 33, 4, 4, 22, 1);
  } else if (pose === "kick") {
    leg(11, 34, false);
    bootAt(10, 38, 5, 2, 10, 2);
    rect(21, 31, 3, 3, skinS);
    rect(24, 30, 4, 4, (gx, gy) => sock(gx, gy, false));
    bootAt(28, 29, 4, 5, 28, 2);
  } else if (jump) {
    leg(11, 32, false, 2);
    bootAt(10, 35, 5, 2, 10, 2);
    leg(17, 32, true, 2);
    bootAt(17, 35, 5, 2, 20, 2);
  } else {
    leg(11, 34, false);
    bootAt(10, 38, 5, 2, 10, 2);
    leg(17, 34, true);
    bootAt(17, 38, 5, 2, 20, 2);
  }

  // ---------------------------------------------------------------- head
  for (let y = 0; y < 22; y++) for (let x = 4; x < 29; x++) if (inHead(x, y)) px(x, y, inHead(x, y, -1.6, -1.6) ? skin : skinS);
  rect(6 + hx, 11 + hy, 1, 3, skin);
  rect(25 + hx, 11 + hy, 1, 3, skinS);

  // ---------------------------------------------------------------- hair on the head
  const sides = !["mohawk", "buzz"].includes(hairStyle);
  for (let y = 0; y < 22; y++)
    for (let x = 4; x < 29; x++) {
      if (!inHead(x, y)) continue;
      const ly = y - hy;
      const lx = x - hx;
      let on: boolean;
      if (back) on = hairStyle === "mohawk" ? lx >= 13 && lx <= 18 && ly <= 14 : hairStyle === "buzz" ? ly <= 12 : ly <= 14;
      else if (hairStyle === "mohawk") on = lx >= 13 && lx <= 18 && ly <= 7;
      else if (hairStyle === "buzz") on = ly <= 5 || ((lx <= 7 || lx >= 24) && ly <= 9);
      else {
        const cap = ly <= 7 || (sides && (lx <= 8 || lx >= 23) && ly <= 11);
        const fringe =
          !band &&
          (hairStyle === "side-part"
            ? (ly === 8 && lx <= 15) || (ly === 9 && lx <= 11)
            : hairStyle === "short" || hairStyle === "bleached" || hairStyle === "curls" || hairStyle === "dreads"
              ? ly === 8 && (lx + 1) % 5 < 3
              : false);
        on = cap || fringe;
      }
      if (!on) continue;
      let c = hairAt(lx, ly);
      if (hairStyle === "curls" && (lx + ly) % 3 === 0) c = light(hairBase);
      if (hairStyle === "side-part" && lx === 12 && ly >= 2 && ly <= 6) c = shade(hairBase);
      if (hairStyle === "fire") c = ly <= 3 ? "#FF7A1A" : "#C8202F";
      px(x, y, c);
    }

  // ---------------------------------------------------------------- hair above the head
  const top = (x: number, y: number, c: string) => px(x + hx, y + hy, c);
  if (hairStyle === "bun") {
    for (let y = -4; y <= 1; y++) for (let x = 12; x <= 19; x++) if (((x - 15.5) / 3.6) ** 2 + ((y + 1.5) / 2.8) ** 2 <= 1) top(x, y, y === -3 && x < 16 ? light(hairBase) : hairBase);
    for (let x = 13; x <= 18; x++) top(x, 2, shade(hairBase));
  }
  if (hairStyle === "mohawk") {
    const h = [2, 4, 5, 5, 4, 2];
    h.forEach((k, i) => {
      for (let j = 0; j < k; j++) top(13 + i, 2 - j, j === k - 1 ? light(hairBase) : hairBase);
    });
  }
  if (hairStyle === "flat-top") {
    rect(8 + hx, -3 + hy, 16, 8, (x) => ((x - hx) % 3 === 0 ? shade(hairBase) : hairBase));
    rect(8 + hx, -3 + hy, 16, 1, light(hairBase));
  }
  if (hairStyle === "curls") {
    for (const x of [8, 9, 12, 13, 16, 17, 20, 21, 24]) top(x, 1, (x % 4) % 3 ? hairBase : light(hairBase));
    for (const x of [10, 14, 18, 22]) top(x, 0, hairBase);
    for (const y of [9, 11]) {
      top(5, y, hairBase);
      top(26, y, hairBase);
    }
  }
  if (hairStyle === "fire") {
    const spikes: [number, number][] = [
      [8, 3],
      [11, 5],
      [14, 7],
      [17, 6],
      [20, 5],
      [23, 3],
    ];
    for (const [x, k] of spikes)
      for (let j = 0; j < k; j++) {
        const y = 2 - j;
        const c = j >= k - 2 ? "#F2B705" : j >= k - 4 ? "#FF7A1A" : "#C8202F";
        top(x, y, c);
        if (j < k - 1) top(x + 1, y, c);
      }
  }

  // ---------------------------------------------------------------- headband
  if (band) {
    for (let x = 4; x < 29; x++)
      for (let y = 7; y <= 8; y++)
        if (inHead(x, y + hy)) {
          const c = paint(band, x, y);
          px(x, y + hy, y === 8 ? shade(c) : c);
        }
    if (band === "laurel") for (const x of [7, 10, 13, 18, 21, 24]) px(x + hx, 6 + hy, "#6FBF5A");
    if (band === "gold" && !back) px(15 + hx, 7 + hy, "#FFF3B0");
  }

  // ---------------------------------------------------------------- face: eyes and mouth from the number
  if (pose === "backHands") {
    hand(7, 3, 6, 4, true);
    hand(19, 3, 6, 4, true);
  }
  if (!back) {
    const round = (n >> 7) % 2 === 1;
    const mouth = pose === "cheer" || pose === "kick" ? 0 : (n >> 5) % 3; // 0 grin, 1 smile, 2 flat
    if (round) {
      rect(10 + hx, 11 + hy, 3, 4, INK);
      rect(19 + hx, 11 + hy, 3, 4, INK);
      rect(10 + hx, 11 + hy, 2, 2, "#FFFFFF");
      rect(19 + hx, 11 + hy, 2, 2, "#FFFFFF");
    } else {
      rect(10 + hx, 12 + hy, 2, 3, INK);
      rect(20 + hx, 12 + hy, 2, 3, INK);
      px(10 + hx, 12 + hy, "#FFFFFF");
      px(20 + hx, 12 + hy, "#FFFFFF");
    }
    rect(7 + hx, 15 + hy, 2, 1, "#F08A8A");
    rect(23 + hx, 15 + hy, 2, 1, "#F08A8A");
    if (mouth === 0) {
      rect(14 + hx, 16 + hy, 4, 2, "#8E2233");
      rect(14 + hx, 16 + hy, 4, 1, "#FFFFFF");
    } else if (mouth === 1) {
      px(14 + hx, 16 + hy, "#8E2233");
      px(17 + hx, 16 + hy, "#8E2233");
      rect(15 + hx, 17 + hy, 2, 1, "#8E2233");
    } else rect(14 + hx, 17 + hy, 4, 1, "#8E2233");
  }

  // ---------------------------------------------------------------- outline
  const filled = G.map((r) => r.map((v) => v !== null));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (filled[y]![x]) continue;
      if ((y > 0 && filled[y - 1]![x]) || (y < H - 1 && filled[y + 1]![x]) || (x > 0 && filled[y]![x - 1]) || (x < W - 1 && filled[y]![x + 1])) G[y]![x] = INK;
    }
  return o.flip ? G.map((r) => r.slice().reverse()) : G;
}

/** One SVG path per colour, from rows [y0, y1). */
function compile(G: Grid, y0 = 0, y1 = H): [string, string][] {
  const d = new Map<string, string>();
  for (let y = y0; y < y1; y++) {
    let x = 0;
    while (x < W) {
      const c = G[y]![x];
      if (!c) {
        x++;
        continue;
      }
      let k = 1;
      while (x + k < W && G[y]![x + k] === c) k++;
      d.set(c, (d.get(c) ?? "") + `M${x} ${y - y0}h${k}v1h-${k}z`);
      x += k;
    }
  }
  return [...d.entries()];
}

const memo = new Map<string, Grid>();
function grid(o: PixelOpts): Grid {
  const key = JSON.stringify([o.look ?? null, o.n, o.shirt, o.shirt2, o.shorts, o.pose, o.flip, o.colors ?? null]);
  let g = memo.get(key);
  if (!g) {
    g = draw(o);
    if (memo.size > 500) memo.clear();
    memo.set(key, g);
  }
  return g;
}

function Svg({ paths, w, h, width, height, className, title }: { paths: [string, string][]; w: number; h: number; width?: number; height?: number; className?: string; title?: string }) {
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={width}
      height={height}
      className={className}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {paths.map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}

// Rows of the grid shown by each crop.
const BUST: [number, number] = [0, 33]; // hair top to the chest: stickers
const HEAD: [number, number] = [1, 30]; // head and collar: pitch, squad, wall, header

/** The whole footballer. Same props as Look.tsx Avatar (size = height). */
export function PixelAvatar({ look, n, shirt, shirt2, size = 180, pose, flip, className }: { look?: Look | null; n: number; shirt?: string; shirt2?: string; size?: number; pose?: Pose; flip?: boolean; className?: string }) {
  const g = grid({ look, n, shirt, shirt2, pose, flip });
  return <Svg paths={compile(g)} w={W} h={H} width={Math.round((size * W) / H)} height={size} className={className} />;
}

/** Head and collar. Same props as Look.tsx Head (size = width). */
export function PixelHead({ look, n, shirt, size = 36, title, className }: { look?: Look | null; n: number; shirt?: string; size?: number; title?: string; className?: string }) {
  const g = grid({ look, n, shirt });
  const [a, b] = HEAD;
  return <Svg paths={compile(g, a, b)} w={W} h={b - a} width={size} height={Math.round((size * (b - a)) / W)} className={className ?? "face-head"} title={title} />;
}

/** Sticker portrait: hair to chest. Sized by CSS (100% of .sticker-face). */
export function PixelBust({ look, n, shirt, shirt2, className }: { look?: Look | null; n: number; shirt?: string; shirt2?: string; className?: string }) {
  const g = grid({ look, n, shirt, shirt2 });
  const [a, b] = BUST;
  return <Svg paths={compile(g, a, b)} w={W} h={b - a} className={className} />;
}

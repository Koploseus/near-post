/**
 * The tifo: the north stand is a grid of squares. Each fan who checks in paints
 * part of it, and the picture is complete exactly at the full-house target (60%).
 */

export const COLS = 40;
export const ROWS = 12;
export const TARGET = 0.6;

export const COLORS = {
  blue: "#2F5DA8",
  yellow: "#F2B705",
  red: "#C8202F",
  paper: "#F3EAD7",
  seat: "#2A3150",
} as const;

const FONT: Record<"R" | "N", string[]> = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
};

function inStar(x: number, y: number): boolean {
  const cx = 8.5, cy = 5.5, outer = 5.6, inner = 2.3;
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? inner : outer;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inLetters(x: number, y: number): boolean {
  const row = y - 2;
  if (row < 0 || row > 6) return false;
  const at = (ch: "R" | "N", x0: number) => {
    const c = Math.floor((x - x0) / 2);
    return c >= 0 && c < 5 && FONT[ch][row]![c] === "1";
  };
  return at("R", 18) || at("N", 29);
}

/** The finished picture's colour for a square. */
export function pictureColor(x: number, y: number): string {
  if (y === 0 || y === ROWS - 1) return Math.floor(x / 2) % 2 ? COLORS.red : COLORS.paper;
  if (inStar(x + 0.5, y + 0.5) || inLetters(x, y)) return COLORS.yellow;
  return COLORS.blue;
}

/** A fixed, scattered order in which squares light up (same for every viewer). */
export function revealOrder(total = COLS * ROWS): number[] {
  const ranked = Array.from({ length: total }, (_, i) => {
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return [h - Math.floor(h), i] as const;
  }).sort((a, b) => a[0] - b[0]);
  const rankOf = new Array<number>(total);
  ranked.forEach(([, i], k) => (rankOf[i] = k));
  return rankOf;
}

export interface Square {
  index: number;
  color: string;
  lit: boolean;
  rank: number;
}

/** Squares to show for `present` fans out of `fans`. */
export function paint(present: number, fans: number): Square[] {
  const total = COLS * ROWS;
  const ratio = fans > 0 ? present / fans : 0;
  const lit = Math.round(total * Math.min(1, ratio / TARGET));
  const rank = revealOrder(total);
  return Array.from({ length: total }, (_, i) => {
    const on = rank[i]! < lit;
    return { index: i, rank: rank[i]!, lit: on, color: on ? pictureColor(i % COLS, Math.floor(i / COLS)) : COLORS.seat };
  });
}

/** Fans needed for a full house, rounded up like the league contract. */
export function target(fans: number): number {
  return Math.ceil((fans * 6000) / 10_000);
}

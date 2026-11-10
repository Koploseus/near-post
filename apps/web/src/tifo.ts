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

/** The tifos a stand's fans choose from (league `vote_tifo`, 0 to 5). */
export const PATTERNS = ["Star", "Stripes", "Chevrons", "Checkers", "Sun", "Hoops"] as const;

/** The pattern with the most votes (the lower one on a tie), or the star before anyone voted. */
export function leading(votes: number[] | undefined): number {
  const best = Math.max(0, ...(votes ?? []));
  return best > 0 ? votes!.indexOf(best) : 0;
}

/** The colours of the top and bottom rows: the club's scarf, or a derby winner's colours. */
export interface Border {
  a: string;
  b: string;
}
const SCARF: Border = { a: COLORS.paper, b: COLORS.red };

/** The finished picture's colour for a square. */
export function pictureColor(x: number, y: number, pattern = 0, border: Border = SCARF): string {
  if (y === 0 || y === ROWS - 1) return Math.floor(x / 2) % 2 ? border.b : border.a;
  const on = (() => {
    switch (pattern) {
      case 1:
        return Math.floor(x / 4) % 2 === 0;
      case 2:
        return (x + Math.abs(y - 5.5) * 2) % 8 < 4;
      case 3:
        return (Math.floor(x / 4) + Math.floor((y - 1) / 2.5)) % 2 === 0;
      case 4: {
        const [dx, dy] = [x + 0.5 - COLS / 2, (y + 0.5 - ROWS / 2) * 2];
        const r = Math.hypot(dx, dy);
        const ray = Math.floor(((Math.atan2(dy, dx) + Math.PI) / Math.PI) * 8) % 2 === 0;
        return r < 6 || (r > 8 && ray);
      }
      case 5:
        return Math.floor((y - 1 + Math.sin(x / 3) * 1.2) / 2) % 2 === 0;
      default:
        return inStar(x + 0.5, y + 0.5) || inLetters(x, y);
    }
  })();
  return on ? COLORS.yellow : COLORS.blue;
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
  /** Its colour in the finished picture: the card waiting on the seat. */
  picture: string;
}

/** Squares to show for `present` fans out of `fans`. */
export function paint(present: number, fans: number, pattern = 0, border: Border = SCARF): Square[] {
  const total = COLS * ROWS;
  const ratio = fans > 0 ? present / fans : 0;
  const lit = Math.round(total * Math.min(1, ratio / TARGET));
  const rank = revealOrder(total);
  return Array.from({ length: total }, (_, i) => {
    const on = rank[i]! < lit;
    const picture = pictureColor(i % COLS, Math.floor(i / COLS), pattern, border);
    return { index: i, rank: rank[i]!, lit: on, picture, color: on ? picture : COLORS.seat };
  });
}

/** Fans in the ola window that make the ola: half the full-house target, rounded up, at least one. */
export function olaTarget(fans: number, bps = 5_000): number {
  return Math.max(1, Math.ceil((target(fans) * bps) / 10_000));
}

/** Fans needed for a full house, rounded up like the league contract. */
export function target(fans: number): number {
  return Math.ceil((fans * 6000) / 10_000);
}

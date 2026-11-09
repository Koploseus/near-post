/**
 * A club's crest: a shield in two colours with its initials, both drawn from
 * the club's account, so a club always wears the same one. Made up, like the
 * clubs: no real club's badge.
 */

const COLOURS: [string, string][] = [
  ["#2F5DA8", "#F3EAD7"],
  ["#C8202F", "#F3EAD7"],
  ["#F2B705", "#1B2340"],
  ["#1B2340", "#F2B705"],
  ["#2e7d4f", "#F3EAD7"],
  ["#7a2e8c", "#F2B705"],
  ["#e06a1b", "#1B2340"],
  ["#0f7c86", "#F3EAD7"],
  ["#8a1c2b", "#F2B705"],
  ["#3c4a7a", "#e2d6ba"],
];
const PATTERNS = ["plain", "stripes", "half", "sash", "band"] as const;

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261);

/** "Moonhaven FC" → "MF", "St Cinder Albion" → "SC", "Lowtide" → "LO". */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function crestOf(clubId: string) {
  const h = hash(clubId);
  const [main, accent] = COLOURS[h % COLOURS.length]!;
  return { main, accent, pattern: PATTERNS[(h >>> 8) % PATTERNS.length]! };
}

export function Crest({ clubId, name, size = 28 }: { clubId: string; name: string; size?: number }) {
  const { main, accent, pattern } = crestOf(clubId);
  const id = `cr-${hash(clubId).toString(36)}`;
  const shield = "M16 2 L29 6 V16 C29 24 23 29 16 31 C9 29 3 24 3 16 V6 Z";
  return (
    <svg viewBox="0 0 32 33" width={size} height={size * (33 / 32)} className="crest" aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <path d={shield} />
        </clipPath>
      </defs>
      <path d={shield} fill={main} />
      <g clipPath={`url(#${id})`} fill={accent} opacity=".9">
        {pattern === "stripes" && [8, 16, 24].map((x) => <rect key={x} x={x - 1.5} y="0" width="3" height="33" />)}
        {pattern === "half" && <rect x="16" y="0" width="16" height="33" />}
        {pattern === "sash" && <path d="M-2 10 L10 -2 L34 22 L22 34 Z" />}
        {pattern === "band" && <rect x="0" y="12" width="32" height="7" />}
      </g>
      <path d={shield} fill="none" stroke="#1B2340" strokeWidth="2" />
      <text
        x="16"
        y="20.5"
        textAnchor="middle"
        fontFamily="'Archivo Black', system-ui, sans-serif"
        fontSize="10.5"
        fill={pattern === "plain" ? accent : main}
        stroke={pattern === "plain" ? "none" : accent}
        strokeWidth={pattern === "plain" ? 0 : 2.4}
        paintOrder="stroke"
      >
        {initials(name)}
      </text>
    </svg>
  );
}

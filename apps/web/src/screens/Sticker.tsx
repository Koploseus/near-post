import { positionLabel, tier } from "../lib/format.js";
import type { Player } from "../lib/types.js";

const SKIN = ["#C68B5E", "#E9B98F", "#B37650", "#F0C6A0", "#8A5A3B", "#DDA77C"];
const HAIR = ["#2A1A10", "#7A4B23", "#111111", "#C9A15A", "#1A1210", "#3B2416"];
const BG = ["#5D8FD8", "#3FA06B", "#D9624B", "#E2A12B"];

/** A sticker: rating, position, a simple portrait, the name strip. Gold from 75. */
export function Sticker({ p, onClick, selected, badge }: { p: Player; onClick?: () => void; selected?: boolean; badge?: string }) {
  const n = Number(p.token_id.replace(/\D/g, "")) || 0;
  const gold = tier(p.attack, p.defence) === "gold";
  const rating = Math.max(p.attack, p.defence);
  const body = (
    <>
      <span className="sticker-face" style={{ backgroundColor: gold ? "#E2A12B" : BG[n % BG.length] }}>
        {gold && <span className="foil" aria-hidden="true" />}
        <svg viewBox="0 0 60 64" aria-hidden="true">
          <path d="M8 64 C10 48 19 43 30 43 C41 43 50 48 52 64 Z" fill="#000" opacity=".18" transform="translate(2 1)" />
          <path d="M8 64 C10 48 19 43 30 43 C41 43 50 48 52 64 Z" fill="#2F5DA8" />
          <path d="M24 44 L36 44 L34 64 L26 64 Z" fill="#F2B705" />
          <rect x="26" y="34" width="8" height="10" fill={SKIN[n % SKIN.length]} />
          <ellipse cx="30" cy="25" rx="11" ry="13" fill={SKIN[n % SKIN.length]} />
          <path d="M19 24 C18 10 42 10 41 24 C38 17 23 17 19 24 Z" fill={HAIR[(n >> 1) % HAIR.length]} />
          <rect x="25" y="25" width="3" height="3" fill="#1B2340" />
          <rect x="32" y="25" width="3" height="3" fill="#1B2340" />
        </svg>
        <span className="rating">{rating}</span>
        <span className="pos">{positionLabel[p.position]}</span>
        {badge && <span className="badge">{badge}</span>}
      </span>
      <span className="strip">{p.name}</span>
    </>
  );
  const label = `${p.name}, ${positionLabel[p.position]}, attack ${p.attack}, defence ${p.defence}${gold ? ", gold" : ""}${p.controller ? ", played by a person" : ""}`;
  return onClick ? (
    <button type="button" className={`sticker${selected ? " on" : ""}`} onClick={onClick} aria-pressed={selected} aria-label={label}>
      {body}
    </button>
  ) : (
    <div className="sticker" role="img" aria-label={label}>
      {body}
    </div>
  );
}

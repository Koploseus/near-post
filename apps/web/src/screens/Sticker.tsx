import { SKILLS, positionLabel, tier } from "../lib/format.js";
import type { Player } from "../lib/types.js";
import { useAgents } from "../lib/agents.js";
import { HairBack, HairFront, LookDefs, SKIN } from "./Look.js";

/**
 * A player card: rating out of 100 and position, a portrait, the name, and
 * the six skills. Bronze, silver from 65, gold (with foil) from 75.
 */
export function Sticker({ p, onClick, selected, badge }: { p: Player; onClick?: () => void; selected?: boolean; badge?: string }) {
  const n = Number(p.token_id.replace(/\D/g, "")) || 0;
  const t = tier(p.overall);
  const ai = useAgents().get(p.controller ?? "")?.kind === "footballer";
  const body = (
    <>
      <span className="sticker-face">
        {t === "gold" && <span className="foil" aria-hidden="true" />}
        <svg viewBox="0 0 60 64" aria-hidden="true">
          <LookDefs />
          <path d="M8 64 C10 48 19 43 30 43 C41 43 50 48 52 64 Z" fill="#000" opacity=".18" transform="translate(2 1)" />
          <path d="M8 64 C10 48 19 43 30 43 C41 43 50 48 52 64 Z" fill="#2F5DA8" />
          <path d="M24 44 L36 44 L34 64 L26 64 Z" fill="#F2B705" />
          <rect x="26" y="34" width="8" height="10" fill={SKIN[n % SKIN.length]} />
          <HairBack look={p.look} n={n} />
          <ellipse cx="30" cy="25" rx="11" ry="13" fill={SKIN[n % SKIN.length]} />
          <HairFront look={p.look} n={n} />
          <rect x="25" y="25" width="3" height="3" fill="#1B2340" />
          <rect x="32" y="25" width="3" height="3" fill="#1B2340" />
        </svg>
        <span className="rating">{p.overall}</span>
        <span className="pos">{positionLabel[p.position]}</span>
        {badge && <span className="badge">{badge}</span>}
        {ai && <span className="ai-tag sticker-ai">AI</span>}
      </span>
      <span className="strip">{p.name}</span>
      <span className="card-stats" aria-hidden="true">
        {SKILLS.map(([k, label]) => (
          <span key={k}>
            <b>{p.skills[k]}</b>
            {label}
          </span>
        ))}
      </span>
    </>
  );
  const label = `${p.name}, ${positionLabel[p.position]}, rated ${p.overall}, ${t}${p.controller ? ", played by a person" : ""}. ${SKILLS.map(([k, , name]) => `${name} ${p.skills[k]}`).join(", ")}`;
  const cls = `sticker ${t}${selected ? " on" : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-pressed={selected} aria-label={label}>
      {body}
    </button>
  ) : (
    <div className={cls} role="img" aria-label={label}>
      {body}
    </div>
  );
}

/** The six skills as bars, for the back of a card. */
export function SkillBars({ p }: { p: Player }) {
  return (
    <dl className="skill-bars">
      {SKILLS.map(([k, , name]) => (
        <div key={k}>
          <dt>{name}</dt>
          <dd>
            <span className="track">
              <span style={{ width: `${p.skills[k]}%` }} />
            </span>
            <b>{p.skills[k]}</b>
          </dd>
        </div>
      ))}
    </dl>
  );
}

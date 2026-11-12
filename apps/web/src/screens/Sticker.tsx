import { SKILLS, positionLabel, tier } from "../lib/format.js";
import type { Player } from "../lib/types.js";
import { useAgents } from "../lib/agents.js";
import { PixelAvatar } from "../floodlight/PixelPlayer.js";

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
        <PixelAvatar look={p.look} n={n} shirt="#2F5DA8" size={92} className="sticker-body" />
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

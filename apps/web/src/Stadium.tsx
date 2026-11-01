import { useMemo, useState } from "react";
import { COLS, paint, pictureColor, target } from "./tifo.js";

const FANS = 340;
const SCENARIOS = [
  { label: "2 h before kick-off", present: 168 },
  { label: "Kick-off", present: 221 },
  { label: "If fans stay home", present: 41 },
] as const;
const YOU = 10 * COLS + 21;

/**
 * The stadium ritual. Until the league is deployed this screen runs on an
 * example stand (marked "Preview"); the numbers follow the contract's rules.
 */
export function Stadium() {
  const [base, setBase] = useState<number>(SCENARIOS[0].present);
  const [seated, setSeated] = useState(false);
  const present = Math.min(FANS, base + (seated ? 1 : 0));
  const need = Math.max(0, target(FANS) - present);
  const done = need === 0;
  const empty = base < FANS * 0.2;
  const squares = useMemo(() => paint(present, FANS), [present]);
  const pct = Math.round((present / FANS) * 100);
  const color = done ? "var(--green-ok)" : empty ? "#ff6b6b" : "var(--yellow)";

  return (
    <main className="wrap">
      <div className="head">
        <div>
          <span className="eyebrow">MATCH DAY 13 · RIVE NORD v PORT-LUNE · DERBY</span>{" "}
          <span className="preview">PREVIEW</span>
          <h1>{done ? "TIFO COMPLETE!" : empty ? "THE TIFO HAS HOLES" : `${need} FANS TO GO`}</h1>
          <p className="sub">
            {done
              ? "Full house. Every fan in the stand gets 100k G, ×2 for the derby."
              : empty
                ? "At kick-off the gaps stay. 2% of the club treasury burns and the streak resets."
                : "Fill the stand to 60% before kick-off and the tifo unfurls."}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Preview the stand">
          {SCENARIOS.map((s) => (
            <button key={s.label} type="button" aria-pressed={base === s.present} onClick={() => setBase(s.present)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className={`stand${done ? " done" : ""}`} aria-label="North stand tifo">
        <div className="grid" role="img" aria-label={`Tifo ${Math.min(100, Math.round((present / target(FANS)) * 100))}% painted: a yellow star and the letters RN on blue`}>
          {squares.map((s) => {
            const you = seated && s.index === YOU;
            return (
              <div
                key={s.index}
                className={`sq${s.lit || you ? " lit" : ""}${you ? " you" : ""}`}
                style={{
                  background: you ? pictureColor(s.index % COLS, Math.floor(s.index / COLS)) : s.color,
                  transitionDelay: `${(s.rank % 60) * 12}ms`,
                  animationDelay: `${((s.index % COLS) * 40) % 1600}ms`,
                }}
              />
            );
          })}
        </div>
        <div className="pitch" aria-hidden="true" />
      </section>

      <div className="row2">
        <section className="att" aria-label="Attendance">
          <strong style={{ fontSize: 18 }}>
            {present} of {FANS} fans in the stand · <span style={{ color }}>{pct}%</span>
          </strong>
          <div className="bar">
            <div style={{ width: `${pct}%`, background: color }} />
            <i aria-hidden="true" />
          </div>
          <span className="sub" style={{ fontSize: 15 }}>
            Each fan who checks in paints part of the tifo. The white line is 60%: the tifo is complete and every fan in the
            stand gets 100k G.
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
            <button type="button" className="cta" style={{ background: seated ? "#9be3b8" : "var(--yellow)" }} onClick={() => setSeated(true)}>
              {seated ? "IN THE STAND ✓" : "TAKE YOUR SEAT"}
            </button>
            <span className="sub" style={{ fontSize: 14, maxWidth: 260 }}>
              {seated ? "Your square is lit, bottom row." : "One tap, free. Your square of the tifo lights up."}
            </span>
          </div>
        </section>

        <aside className="card" aria-label="Rules">
          <span className="k">THE RULES</span>
          <dl>
            <dt>Full house (60%)</dt>
            <dd style={{ color: "#1e7a47" }}>+100k G per fan</dd>
            <dt>Derby</dt>
            <dd>×2</dd>
            <dt>Tifo not complete</dt>
            <dd style={{ color: "#b01e2b" }}>2% of treasury burns</dd>
          </dl>
          <span className="note">Fixed in the league contract at launch. No one can change them.</span>
        </aside>
      </div>
    </main>
  );
}

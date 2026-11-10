import { GOALARS } from "../lib/config.js";
import { clubName, g, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { breathing, type DayBreath, netBySplit, type StandSettled } from "../lib/breathing.js";
import { type LedgerEntry, league, view } from "../lib/near.js";
import type { Club, Stand } from "../lib/types.js";

const CAP = 10_000_000_000n * 1_000_000n;

export const KIND: Record<string, string> = {
  full_house: "Full house",
  empty_stand: "Empty stand",
  goals: "Goals",
  own_goal: "Own goal",
  season_tickets: "Season tickets",
  sale_tax: "Sale tax",
  pack: "Pack",
  training: "Training",
  relegation: "Relegation",
  signup: "Club founded",
  welcome: "Welcome bonus",
  debut: "Debut bonus",
  fans_star: "Fans' star",
  project: "Club project",
};

/** The token page: supply, today's stands, the best streak, every mint and burn. */
export function Goalars() {
  const { schedule } = useGame();
  const day = schedule?.match_day;
  const { data } = useData(
    async () => {
      const [supply, table, stands, ledger] = await Promise.all([
        view<string>(GOALARS, "ft_total_supply"),
        league<Club[]>("table"),
        league<[string, Stand][]>("stands_today"),
        league<LedgerEntry[]>("ledger", { limit: 80 }),
      ]);
      return { supply, table, stands, ledger };
    },
    [day, schedule?.first_half_played],
  );
  const names = new Map((data?.table ?? []).map((c) => [c.manager, clubName(c.name)]));
  const clubs = new Map((data?.table ?? []).map((c) => [c.manager, c]));
  const supply = BigInt(data?.supply ?? "0");
  const pct = Number((supply * 10_000n) / CAP) / 100;
  const stands = (data?.stands ?? []).filter(([, s]) => s.fans > 0).sort((a, b) => b[1].fans - a[1].fans);
  const best = [...(data?.table ?? [])].sort((a, b) => b.best_streak - a.best_streak)[0];
  const running = [...(data?.table ?? [])].filter((c) => c.full_house_streak > 0).sort((a, b) => b.full_house_streak - a.full_house_streak).slice(0, 3);
  const today = (data?.ledger ?? []).filter((e) => e.match_day === (day ?? 0) - 1);
  const sum = (mint: boolean) => today.filter((e) => e.mint === mint).reduce((a, e) => a + BigInt(e.amount), 0n);

  return (
    <div className="goalars">
      <section className="paper panel">
        <span className="k">GOALARS (G)</span>
        <h2>The money breathes with the fans</h2>
        <div className="supply">
          <strong>{g(supply)}</strong> <span className="note">of 10B, ever</span>
          <div className="bar" aria-label={`${pct}% of the cap`}>
            <div style={{ width: `${Math.max(0.5, pct)}%` }} />
          </div>
        </div>
        {today.length > 0 && (
          <p className="note">
            Match day {(day ?? 1) - 1}: <b className="up">+{g(sum(true))}</b> minted, <b className="down">−{g(sum(false))}</b> burned.
          </p>
        )}
      </section>

      <div className="row2">
        <section className="paper panel" aria-labelledby="today-title">
          <span className="k">MATCH DAY {day ?? "…"}</span>
          <h3 id="today-title">In the stands now</h3>
          {stands.length === 0 && <p className="note">No fans yet.</p>}
          <ul className="stand-list">
            {stands.map(([id, s]) => {
              const club = clubs.get(id);
              const p = Math.min(100, Math.round((s.present / Math.max(1, s.target)) * 100));
              const burn = club ? (BigInt(club.treasury) * 2n) / 100n : 0n;
              return (
                <li key={id}>
                  <span className="club-name">{names.get(id) ?? short(id)}</span>
                  <span className="bar">
                    <span style={{ width: `${p}%` }} className={s.full_house ? "full" : ""} />
                  </span>
                  <span className="note">
                    {s.present}/{s.target}{" "}
                    {s.full_house ? <b className="up">full house: +{g(BigInt(s.present) * 100_000n * 1_000_000n)}</b> : <b className="down">else −{g(burn)}</b>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="paper panel record" aria-labelledby="record-title">
          <span className="k">HIGH SCORE</span>
          <h3 id="record-title">Longest run of full houses</h3>
          {best && best.best_streak > 0 ? (
            <p className="big">
              {best.best_streak} <span className="note">{clubName(best.name)}</span>
            </p>
          ) : (
            <p className="note">Nobody has filled a stand yet.</p>
          )}
          {running.length > 0 && (
            <ol className="mini-table">
              {running.map((c) => (
                <li key={c.manager}>
                  <span>{clubName(c.name)}</span>
                  <b>{c.full_house_streak} in a row</b>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <Breathing day={day} />

      <section className="paper panel" aria-labelledby="log-title">
        <span className="k">LEDGER</span>
        <h3 id="log-title">Every mint and burn</h3>
        <ol className="ledger">
          {(data?.ledger ?? []).map((e) => (
            <li key={e.id}>
              <span className="note">D{e.match_day}</span>
              <span>{KIND[e.kind] ?? e.kind}</span>
              <span className="who">{e.who ? (names.get(e.who) ?? short(e.who)) : ""}</span>
              <b className={e.mint ? "up" : "down"}>
                {e.mint ? "+" : "−"}
                {g(e.amount)}
              </b>
            </li>
          ))}
        </ol>
        <p className="note">Mints are nominal: the goalars contract scales each one by the room left under the 10B cap. Burns are exact. Every rule is fixed in the league contract.</p>
      </section>
    </div>
  );
}

const DAYS_SHOWN = 14;

/** Reads `stand_result` for these clubs and days, a few calls at a time. */
async function settledStands(clubs: string[], days: number[]): Promise<Map<number, StandSettled[]>> {
  const out = new Map<number, StandSettled[]>();
  const jobs = days.flatMap((d) => clubs.map((c) => [d, c] as const));
  for (let i = 0; i < jobs.length; i += 8) {
    const batch = jobs.slice(i, i + 8);
    const read = await Promise.all(batch.map(([d, c]) => league<StandSettled | null>("stand_result", { club_id: c, match_day: d })));
    batch.forEach(([d], n) => {
      const s = read[n];
      if (s) out.set(d, [...(out.get(d) ?? []), s]);
      else if (!out.has(d)) out.set(d, []);
    });
  }
  return out;
}

/**
 * Match by match, from the chain: how full the stands were (line) and the G that minted
 * (up) and burned (down). The same numbers `node scripts/verify.mjs` recomputes and checks.
 */
function Breathing({ day }: { day: number | undefined }) {
  const { data, error } = useData(async () => {
    if (!day) return null;
    const [table, ledger] = await Promise.all([league<Club[]>("table"), league<LedgerEntry[]>("ledger", { limit: 600 })]);
    const days = Array.from({ length: DAYS_SHOWN }, (_, i) => day - 1 - i).filter((d) => d > 0);
    const clubs = table.filter((c) => c.fans > 0).map((c) => c.manager);
    return breathing(ledger, await settledStands(clubs, days));
  }, [day]);
  const rows: DayBreath[] = data ?? [];
  const split = netBySplit(rows);
  return (
    <section className="paper panel breathing" aria-labelledby="breath-title">
      <span className="k">MATCH BY MATCH</span>
      <h3 id="breath-title">No fans, no money</h3>
      <p className="note">
        G is minted only for people who show up: a goal mints in proportion to how full its club's stand is, a full house mints
        100k G per fan present, and a stand that is not full burns 2% of its club's treasury. Spending G on training, packs and
        transfers burns it.
      </p>
      {error && <p className="note">Could not read the chain: {error}</p>}
      {!data && !error && <p className="note">Reading the last {DAYS_SHOWN} match days from the chain…</p>}
      {rows.length > 0 && <BreathChart rows={rows} />}
      {split.full !== null && split.empty !== null && (
        <p className="note">
          Net per match day: <b className="up">{split.full >= 0n ? "+" : "−"}{g(split.full >= 0n ? split.full : -split.full)}</b> when the stands were half full or more,{" "}
          <b className="down">{split.empty >= 0n ? "+" : "−"}{g(split.empty >= 0n ? split.empty : -split.empty)}</b> when they were not.
          Replay and check every number: <code>node scripts/verify.mjs</code>.
        </p>
      )}
    </section>
  );
}

function BreathChart({ rows }: { rows: DayBreath[] }) {
  const W = 640;
  const H = 220;
  const mid = 120;
  const pad = 34;
  const top = 18;
  const max = rows.reduce((m, r) => [r.minted + r.onboarding, r.burned].reduce((a, v) => (v > a ? v : a), m), 1n);
  const up = (v: bigint) => Number((v * BigInt(mid - top)) / max);
  const down = (v: bigint) => Number((v * BigInt(H - 26 - mid)) / max);
  const step = (W - pad * 2) / rows.length;
  const bar = Math.max(6, step * 0.56);
  const x = (i: number) => pad + step * i + step / 2;
  const y = (fill: number) => top + ((100 - fill) * (H - 26 - top)) / 100;
  const line = rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r.fill).toFixed(1)}`).join(" ");
  return (
    <figure className="breath-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Per match day: stand fill as a line, G minted as bars above the axis and G burned below">
        <line x1={pad} x2={W - pad} y1={mid} y2={mid} className="axis" />
        {rows.map((r, i) => (
          <g key={r.day}>
            <rect x={x(i) - bar / 2} y={mid - up(r.minted)} width={bar} height={up(r.minted)} className="minted">
              <title>{`Match day ${r.day}: +${g(r.minted)} minted by presence`}</title>
            </rect>
            {r.onboarding > 0n && (
              <rect x={x(i) - bar / 2} y={mid - up(r.minted) - up(r.onboarding)} width={bar} height={up(r.onboarding)} className="onboarding">
                <title>{`+${g(r.onboarding)} clubs founded and debuts`}</title>
              </rect>
            )}
            <rect x={x(i) - bar / 2} y={mid} width={bar} height={down(r.burned)} className="burned">
              <title>{`Match day ${r.day}: −${g(r.burned)} burned`}</title>
            </rect>
            <text x={x(i)} y={H - 6} className="tick">{r.day}</text>
          </g>
        ))}
        <path d={line} className="fill-line" />
        {rows.map((r, i) => (
          <circle key={r.day} cx={x(i)} cy={y(r.fill)} r={3.5} className="fill-dot">
            <title>{`Match day ${r.day}: ${r.fill}% of the full-house target in the stands, ${r.fullHouses}/${r.stands} full houses`}</title>
          </circle>
        ))}
        <text x={W - pad + 4} y={y(100) + 4} className="tick left">100%</text>
        <text x={W - pad + 4} y={y(0) + 4} className="tick left">0%</text>
      </svg>
      <figcaption className="legend">
        <span><i className="sw fill" /> fans in the stands (share of full house)</span>
        <span><i className="sw minted" /> minted by presence</span>
        <span><i className="sw onboarding" /> clubs founded and debuts</span>
        <span><i className="sw burned" /> burned</span>
      </figcaption>
    </figure>
  );
}

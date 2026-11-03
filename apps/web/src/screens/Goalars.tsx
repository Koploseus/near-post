import { GOALARS } from "../lib/config.js";
import { clubName, g, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
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
  signup: "Signup grant",
  welcome: "Welcome bonus",
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
                  <span className="who">{names.get(id) ?? short(id)}</span>
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

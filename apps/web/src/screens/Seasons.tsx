import { useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { league } from "../lib/near.js";
import { bySeason, finishesOf, ordinal, seasonProgress } from "../lib/seasons.js";
import type { Champion, FinalRow } from "../lib/types.js";

/** Seasons: where this one stands, who won the past ones, and how each division finished. */
export function Seasons() {
  const { schedule, clubId, club } = useGame();
  const season = schedule?.season ?? 1;
  const { data } = useData(async () => {
    const champions = await league<Champion[]>("champions", { before: null, limit: 10 });
    // Every final table of those seasons, for the club's history and the tables below.
    const tables = await Promise.all(
      champions.map(async (c) => ({ season: c.season, division: c.division, rows: await league<FinalRow[]>("final_table", { season: c.season, division: c.division }) })),
    );
    return { champions, tables };
  }, [season]);
  const seasons = bySeason(data?.champions ?? []);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open ?? seasons[0]?.season ?? null;
  const p = schedule ? seasonProgress(schedule) : null;
  const history = clubId && data ? finishesOf(clubId, data.tables) : [];
  const titles = history.filter((f) => f.position === 1);

  return (
    <div className="seasons">
      <section className="panel ink season-now" aria-label="This season">
        <span className="eyebrow">THIS SEASON</span>
        <h2>Season {season}</h2>
        {schedule && p && (
          <>
            <p className="sub">
              Match day {schedule.season_day} of {schedule.season_days} · every club meets every other club twice, at home and away.
            </p>
            <div className="season-bar" role="progressbar" aria-valuemin={0} aria-valuemax={schedule.season_days} aria-valuenow={p.played}>
              <div style={{ width: `${Math.round(p.share * 100)}%` }} />
            </div>
            <p className="note">
              {p.left === 1 ? "Last match day" : `${p.left} match days left`}. Then the champions are crowned, the top three of each lower division go up and the bottom three go down.
            </p>
          </>
        )}
        <a className="link" href="#/match">
          Live table and results →
        </a>
      </section>

      {seasons[0] && (
        <section className="panel champions-banner" aria-label={`Season ${seasons[0].season} champions`}>
          <span className="k">SEASON {seasons[0].season} CHAMPIONS</span>
          <div className="trophies">
            {seasons[0].champions.map((c) => (
              <div key={c.division} className={`trophy${c.club_id === clubId ? " mine" : ""}`}>
                <Cup />
                <b>{c.name}</b>
                <span className="note">
                  Division {c.division} · {c.points} pts · {c.won}W {c.drawn}D {c.lost}L
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {club && (
        <section className="paper panel" aria-label="Your club's history">
          <span className="k">{club.name.toUpperCase()} · HISTORY</span>
          {history.length === 0 ? (
            <p className="sub">No season finished yet. The first one ends after match day {schedule?.season_days ?? 26}.</p>
          ) : (
            <>
              <p className="sub">
                {titles.length > 0 ? `${titles.length} title${titles.length > 1 ? "s" : ""}: season ${titles.map((t) => t.season).join(", ")}.` : "No title yet."}
              </p>
              <ol className="finishes">
                {history.map((f) => (
                  <li key={f.season} className={f.position === 1 ? "won" : ""}>
                    <span>Season {f.season}</span>
                    <span>Division {f.division}</span>
                    <b>
                      {f.position === 1 ? "Champions" : `${ordinal(f.position)} of ${f.of}`}
                    </b>
                    <span>{f.points} pts</span>
                    <span className={f.moved > 0 ? "up" : f.moved < 0 ? "down" : "note"}>{f.moved > 0 ? "▲ promoted" : f.moved < 0 ? "▼ relegated" : "stayed"}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      <section className="paper panel" aria-label="Past seasons">
        <span className="k">HONOURS</span>
        {seasons.length === 0 ? (
          <p className="sub">The roll of honour starts when season 1 ends.</p>
        ) : (
          <>
            <ol className="honours">
              {seasons.map((s) => (
                <li key={s.season}>
                  <button type="button" className={s.season === shown ? "on" : ""} onClick={() => setOpen(s.season)} aria-expanded={s.season === shown}>
                    <b>Season {s.season}</b>
                    <span>{s.champions.map((c) => `D${c.division} ${c.name}`).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ol>
            {shown !== null &&
              (data?.tables ?? [])
                .filter((t) => t.season === shown)
                .sort((a, b) => a.division - b.division)
                .map((t) => <FinalTable key={t.division} season={t.season} division={t.division} rows={t.rows} mine={clubId} />)}
          </>
        )}
      </section>
    </div>
  );
}

function FinalTable({ season, division, rows, mine }: { season: number; division: number; rows: FinalRow[]; mine: string | null }) {
  return (
    <div className="final-table">
      <h3>
        Season {season} · Division {division} · final table
      </h3>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Club</th>
            <th scope="col">P</th>
            <th scope="col">W</th>
            <th scope="col">D</th>
            <th scope="col">L</th>
            <th scope="col">GD</th>
            <th scope="col">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.club_id} className={`${r.club_id === mine ? "mine" : ""}${r.moved > 0 ? " up" : r.moved < 0 ? " down" : ""}`}>
              <td>{i === 0 ? "🏆" : i + 1}</td>
              <td>
                {r.name}
                {r.moved > 0 && <span className="zone"> ▲ promoted</span>}
                {r.moved < 0 && <span className="zone"> ▼ relegated</span>}
              </td>
              <td>{r.played}</td>
              <td>{r.won}</td>
              <td>{r.drawn}</td>
              <td>{r.lost}</td>
              <td>{r.goals_for - r.goals_against}</td>
              <td>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A small trophy, in the sticker style. */
function Cup() {
  return (
    <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">
      <path d="M12 6h16v8c0 6-4 10-8 10s-8-4-8-10z" fill="#F2B705" stroke="#1B2340" strokeWidth="2.5" />
      <path d="M12 9H6c0 6 3 9 7 9M28 9h6c0 6-3 9-7 9" fill="none" stroke="#1B2340" strokeWidth="2.5" />
      <path d="M17 24h6v5h-6z" fill="#F2B705" stroke="#1B2340" strokeWidth="2.5" />
      <path d="M11 30h18v5H11z" fill="#C8202F" stroke="#1B2340" strokeWidth="2.5" />
    </svg>
  );
}

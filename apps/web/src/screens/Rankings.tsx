import { g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { type Person, rankings, wholeG } from "../lib/people.js";
import { Crest, crestOf } from "./Crest.js";
import { faceNumber, Head } from "./Look.js";

function Players({ title, note, people, figure }: { title: string; note: string; people: Person[]; figure: (p: Person) => string }) {
  const { session } = useGame();
  return (
    <section className="paper panel" aria-label={title}>
      <span className="k">{title.toUpperCase()}</span>
      <p className="note">{note}</p>
      {people.length === 0 ? (
        <p className="note">Nobody yet.</p>
      ) : (
        <ol className="people ranked-people">
          {people.map((p, i) => (
            <li key={p.account} className={`person${p.account === session?.accountId ? " is-me" : ""}`}>
              <span className="person-rank">{i + 1}</span>
              <Head n={faceNumber(p.token_id)} shirt={p.club ? crestOf(p.club).main : undefined} size={36} />
              <span className="person-who">
                <b>{p.name}</b>
                <span className="note">
                  {p.position.toUpperCase()} {p.overall} · {p.club_name ?? "Free agent"}
                </span>
              </span>
              <strong className="person-figure">{figure(p)}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Clubs({ title, note, rows }: { title: string; note: string; rows: { club: string; name: string; figure: string }[] }) {
  const { clubId } = useGame();
  return (
    <section className="paper panel" aria-label={title}>
      <span className="k">{title.toUpperCase()}</span>
      <p className="note">{note}</p>
      {rows.length === 0 ? (
        <p className="note">No club yet.</p>
      ) : (
        <ol className="people ranked-people">
          {rows.map((r, i) => (
            <li key={r.club} className={`person${r.club === clubId ? " is-me" : ""}`}>
              <span className="person-rank">{i + 1}</span>
              <Crest clubId={r.club} name={r.name} size={34} />
              <span className="person-who">
                <b>{r.name}</b>
              </span>
              <strong className="person-figure">{r.figure}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The rankings that are not a league table: people by value and by goals, clubs by treasury and by full houses. */
export function Rankings() {
  const { data } = useData(rankings, []);
  if (!data) return <p className="sub">Counting…</p>;
  return (
    <div className="ranks-page">
      <Players
        title="Most valuable footballers"
        note="A guide, not a price: it grows with his rating and his goals. Only people, no academy players."
        people={data.valuable}
        figure={(p) => wholeG(p.value)}
      />
      <Players title="Top scorers, all time" note="Goals since he was minted, every season." people={data.scorers} figure={(p) => `${p.goals} ${p.goals === 1 ? "goal" : "goals"}`} />
      <Clubs title="Richest clubs" note="G in the treasury right now." rows={data.richest.map((r) => ({ club: r.club, name: r.name, figure: g(r.treasury) }))} />
      <Clubs
        title="Best runs of full houses"
        note="Match days in a row with a full stand."
        rows={data.streaks.map((r) => ({ club: r.club, name: r.name, figure: `${r.best_streak} in a row` }))}
      />
    </div>
  );
}

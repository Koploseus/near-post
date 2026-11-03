import { useState } from "react";
import { Action } from "../lib/Action.js";
import { PLAYERS } from "../lib/config.js";
import { g, positionLabel, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league, leagueCall, view } from "../lib/near.js";
import type { Career, Club, Player } from "../lib/types.js";
import { SkillBars, Sticker } from "./Sticker.js";

export function Album() {
  const { session, me, club, clubId } = useGame();
  const { data } = useData(async () => {
    if (!clubId) return null;
    const [squad, eleven, captain] = await Promise.all([
      league<Player[]>("squad", { account_id: clubId }),
      league<Player[]>("starting_eleven", { club_id: clubId }),
      league<{ token_id: string; name: string; votes: number } | null>("captain", { club_id: clubId }),
    ]);
    return { squad, starters: new Set(eleven.map((p) => p.token_id)), captain };
  }, [clubId]);
  const [selected, setSelected] = useState<string | null>(null);
  const sel = data?.squad.find((p) => p.token_id === selected) ?? data?.squad[0] ?? null;
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const nameOf = (id: string) => table?.find((c) => c.manager === id)?.name ?? short(id);
  const { data: career } = useData(() => (sel ? view<Career | null>(PLAYERS, "career", { token_id: sel.token_id }) : Promise.resolve(null)), [sel?.token_id]);

  if (!club || !clubId) return <p className="sub">Sign in and join a club to open its album.</p>;
  const people = data?.squad.filter((p) => p.controller) ?? [];
  return (
    <div className="album paper">
      <section className="album-left" aria-label="Club page">
        <span className="k">SEASON 1 · DIVISION {club.division}</span>
        <h2>{club.name.toUpperCase()}</h2>
        <p className="note">
          {data?.squad.length ?? 0} players · {people.length} played by people · captain:{" "}
          {data?.captain ? `${data.captain.name} (${data.captain.votes} votes)` : "none this week"}
        </p>
        {sel && (
          <div className="back">
            <span className="k">BACK OF THE STICKER</span>
            <h3>{sel.name}</h3>
            <p className="note">
              {positionLabel[sel.position]} · rated {sel.overall} · {sel.goals} goals
              {sel.controller ? ` · played by ${short(sel.controller)}` : " · academy player"}
            </p>
            <SkillBars p={sel} />
            {career && (
              <dl className="stats">
                <dt>Trained by</dt>
                <dd>{nameOf(career.trained_by)}</dd>
                <dt>Past clubs</dt>
                <dd>{career.past_clubs.length ? career.past_clubs.map(nameOf).join(", ") : "none"}</dd>
                <dt>Wallet</dt>
                <dd>{g(sel.wallet)}</dd>
              </dl>
            )}
            <p className="note">If he is sold: 10% to his trainer, 2% to each of his last 3 clubs, 5% to the person who plays him, 3% burned.</p>
            {session && me && sel.controller && me.owner === clubId && (
              <Action className="cta small" label={`VOTE ${sel.name.toUpperCase()} CAPTAIN`} run={() => leagueCall(session, "vote_captain", { candidate: sel.token_id }, 30)} success={`Your vote: ${sel.name} for captain`} />
            )}
          </div>
        )}
      </section>
      <section className="album-right" aria-label="Squad">
        <h2>THE SQUAD</h2>
        <div className="stickers">
          {data?.squad.map((p) => (
            <Sticker
              key={p.token_id}
              p={p}
              selected={sel?.token_id === p.token_id}
              onClick={() => setSelected(p.token_id)}
              {...(data.captain?.token_id === p.token_id ? { badge: "C" } : data.starters.has(p.token_id) ? { badge: "XI" } : {})}
            />
          ))}
        </div>
        <p className="note">XI: would start now. C: this week's captain. Tap a sticker to turn it over.</p>
      </section>
    </div>
  );
}

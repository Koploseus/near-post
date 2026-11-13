import { useState } from "react";
import { Action } from "../lib/Action.js";
import { GOALARS, LEAGUE, PLAYERS } from "../lib/config.js";
import { clubName, g, positionLabel, short } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { acceptOffer, call, league, leagueCall } from "../lib/near.js";
import type { Club, Offer, Player } from "../lib/types.js";
import { roleOf, useAgents } from "../lib/agents.js";
import { Sticker } from "./Sticker.js";

const ONE_G = 1_000_000n;
const parseG = (text: string): bigint | null => {
  const m = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
  if (!m) return null;
  const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
  return BigInt(Math.round(Number(m[1]) * mult)) * ONE_G;
};

/** The transfer market: bid on any player with goalars; a club accepts with an NFT approval. */
export function Market() {
  const { session, schedule } = useGame();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const mine = table?.find((c) => c.manager === session?.accountId) ?? null;
  const [scout, setScout] = useState<string | null>(null);
  const target = scout ?? table?.find((c) => c.manager !== session?.accountId)?.manager ?? null;
  const { data: squad } = useData(() => (target ? league<Player[]>("squad", { account_id: target }) : Promise.resolve([])), [target]);
  const [picked, setPicked] = useState<string | null>(null);
  const player = squad?.find((p) => p.token_id === picked) ?? null;
  const [price, setPrice] = useState("500k");
  const amount = parseG(price);
  const { data: owed, reload: reloadOwed } = useData(
    () => (session ? league<string>("owed_of", { account_id: session.accountId }) : Promise.resolve("0")),
    [session?.accountId, schedule?.match_day],
  );

  return (
    <div className="market">
      <section className="paper panel" aria-labelledby="scout-title">
        <span className="k">TRANSFER MARKET</span>
        <h2 id="scout-title">Scout a squad</h2>
        <p className="note">
          A bid locks your goalars in the league until the club answers or you cancel. On a sale: 10% to the trainer, 2% to each of
          the last 3 clubs, 5% to the person who plays him, 3% burned, the rest to the seller.
        </p>
        <label className="field">
          <span>Club</span>
          <select value={target ?? ""} onChange={(e) => (setScout(e.target.value), setPicked(null))}>
            {table
              ?.filter((c) => c.manager !== session?.accountId)
              .map((c) => (
                <option key={c.manager} value={c.manager}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <CoachNote club={target} />
        <div className="stickers">
          {squad?.map((p) => (
            <Sticker key={p.token_id} p={p} selected={p.token_id === picked} onClick={() => setPicked(p.token_id)} />
          ))}
        </div>
        {player && (
          <div className="form">
            <p>
              <strong>{player.name}</strong> · {positionLabel[player.position]} · ATT {player.attack} · DEF {player.defence} · {player.goals}{" "}
              goals
            </p>
            {session && !mine ? (
              <p className="note">Only a club bids, from its manager's account. A player moves when he signs for a club, or when a club pays his release clause.</p>
            ) : (
              <label className="field">
                <span>Your bid (G), e.g. 500k or 2m</span>
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
              </label>
            )}
            {session && !mine ? null : session ? (
              <Action
                label={amount ? `BID ${g(amount)}` : "ENTER A PRICE"}
                disabled={!amount}
                run={() =>
                  call(
                    session,
                    GOALARS,
                    "ft_transfer_call",
                    { receiver_id: LEAGUE, amount: amount!.toString(), msg: JSON.stringify({ bid: player.token_id }) },
                    { deposit: 1n, tgas: 150 },
                  )
                }
              />
            ) : (
              <p className="note">Sign in to bid.</p>
            )}
            <Offers tokenId={player.token_id} />
          </div>
        )}
      </section>

      {session && mine && <MyClubOffers club={mine} />}

      {session && owed && owed !== "0" && (
        <section className="paper panel" aria-label="Money owed to you">
          <h2>{g(owed)} waiting for you</h2>
          <p className="note">Sale shares and refunds are kept by the league until you collect them.</p>
          <Action label="COLLECT" run={() => leagueCall(session, "collect", {}, 60)} done={reloadOwed} />
        </section>
      )}
    </div>
  );
}

/** The AI coach who runs a club, if one does. */
function CoachNote({ club }: { club: string | null }) {
  const coach = useAgents().get(club ?? "");
  if (coach?.kind !== "coach") return null;
  return (
    <p className="note">
      <span className="ai-tag">AI</span> Coach {coach.name} · {roleOf(coach)}. He answers bids between match days.
    </p>
  );
}

export function Offers({ tokenId, accept, ask }: { tokenId: string; accept?: (o: Offer) => Promise<unknown>; /** A club sells: a person-played footballer must have agreed. */ ask?: boolean }) {
  const { session } = useGame();
  const roster = useAgents();
  const { data: table } = useData(() => league<Club[]>("table"), []);
  const clubOf = (a: string) => table?.find((c) => c.manager === a);
  const { data, reload } = useData(() => league<Offer[]>("offers_for", { token_id: tokenId }), [tokenId]);
  // A person is sold only to the club he gave his word to.
  const { data: word } = useData(
    async () => {
      if (!ask) return null;
      const p = await league<Player | null>("get_player", { token_id: tokenId });
      if (!p?.controller) return null;
      const s = await league<{ club: string } | null>("signing_of", { token_id: tokenId }).catch(() => null);
      return { club: s?.club ?? "" };
    },
    [tokenId, ask],
  );
  const open = data?.filter((o) => o.state === "Open") ?? [];
  if (open.length === 0) return <p className="note">No open offer.</p>;
  return (
    <ul className="offers">
      {open.map((o) => (
        <li key={o.id}>
          <strong>{g(o.price)}</strong> from {clubOf(o.buyer) ? clubName(clubOf(o.buyer)!.name) : short(o.buyer)}
          {roster.get(o.buyer)?.kind === "coach" && <span className="ai-tag">AI</span>}
          {accept && (word && word.club !== o.buyer ? <span className="chip">WAITS FOR HIS YES</span> : <Action label="ACCEPT" className="cta small" run={() => accept(o)} done={reload} />)}
          {session?.accountId === o.buyer && (
            <Action label="CANCEL" className="cta small" run={() => leagueCall(session, "cancel_offer", { offer_id: o.id }, 60)} done={reload} />
          )}
        </li>
      ))}
    </ul>
  );
}

function MyClubOffers({ club }: { club: Club }) {
  const { session } = useGame();
  const { data: squad } = useData(() => league<Player[]>("squad", { account_id: club.manager }), [club.manager]);
  if (!session) return null;
  const accept = (o: Offer) =>
    acceptOffer(session, o.token_id, o.id);
  return (
    <section className="paper panel" aria-label={`Offers for ${club.name}`}>
      <span className="k">YOUR CLUB</span>
      <h2>Offers for {club.name}</h2>
      <ul className="clubs">
        {squad?.map((p) => (
          <li key={p.token_id} className="club-row">
            <span>
              {p.name} · {positionLabel[p.position]}
            </span>
            <Offers tokenId={p.token_id} accept={accept} ask />
          </li>
        ))}
      </ul>
    </section>
  );
}

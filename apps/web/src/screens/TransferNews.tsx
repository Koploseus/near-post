import { useEffect, useState } from "react";
import { Crest } from "./Crest.js";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useGame } from "../lib/game.js";
import { league, leagueCall } from "../lib/near.js";
import { lastClub, moved, rememberClub } from "../lib/transfer.js";
import type { Club } from "../lib/types.js";

interface News {
  from: string;
  /** What the league keeps for him: his part of the fee (yocto G). */
  part: bigint;
}

/** He changed club since this browser last looked: the move and his part of the fee, once. */
export function TransferNews() {
  const { session, me, club, loading, refresh } = useGame();
  const [news, setNews] = useState<News | null>(null);
  const account = session?.accountId;
  const now = me && club ? me.owner : "";
  useEffect(() => {
    if (!account || loading || !me) return;
    const before = lastClub(account);
    if (!moved(before, now)) {
      if (before !== now) rememberClub(account, now);
      return;
    }
    let live = true;
    (async () => {
      const [old, owed] = await Promise.all([
        league<Club | null>("get_club", { club_id: before }).catch(() => null),
        league<string>("owed_of", { account_id: account }).catch(() => "0"),
      ]);
      if (live) setNews({ from: old?.name ?? "your club", part: BigInt(owed) });
    })();
    return () => {
      live = false;
    };
  }, [account, loading, me?.token_id, now]);
  if (!news || !me || !club || !session) return null;
  const close = () => {
    rememberClub(session.accountId, now);
    setNews(null);
  };
  return (
    <div className="reveal-modal" role="dialog" aria-modal="true" aria-label="You changed club" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="reveal-card transfer-news">
        <span className="unbox-title legendary">DEAL DONE!</span>
        <Crest clubId={club.manager} name={club.name} size={96} />
        <p className="transfer-line">
          {me.name} leaves {news.from} for <b>{club.name}</b>
        </p>
        {news.part > 0n ? (
          <Action
            className="cta"
            label={`Collect your part, ${g(news.part)}`}
            run={() => leagueCall(session, "collect", {}, 60)}
            done={() => {
              soon(refresh);
              close();
            }}
            success={`${g(news.part)} in your wallet`}
          />
        ) : null}
        <button type="button" className={news.part > 0n ? "chip" : "cta"} autoFocus onClick={close}>
          {news.part > 0n ? "Later" : "LET'S GO"}
        </button>
      </div>
    </div>
  );
}

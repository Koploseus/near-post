import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { goalars, league, loadSession, type Session } from "./near.js";
import type { Club, Player, Schedule } from "./types.js";

interface Game {
  session: Session | null;
  setSession(s: Session | null): void;
  me: Player | null;
  club: Club | null;
  clubId: string | null;
  schedule: Schedule | null;
  balance: string;
  refresh(): void;
  loading: boolean;
}

const Ctx = createContext<Game | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [me, setMe] = useState<Player | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const [sched, player, bal] = await Promise.all([
        league<Schedule>("schedule").catch(() => null),
        session ? league<Player | null>("footballer_of", { account_id: session.accountId }).catch(() => null) : null,
        session ? goalars(session.accountId).catch(() => "0") : "0",
      ]);
      const c = player ? await league<Club | null>("get_club", { club_id: player.owner }).catch(() => null) : null;
      if (!live) return;
      setSchedule(sched);
      setMe(player);
      setClub(c);
      setBalance(bal);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [session, tick]);

  return (
    <Ctx.Provider
      value={{ session, setSession, me, club, clubId: club ? me!.owner : null, schedule, balance, refresh, loading }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useGame(): Game {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGame outside GameProvider");
  return g;
}

/** Loads data for a screen; `reload` re-runs it. */
export function useData<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload(): void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

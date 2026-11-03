import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { goalars, league, loadSession, type Session } from "./near.js";
import { liveDay } from "./live.js";
import { type Kickoffs, kickoffsOf, serverNow, syncClock } from "./time.js";
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
  /** When the halves of a match day really kicked off, by day (from the relay). */
  kickoffs: Record<number, Kickoffs>;
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

  // One clock for every viewer: the relay's.
  useEffect(() => {
    void syncClock();
    const t = setInterval(() => void syncClock(), 10 * 60_000);
    return () => clearInterval(t);
  }, []);

  // When the halves of the match day in play really reached the chain:
  // every 3 s around a match, so a late half starts in step for everyone.
  const [kickoffs, setKickoffs] = useState<Record<number, Kickoffs>>({});
  useEffect(() => {
    if (!schedule) return;
    const look = async () => {
      const ld = liveDay(schedule, serverNow());
      if (ld.state !== "live" && ld.kickoff - serverNow() > 60_000) return;
      const k = await kickoffsOf(ld.day);
      setKickoffs((prev) => (JSON.stringify(prev[ld.day]) === JSON.stringify(k) ? prev : { ...prev, [ld.day]: k }));
    };
    void look();
    const t = setInterval(() => void look(), 3_000);
    return () => clearInterval(t);
  }, [schedule]);

  // The schedule moves on its own (kick-off, half-time, full time): poll it,
  // every 3 s when a half is due within a minute (or overdue), else 15 s.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let last: Schedule | null = null;
    const poll = async () => {
      const s = await league<Schedule>("schedule").catch(() => null);
      if (s) {
        last = s;
        setSchedule((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s));
      }
      const due = last ? Number(last.next_match_at_ms) - serverNow() : 0;
      t = setTimeout(() => void poll(), due < 60_000 ? 3_000 : 15_000);
    };
    t = setTimeout(() => void poll(), 3_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <Ctx.Provider
      value={{ session, setSession, me, club, clubId: club ? me!.owner : null, schedule, balance, refresh, loading, kickoffs }}
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
/**
 * Reads again a few times after a transaction: its callbacks land a block or
 * two later, and the RPCs read final blocks, a few seconds behind.
 */
export function soon(f: () => void) {
  for (const ms of [2500, 6000, 12000]) setTimeout(f, ms);
}

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

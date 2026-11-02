import { useEffect, useState } from "react";
import { g } from "./lib/format.js";
import { GameProvider, useGame } from "./lib/game.js";
import { Toasts } from "./lib/toast.js";
import { Album } from "./screens/Album.js";
import { Dashboard } from "./screens/Dashboard.js";
import { Game } from "./screens/Game.js";
import { Lineup } from "./screens/Lineup.js";
import { Live } from "./screens/Live.js";
import { LockerRoom } from "./screens/LockerRoom.js";
import { HairBack, HairFront, LookDefs, SKIN } from "./screens/Look.js";
import { Market } from "./screens/Market.js";
import { Match } from "./screens/Match.js";
import { Stands } from "./screens/Stands.js";

/** Every screen, by hash. `tab` is the section of the nav it belongs to. */
const ROUTES = {
  home: { tab: "home", view: Dashboard },
  live: { tab: "live", view: Live },
  team: { tab: "team", view: Lineup },
  stands: { tab: "stands", view: Stands },
  match: { tab: "club", view: Match },
  album: { tab: "club", view: Album },
  market: { tab: "club", view: Market },
  game: { tab: "club", view: Game },
  locker: { tab: "me", view: LockerRoom },
} as const;
type Route = keyof typeof ROUTES;
type Tab = (typeof ROUTES)[Route]["tab"];

/** The five sections: today, the live match, the team sheet, the stands, the club. */
const TABS: { tab: Tab; href: string; label: string; icon: string }[] = [
  { tab: "home", href: "#/home", label: "Today", icon: "M4 11 12 4l8 7v9h-5v-6H9v6H4z" },
  { tab: "live", href: "#/live", label: "Live", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4 3.5 2.5-1.3 4h-4.4l-1.3-4Z" },
  { tab: "team", href: "#/team", label: "Team", icon: "M3 5h18v14H3zM12 5v14M3 9h3v6H3M21 9h-3v6h3" },
  { tab: "stands", href: "#/stands", label: "Stands", icon: "M3 20h18M5 16h14M7 12h10M9 8h6" },
  { tab: "club", href: "#/match", label: "Club", icon: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" },
];

/** "#/game/3/1" → "game"; the rest of the hash is read by the screen. */
const route = (): Route => {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0] as Route;
  return h in ROUTES ? h : "home";
};

function useRoute() {
  const [r, setR] = useState<Route>(route);
  useEffect(() => {
    const on = () => {
      setR(route());
      scrollTo({ top: 0 });
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

function TabLinks({ current, className }: { current: Tab; className: string }) {
  return (
    <nav className={className} aria-label="Main">
      {TABS.map((t) => (
        <a key={t.tab} href={t.href} aria-current={t.tab === current ? "page" : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={t.icon} />
          </svg>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

/** Who you are, top right: your footballer's head, his name and your G. */
function Me({ current }: { current: Tab }) {
  const { session, me, balance } = useGame();
  if (!session)
    return (
      <a className="me-chip cta small" href="#/locker">
        Play now
      </a>
    );
  const n = me ? Number(me.token_id.replace(/\D/g, "")) || 0 : 0;
  return (
    <a className="me-chip" href="#/locker" aria-current={current === "me" ? "page" : undefined} aria-label={me ? `${me.name}, your footballer` : "Create your footballer"}>
      <svg viewBox="15 6 30 34" aria-hidden="true">
        <LookDefs />
        <HairBack look={me?.look} n={n} />
        <ellipse cx="30" cy="25" rx="11" ry="13" fill={SKIN[n % SKIN.length]} />
        <HairFront look={me?.look} n={n} />
        <rect x="25" y="25" width="3" height="3" fill="#1B2340" />
        <rect x="32" y="25" width="3" height="3" fill="#1B2340" />
      </svg>
      <span className="me-text">
        <b>{me ? me.name.split(" ")[0] : "Your player"}</b>
        <em>{g(balance)}</em>
      </span>
    </a>
  );
}

function Header({ tab }: { tab: Tab }) {
  return (
    <header className="wrap top">
      <a className="brand" href="#/home">
        NEAR POST
      </a>
      <TabLinks current={tab} className="nav" />
      <Me current={tab} />
    </header>
  );
}

/** Results, album and market, the club's three pages. */
export function ClubTabs({ current }: { current: "match" | "album" | "market" }) {
  const tabs = [
    ["match", "Results"],
    ["album", "Album"],
    ["market", "Market"],
  ] as const;
  return (
    <nav className="sub-tabs" aria-label="Club">
      {tabs.map(([k, label]) => (
        <a key={k} href={`#/${k}`} aria-current={k === current ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function App() {
  const r = useRoute();
  const View = ROUTES[r].view;
  const tab = ROUTES[r].tab;
  return (
    <GameProvider>
      <Header tab={tab} />
      <main className="wrap page">
        {(r === "match" || r === "album" || r === "market") && <ClubTabs current={r} />}
        <View />
      </main>
      <TabLinks current={tab} className="tabbar" />
      <Toasts />
    </GameProvider>
  );
}

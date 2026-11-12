import { useEffect, useState } from "react";
import { g } from "./lib/format.js";
import { GameProvider, useGame } from "./lib/game.js";
import { useHeartbeat } from "./lib/social.js";
import { Toasts } from "./lib/toast.js";
import { Agents } from "./screens/Agents.js";
import { ClubHousePage } from "./screens/ClubHouse.js";
import { Album } from "./screens/Album.js";
import { Goalars } from "./screens/Goalars.js";
import { SeasonTickets } from "./screens/SeasonTickets.js";
import { Dashboard } from "./screens/Dashboard.js";
import { Game } from "./screens/Game.js";
import { Lineup } from "./screens/Lineup.js";
import { Live } from "./screens/Live.js";
import { AccountPage, LockerRoom } from "./screens/LockerRoom.js";
import { faceNumber, Head } from "./screens/Look.js";
import { Market } from "./screens/Market.js";
import { Match } from "./screens/Match.js";
import { Seasons } from "./screens/Seasons.js";
import { Stands } from "./screens/Stands.js";
import { Try } from "./screens/Try.js";

/** Every screen, by hash. `tab` is the section of the nav it belongs to. */
const ROUTES = {
  home: { tab: "home", view: Dashboard },
  live: { tab: "live", view: Live },
  team: { tab: "team", view: Lineup },
  stands: { tab: "stands", view: Stands },
  g: { tab: "stands", view: Goalars },
  tickets: { tab: "stands", view: SeasonTickets },
  match: { tab: "club", view: Match },
  seasons: { tab: "club", view: Seasons },
  album: { tab: "club", view: Album },
  market: { tab: "club", view: Market },
  house: { tab: "club", view: ClubHousePage },
  ai: { tab: "club", view: Agents },
  game: { tab: "club", view: Game },
  locker: { tab: "me", view: LockerRoom },
  account: { tab: "me", view: AccountPage },
  try: { tab: "home", view: Try },
} as const;
type Route = keyof typeof ROUTES;
type Tab = (typeof ROUTES)[Route]["tab"];

/** The five sections: today, the live match, the team sheet, the stands, the club. */
const TABS: { tab: Tab; href: string; label: string; icon: string; tone: string }[] = [
  { tab: "home", href: "#/home", label: "Today", icon: "M4 11 12 4l8 7v9h-5v-6H9v6H4z", tone: "yellow" },
  { tab: "live", href: "#/live", label: "Live", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4 3.5 2.5-1.3 4h-4.4l-1.3-4Z", tone: "red" },
  { tab: "team", href: "#/team", label: "Team", icon: "M3 5h18v14H3zM12 5v14M3 9h3v6H3M21 9h-3v6h3", tone: "green" },
  { tab: "stands", href: "#/stands", label: "Stands", icon: "M3 20h18M5 16h14M7 12h10M9 8h6", tone: "blue" },
  { tab: "club", href: "#/match", label: "Club", icon: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z", tone: "paper" },
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
        <a key={t.tab} href={t.href} aria-current={t.tab === current ? "page" : undefined} className={`tone-${t.tone}`}>
          <span className="tile" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d={t.icon} />
            </svg>
          </span>
          <span className="tab-label">{t.label}</span>
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
  return (
    <a className="me-chip" href="#/locker" aria-current={current === "me" ? "page" : undefined} aria-label={me ? `${me.name}, your footballer` : "Create your footballer"}>
      <Head look={me?.look} n={faceNumber(me?.token_id)} size={34} />
      <span className="me-text">
        <b>
          <span className="me-first">{me ? me.name.split(" ")[0] : "Your player"}</span>
          <span className="me-full">{me ? me.name : "Your player"}</span>
        </b>
        <em>{g(balance)}</em>
        {me && (
          <i className="me-sub">
            {me.position} · {me.overall}
          </i>
        )}
      </span>
    </a>
  );
}

/** Your G, with the coin: its own pill on a wide screen (the phone keeps it in the player chip). */
function Balance() {
  const { session, balance } = useGame();
  if (!session) return null;
  return (
    <span className="bal-pill" title="Your goalars">
      {g(balance)}
    </span>
  );
}

/** The door to the account page: backup, gas, sign out. */
function AccountLink() {
  const { session } = useGame();
  if (!session) return null;
  return (
    <a className="me-gear" href="#/account" aria-label="Your account" title="Your account">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="7.6" strokeWidth="3.4" strokeDasharray="2.6 3.37" strokeLinecap="butt" />
        <circle cx="12" cy="12" r="5.6" />
        <circle cx="12" cy="12" r="1.8" />
      </svg>
    </a>
  );
}

/** How many players have the game open right now (and your own heartbeat, when signed in). */
function Online() {
  const { session } = useGame();
  const n = useHeartbeat(session);
  if (n === null) return null;
  return (
    <span className="online-pill" title="Players with the game open right now">
      <span className="online-dot inline" aria-hidden="true" />
      <b>{n}</b>
      <span className="lbl">online</span>
    </span>
  );
}

function Header({ tab }: { tab: Tab }) {
  return (
    <header className="top-band">
      <div className="wrap top">
        <a className="brand" href="#/home">
          <img src="/logo.svg" alt="" width="58" height="49" />
          <span className="brand-text">
            NEAR POST
            <em>The star is you!</em>
          </span>
        </a>
        <TabLinks current={tab} className="nav" />
        <div className="top-right">
          <Online />
          <Balance />
          <Me current={tab} />
          <AccountLink />
        </div>
      </div>
    </header>
  );
}

/** Results, seasons, album, market, club house and the AI agents: the club's pages. */
export function ClubTabs({ current }: { current: "match" | "seasons" | "album" | "market" | "house" | "ai" }) {
  const tabs = [
    ["match", "Results"],
    ["seasons", "Seasons"],
    ["album", "Album"],
    ["market", "Market"],
    ["house", "Club house"],
    ["ai", "AI agents"],
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

/** The stand, the money it moves, and the season tickets: the fans' pages. */
export function StandsTabs({ current }: { current: "stands" | "g" | "tickets" }) {
  const tabs = [
    ["stands", "Stand"],
    ["g", "Goalars"],
    ["tickets", "Season tickets"],
  ] as const;
  return (
    <nav className="sub-tabs" aria-label="Stands">
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
        {(r === "match" || r === "seasons" || r === "album" || r === "market" || r === "house" || r === "ai") && <ClubTabs current={r} />}
        {(r === "stands" || r === "g" || r === "tickets") && <StandsTabs current={r} />}
        <View />
      </main>
      <TabLinks current={tab} className="tabbar" />
      <Toasts />
    </GameProvider>
  );
}

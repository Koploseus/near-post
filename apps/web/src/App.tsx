import { useEffect, useState } from "react";
import { g, short } from "./lib/format.js";
import { GameProvider, useGame } from "./lib/game.js";
import { signOut } from "./lib/near.js";
import { Album } from "./screens/Album.js";
import { Dashboard } from "./screens/Dashboard.js";
import { Lineup } from "./screens/Lineup.js";
import { Live } from "./screens/Live.js";
import { LockerRoom } from "./screens/LockerRoom.js";
import { Market } from "./screens/Market.js";
import { Match } from "./screens/Match.js";
import { Game } from "./screens/Game.js";
import { Stands } from "./screens/Stands.js";

const ROUTES = {
  home: { label: "Home", view: Dashboard },
  live: { label: "Live", view: Live },
  team: { label: "Team", view: Lineup },
  stands: { label: "Stands", view: Stands },
  match: { label: "Results", view: Match },
  locker: { label: "Locker room", view: LockerRoom },
  album: { label: "Album", view: Album },
  market: { label: "Market", view: Market },
  game: { label: "", view: Game },
} as const;
type Route = keyof typeof ROUTES;

/** "#/game/3/1" → "game"; the rest of the hash is read by the screen. */
const route = (): Route => {
  const h = location.hash.replace(/^#\/?/, "").split("/")[0] as Route;
  return h in ROUTES ? h : "home";
};

function useRoute() {
  const [r, setR] = useState<Route>(route);
  useEffect(() => {
    const on = () => setR(route());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r;
}

function Header({ current }: { current: Route }) {
  const { session, setSession, balance } = useGame();
  return (
    <header className="wrap top">
      <a className="brand" href="#/home">
        NEAR POST
      </a>
      <nav className="nav" aria-label="Main">
        {(Object.keys(ROUTES) as Route[]).filter((k) => ROUTES[k].label).map((k) => (
          <a key={k} href={`#/${k}`} aria-current={k === current || (k === "match" && current === "game") ? "page" : undefined}>
            {ROUTES[k].label}
          </a>
        ))}
      </nav>
      {session ? (
        <span className="who">
          <strong>{g(balance)}</strong>
          <span title={session.accountId}>{short(session.accountId)}</span>
          <button
            type="button"
            className="link"
            onClick={() => {
              signOut();
              setSession(null);
            }}
          >
            Sign out
          </button>
        </span>
      ) : (
        <a className="who" href="#/locker">
          Sign in
        </a>
      )}
    </header>
  );
}

export function App() {
  const r = useRoute();
  const View = ROUTES[r].view;
  return (
    <GameProvider>
      <Header current={r} />
      <main className="wrap page">
        <View />
      </main>
    </GameProvider>
  );
}

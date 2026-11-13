import { useEffect, useState } from "react";
import { g } from "./lib/format.js";
import { GameProvider, useGame } from "./lib/game.js";
import { TransferNews } from "./screens/TransferNews.js";
import { useHeartbeat } from "./lib/social.js";
import { Toasts } from "./lib/toast.js";
import { setSound, soundOn } from "./lib/sound.js";
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
import { People } from "./screens/People.js";
import { Rankings } from "./screens/Rankings.js";
import { About, Faq, Footer, Privacy, Terms } from "./screens/Pages.js";
import { Rules } from "./screens/Rules.js";
import { TrainingPage } from "./screens/Training.js";
import { inbox } from "./lib/people.js";
import { ICON, Tile } from "./screens/Icon.js";

/** Every screen, by hash. `tab` is the entry of the menu it belongs to. */
const ROUTES = {
  home: { tab: "home", view: Dashboard },
  live: { tab: "live", view: Live },
  match: { tab: "live", view: Match },
  seasons: { tab: "live", view: Seasons },
  game: { tab: "live", view: Game },
  training: { tab: "training", view: TrainingPage },
  locker: { tab: "me", view: LockerRoom },
  account: { tab: "me", view: AccountPage },
  team: { tab: "club", view: Lineup },
  album: { tab: "club", view: Album },
  house: { tab: "club", view: ClubHousePage },
  ai: { tab: "club", view: Agents },
  people: { tab: "people", view: People },
  ranks: { tab: "ranks", view: Rankings },
  stands: { tab: "stands", view: Stands },
  g: { tab: "stands", view: Goalars },
  tickets: { tab: "stands", view: SeasonTickets },
  market: { tab: "stands", view: Market },
  rules: { tab: "help", view: Rules },
  try: { tab: "home", view: Try },
  about: { tab: "help", view: About },
  faq: { tab: "help", view: Faq },
  terms: { tab: "help", view: Terms },
  privacy: { tab: "help", view: Privacy },
} as const;
type Route = keyof typeof ROUTES;
type Tab = (typeof ROUTES)[Route]["tab"];


/** The menu: eight places, named for what is in them. */
const TABS: { tab: Tab; href: string; label: string; icon: string; tone: string }[] = [
  { tab: "home", href: "#/home", label: "Home", icon: ICON.home, tone: "yellow" },
  { tab: "live", href: "#/live", label: "Live", icon: ICON.live, tone: "red" },
  { tab: "training", href: "#/training", label: "Training", icon: ICON.training, tone: "green" },
  { tab: "me", href: "#/locker", label: "My player", icon: ICON.me, tone: "blue" },
  { tab: "club", href: "#/team", label: "My club", icon: ICON.club, tone: "paper" },
  { tab: "people", href: "#/people", label: "People", icon: ICON.people, tone: "pink" },
  { tab: "ranks", href: "#/ranks", label: "Rankings", icon: ICON.ranks, tone: "gold" },
  { tab: "stands", href: "#/stands", label: "Stands & market", icon: ICON.stands, tone: "sky" },
];

/** The pages of each menu entry that has more than one, as tabs at the top of the page. */
const SECTIONS: Partial<Record<Tab, { label: string; pages: [Route, string][] }>> = {
  live: { label: "Matches", pages: [["live", "Live"], ["match", "Results"], ["seasons", "Seasons"]] },
  me: { label: "My player", pages: [["locker", "Locker room"], ["account", "Account"]] },
  club: { label: "My club", pages: [["team", "Team sheet"], ["album", "Squad album"], ["house", "Club house"], ["ai", "AI agents"]] },
  stands: { label: "Stands and market", pages: [["stands", "Stand"], ["g", "Goalars"], ["tickets", "Season tickets"], ["market", "Market"]] },
  help: { label: "Help", pages: [["rules", "How to play"], ["faq", "Questions"], ["about", "About"]] },
};

/** Which part of "How to play" explains each page (the "?" next to its tabs). */
const HELP: Partial<Record<Route, string>> = {
  live: "match",
  match: "match",
  seasons: "season",
  game: "match",
  training: "training",
  locker: "player",
  team: "club",
  album: "club",
  house: "club",
  ai: "agents",
  people: "life",
  ranks: "season",
  stands: "money",
  g: "money",
  tickets: "money",
  market: "money",
};

/** The menu on a phone, behind "Menu": every page, in groups. */
const GROUPS: { title: string; tone: string; icon: string; links: [string, string][] }[] = [
  { title: "Play", tone: "red", icon: ICON.live, links: [["#/live", "Live match"], ["#/training", "Training"], ["#/match", "Results"], ["#/seasons", "Seasons"]] },
  { title: "My player", tone: "blue", icon: ICON.me, links: [["#/locker", "Locker room"], ["#/account", "Account"]] },
  { title: "My club", tone: "paper", icon: ICON.club, links: [["#/team", "Team sheet"], ["#/album", "Squad album"], ["#/house", "Club house"], ["#/ai", "AI agents"]] },
  { title: "People", tone: "pink", icon: ICON.people, links: [["#/people/terrace", "Terrace"], ["#/people/messages", "Messages"], ["#/people/friends", "Friends"], ["#/people/duels", "Duels"]] },
  { title: "Rankings", tone: "gold", icon: ICON.ranks, links: [["#/ranks", "Rankings"]] },
  { title: "Stands and market", tone: "sky", icon: ICON.stands, links: [["#/stands", "Stand"], ["#/g", "Goalars"], ["#/tickets", "Season tickets"], ["#/market", "Market"]] },
  { title: "Help", tone: "yellow", icon: ICON.help, links: [["#/rules", "How to play"], ["#/faq", "Questions"], ["#/about", "About"]] },
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

const TabIcon = Tile;

/** New messages, friend requests and duels to play: the red badge on People. */
function usePeopleCount() {
  const { session, me } = useGame();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!session || !me) return setN(0);
    let live = true;
    const load = () =>
      inbox(session)
        .then((b) => live && setN(b.unread + b.requests.length + b.duels.filter((d) => d.mine === null && !d.result).length))
        .catch(() => {});
    load();
    const t = setInterval(load, 90_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [session?.accountId, me?.token_id]);
  return n;
}

/** The menu on a wide screen: eight big tiles, a word under each. */
function MainNav({ current, people }: { current: Tab; people: number }) {
  return (
    <nav className="mainnav" aria-label="Main">
      {TABS.map((t) => (
        <a key={t.tab} href={t.href} aria-current={t.tab === current ? "page" : undefined} className={`tone-${t.tone}`}>
          <TabIcon d={t.icon} />
          <span className="tab-label">{t.label}</span>
          {t.tab === "people" && people > 0 && <span className="count-badge">{people}</span>}
        </a>
      ))}
    </nav>
  );
}

/** The menu on a phone: four places and "Menu", which opens every page. */
function BottomBar({ current, people, open, onMenu }: { current: Tab; people: number; open: boolean; onMenu: () => void }) {
  const main = TABS.slice(0, 4);
  const inMenu = !main.some((t) => t.tab === current);
  return (
    <nav className="bottombar" aria-label="Main">
      {main.map((t) => (
        <a key={t.tab} href={t.href} aria-current={!open && t.tab === current ? "page" : undefined} className={`tone-${t.tone}`}>
          <TabIcon d={t.icon} />
          <span className="tab-label">{t.label}</span>
        </a>
      ))}
      <button type="button" className={`tone-paper${open || inMenu ? " on" : ""}`} aria-expanded={open} aria-controls="menu-sheet" onClick={onMenu}>
        <TabIcon d={open ? "M6 6l12 12M18 6 6 18" : ICON.menu} plain={open} />
        <span className="tab-label">{open ? "Close" : "Menu"}</span>
        {people > 0 && !open && <span className="count-badge">{people}</span>}
      </button>
    </nav>
  );
}

/** Every page, in groups, over the screen (phone). */
function MenuSheet({ onClose, people }: { onClose: () => void; people: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    document.body.classList.add("menu-open");
    (document.querySelector("#menu-sheet a") as HTMLElement | null)?.focus();
    return () => {
      removeEventListener("keydown", key);
      document.body.classList.remove("menu-open");
    };
  }, []);
  return (
    <div id="menu-sheet" className="menu-sheet" role="dialog" aria-modal="true" aria-label="Menu">
      <a className="menu-rules" href="#/rules">
        <TabIcon d={ICON.help} />
        <span>
          <b>How to play</b>
          <span>The rules in two minutes</span>
        </span>
      </a>
      {GROUPS.map((gr) => (
        <section key={gr.title} className={`menu-group tone-${gr.tone}`}>
          <h2>
            <TabIcon d={gr.icon} />
            {gr.title}
            {gr.title === "People" && people > 0 && <span className="count-badge">{people}</span>}
          </h2>
          <div className="menu-links">
            {gr.links.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The pages of this menu entry, and the "?" to the rules that explain it. */
function SectionTabs({ r }: { r: Route }) {
  const sec = SECTIONS[ROUTES[r].tab];
  const help = HELP[r];
  if (!sec && !help) return null;
  return (
    <div className={`section-bar${sec ? "" : " solo"}`}>
      {sec && (
        <nav className="sub-tabs" aria-label={sec.label}>
          {sec.pages.map(([k, label]) => (
            <a key={k} href={`#/${k}`} aria-current={k === r || (r === "game" && k === "match") ? "page" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      )}
      {help && (
        <a className="help-link" href={`#/rules/${help}`} title="How this works" aria-label="How this works">
          <span aria-hidden="true">?</span>
          {!sec && <b>How it works</b>}
        </a>
      )}
    </div>
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

/** The game's sounds, on or off for this device (on unless you turn them off). */
function SoundButton() {
  const [on, setOn] = useState(soundOn);
  return (
    <button
      type="button"
      className={`sound-btn${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Sound on: turn it off" : "Sound off: turn it on"}
      title={on ? "Sound on" : "Sound off"}
      onClick={() => {
        setSound(!on);
        setOn(!on);
      }}
    >
      <svg viewBox="0 0 16 16" width="22" height="22" shapeRendering="crispEdges" aria-hidden="true">
        <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
        {on ? <path d="M11 6h1v4h-1zM13 4h1v8h-1z" fill="currentColor" /> : <path d="M11 6h1v1h1v1h1v1h-1v1h-1v1h-1v-1h1V9h-1V8h1V7h-1zM14 6h1v1h-1zM14 10h1v1h-1z" fill="currentColor" />}
      </svg>
    </button>
  );
}

function Header({ tab, people }: { tab: Tab; people: number }) {
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
        <div className="top-right">
          <a className="rules-pill" href="#/rules" aria-current={tab === "help" ? "page" : undefined}>
            <img src="/art/icons/help.webp" alt="" width="30" height="30" />
            <b>How to play</b>
          </a>
          <SoundButton />
          <Online />
          <Balance />
          <Me current={tab} />
          <AccountLink />
        </div>
      </div>
      <div className="wrap">
        <MainNav current={tab} people={people} />
      </div>
    </header>
  );
}

export function App() {
  return (
    <GameProvider>
      <Shell />
    </GameProvider>
  );
}

function Shell() {
  const r = useRoute();
  const View = ROUTES[r].view;
  const tab = ROUTES[r].tab;
  const people = usePeopleCount();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const close = () => setMenu(false);
    addEventListener("hashchange", close);
    return () => removeEventListener("hashchange", close);
  }, []);
  return (
    <>
      <Header tab={tab} people={people} />
      <TransferNews />
      <main className="wrap page">
        <SectionTabs r={r} />
        <View />
        <Footer />
      </main>
      {menu && <MenuSheet onClose={() => setMenu(false)} people={people} />}
      <BottomBar current={tab} people={people} open={menu} onMenu={() => setMenu(!menu)} />
      <Toasts />
    </>
  );
}

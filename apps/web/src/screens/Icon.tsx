/** The menu's icons (24 x 24 strokes), and the coloured tile they sit in. */
export const ICON = {
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
  live: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4 3.5 2.5-1.3 4h-4.4l-1.3-4Z",
  training: "M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM12 9v4l3 2M9 2h6",
  me: "M8 3 3 6l2 4 2-1v11h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z",
  club: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 1 0 0-6M17.5 14.3c2 .8 3.5 2.9 3.5 5.7",
  ranks: "M3 20h18M4 20v-6h5v6M9 20V9h6v11M15 20v-8h5v8",
  stands: "M3 20h18M5 16h14M7 12h10M9 8h6",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
} as const;

/** The drawn icon of each place (public/art/icons, 160 x 160), shown instead of the stroke icon. */
const ART: Partial<Record<keyof typeof ICON, string>> = {
  home: "home",
  live: "live",
  training: "training",
  me: "me",
  club: "club",
  people: "people",
  ranks: "ranks",
  stands: "stands",
  help: "help",
  menu: "menu",
};
const BY_PATH = new Map(Object.entries(ART).map(([k, f]) => [ICON[k as keyof typeof ICON] as string, `/art/icons/${f}.webp`]));

/** An icon in its tile: the drawn one when there is one, else the stroke icon on the place's colour. */
export function Tile({ d, plain }: { d: string; plain?: boolean }) {
  const art = plain ? undefined : BY_PATH.get(d);
  if (art)
    return (
      <span className="tile art" aria-hidden="true">
        <img src={art} alt="" width="160" height="160" decoding="async" />
      </span>
    );
  return (
    <span className="tile" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d={d} />
      </svg>
    </span>
  );
}

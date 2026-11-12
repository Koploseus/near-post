import { ItemArt, itemArt } from "../floodlight/item-art.js";
import { PixelAvatar } from "../floodlight/PixelPlayer.js";
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { avatarCanvas } from "./art.js";
import { type Face, HEAD, type View, artReady, faceOf, facesVersion, headGrid, headURL, packFace, subscribeFaces } from "../lib/face.js";
import type { CatalogItem, ItemKind, Look, Skill } from "../lib/types.js";

export const SKIN = ["#C68B5E", "#E9B98F", "#B37650", "#F0C6A0", "#8A5A3B", "#DDA77C"];
export const HAIR = ["#2A1A10", "#7A4B23", "#111111", "#C9A15A", "#1A1210", "#3B2416"];

export const RARITY_COLOR: Record<CatalogItem["rarity"], string> = {
  common: "#8b8f9c",
  rare: "#2F5DA8",
  epic: "#8a3fd1",
  legendary: "#F2B705",
};

export const KINDS: ItemKind[] = ["hair", "boots", "band", "socks", "pads", "gloves", "wrist", "tape"];
export const KIND_LABEL: Record<ItemKind, string> = {
  hair: "Haircut",
  boots: "Boots",
  band: "Headband",
  socks: "Grip socks",
  pads: "Shin pads",
  gloves: "Gloves",
  wrist: "Wristband",
  tape: "Ankle tape",
};
/** The skill each kind adds to on the pitch (league `dressed`). Hair is looks only. */
export const KIND_SKILL: Record<ItemKind, Skill | null> = {
  hair: null,
  boots: "pace",
  band: "physical",
  socks: "dribbling",
  pads: "defending",
  gloves: "defending",
  wrist: "passing",
  tape: "shooting",
};
/** Where it counts: pads on an outfield player, gloves in goal. */
export const KIND_NOTE: Partial<Record<ItemKind, string>> = { pads: "outfield", gloves: "in goal" };
export const noLook = (): Look => ({ hair: null, boots: null, band: null, socks: null, pads: null, gloves: null, wrist: null, tape: null });

/** One colour per style name, for the kit items (socks, pads, gloves, wristband, tape). */
const KIT_COLOR: Record<string, string> = {
  white: "#f7f4ec",
  black: "#151515",
  navy: "#1B2340",
  grey: "#8b8f9c",
  red: "#C8202F",
  blue: "#2F5DA8",
  yellow: "#F2B705",
  neon: "#b8ff2e",
  grip: "#3f8a3a",
  camo: "#5b6b3a",
  carbon: "#2b2f3a",
  hooped: "url(#np-stripes)",
  striped: "url(#np-stripes)",
  "two-tone": "#ff7a1a",
  tifo: "url(#np-tifo)",
  gold: "#F2B705",
  chrome: "#d9dde4",
  laurel: "#3f8a3a",
  flame: "url(#np-flame)",
  galaxy: "#2b1055",
};
const kit = (id: string | null | undefined, fallback: string | null = null) => (id ? (KIT_COLOR[id.split(".")[1]!] ?? "#8b8f9c") : fallback);

const style = (id: string | null | undefined) => (id ? id.split(".")[1]! : null);

export const BOOT_COLOR: Record<string, [string, string]> = {
  black: ["#151515", "#3a3a3a"],
  white: ["#f7f4ec", "#c9c4b6"],
  navy: ["#1B2340", "#2F5DA8"],
  red: ["#C8202F", "#7e111b"],
  blue: ["#2F5DA8", "#9cc0ff"],
  yellow: ["#F2B705", "#1B2340"],
  neon: ["#b8ff2e", "#ff2ea6"],
  "two-tone": ["#ff7a1a", "#1B2340"],
  camo: ["#5b6b3a", "#2f3a1c"],
  gold: ["#F2B705", "#fff3b0"],
  chrome: ["#d9dde4", "#7b8494"],
  galaxy: ["#2b1055", "#ff9ef0"],
};

const BAND_COLOR: Record<string, string> = {
  white: "#f7f4ec",
  black: "#151515",
  navy: "#1B2340",
  red: "#C8202F",
  blue: "#2F5DA8",
  yellow: "#F2B705",
  striped: "url(#np-stripes)",
  checked: "url(#np-checks)",
  tifo: "url(#np-tifo)",
  gold: "#F2B705",
  laurel: "#3f8a3a",
  flame: "url(#np-flame)",
};

/** Patterns the items use; put once in each SVG. */
export function LookDefs() {
  return (
    <defs>
      <pattern id="np-stripes" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="#f7f4ec" />
        <rect width="2" height="4" fill="#C8202F" />
      </pattern>
      <pattern id="np-checks" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="#f7f4ec" />
        <rect width="2" height="2" fill="#1B2340" />
        <rect x="2" y="2" width="2" height="2" fill="#1B2340" />
      </pattern>
      <pattern id="np-tifo" width="6" height="4" patternUnits="userSpaceOnUse">
        <rect width="6" height="4" fill="#F2B705" />
        <rect width="2" height="4" fill="#C8202F" />
      </pattern>
      <linearGradient id="np-flame" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#C8202F" />
        <stop offset=".6" stopColor="#ff7a1a" />
        <stop offset="1" stopColor="#F2B705" />
      </linearGradient>
    </defs>
  );
}

/** What goes behind the head (afro, ponytail, bun). Head: ellipse at (30, 25), 11 × 13. */
export function HairBack({ look, n }: { look?: Look; n: number }) {
  const c = hairColor(look, n);
  switch (style(look?.hair)) {
    case "afro":
      return <circle cx="30" cy="21" r="16" fill={c} />;
    case "ponytail":
      return <path d="M38 18 C48 20 48 34 43 40 C42 32 40 26 38 24 Z" fill={c} />;
    case "dreads":
      return (
        <g stroke={c} strokeWidth="2.6" strokeLinecap="round">
          {[19, 22, 38, 41].map((x) => (
            <line key={x} x1={x} y1="20" x2={x + (x < 30 ? -1 : 1)} y2="36" />
          ))}
        </g>
      );
    default:
      return null;
  }
}

/** Hair on top of the head, then the headband. */
export function HairFront({ look, n }: { look?: Look; n: number }) {
  const c = hairColor(look, n);
  const s = style(look?.hair);
  const top = (() => {
    switch (s) {
      case "buzz":
        return <path d="M19.5 22 C20 13 40 13 40.5 22 C37 18.5 23 18.5 19.5 22 Z" fill={c} opacity=".75" />;
      case "side-part":
        return (
          <>
            <path d="M19 24 C18 10 42 10 41 24 C38 17 23 17 19 24 Z" fill={c} />
            <path d="M25 13 L23 19" stroke="#000" strokeOpacity=".35" strokeWidth="1" />
          </>
        );
      case "curls":
        return (
          <g fill={c}>
            {[21, 25, 30, 35, 39, 23, 28, 33, 37].map((x, i) => (
              <circle key={i} cx={x} cy={i < 5 ? 15 + Math.abs(30 - x) / 3 : 11.5 + Math.abs(30 - x) / 4} r="3.6" />
            ))}
          </g>
        );
      case "bun":
        return (
          <>
            <path d="M19 24 C18 10 42 10 41 24 C38 17 23 17 19 24 Z" fill={c} />
            <circle cx="30" cy="9" r="4.5" fill={c} />
          </>
        );
      case "mohawk":
        return <path d="M27 5 L33 5 L34.5 21 L25.5 21 Z" fill={c} />;
      case "fire":
        return <path d="M26 21 L24 9 L27.5 12 L28 3 L31 10 L33 4 L34 12 L37 8 L35 21 Z" fill="url(#np-flame)" />;
      case "afro":
        return <path d="M18 22 C17 9 43 9 42 22 C38 16 22 16 18 22 Z" fill={c} />;
      case "flat-top":
        return <path d="M18.5 22 L18.5 8 L41.5 8 L41.5 22 C38 17 22 17 18.5 22 Z" fill={c} />;
      case "dreads":
      case "ponytail":
      case "short":
      case "bleached":
      default:
        return <path d="M19 24 C18 10 42 10 41 24 C38 17 23 17 19 24 Z" fill={c} />;
    }
  })();
  const band = style(look?.band);
  return (
    <>
      {top}
      {band && (
        <>
          <rect x="18.6" y="17.6" width="22.8" height="3.8" rx="1.4" fill={BAND_COLOR[band] ?? "#fff"} stroke="#1B2340" strokeWidth=".5" />
          {band === "laurel" &&
            [21, 25, 29, 33, 37].map((x) => <ellipse key={x} cx={x} cy="17.4" rx="1.8" ry="1" fill="#6fbf5a" transform={`rotate(-25 ${x} 17.4)`} />)}
          {band === "gold" && <circle cx="30" cy="19.5" r="1.3" fill="#fff3b0" />}
        </>
      )}
    </>
  );
}

function hairColor(look: Look | undefined, n: number): string {
  switch (style(look?.hair)) {
    case "bleached":
      return "#F1DE9A";
    case "fire":
      return "#C8202F";
    default:
      return HAIR[(n >> 1) % HAIR.length]!;
  }
}

/**
 * Ears, brows, eyes, nose and mouth on the head (ellipse at (30, 25), 11 × 13).
 * Each footballer gets his own set from his number: no two squads look alike.
 */
export function Face({ n, skin }: { n: number; skin: string }) {
  const brow = (n >> 3) % 3; // flat, raised, frowning
  const mouth = (n >> 5) % 3; // grin, smile, flat
  const eyes = (n >> 7) % 2; // dots, round
  const ink = "#1B2340";
  return (
    <>
      <ellipse cx="19.2" cy="26" rx="2" ry="3" fill={skin} stroke="#000" strokeOpacity=".15" strokeWidth=".5" />
      <ellipse cx="40.8" cy="26" rx="2" ry="3" fill={skin} stroke="#000" strokeOpacity=".15" strokeWidth=".5" />
      <g stroke={ink} strokeWidth="1.3" strokeLinecap="round" fill="none">
        {brow === 0 && <path d="M23.5 21.6 h4.5 M32 21.6 h4.5" />}
        {brow === 1 && <path d="M23.5 22 q2.2 -1.6 4.5 -0.4 M32 21.6 q2.3 -1.2 4.5 0.4" />}
        {brow === 2 && <path d="M23.5 21 l4.5 1.2 M36.5 21 l-4.5 1.2" />}
      </g>
      {eyes === 0 ? (
        <>
          <circle cx="26" cy="25.4" r="1.5" fill={ink} />
          <circle cx="34" cy="25.4" r="1.5" fill={ink} />
        </>
      ) : (
        <>
          <ellipse cx="26" cy="25.4" rx="2" ry="1.7" fill="#fff" />
          <ellipse cx="34" cy="25.4" rx="2" ry="1.7" fill="#fff" />
          <circle cx="26.4" cy="25.6" r="1.1" fill={ink} />
          <circle cx="34.4" cy="25.6" r="1.1" fill={ink} />
        </>
      )}
      <path d="M30 26.5 l-1.3 3.4 h2" stroke="#000" strokeOpacity=".28" strokeWidth=".9" fill="none" strokeLinecap="round" />
      {mouth === 0 && <path d="M26 32 q4 3.6 8 0 Z" fill="#7e111b" stroke={ink} strokeWidth=".6" />}
      {mouth === 1 && <path d="M26.2 32 q3.8 2.6 7.6 0" stroke={ink} strokeWidth="1.2" fill="none" strokeLinecap="round" />}
      {mouth === 2 && <path d="M27 32.6 h6" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />}
    </>
  );
}

/** A number for a footballer's face, from his token id ("p42" → 42). */
export const faceNumber = (tokenId: string | null | undefined) => (tokenId ? Number(tokenId.replace(/\D/g, "")) || 0 : 0);

/** His head, drawn (art/faces), with the collar of his shirt. `size` is the width; it is a quarter taller. */
export function FaceHead({ face, hair, shirt = "#2F5DA8", size = 36, title, view = "front", className }: { face: Face; hair?: string | null; shirt?: string; size?: number; title?: string; view?: View; className?: string }) {
  useSyncExternalStore(subscribeFaces, facesVersion);
  const url = headURL(face, view, hair);
  // Until the art has loaded: the same face on a grid of big pixels.
  const paths = useMemo(() => {
    if (url) return [];
    const by = new Map<string, string>();
    headGrid(face, view, hair).forEach((row, y) => {
      for (let x = 0; x < row.length; ) {
        const c = row[x];
        let w = 1;
        while (x + w < row.length && row[x + w] === c) w++;
        if (c) by.set(c, `${by.get(c) ?? ""}M${x} ${y}h${w}v1h-${w}z`);
        x += w;
      }
    });
    return [...by];
  }, [packFace(face), view, hair, url]);
  const label = { role: title ? "img" : undefined, "aria-label": title, "aria-hidden": title ? undefined : true } as const;
  if (url)
    return (
      <svg className={className} width={size} height={size * 1.25} viewBox="16 8 96 120" {...label}>
        {/* Shoulders behind the head. */}
        <path d="M30 128v-10l8-6h52l8 6v10z" fill={shirt} stroke="#1B1030" strokeWidth="3" strokeLinejoin="round" />
        <image href={url} x="0" y="0" width="128" height="128" style={{ imageRendering: "pixelated" }} />
      </svg>
    );
  return (
    <svg className={className} width={size} height={size * 1.25} viewBox={`0 -2 ${HEAD} 37.5`} shapeRendering="crispEdges" {...label}>
      <path d="M4 36v-7h3v-1h16v1h3v7z" fill="#1B1030" />
      <path d="M5 36v-6h3v-1h14v1h3v6z" fill={shirt} />
      {paths.map(([c, d]) => (
        <path key={c} d={d} fill={c} />
      ))}
    </svg>
  );
}

/** Just the head and the collar of his shirt: for the pitch, the squad and the wall. His own face (lib/face.ts). */
export function Head({ look, n, shirt = "#2F5DA8", size = 36, title }: { look?: Look; n: number; shirt?: string; size?: number; title?: string }) {
  useSyncExternalStore(subscribeFaces, facesVersion);
  return <FaceHead face={faceOf(n)} hair={look?.hair} shirt={shirt} size={size} title={title} />;
}

/** A footballer head to toe, with his own face and wearing his look: for the wardrobe. `size` is the height. */
export function Avatar({ look, n, shirt = "#2F5DA8", size = 180 }: { look?: Look; n: number; shirt?: string; size?: number }) {
  const version = useSyncExternalStore(subscribeFaces, facesVersion);
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const worn = JSON.stringify(look ?? {});
  useEffect(() => {
    let stop = false;
    const paint = () => {
      if (stop) return;
      const src = artReady() ? avatarCanvas(shirt, n, look, version) : null;
      const el = ref.current;
      if (!src || !el) {
        setTimeout(paint, 200); // the art is still loading: the pixel footballer shows meanwhile
        return;
      }
      const g = el.getContext("2d")!;
      g.clearRect(0, 0, el.width, el.height);
      g.drawImage(src, 0, 0);
      setReady(true);
    };
    paint();
    return () => {
      stop = true;
    };
  }, [worn, n, shirt, version]);
  return (
    <span className="avatar-art" style={{ display: "inline-block", position: "relative", height: size, width: (size * 314) / 320 }}>
      {!ready && <PixelAvatar look={look} n={n} shirt={shirt} size={size} />}
      <canvas ref={ref} width={314} height={320} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", visibility: ready ? "visible" : "hidden" }} />
    </span>
  );
}

/** A small picture of an item, for the wardrobe grid. */
export function ItemIcon({ item, n }: { item: CatalogItem; n: number }) {
  if (itemArt(item.id)) return <ItemArt id={item.id} size={52} title={item.id} />;
  if (item.kind === "boots") {
    const [boot, stud] = BOOT_COLOR[item.style] ?? ["#151515", "#3a3a3a"];
    return (
      <svg viewBox="0 0 40 24" width="56" height="34" aria-hidden="true">
        <path d="M4 6 h20 c6 0 12 4 12 10 v4 H4 Z" fill={boot} stroke="#1B2340" strokeWidth="1" />
        <path d="M8 20 v3 M16 20 v3 M24 20 v3 M32 20 v3" stroke={stud} strokeWidth="2" />
        <path d="M10 10 l8 0" stroke={stud} strokeWidth="1.6" />
      </svg>
    );
  }
  if (item.kind !== "hair" && item.kind !== "band") {
    const fill = kit(item.id)!;
    const shape: Record<string, ReactNode> = {
      socks: <path d="M14 3 h10 v12 l8 4 c2 1 2 4 -1 4 H14 Z" fill={fill} stroke="#1B2340" strokeWidth="1" />,
      pads: <path d="M13 3 h14 c2 6 2 12 0 18 h-14 c-2 -6 -2 -12 0 -18 Z" fill={fill} stroke="#1B2340" strokeWidth="1" />,
      gloves: <path d="M10 22 V10 h3 V4 h3 v6 h2 V3 h3 v7 h2 V4 h3 v8 l3 -3 l2 2 l-5 7 v4 Z" fill={fill} stroke="#1B2340" strokeWidth="1" />,
      wrist: <rect x="8" y="7" width="24" height="10" rx="4" fill={fill} stroke="#1B2340" strokeWidth="1" />,
      tape: (
        <>
          <circle cx="20" cy="12" r="9" fill={fill} stroke="#1B2340" strokeWidth="1" />
          <circle cx="20" cy="12" r="3.5" fill="#F3EAD7" stroke="#1B2340" strokeWidth="1" />
        </>
      ),
    };
    return (
      <svg viewBox="0 0 40 24" width="56" height="34" aria-hidden="true">
        <LookDefs />
        {shape[item.kind]}
      </svg>
    );
  }
  const look: Look = { ...noLook(), hair: item.kind === "hair" ? item.id : null, band: item.kind === "band" ? item.id : null };
  return (
    <svg viewBox="8 2 44 38" width="52" height="45" aria-hidden="true">
      <LookDefs />
      <HairBack look={look} n={n} />
      <ellipse cx="30" cy="25" rx="11" ry="13" fill={SKIN[n % SKIN.length]} />
      <HairFront look={look} n={n} />
    </svg>
  );
}

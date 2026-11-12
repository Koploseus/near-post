/**
 * Item art for the on-chain wardrobe catalog (contracts/league/src/wardrobe.rs).
 *
 * Every catalog id `kind.style` maps to one base image (neutral white or, for
 * hair, natural brown) plus a "paint": a CSS background laid over the image
 * with mix-blend-mode: multiply and masked by the image itself, so the pixel
 * shading of the art survives under any colour or pattern. 96 items, 30 files,
 * all in public-art/items/.
 */
import type { CSSProperties } from "react";

const ART = "/art/items/";

/** Paints, by catalog style name. Colours match Look.tsx KIT_COLOR. */
const PAINT: Record<string, string> = {
  white: "#f7f4ec",
  black: "#3a3a40", // multiply on white: pure black would erase the shading
  navy: "#1B2340",
  grey: "#8b8f9c",
  red: "#C8202F",
  blue: "#2F5DA8",
  yellow: "#F2B705",
  neon: "#b8ff2e",
  grip: "#3f8a3a",
  laurel: "#3f8a3a",
  camo: "radial-gradient(circle at 20% 30%, #3f4a2a 0 18%, transparent 19%), radial-gradient(circle at 70% 60%, #6b7a3a 0 22%, transparent 23%), radial-gradient(circle at 40% 80%, #2f3a20 0 15%, transparent 16%), #5b6b3a",
  carbon: "repeating-linear-gradient(45deg, #2b2f3a 0 3px, #454b5c 3px 6px)",
  hooped: "repeating-linear-gradient(180deg, #C8202F 0 16%, #f7f4ec 16% 32%)",
  striped: "repeating-linear-gradient(90deg, #C8202F 0 16%, #f7f4ec 16% 32%)",
  checked: "repeating-conic-gradient(#1B2340 0 25%, #f7f4ec 0 50%) 0 0 / 22% 22%",
  "two-tone": "linear-gradient(90deg, #ff7a1a 50%, #f7f4ec 50%)",
  tifo: "repeating-linear-gradient(90deg, #C8202F 0 25%, #F2B705 25% 50%, #2F5DA8 50% 75%, #f7f4ec 75% 100%)",
  gold: "linear-gradient(180deg, #FFE45C, #F2B705 55%, #C98A00)",
  chrome: "linear-gradient(180deg, #ffffff, #9aa3b2 45%, #e8ecf2 60%, #7d8696)",
  galaxy: "radial-gradient(circle at 30% 30%, #fff 0 2%, transparent 3%), radial-gradient(circle at 70% 55%, #fff 0 2%, transparent 3%), linear-gradient(135deg, #2a1466, #8a3fd1 50%, #3B9BFF)",
  flame: "linear-gradient(0deg, #E8461A, #FF9A1F 55%, #FFE45C)",
  platinum: "#f1ead2",
  natural: "transparent",
};

type Art = { file: string; paint: string };

const plain = (file: string) => (paint: string): Art => ({ file, paint });

/** kind -> style -> art. */
const MAP: Record<string, Record<string, Art>> = {
  hair: {
    short: { file: "item-hair-short.png", paint: "natural" },
    buzz: { file: "item-hair-buzz.png", paint: "natural" },
    "side-part": { file: "item-hair-undercut.png", paint: "natural" },
    curls: { file: "item-hair-curls.png", paint: "natural" },
    ponytail: { file: "item-hair-ponytail.png", paint: "natural" },
    bun: { file: "item-hair-bun.png", paint: "natural" },
    mohawk: { file: "item-hair-mohawk.png", paint: "natural" },
    afro: { file: "item-hair-afro.png", paint: "natural" },
    dreads: { file: "item-hair-dreads.png", paint: "natural" },
    bleached: { file: "item-hair-spiky.png", paint: "platinum" },
    "flat-top": { file: "item-hair-flattop.png", paint: "natural" },
    fire: { file: "item-hair-fire.png", paint: "natural" },
  },
  boots: {
    ...Object.fromEntries(["black", "white", "navy", "red", "blue", "yellow"].map((s) => [s, plain("item-boots-classic.png")(s)])),
    neon: { file: "item-boots-lightning.png", paint: "neon" },
    "two-tone": { file: "item-boots-retro.png", paint: "two-tone" },
    camo: { file: "item-boots-sock.png", paint: "camo" },
    gold: { file: "item-boots-wings.png", paint: "gold" },
    chrome: { file: "item-boots-wings.png", paint: "chrome" },
    galaxy: { file: "item-boots-flame.png", paint: "galaxy" },
  },
  band: {
    ...Object.fromEntries(["white", "black", "navy", "red", "blue", "yellow"].map((s) => [s, plain("item-band-thin.png")(s)])),
    striped: { file: "item-band-zigzag.png", paint: "red" },
    checked: { file: "item-band-bandana.png", paint: "checked" },
    tifo: { file: "item-band-star.png", paint: "tifo" },
    gold: { file: "item-band-terry.png", paint: "gold" },
    laurel: { file: "item-band-laurel.png", paint: "laurel" },
    flame: { file: "item-band-tails.png", paint: "flame" },
  },
};
// Kit items: one base each (GUS N21), painted with the style name.
for (const kind of ["socks", "pads", "gloves", "wrist", "tape"]) {
  MAP[kind] = new Proxy({} as Record<string, Art>, {
    get: (_, style: string) => ({ file: `item-${kind}.png`, paint: style }),
  });
}

export function itemArt(id: string): Art | undefined {
  const [kind, style] = id.split(".") as [string, string];
  return MAP[kind]?.[style];
}

/** The item as an image, painted. Size is the box; the art is contained. */
export function ItemArt({ id, size = 64, title }: { id: string; size?: number; title?: string }) {
  const art = itemArt(id);
  if (!art) return null;
  const url = `${ART}${art.file}`;
  const mask: CSSProperties = {
    maskImage: `url(${url})`,
    WebkitMaskImage: `url(${url})`,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  };
  const paint = PAINT[art.paint] ?? art.paint;
  return (
    <span role="img" aria-label={title ?? id} title={title} style={{ position: "relative", display: "inline-block", width: size, height: size }}>
      <img src={url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
      {paint !== "transparent" && (
        <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: paint, mixBlendMode: "multiply", ...mask }} />
      )}
    </span>
  );
}

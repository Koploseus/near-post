/**
 * The kit's illustrations, for hero moments only: heroes in club colours, the
 * drill cabinets, the AI coaches' portraits. Everything else stays drawn in code.
 */
import { useEffect, useState } from "react";
import { recolorKitUrl } from "./recolor.js";

type Pose = "idle" | "cheer" | "kick" | "back";
const cache = new Map<string, Promise<string>>();

/** A hero illustration with the shirt in a club colour (default red when no club). */
export function HeroArt({ pose = "idle", color, className, alt = "" }: { pose?: Pose; color?: string; className?: string; alt?: string }) {
  const plain = `/art/heroes/hero-${pose}.png`;
  const [src, setSrc] = useState(color ? "" : plain);
  useEffect(() => {
    if (!color) return setSrc(plain);
    const key = `${pose}:${color}`;
    if (!cache.has(key)) cache.set(key, recolorKitUrl(`/art/heroes/hero-${pose}-keyblue.png`, color).catch(() => plain));
    let live = true;
    void cache.get(key)!.then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [pose, color, plain]);
  return src ? <img className={className} src={src} alt={alt} draggable={false} /> : <span className={className} aria-hidden="true" />;
}

/** One arcade cabinet per drill (relay/src/drill.ts: physical plays penalties). */
const CABINET: Record<string, string> = {
  shooting: "penalties",
  physical: "penalties",
  passing: "throughballs",
  dribbling: "dribble",
  pace: "sprint",
  defending: "tackles",
};
const SCREEN: Record<string, string> = { penalties: "bg-penalty", throughballs: "bg-pitch-topdown" };

export function Cabinet({ skill, className }: { skill: string; className?: string }) {
  const c = CABINET[skill] ?? "penalties";
  const behind = SCREEN[c];
  return (
    <span className={`cabinet ${className ?? ""}`} aria-hidden="true">
      {behind && <img className="cabinet-screen" src={`/art/bg/${behind}.webp`} alt="" />}
      <img className="cabinet-body" src={`/art/cabinets/cabinet-${c}.png`} alt="" />
    </span>
  );
}

const COACHES = ["edith", "bruno", "theo", "amara"];
/** The same AI coach always gets the same portrait. */
export function CoachFace({ id, size = 44 }: { id: string; size?: number }) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <img className="coach-face" src={`/art/coaches/coach-${COACHES[h % COACHES.length]}.webp`} alt="" width={size} height={size} />;
}

const ONE_G = 1_000_000n;

/** "1.8M G", "400k G", "12 G" from a 6-decimal U128 string. */
export function g(amount: string | bigint): string {
  const whole = Number(BigInt(amount) / ONE_G);
  if (whole >= 1e9) return `${(whole / 1e9).toFixed(2)}B G`;
  if (whole >= 1e6) return `${(whole / 1e6).toFixed(whole >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M G`;
  if (whole >= 1e3) return `${Math.round(whole / 1e3)}k G`;
  return `${whole} G`;
}

export const minute = (m: number) => (m > 90 ? `90+${m - 90}'` : `${m}'`);

/** "rive-nord" from "rive-nord.near-post.testnet". */
export const short = (account: string) => account.split(".")[0] ?? account;

export const positionLabel: Record<string, string> = { Gk: "GK", Df: "DF", Mf: "MF", Fw: "FW" };

/** Card tiers by rating out of 100: bronze, silver from 65, gold from 75. */
export const tier = (overall: number) => (overall >= 75 ? "gold" : overall >= 65 ? "silver" : "bronze");

/** The six skills in card order, with their three-letter labels. */
export const SKILLS = [
  ["pace", "PAC", "Pace"],
  ["shooting", "SHO", "Shooting"],
  ["passing", "PAS", "Passing"],
  ["dribbling", "DRI", "Dribbling"],
  ["defending", "DEF", "Defending"],
  ["physical", "PHY", "Physical"],
] as const;

const PREFIX = /^(FC|AS|US|SC|AC|Olympique|Racing|Stade|Union|Sporting|Athletic|Etoile|Entente|Real)\s+(des\s+|de\s+|du\s+)?/i;

const SUFFIX = /\s+(FC|AFC|SC)$/i;

/** A club's short name, as people say it: "FC Port-Lune" → "Port-Lune", "Moonhaven FC" → "Moonhaven". */
export function clubName(name: string): string {
  const s = name.replace(PREFIX, "").replace(SUFFIX, "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

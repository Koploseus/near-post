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

/** Gold from 75, like the sticker album. */
export const tier = (attack: number, defence: number) => (Math.max(attack, defence) >= 75 ? "gold" : "silver");

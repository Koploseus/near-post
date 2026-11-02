import { createHash } from "node:crypto";

/**
 * The demo crowd: fan accounts that share one key, so the relay can seat
 * them. Each match day a club gets a mood (how many of its fans come) and
 * each fan an arrival time, both from a hash of the day: deterministic, no
 * state to keep, and some stands fill up while others stay half empty.
 */
export interface CrowdClub {
  club: string;
  fans: string[];
}

/** "rive-nord:5,port-lune:4" → clubs `<name>.<parent>`, fans `<name>-f<n>.<parent>`. */
export function parseCrowd(spec: string | undefined, parent: string): CrowdClub[] {
  if (!spec) return [];
  return spec.split(",").map((part) => {
    const [name, n] = part.trim().split(":");
    const size = Number(n);
    if (!name || !/^[a-z\d-]+$/.test(name) || !Number.isInteger(size) || size < 1 || size > 50) {
      throw new Error(`CROWD: bad entry "${part}"`);
    }
    return { club: `${name}.${parent}`, fans: Array.from({ length: size }, (_, i) => `${name}-f${i + 1}.${parent}`) };
  });
}

/** A number in [0, 1) from the parts. */
export function unit(...parts: (string | number)[]): number {
  return createHash("sha256").update(parts.join(":")).digest().readUInt32BE(0) / 2 ** 32;
}

/**
 * Fans of `c` who should be in the stand on `day` at `progress` (0 at the
 * start of the match day, 1 at kick-off). Only every `every`-th day has a
 * crowd, to keep the league's storage bill low.
 */
export function seatedBy(c: CrowdClub, day: number, progress: number, every: number): string[] {
  if (every < 1 || day % every !== 0) return [];
  const mood = 0.3 + 0.7 * unit(c.club, day); // 30% to 100% of the crowd comes
  return c.fans.filter((f) => unit(f, day, "comes") < mood && progress >= 0.8 * unit(f, day, "arrives"));
}

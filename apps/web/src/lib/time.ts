import { RELAY } from "./config.js";

/**
 * The relay's clock, so every viewer reveals a match at the same instant
 * whatever the clock of his device says. The offset is measured a few times
 * and the round trip with the least delay wins.
 */
let offset = 0;
let best = Number.POSITIVE_INFINITY;

export const serverNow = () => Date.now() + offset;

export async function syncClock(samples = 3): Promise<void> {
  for (let i = 0; i < samples; i++) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${RELAY}/v1/time`, { cache: "no-store" });
      const t1 = Date.now();
      const { now } = (await r.json()) as { now: number };
      if (typeof now === "number" && t1 - t0 < best) {
        best = t1 - t0;
        offset = now - (t0 + t1) / 2;
      }
    } catch {
      return; // no relay: the device clock it is
    }
  }
}

/** When each half of a match day really kicked off (null: use the schedule). */
export interface Kickoffs {
  first: number | null;
  second: number | null;
}

export async function kickoffsOf(day: number): Promise<Kickoffs> {
  try {
    const r = await fetch(`${RELAY}/v1/kickoffs/${day}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as Kickoffs) : { first: null, second: null };
  } catch {
    return { first: null, second: null };
  }
}

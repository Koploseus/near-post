import type { Chain } from "./chain.js";

/** One tick: plays the match day if it is due. Returns the tx hash if it did. */
export async function tick(chain: Chain, leagueId: string, nowMs = Date.now()): Promise<string | null> {
  const s = await chain.view<{ next_match_at_ms: string }>(leagueId, "schedule");
  if (nowMs < Number(s.next_match_at_ms)) return null;
  return chain.call(leagueId, "play_match_day", {}, 300);
}

/** Checks every `everyMs`; anyone else may play a match day first, that is fine. */
export function startScheduler(chain: Chain, leagueId: string, everyMs = 30_000) {
  const run = () =>
    tick(chain, leagueId)
      .then((tx) => tx && console.log(`match day played: ${tx}`))
      .catch((e) => console.error(`match day not played: ${e instanceof Error ? e.message : e}`));
  void run();
  return setInterval(run, everyMs);
}

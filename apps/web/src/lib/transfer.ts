// A footballer who changed club while his person was away: the app tells him when he comes back.
// What it knew last is kept in this browser, by account; nothing here is needed for the game to work.

const KEY = "np:club:";

/** The club this browser last saw the account's footballer at ("" for a free agent), or null if it never looked. */
export function lastClub(account: string): string | null {
  try {
    return localStorage.getItem(KEY + account);
  } catch {
    return null;
  }
}

export function rememberClub(account: string, club: string): void {
  try {
    localStorage.setItem(KEY + account, club);
  } catch {
    /* a private window: the news is just not shown next time */
  }
}

/**
 * Whether there is a move to announce: he was at a club, and he is at another one now.
 * A free agent who signs did it himself a moment ago, and a contract that ends is no transfer.
 */
export function moved(before: string | null, now: string): boolean {
  return !!before && !!now && before !== now;
}

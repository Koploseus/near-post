/**
 * The social side of a club: who is online and the team wall.
 *
 * Both are off chain and signed: a player signs with a key of his account
 * (checked on chain, then cached), so nobody can be online or post in his
 * name. Posting on a wall also needs the footballer to play for that club.
 * The wall is kept as one JSON file (a Fly volume in production); presence
 * lives in memory only, it is two minutes deep anyway.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Seen within this long: online. The browser says it is here every minute. */
export const ONLINE_MS = 2 * 60_000;
/** Posts a club's wall keeps (the oldest go). */
export const WALL_KEEP = 100;
/** Longest post, in characters. */
export const WALL_MAX = 200;

export interface WallPost {
  id: number;
  account: string;
  token_id: string;
  name: string;
  text: string;
  at: number;
  /** Said by one of the AI agents (the club's coach, or a footballer it plays): from its journal. */
  ai?: "coach" | "footballer";
}

/**
 * A post as typed, made safe to keep and show: control characters out,
 * runs of spaces folded, trimmed. Null when nothing is left or it is too long.
 */
export function cleanPost(text: string): string | null {
  const t = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || [...t].length > WALL_MAX) return null;
  return t;
}

export class Presence {
  private seen = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  here(account: string) {
    this.seen.set(account, this.now());
  }

  /** Of these accounts, the ones online now. */
  online(accounts: string[]): string[] {
    const t = this.now();
    return accounts.filter((a) => t - (this.seen.get(a) ?? 0) < ONLINE_MS);
  }

  /** How many players are online now (and forget the ones long gone). */
  count(): number {
    const t = this.now();
    let n = 0;
    for (const [a, at] of this.seen) {
      if (t - at < ONLINE_MS) n += 1;
      else if (t - at > 10 * ONLINE_MS) this.seen.delete(a);
    }
    return n;
  }
}

export class Walls {
  private data: Record<string, WallPost[]> = {};
  private next = 1;

  constructor(private file: string | null) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, WallPost[]>;
      this.next = 1 + Math.max(0, ...Object.values(this.data).flatMap((ps) => ps.map((p) => p.id)));
    } catch {
      this.data = {};
    }
  }

  /** Newest first. */
  of(club: string, limit = 50): WallPost[] {
    return (this.data[club] ?? []).slice(-limit).reverse();
  }

  add(club: string, post: Omit<WallPost, "id">): WallPost {
    const p = { id: this.next++, ...post };
    this.data[club] = [...(this.data[club] ?? []), p].slice(-WALL_KEEP);
    this.save();
    return p;
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/**
 * Remembers what was already checked on chain for a while: that a key is on
 * an account, and which footballer an account plays. A heartbeat a minute per
 * player must not cost an RPC call a minute per player.
 */
export class Memo<T> {
  private kept = new Map<string, { value: T; until: number }>();

  constructor(
    private ttlMs: number,
    private now: () => number = Date.now,
  ) {}

  /** The value for `key`, loaded when not kept; `keep` says which answers are worth keeping. */
  async get(key: string, load: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
    const k = this.kept.get(key);
    if (k && k.until > this.now()) return k.value;
    const value = await load();
    if (!keep(value)) return value;
    this.kept.set(key, { value, until: this.now() + this.ttlMs });
    if (this.kept.size > 20_000) this.kept.clear();
    return value;
  }
}

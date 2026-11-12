/**
 * People, off chain: friends, private messages, the terrace (one chat for the
 * whole league) and duels (two players, the same drill, the better score).
 *
 * Nothing here is a rule of the game: no G, no rating and no payout reads it,
 * and a duel has no stake. Every write is signed with a key of the account
 * (see app.ts), so nobody speaks, befriends or plays in someone else's name.
 * Kept as one JSON file (a Fly volume in production).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Skill } from "./drill.js";

/** Messages a thread keeps, and the terrace. */
export const THREAD_KEEP = 100;
export const CHAT_KEEP = 150;
/** Friends and pending requests an account can have. */
export const FRIENDS_MAX = 100;
/** A duel nobody finished is dropped after a day. */
export const DUEL_TTL_MS = 24 * 60 * 60_000;
/** Duels kept in the file (the oldest go). */
export const DUELS_KEEP = 2000;
/** Every duel is played at the same level, whoever plays: only the hands count. */
export const DUEL_LEVEL = 50;

export interface Message {
  id: number;
  from: string;
  text: string;
  at: number;
}

export interface ChatLine {
  id: number;
  account: string;
  token_id: string;
  name: string;
  text: string;
  at: number;
}

export interface Duel {
  id: number;
  from: string;
  to: string;
  skill: Skill;
  seed: string;
  at: number;
  /** Hits by account, once each has played. */
  hits: Record<string, number>;
  rounds: number;
}

export interface ThreadHead {
  with: string;
  last: Message;
  unread: number;
}

interface Data {
  friends: Record<string, string[]>;
  /** to -> the accounts that asked. */
  requests: Record<string, string[]>;
  threads: Record<string, Message[]>;
  /** account -> other -> the last message id he read. */
  read: Record<string, Record<string, number>>;
  friendsOnly: Record<string, boolean>;
  chat: ChatLine[];
  duels: Duel[];
  next: number;
}

const empty = (): Data => ({ friends: {}, requests: {}, threads: {}, read: {}, friendsOnly: {}, chat: [], duels: [], next: 1 });
const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Who won a duel both have played: the account, or null for a draw. */
export function duelWinner(d: Duel): string | null | undefined {
  const a = d.hits[d.from];
  const b = d.hits[d.to];
  if (a === undefined || b === undefined) return undefined;
  return a === b ? null : a > b ? d.from : d.to;
}

export class People {
  private data: Data = empty();

  constructor(
    private file: string | null,
    private now: () => number = Date.now,
  ) {
    if (!file) return;
    try {
      this.data = { ...empty(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<Data>) };
    } catch {
      this.data = empty();
    }
  }

  // ---- Friends ----

  friendsOf(a: string): string[] {
    return this.data.friends[a] ?? [];
  }

  requestsTo(a: string): string[] {
    return this.data.requests[a] ?? [];
  }

  areFriends(a: string, b: string): boolean {
    return this.friendsOf(a).includes(b);
  }

  /** Asks `to` to be friends. When he had asked first, they are friends at once. */
  ask(from: string, to: string): "asked" | "friends" | "already" | "full" | "self" {
    if (from === to) return "self";
    if (this.areFriends(from, to)) return "already";
    if (this.requestsTo(from).includes(to)) return this.accept(from, to) ? "friends" : "full";
    const asked = this.requestsTo(to);
    if (asked.includes(from)) return "already";
    if (asked.length >= FRIENDS_MAX) return "full";
    this.data.requests[to] = [...asked, from];
    this.save();
    return "asked";
  }

  /** `me` says yes to `from`'s request. */
  accept(me: string, from: string): boolean {
    if (!this.requestsTo(me).includes(from)) return false;
    if (this.friendsOf(me).length >= FRIENDS_MAX || this.friendsOf(from).length >= FRIENDS_MAX) return false;
    this.data.requests[me] = this.requestsTo(me).filter((a) => a !== from);
    this.data.friends[me] = [...this.friendsOf(me), from];
    this.data.friends[from] = [...this.friendsOf(from), me];
    this.save();
    return true;
  }

  decline(me: string, from: string) {
    this.data.requests[me] = this.requestsTo(me).filter((a) => a !== from);
    this.save();
  }

  unfriend(me: string, other: string) {
    this.data.friends[me] = this.friendsOf(me).filter((a) => a !== other);
    this.data.friends[other] = this.friendsOf(other).filter((a) => a !== me);
    this.save();
  }

  // ---- Private messages ----

  friendsOnly(a: string): boolean {
    return this.data.friendsOnly[a] ?? false;
  }

  setFriendsOnly(a: string, on: boolean) {
    this.data.friendsOnly[a] = on;
    this.save();
  }

  /** Whether `from` may write to `to`: always a friend, anyone unless `to` said friends only. */
  mayWrite(from: string, to: string): boolean {
    return from !== to && (this.areFriends(from, to) || !this.friendsOnly(to));
  }

  send(from: string, to: string, text: string): Message {
    const m = { id: this.data.next++, from, text, at: this.now() };
    const k = pair(from, to);
    this.data.threads[k] = [...(this.data.threads[k] ?? []), m].slice(-THREAD_KEEP);
    this.markRead(from, to, m.id);
    this.save();
    return m;
  }

  /** The thread between two accounts, oldest first; reading it marks it read. */
  thread(me: string, other: string): Message[] {
    const ms = this.data.threads[pair(me, other)] ?? [];
    const last = ms[ms.length - 1];
    if (last && (this.data.read[me]?.[other] ?? 0) < last.id) {
      this.markRead(me, other, last.id);
      this.save();
    }
    return ms;
  }

  private markRead(me: string, other: string, id: number) {
    this.data.read[me] = { ...(this.data.read[me] ?? {}), [other]: id };
  }

  /** Every thread of an account, the most recent first, with what he has not read. */
  threadsOf(me: string): ThreadHead[] {
    const out: ThreadHead[] = [];
    for (const [k, ms] of Object.entries(this.data.threads)) {
      const [a, b] = k.split("|") as [string, string];
      if (a !== me && b !== me) continue;
      const other = a === me ? b : a;
      const last = ms[ms.length - 1];
      if (!last) continue;
      const seen = this.data.read[me]?.[other] ?? 0;
      out.push({ with: other, last, unread: ms.filter((m) => m.id > seen && m.from !== me).length });
    }
    return out.sort((x, y) => y.last.at - x.last.at);
  }

  // ---- The terrace ----

  /** Newest first. */
  chat(limit = 60): ChatLine[] {
    return this.data.chat.slice(-limit).reverse();
  }

  say(line: Omit<ChatLine, "id" | "at">): ChatLine {
    const l = { id: this.data.next++, at: this.now(), ...line };
    this.data.chat = [...this.data.chat, l].slice(-CHAT_KEEP);
    this.save();
    return l;
  }

  // ---- Duels ----

  /** A new duel, unless these two have one open already. */
  duel(from: string, to: string, skill: Skill, seed: string, rounds: number): Duel | null {
    if (from === to) return null;
    const t = this.now();
    const open = this.data.duels.find((d) => pair(d.from, d.to) === pair(from, to) && duelWinner(d) === undefined && t - d.at < DUEL_TTL_MS);
    if (open) return null;
    const d: Duel = { id: this.data.next++, from, to, skill, seed, at: t, hits: {}, rounds };
    this.data.duels = [...this.data.duels, d].slice(-DUELS_KEEP);
    this.save();
    return d;
  }

  duelById(id: number): Duel | null {
    return this.data.duels.find((d) => d.id === id) ?? null;
  }

  /** Records a player's score, once. */
  score(id: number, account: string, hits: number): Duel | null {
    const d = this.duelById(id);
    if (!d || (d.from !== account && d.to !== account) || d.hits[account] !== undefined) return null;
    if (this.now() - d.at >= DUEL_TTL_MS) return null;
    d.hits[account] = hits;
    this.save();
    return d;
  }

  /** An account's duels, newest first: the open ones still in time, and the last finished ones. */
  duelsOf(me: string, limit = 20): Duel[] {
    const t = this.now();
    return this.data.duels
      .filter((d) => (d.from === me || d.to === me) && (duelWinner(d) !== undefined || t - d.at < DUEL_TTL_MS))
      .slice(-limit)
      .reverse();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

/** What a footballer is worth on the market, in G: a guide, not a price. It grows with his rating and his goals. */
export function valueOf(p: { overall: number; goals: number }): number {
  const base = 50_000 * 1.12 ** (p.overall - 40);
  const scorer = 1 + Math.min(p.goals, 50) / 50;
  return Math.max(1_000, Math.round((base * scorer) / 1_000) * 1_000);
}

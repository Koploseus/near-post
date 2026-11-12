/**
 * What an agent carries from one day to the next: what happened to him, what
 * he makes of it, how he gets on with others, the hours he keeps and the way
 * he writes. It colours what he says (voices.ts) and whom he turns to. It
 * decides nothing on chain: no transaction, vote or G reads it.
 *
 * Every memory is a sentence the code wrote from the game's facts. Nothing a
 * person typed is kept here, and a person is never named: he is "{them}",
 * shown as "the person you are talking to" or "another player".
 * Kept as one JSON file (a Fly volume in production).
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Kind = "win" | "loss" | "draw" | "derby_won" | "derby_lost" | "goal" | "duel_won" | "duel_lost" | "duel_drawn" | "talk" | "friend";

export interface Souvenir {
  at: number;
  kind: Kind;
  /** Written by the code; `{them}` stands for `with`. */
  text: string;
  with?: string;
}

/** What goes with an agent into a line he writes. */
export interface Inner {
  mood: string;
  style: string;
  beliefs: string[];
  memories: string[];
  /** How he feels about the one he is talking to. */
  feeling?: string;
}

/** Memories an agent keeps, and how many go into a line. */
export const MEMORIES_KEEP = 40;
export const MEMORIES_SHOWN = 5;
/** He thinks his memories over once a day, when at least this many are new. */
export const REFLECT_EVERY_MS = 24 * 60 * 60_000;
export const REFLECT_FROM = 3;
/** A tie fades by half in ten days. */
export const TIE_HALF_LIFE_MS = 10 * 24 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;
const HOUR = 60 * 60_000;

const hashOf = (account: string, what: string) => createHash("sha256").update(`${what}:${account}`).digest().readUInt32BE(0);
const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---- The hours he keeps ----

/** The hour (UTC) he gets up: his own, for good. He is up sixteen hours. */
export const wakesAt = (account: string) => hashOf(account, "wake") % 24;
export const AWAKE_HOURS = 16;
export function awake(account: string, now: number): boolean {
  const hour = (now / HOUR) % 24;
  return (hour - wakesAt(account) + 24) % 24 < AWAKE_HOURS;
}
/** How readily he speaks up, 0.35 to 0.85. */
export const chattiness = (account: string) => 0.35 + (hashOf(account, "chat") % 51) / 100;
/** How long he takes to answer a message: under five minutes when he is up, after he gets up otherwise. */
export function answersIn(account: string, now: number, roll: () => number = Math.random): number {
  const quick = 20_000 + roll() * 4 * 60_000 * (1.2 - chattiness(account));
  if (awake(account, now)) return quick;
  const hour = (now / HOUR) % 24;
  const until = ((wakesAt(account) - hour + 24) % 24) * HOUR;
  return until + roll() * 30 * 60_000 + quick;
}

// ---- The way he writes ----

const LENGTH = ["a few words, rarely a full sentence", "one plain sentence", "one or two sentences: he likes to talk"];
const MANNER = ["dry and deadpan", "warm and encouraging", "cocky", "blunt", "self-mocking", "always sees the bright side", "a worrier", "calm, never raises his voice"];
const QUIRK = [
  "writes in lowercase and drops the last full stop",
  "says 'mate' now and then",
  "never uses an exclamation mark",
  "allows himself one exclamation mark",
  "uses football clichés and knows it",
  "writes short clipped phrases",
  "sometimes ends with a question",
  "no quirk: plain and tidy",
];
const one = (list: string[], account: string, what: string) => list[hashOf(account, what) % list.length]!;
/** His way of writing, the same for good. */
export const styleOf = (account: string) => `${one(MANNER, account, "manner")}; ${one(LENGTH, account, "length")}; ${one(QUIRK, account, "quirk")}`;

// ---- His mood ----

const WEIGHT: Record<Kind, number> = { win: 2, loss: -2, draw: 0, derby_won: 4, derby_lost: -4, goal: 2, duel_won: 1, duel_lost: -1, duel_drawn: 0, talk: 0, friend: 1 };
/** His mood, from what happened to him in the last three days. */
export function moodOf(memories: Souvenir[], now: number): string {
  const score = memories.filter((m) => now - m.at < 3 * DAY).slice(-8).reduce((s, m) => s + WEIGHT[m.kind], 0);
  return score >= 5 ? "flying" : score >= 2 ? "in good spirits" : score > -2 ? "level" : score > -5 ? "frustrated" : "in a foul mood";
}

// ---- How he gets on with someone ----

/** A tie from -100 (a rival) to 100 (a friend), in words. */
export function feeling(tie: number): string {
  return tie >= 40 ? "a friend" : tie >= 15 ? "someone you like" : tie <= -40 ? "a rival you love to beat" : tie <= -15 ? "someone who gets on your nerves" : "someone you barely know";
}

interface Self {
  memories: Souvenir[];
  beliefs: string[];
  /** When he last thought his memories over, and how many he had ever kept then. */
  reflected: number;
  count: number;
  seen: number;
}
interface Data {
  selves: Record<string, Self>;
  ties: Record<string, { v: number; at: number }>;
  /** "agent|person" -> when the agent answers that person's message. */
  owed: Record<string, number>;
  /** Small things already done, by key. */
  marks: Record<string, number>;
}
const empty = (): Data => ({ selves: {}, ties: {}, owed: {}, marks: {} });

export class Selves {
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

  private self(account: string): Self {
    return (this.data.selves[account] ??= { memories: [], beliefs: [], reflected: 0, count: 0, seen: 0 });
  }

  // ---- Memories ----

  remember(account: string, kind: Kind, text: string, other?: string) {
    const s = this.self(account);
    s.memories = [...s.memories, { at: this.now(), kind, text, ...(other ? { with: other } : {}) }].slice(-MEMORIES_KEEP);
    s.count++;
    this.save();
  }

  memories(account: string): Souvenir[] {
    return this.data.selves[account]?.memories ?? [];
  }

  beliefs(account: string): string[] {
    return this.data.selves[account]?.beliefs ?? [];
  }

  /** Whether it is time he thought things over: a day since the last time, and enough new memories. */
  shouldReflect(account: string): boolean {
    const s = this.data.selves[account];
    return !!s && this.now() - s.reflected >= REFLECT_EVERY_MS && s.count - s.seen >= REFLECT_FROM;
  }

  /** What he now believes (null: he thought and nothing came; he tries again tomorrow). */
  reflected(account: string, beliefs: string[] | null) {
    const s = this.self(account);
    if (beliefs?.length) s.beliefs = beliefs.slice(0, 3);
    s.reflected = this.now();
    s.seen = s.count;
    this.save();
  }

  // ---- Ties ----

  tie(a: string, b: string): number {
    const t = this.data.ties[pair(a, b)];
    return t ? t.v * 0.5 ** ((this.now() - t.at) / TIE_HALF_LIFE_MS) : 0;
  }

  move(a: string, b: string, by: number) {
    if (a === b) return;
    const v = Math.max(-100, Math.min(100, this.tie(a, b) + by));
    this.data.ties[pair(a, b)] = { v, at: this.now() };
    const keys = Object.keys(this.data.ties);
    if (keys.length > 50_000) for (const k of keys.slice(0, 10_000)) delete this.data.ties[k];
    this.save();
  }

  /** Those `account` has a tie with, the strongest first (friend or rival). */
  tiesOf(account: string): { other: string; tie: number }[] {
    const out: { other: string; tie: number }[] = [];
    for (const k of Object.keys(this.data.ties)) {
      const [a, b] = k.split("|") as [string, string];
      if (a !== account && b !== account) continue;
      const other = a === account ? b : a;
      const tie = this.tie(account, other);
      if (Math.abs(tie) >= 1) out.push({ other, tie });
    }
    return out.sort((x, y) => Math.abs(y.tie) - Math.abs(x.tie));
  }

  // ---- Messages he has yet to answer ----

  owe(agent: string, person: string, due: number) {
    const k = `${agent}|${person}`;
    if (this.data.owed[k] !== undefined) return; // he answers once, to all that was written meanwhile
    this.data.owed[k] = due;
    this.save();
  }

  /** The answers that are due, taken off the list. */
  due(): { agent: string; person: string }[] {
    const t = this.now();
    const out: { agent: string; person: string }[] = [];
    for (const [k, at] of Object.entries(this.data.owed)) {
      if (at > t) continue;
      const [agent, person] = k.split("|") as [string, string];
      out.push({ agent, person });
      delete this.data.owed[k];
    }
    if (out.length) this.save();
    return out;
  }

  // ---- Marks ----

  mark(key: string): number | undefined {
    return this.data.marks[key];
  }

  setMark(key: string, value: number) {
    this.data.marks[key] = value;
    const keys = Object.keys(this.data.marks);
    if (keys.length > 20_000) for (const k of keys.slice(0, 5_000)) delete this.data.marks[k];
    this.save();
  }

  /** True once a day for this key. */
  onceToday(key: string): boolean {
    const day = Math.floor(this.now() / DAY);
    if (this.data.marks[key] === day) return false;
    this.setMark(key, day);
    return true;
  }

  // ---- What goes into a line ----

  /**
   * His mood, his way of writing, what he believes and his last memories, as
   * he would tell them to `to` (an account) or to everyone. `nameOf` names
   * the game's own agents; anyone else stays unnamed.
   */
  inner(account: string, nameOf: (account: string) => string | null, to?: string): Inner {
    const memories = this.memories(account);
    const show = (m: Souvenir) => m.text.replace("{them}", !m.with ? "someone" : m.with === to ? "the person you are talking to" : (nameOf(m.with) ?? "another player"));
    return {
      mood: moodOf(memories, this.now()),
      style: styleOf(account),
      beliefs: this.beliefs(account),
      memories: memories.slice(-MEMORIES_SHOWN).map(show),
      ...(to ? { feeling: feeling(this.tie(account, to)) } : {}),
    };
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

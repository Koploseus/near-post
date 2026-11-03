import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Evidence, Signature } from "./brain.js";

/**
 * What the agents did, for everyone to read (GET /v1/agents/...), and what
 * they already did today so a restart does not do it twice. One JSON file
 * (on the Fly volume in production).
 */

export type Act =
  | { what: "formation"; formation: string }
  | { what: "strategy"; strategy: string }
  | { what: "captain_vote"; token_id: string }
  | { what: "bid"; token_id: string; price: number }
  | { what: "sold"; token_id: string; price: number; offer_id: number }
  | { what: "cancelled_bid"; offer_id: number }
  | { what: "pack"; items: string[] }
  | { what: "equipped"; item: string }
  | { what: "joined"; club: string; price: number }
  | { what: "reported" }
  | { what: "collected" }
  | { what: "created"; token_id?: string }
  | { what: "renamed"; name: string }
  | { what: "recalled"; token_id: string }
  | { what: "season_ticket"; club: string; price: number };

export interface Entry {
  at: number;
  day: number;
  agent: string;
  /** tactic: a coach before a half; market: a coach's day; day / half: a footballer's. */
  kind: "tactic" | "market" | "day" | "half" | "setup";
  half?: 1 | 2;
  quote: string;
  source: "model" | "rules";
  /** What the checks refused in the model's answer. */
  refused: string[];
  acts: Act[];
  txs: string[];
  errors: string[];
  evidence: Evidence | null;
  signature: Signature | null;
  /** Only for season ticket holders (the fan zone), never in the public feed. */
  briefing?: string;
}

export interface SeenOffer {
  id: number;
  token_id: string;
  buyer: string;
  price: string;
  state: string;
  match_day: number;
  position?: string;
  overall?: number;
}

interface State {
  done: string[];
  entries: Entry[];
  offers: Record<string, SeenOffer>;
  cursor: number;
}

const MAX_ENTRIES = 4000;
const MAX_DONE = 5000;

export class Journal {
  private s: State = { done: [], entries: [], offers: {}, cursor: 0 };
  private doneSet = new Set<string>();

  constructor(private file: string | null) {
    if (file) {
      try {
        this.s = { ...this.s, ...(JSON.parse(readFileSync(file, "utf8")) as State) };
      } catch {
        // a new journal
      }
    }
    this.doneSet = new Set(this.s.done);
  }

  isDone(key: string) {
    return this.doneSet.has(key);
  }
  markDone(key: string) {
    if (this.doneSet.has(key)) return;
    this.doneSet.add(key);
    this.s.done.push(key);
    if (this.s.done.length > MAX_DONE) {
      for (const k of this.s.done.splice(0, this.s.done.length - MAX_DONE)) this.doneSet.delete(k);
    }
  }

  add(e: Entry) {
    this.s.entries.push(e);
    if (this.s.entries.length > MAX_ENTRIES) this.s.entries.splice(0, this.s.entries.length - MAX_ENTRIES);
  }
  /** Newest first, without what is for season ticket holders. */
  feed(limit = 50, agent?: string, day?: number): Entry[] {
    return this.all(limit, agent, day).map(({ briefing: _, ...e }) => e);
  }

  /** The coaches' briefings for these clubs (the fan zone), newest first. */
  briefings(clubs: string[], limit = 20): Entry[] {
    const out: Entry[] = [];
    for (let i = this.s.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.s.entries[i]!;
      if (e.briefing && clubs.includes(e.agent)) out.push(e);
    }
    return out;
  }

  private all(limit: number, agent?: string, day?: number): Entry[] {
    const out: Entry[] = [];
    for (let i = this.s.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.s.entries[i]!;
      if ((agent && e.agent !== agent) || (day !== undefined && e.day !== day)) continue;
      out.push(e);
    }
    return out;
  }
  /** Entries waiting for NEAR AI Cloud's signature. */
  unsigned(since: number): Entry[] {
    return this.s.entries.filter((e) => e.at >= since && e.evidence?.chat_id && !e.signature);
  }

  get offers() {
    return this.s.offers;
  }
  get cursor() {
    return this.s.cursor;
  }
  set cursor(n: number) {
    this.s.cursor = n;
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.s), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

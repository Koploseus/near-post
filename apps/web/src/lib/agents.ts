import { useEffect, useState } from "react";
import { RELAY } from "./config.js";

/** The AI agents (coaches of the fictional clubs, footballers) and their journal, from the relay. */

export interface AgentInfo {
  kind: "coach" | "footballer";
  account: string;
  name: string;
  style?: "builder" | "gambler" | "careful" | "tactician";
  character?: "leader" | "showman" | "loyal" | "mercenary";
}

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
  | { what: "created" }
  | { what: "renamed"; name: string }
  | { what: "recalled"; token_id: string }
  | { what: "season_ticket"; club: string; price: number }
  | { what: "rested" }
  | { what: "signed"; club: string; days: number }
  | { what: "project_vote"; project: string }
  | { what: "wage"; wage: number }
  | { what: "instruction"; instruction: string }
  | { what: "diet"; diet: string; price: number }
  | { what: "gift"; club: string; amount: number }
  | { what: "recruit_vote"; token_id: string; yes: boolean };

export interface AgentEntry {
  at: number;
  day: number;
  agent: string;
  kind: "tactic" | "market" | "day" | "half" | "setup";
  half?: 1 | 2;
  quote: string;
  source: "model" | "rules";
  refused: string[];
  acts: Act[];
  txs: string[];
  errors: string[];
  evidence: { model: string; chat_id: string | null } | null;
  signature: { matches: boolean; signature_kind: string | null } | null;
}

let roster: Promise<Map<string, AgentInfo>> | null = null;

export function agents(): Promise<Map<string, AgentInfo>> {
  roster ??= fetch(`${RELAY}/v1/agents`)
    .then((r) => (r.ok ? (r.json() as Promise<{ agents: AgentInfo[] }>) : { agents: [] }))
    .then((j) => new Map(j.agents.map((a) => [a.account, a])))
    .catch(() => {
      roster = null;
      return new Map<string, AgentInfo>();
    });
  return roster;
}

/** The agents by account, once loaded (empty before). */
export function useAgents(): Map<string, AgentInfo> {
  const [m, setM] = useState<Map<string, AgentInfo>>(new Map());
  useEffect(() => {
    let live = true;
    void agents().then((a) => live && setM(a));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

export async function agentFeed(opts: { limit?: number; day?: number; agent?: string } = {}): Promise<AgentEntry[]> {
  try {
    if (opts.agent) {
      const r = await fetch(`${RELAY}/v1/agents/${opts.agent}`, { cache: "no-store" });
      return r.ok ? ((await r.json()) as { entries: AgentEntry[] }).entries : [];
    }
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50), ...(opts.day !== undefined ? { day: String(opts.day) } : {}) });
    const r = await fetch(`${RELAY}/v1/agents/feed?${q}`, { cache: "no-store" });
    return r.ok ? ((await r.json()) as { entries: AgentEntry[] }).entries : [];
  } catch {
    return [];
  }
}

export const ROLE: Record<string, string> = {
  builder: "Builder",
  gambler: "Gambler",
  careful: "Careful",
  tactician: "Tactician",
  leader: "Leader",
  showman: "Showman",
  loyal: "Loyal",
  mercenary: "Mercenary",
};

export const roleOf = (a: AgentInfo) => ROLE[a.style ?? a.character ?? ""] ?? "";

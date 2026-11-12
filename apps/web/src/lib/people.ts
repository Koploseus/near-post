import { KeyPair } from "near-api-js";
import type { Click } from "../../../relay/src/drill.js";
import { socialMessage } from "../../../relay/src/vault-message.js";
import { RELAY } from "./config.js";
import type { Session } from "./near.js";
import { serverNow } from "./time.js";

/** A person who plays a footballer, as the relay lists him. */
export interface Person {
  account: string;
  token_id: string;
  name: string;
  position: string;
  overall: number;
  goals: number;
  /** What he is worth on the market, in whole G: a guide, not a price. */
  value: number;
  club: string | null;
  club_name: string | null;
  online?: boolean;
}

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

export type DuelSkill = "pace" | "shooting" | "passing" | "dribbling" | "defending";

export interface Duel {
  id: number;
  skill: DuelSkill;
  at: number;
  rounds: number;
  rival: Person;
  mine: number | null;
  theirs: number | null;
  their_turn_done: boolean;
  result: "won" | "lost" | "draw" | null;
}

export interface Inbox {
  me: Person;
  friends: Person[];
  requests: Person[];
  threads: { with: Person; last: Message; unread: number }[];
  unread: number;
  duels: Duel[];
  friends_only: boolean;
}

export interface Rankings {
  valuable: Person[];
  scorers: Person[];
  richest: { club: string; name: string; treasury: string }[];
  streaks: { club: string; name: string; best_streak: number }[];
}

const WHY: Record<string, string> = {
  too_many_requests: "Slow down a little.",
  no_footballer: "Create your footballer first.",
  no_such_player: "That player is not in the league.",
  friends_only: "He only takes messages from his friends.",
  bad_text: "Between 1 and 200 characters.",
  duel_open: "You two already have a duel to play.",
  already_played: "You already played this duel.",
  duel_over: "This duel is over.",
  implausible: "The relay could not replay that drill.",
  bad_signature: "Sign in again: this browser's key is not on your account.",
};

/** One signed call to the relay: the signature covers the action, who it is for, the id and the text. */
async function act<T>(s: Session, action: string, o: { to?: string; id?: number; text?: string; clicks?: Click[] } = {}): Promise<T> {
  const kp = KeyPair.fromString(s.privateKey as `ed25519:${string}`);
  const ts = Math.round(serverNow());
  const message = socialMessage(s.accountId, ts, action, o.to ?? "", o.id ?? 0, o.text ?? "");
  const r = await fetch(`${RELAY}/v1/people/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account_id: s.accountId,
      public_key: kp.getPublicKey().toString(),
      ts,
      action,
      ...o,
      signature: btoa(String.fromCharCode(...kp.sign(new TextEncoder().encode(message)).signature)),
    }),
  });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(WHY[body.error ?? ""] ?? "Could not reach the relay, try again.");
  return body;
}

const read = async <T,>(path: string, empty: T): Promise<T> => {
  const r = await fetch(`${RELAY}${path}`).catch(() => null);
  return r?.ok ? ((await r.json()) as T) : empty;
};

export const inbox = (s: Session) => act<Inbox>(s, "inbox");
export const threadWith = (s: Session, to: string) => act<{ with: Person; messages: Message[]; may_write: boolean }>(s, "thread", { to });
export const sendMessage = (s: Session, to: string, text: string) => act<{ message: Message }>(s, "message", { to, text });
export const askFriend = (s: Session, to: string) => act<{ state: "asked" | "friends" | "already" | "full" | "self" }>(s, "friend_ask", { to });
export const acceptFriend = (s: Session, to: string) => act<{ ok: boolean }>(s, "friend_accept", { to });
export const declineFriend = (s: Session, to: string) => act<{ ok: boolean }>(s, "friend_decline", { to });
export const removeFriend = (s: Session, to: string) => act<{ ok: boolean }>(s, "friend_remove", { to });
export const setFriendsOnly = (s: Session, on: boolean) => act<{ friends_only: boolean }>(s, "friends_only", { text: on ? "on" : "off" });
export const sayOnTerrace = (s: Session, text: string) => act<{ line: ChatLine }>(s, "say", { text });
export const newDuel = (s: Session, to: string, skill: DuelSkill) => act<{ duel: Duel }>(s, "duel_new", { to, text: skill });
export const startDuel = (s: Session, id: number) => act<{ id: number; seed: string; skill: DuelSkill; level: number }>(s, "duel_start", { id });
export const playDuel = (s: Session, id: number, clicks: Click[]) => act<{ duel: Duel }>(s, "duel_play", { id, clicks });

export const terrace = () => read<{ lines: ChatLine[] }>("/v1/people/chat", { lines: [] }).then((r) => r.lines);
export const searchPeople = (q: string) => read<{ people: Person[] }>(`/v1/people/search?q=${encodeURIComponent(q)}`, { people: [] }).then((r) => r.people);
/** Everyone who plays a footballer, online first: 60 a page. */
export const allPeople = (offset = 0) => read<{ total: number; online: number; people: Person[] }>(`/v1/people/all?offset=${offset}`, { total: 0, online: 0, people: [] });
export const rankings = () => read<Rankings>("/v1/people/rankings", { valuable: [], scorers: [], richest: [], streaks: [] });

/** "1.2M G" from whole G. */
export const wholeG = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M G` : n >= 1e3 ? `${Math.round(n / 1e3)}k G` : `${n} G`);

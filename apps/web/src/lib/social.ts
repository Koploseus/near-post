import { KeyPair } from "near-api-js";
import { useEffect, useState } from "react";
import { presenceMessage, wallMessage, wallReadMessage } from "../../../relay/src/vault-message.js";
import { RELAY } from "./config.js";
import type { Session } from "./near.js";
import { serverNow } from "./time.js";

/** A post on a club's wall. */
export interface WallPost {
  id: number;
  account: string;
  token_id: string;
  name: string;
  text: string;
  at: number;
  /** Said by an AI agent (the club's coach or one of its footballers). */
  ai?: "coach" | "footballer";
}

/** Longest post the relay takes, in characters. */
export const WALL_MAX = 200;

/** Quick shouts: one tap, nothing to type. */
export const SHOUTS = ["Come on! 📣", "Who's in the stand tonight? 🏟️", "What a goal! ⚽", "I'm taking the slot up front", "Full house, lads! 🔥", "Unlucky. Next one is ours."];

const sign = (s: Session, message: string) => {
  const kp = KeyPair.fromString(s.privateKey as `ed25519:${string}`);
  return {
    public_key: kp.getPublicKey().toString(),
    signature: btoa(String.fromCharCode(...kp.sign(new TextEncoder().encode(message)).signature)),
  };
};

/** "I'm here": signed, every minute while the game is open and the tab visible. */
export async function heartbeat(s: Session): Promise<number | null> {
  const ts = Math.round(serverNow());
  const r = await fetch(`${RELAY}/v1/presence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: s.accountId, ts, ...sign(s, presenceMessage(s.accountId, ts)) }),
  }).catch(() => null);
  if (!r?.ok) return null;
  return ((await r.json()) as { online: number }).online;
}

export async function presenceOf(accounts: string[]): Promise<{ count: number; online: string[] }> {
  const r = await fetch(`${RELAY}/v1/presence?accounts=${encodeURIComponent(accounts.slice(0, 60).join(","))}`);
  if (!r.ok) return { count: 0, online: [] };
  return (await r.json()) as { count: number; online: string[] };
}

/** Your club's wall: signed, the relay only shows a dressing room to its own squad. */
export async function wallOf(s: Session, club: string): Promise<WallPost[]> {
  const ts = Math.round(serverNow());
  const r = await fetch(`${RELAY}/v1/clubs/${club}/wall/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: s.accountId, ts, ...sign(s, wallReadMessage(s.accountId, club, ts)) }),
  });
  if (!r.ok) return [];
  return ((await r.json()) as { posts: WallPost[] }).posts;
}

/** Post on your club's wall; the relay checks the signature and that you play for the club. */
export async function postOnWall(s: Session, club: string, text: string): Promise<WallPost> {
  const ts = Math.round(serverNow());
  const r = await fetch(`${RELAY}/v1/clubs/${club}/wall`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account_id: s.accountId, ts, text, ...sign(s, wallMessage(s.accountId, club, ts, text)) }),
  });
  const body = (await r.json().catch(() => ({}))) as { post?: WallPost; error?: string };
  if (!r.ok || !body.post) {
    throw new Error(
      body.error === "too_many_requests"
        ? "Slow down: a few posts a minute."
        : body.error === "not_in_this_club"
          ? "Only this club's players can post here."
          : body.error === "bad_text"
            ? `Between 1 and ${WALL_MAX} characters.`
            : "Could not post, try again.",
    );
  }
  return body.post;
}

/** Keep saying "I'm here" while signed in and the tab is visible; returns how many are online. */
export function useHeartbeat(session: Session | null): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const n = session ? await heartbeat(session) : (await presenceOf([]).catch(() => null))?.count ?? null;
      if (live && n !== null) setCount(n);
    };
    void beat();
    const t = setInterval(() => void beat(), 60_000);
    const onVis = () => void beat();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session]);
  return count;
}

/** Which of these accounts are online now, refreshed every 30 s. */
export function usePresence(accounts: (string | null | undefined)[]): Set<string> {
  const ids = [...new Set(accounts.filter((a): a is string => !!a))].sort();
  const key = ids.join(",");
  const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!ids.length) return;
    let live = true;
    const look = async () => {
      const r = await presenceOf(ids).catch(() => null);
      if (live && r) setOnline(new Set(r.online));
    };
    void look();
    const t = setInterval(() => void look(), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return online;
}

/** "just now", "5 min", "3 h", "2 d". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
}

/**
 * The AI agents of NEAR Post, running by themselves inside an enclave
 * (OutLayer, Intel TDX). One run looks at the league, decides for some of the
 * agents with the same rules as before (apps/relay/src/agents), signs their
 * transactions with keys that exist only here, and sends them.
 *
 * Whoever starts a run chooses when, and which share of the agents it looks
 * at. Nothing else: not what they decide, not where they play (config.ts).
 * The input holds no instruction for an agent and none is read from it.
 */

import "./globals.js";
import { get, set } from "near:storage/api@0.2.0";
import { getEnvironment } from "wasi:cli/environment@0.2.12";
import { getStdin } from "wasi:cli/stdin@0.2.12";
import { getStdout } from "wasi:cli/stdout@0.2.12";
import { Journal } from "../../relay/src/agents/journal.js";
import { roster } from "../../relay/src/agents/roster.js";
import { Agents } from "../../relay/src/agents/runner.js";
import { COACHES, FOOTBALLERS } from "../../relay/src/agents/rules.js";
import nacl from "tweetnacl";
import { base64, text, unbase58, utf8 } from "./bytes.js";
import { askWith } from "../../relay/src/agents/minds.js";
import { GOALARS, LEAGUE, NEAR_AI_MODEL, NEAR_AI_URL, PARENT, PLAYERS, TICKETS, VERSION } from "./config.js";
import { MAX_CALLS, chain, chainOf, keyOf, used } from "./host.js";
import { drain } from "./jobs.js";

/** A run takes no new work past this many requests to the chain: what it started may still need a few. */
const BUSY_FROM = MAX_CALLS - 35;
/** Entries a share's journal keeps here (the relay keeps the long history, for show). */
const KEEP_ENTRIES = 80;

const slugs = [...COACHES.map((c) => c.club), ...FOOTBALLERS.map((f) => f.id)];
/**
 * Every agent's account, by short name. Deriving a key is slow here, and the
 * accounts are public: they are worked out once and kept in storage.
 */
function accounts(): Record<string, string> {
  const [stored, error] = get(`accounts:${VERSION}`);
  if (!error && stored.length) {
    const known = JSON.parse(text(stored)) as Record<string, string>;
    if (slugs.every((s) => known[s])) return known;
  }
  const all = Object.fromEntries(slugs.map((s) => [s, keyOf(s).account]));
  set(`accounts:${VERSION}`, utf8(JSON.stringify(all)));
  return all;
}

function readInput(): { op?: unknown; shard?: unknown; of?: unknown } {
  const stdin = getStdin();
  const parts: number[] = [];
  for (;;) {
    let b: Uint8Array;
    try {
      b = stdin.blockingRead(65536n);
    } catch {
      break;
    }
    if (!b.length) break;
    parts.push(...b);
    if (parts.length > 4096) break;
  }
  try {
    return JSON.parse(text(Uint8Array.from(parts))) as { op?: unknown };
  } catch {
    return {};
  }
}

async function tick(shard: number, of: number) {
  const env = new Map(getEnvironment());
  const started = Date.now();
  // A run that outlives its limit is cut off and loses what it did not store: stop taking work at a third of it.
  const limit = Number(env.get("NEAR_MAX_EXECUTION_SECONDS")) || 60;
  const budget = Math.min(limit * 1000 * 0.35, 40_000);
  const all = roster(PARENT, accounts());
  const mine = all.filter((_, i) => i % of === shard);
  const slugOf = new Map(all.map((a) => [a.account, a.slug]));
  const cell = `journal:${VERSION}:${shard}/${of}`;
  let kept: string | null = null;
  const [stored, error] = get(cell);
  if (!error && stored.length) kept = text(stored);
  let latest = kept;
  const journal = new Journal(null, { read: () => kept, write: (t) => void (latest = t) });
  const before = new Set(journal.entries().map((e) => `${e.agent}:${e.at}:${e.kind}`));
  // The model: NEAR AI Cloud, reached from here with a key this program alone is given (a secret of the project).
  const key = env.get("NEAR_AI_API_KEY") ?? "";
  const brain = key ? { url: NEAR_AI_URL, key, model: NEAR_AI_MODEL, timeoutMs: 30_000 } : null;
  // The league takes a drill's score only signed by its attester. An agent plays his drill here (agents/player.ts),
  // and this program, given that key as a secret, signs the score it replayed itself.
  const attester = env.get("ATTESTER_PRIVATE_KEY")?.startsWith("ed25519:") ? unbase58(env.get("ATTESTER_PRIVATE_KEY")!.slice(8)) : null;
  let clock = started;
  const runner = new Agents(
    {
      chain,
      as: (a) => chainOf(a.slug),
      publicKeyOf: (a) => keyOf(a.slug).publicKey,
      leagueId: LEAGUE,
      goalarsId: GOALARS,
      playersId: PLAYERS,
      ticketsId: TICKETS,
      ask: askWith(brain),
      brain,
      journal,
      concurrency: 1,
      ...(attester ? { attest: (token: string, ticket: number, points: number) => base64(nacl.sign.detached(utf8(`near-post:train:${LEAGUE}:${token}:${ticket}:${points}`), attester)) } : {}),
      // New accounts are welcomed with G that exists already: each coach gives it once, to the account that hands it out.
      welcome: { to: PARENT, amount: 500_000n * 1_000_000n, keep: 400_000n * 1_000_000n },
      // Two entries never share a millisecond, so the relay tells them apart.
      now: () => (clock = Math.max(clock + 1, Date.now())),
      outOfTime: () => used.calls >= BUSY_FROM || Date.now() - started > budget,
    },
    mine,
  );
  await runner.tick();
  journal.save();
  const entries = journal.entries().filter((e) => !before.has(`${e.agent}:${e.at}:${e.kind}`));
  if (latest && latest !== kept) {
    // Keep it small: the last entries, and what was done in the last days.
    const s = JSON.parse(latest) as { done: string[]; entries: { day: number }[]; offers: unknown; cursor: number };
    const day = Math.max(0, ...s.entries.map((e) => e.day));
    s.entries = s.entries.slice(-KEEP_ENTRIES);
    s.done = s.done.filter((k) => !/^(market|tactic|day|half):\d+:/.test(k) || Number(k.split(":")[1]) >= day - 2);
    const failed = set(cell, utf8(JSON.stringify(s)));
    if (failed) throw new Error(`storage: ${failed}`);
  }
  const done = used.calls < BUSY_FROM && Date.now() - started <= budget;
  return { idle: done && entries.length === 0, more: !done, model: brain ? brain.model : null, calls: used.calls, sent: used.sent, ms: Date.now() - started, limit, entries: entries.map((e) => ({ ...e, slug: slugOf.get(e.agent) })) };
}

async function main(): Promise<unknown> {
  const input = readInput();
  if (input.op === "accounts") return { version: VERSION, league: LEAGUE, accounts: accounts() };
  if (input.op === "tick") {
    const of = Math.max(1, Math.min(16, Math.floor(Number(input.of)) || 1));
    const shard = Math.max(0, Math.min(of - 1, Math.floor(Number(input.shard)) || 0));
    return tick(shard, of);
  }
  return { error: "unknown op", ops: ["accounts", "tick"] };
}

export const run = {
  run() {
    let answer: unknown = { error: "the run did not finish" };
    main().then(
      (a) => void (answer = a),
      (e) => void (answer = { error: String((e as Error)?.message ?? e) }),
    );
    drain();
    const logs = (globalThis as unknown as { __log: string[] }).__log.slice(-12).map((l) => l.slice(0, 200));
    // A stream takes what it says it can take, never more than 4096 bytes at a time.
    const bytes = utf8(JSON.stringify({ ...(answer as object), logs }));
    const stdout = getStdout();
    for (let at = 0; at < bytes.length; ) {
      const room = Math.min(4096, Number(stdout.checkWrite()));
      if (room <= 0) {
        stdout.blockingFlush();
        continue;
      }
      stdout.write(bytes.subarray(at, at + room));
      at += room;
    }
    stdout.blockingFlush();
  },
};

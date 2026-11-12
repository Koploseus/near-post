import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Hono } from "hono";
import { KeyPair, PublicKey } from "near-api-js";
import { z } from "zod";
import { type Mailer, Codes, Limiter, accountIdFor, isPlayerAccount, normalizeEmail } from "./auth.js";
import { type Chain, near, transient } from "./chain.js";
import type { Config } from "./config.js";
import { MAX_CLICKS, drill, drillEnd, hits, implausible, points, rounds } from "./drill.js";
import { allowedMethods, decodeSignedDelegate, refuse } from "./gasless.js";
import type { Journal } from "./agents/journal.js";
import type { Agent } from "./agents/roster.js";
import type { Kickoffs } from "./schedule.js";
import { Stats } from "./stats.js";
import { VaultEntry, Vaults, vaultMessage } from "./vault.js";
import { FACE_MAX, Faces } from "./faces.js";
import { faceMessage, fanzoneMessage, presenceMessage, socialMessage, wallMessage, wallReadMessage } from "./vault-message.js";
import { DUEL_LEVEL, People, duelWinner, valueOf } from "./people.js";
import { botDocs, makeToken, readToken } from "./bot.js";
import { Memo, ONLINE_MS, Presence, WALL_MAX, type WallPost, Walls, cleanPost } from "./social.js";

const AccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "not a NEAR account id");

const Start = z.object({ email: z.email().max(254) });
const TokenId = z.string().regex(/^p\d{1,12}$/);
const Attest = z.object({ token_id: TokenId, clicks: z.array(z.unknown()).max(MAX_CLICKS) });

interface Ticket {
  id: number;
  token_id: string;
  skill: "pace" | "shooting" | "passing" | "dribbling" | "defending" | "physical";
  match_day: number;
  seed: string;
}

const Verify = z.object({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/),
  public_key: z.string().startsWith("ed25519:").max(100),
});

export interface Deps {
  /** Passkey backups of players' keys (encrypted in the browser). */
  vaults?: Vaults;
  faces?: Faces;
  /** When each half really kicked off (the scheduler records it). */
  kickoffs?: Kickoffs;
  /** Where the drill scores already signed are kept (a restart must not reopen them). */
  drillsFile?: string | null;
  /** Keep the season stats counted in the background (the first count reads every stand of the season). */
  warmStats?: boolean;
  /** The AI agents and what they did. */
  agents?: { roster: Agent[]; journal: Journal };
  /** The clubs' walls (who is online lives in memory). */
  walls?: Walls;
  /** Friends, private messages, the terrace and duels. */
  people?: People;
  mailer: Mailer;
  codes?: Codes;
  now?: () => number;
}


/**
 * The relay's HTTP API.
 *
 * Email login without custody: the browser makes a key pair and keeps the
 * private key; after the email code, the relay creates the player's NEAR
 * account with that public key and a little NEAR for gas. The relay never
 * holds a player's key, so it can fund and create, but never act for him.
 */
export function createApp(config: Config, chain: Chain, deps: Deps) {
  const app = new Hono();
  const now = deps.now ?? Date.now;
  const vaults = deps.vaults ?? new Vaults(null);
  const faces = deps.faces ?? new Faces(null);
  const codes = deps.codes ?? new Codes(config.CODE_TTL_SECONDS * 1000, 5, now);
  const startByIp = new Limiter(10, 60 * 60_000, now);
  const startByEmail = new Limiter(3, 15 * 60_000, now);
  const verifyByIp = new Limiter(30, 60 * 60_000, now);
  const topups = new Limiter(config.TOPUPS_PER_DAY, 24 * 60 * 60_000, now);
  const funding = near(config.ACCOUNT_FUNDING_NEAR);
  const welcome = BigInt(config.WELCOME_G);
  const welcomes = new Limiter(config.WELCOME_PER_DAY, 24 * 60 * 60_000, now);
  /** The welcome gift for a new account: never blocks the sign-up, says what it gave. */
  const giveWelcome = async (account_id: string): Promise<string | null> => {
    const goalars = config.GOALARS_ID;
    if (welcome === 0n || !goalars || !chain.giveG || !welcomes.allow("all")) return null;
    try {
      return await chain.giveG(goalars, account_id, welcome);
    } catch (e) {
      console.warn(`welcome gift to ${account_id} failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  };
  const ip = (c: { req: { header(name: string): string | undefined } }) =>
    c.req.header(config.CLIENT_IP_HEADER)?.split(",")[0]?.trim() || "local";

  app.get("/health", (c) => c.json({ status: "ok", network: config.NEAR_NETWORK }));

  // ---- Email login ----

  app.post("/v1/auth/start", async (c) => {
    const body = Start.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_email" }, 400);
    const email = normalizeEmail(body.data.email);
    if (!startByIp.allow(ip(c)) || !startByEmail.allow(email)) return c.json({ error: "too_many_requests" }, 429);
    const code = codes.issue(email);
    await deps.mailer.send(
      email,
      `${code} is your NEAR Post code`,
      `Your NEAR Post code is ${code}. It works once, for ${Math.round(config.CODE_TTL_SECONDS / 60)} minutes.`,
    );
    const account_id = accountIdFor(email, config.PARENT_ACCOUNT_ID);
    return c.json(config.INSECURE_DEV_RETURN_CODE ? { sent: true, account_id, code } : { sent: true, account_id });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = Verify.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    if (!verifyByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    try {
      PublicKey.fromString(body.data.public_key);
    } catch {
      return c.json({ error: "invalid_public_key" }, 400);
    }
    if (!codes.verify(body.data.email, body.data.code)) return c.json({ error: "wrong_or_expired_code" }, 401);
    const account_id = accountIdFor(body.data.email, config.PARENT_ACCOUNT_ID);
    if ((await chain.balance(account_id)) !== null) {
      // A returning player: the account exists; his key is in his browser,
      // or in a passkey backup that only his passkey can open.
      const key_on_account = await chain.hasKey(account_id, body.data.public_key);
      const backups = vaults.get(account_id).map(({ credential_id, salt, iv, ciphertext }) => ({ credential_id, salt, iv, ciphertext }));
      return c.json({ account_id, created: false, key_on_account, vaults: key_on_account ? [] : backups, passkeys: backups.length });
    }
    const tx = await chain.createAccount(account_id, body.data.public_key, funding);
    const welcome_tx = await giveWelcome(account_id);
    return c.json({ account_id, created: true, tx, ...(welcome_tx ? { welcome: welcome.toString(), welcome_tx } : {}) });
  });

  // ---- Passkey backups ----
  //
  // Stored only when signed with a key of that account (so nobody can plant
  // a backup for someone else), handed back only after the email code.

  const backupsByIp = new Limiter(20, 60 * 60_000, now);
  app.post("/v1/vault", async (c) => {
    const body = VaultEntry.extend({
      account_id: AccountId,
      public_key: z.string().startsWith("ed25519:"),
      ts: z.number().int(),
      signature: z.string().min(40).max(200),
    }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    if (!backupsByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    const { account_id, public_key, ts, signature, ...entry } = body.data;
    if (!isPlayerAccount(account_id, config.PARENT_ACCOUNT_ID)) return c.json({ error: "not_a_player_account" }, 400);
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    let ok = false;
    try {
      ok = PublicKey.fromString(public_key).verify(new TextEncoder().encode(vaultMessage(account_id, ts, entry)), Buffer.from(signature, "base64"));
    } catch {
      ok = false;
    }
    if (!ok || !(await chain.hasKey(account_id, public_key))) return c.json({ error: "bad_signature" }, 401);
    vaults.put(account_id, { ...entry, created_ms: now() });
    return c.json({ account_id, passkeys: vaults.get(account_id).length });
  });

  app.get("/v1/vault/:accountId", (c) => {
    const id = AccountId.safeParse(c.req.param("accountId"));
    if (!id.success) return c.json({ error: "invalid_account_id" }, 400);
    return c.json({ passkeys: vaults.get(id.data).length });
  });

  // ---- Faces: how each footballer looks (a drawing choice, not a rule) ----

  app.get("/v1/faces", (c) => c.json({ faces: faces.all() }));

  const facesByIp = new Limiter(30, 60 * 60_000, now);
  app.post("/v1/faces", async (c) => {
    const body = z
      .object({ account_id: AccountId, public_key: z.string().startsWith("ed25519:"), ts: z.number().int(), signature: z.string().min(40).max(200), face: z.number().int().min(0).max(FACE_MAX - 1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    if (!facesByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    const { account_id, public_key, ts, signature, face } = body.data;
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    // The footballer this account plays: only he can change his face.
    const me = await chain.view<{ token_id: string } | null>(config.LEAGUE_ID!, "footballer_of", { account_id }).catch(() => null);
    if (!me) return c.json({ error: "no_footballer" }, 404);
    let ok = false;
    try {
      ok = PublicKey.fromString(public_key).verify(new TextEncoder().encode(faceMessage(account_id, me.token_id, face, ts)), Buffer.from(signature, "base64"));
    } catch {
      ok = false;
    }
    if (!ok || !(await chain.hasKey(account_id, public_key))) return c.json({ error: "bad_signature" }, 401);
    faces.put(me.token_id, face);
    return c.json({ token_id: me.token_id, face });
  });

  /** The AI agents: who they are, and their journal (decisions, quotes, transactions, model evidence). */
  app.get("/v1/agents", (c) => c.json({ agents: deps.agents?.roster ?? [] }));
  app.get("/v1/agents/feed", (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    const day = c.req.query("day");
    return c.json({ entries: deps.agents?.journal.feed(limit, undefined, day ? Number(day) : undefined) ?? [] });
  });
  app.get("/v1/agents/:accountId", (c) => {
    const id = AccountId.safeParse(c.req.param("accountId"));
    if (!id.success) return c.json({ error: "invalid_account_id" }, 400);
    const agent = deps.agents?.roster.find((a) => a.account === id.data);
    if (!agent) return c.json({ error: "not_an_agent" }, 404);
    return c.json({ agent, entries: deps.agents!.journal.feed(50, id.data) });
  });

  // ---- Fan zone ----
  //
  // For season ticket holders only: the request is signed with a key of the
  // account (checked on chain), and the account must hold a season ticket
  // (checked on the tickets contract). What it gets: its tickets and its
  // clubs' AI coach briefings.

  const fanzoneByIp = new Limiter(60, 60 * 60_000, now);
  app.post("/v1/fanzone", async (c) => {
    const body = z
      .object({ account_id: AccountId, public_key: z.string().startsWith("ed25519:"), ts: z.number().int(), signature: z.string().min(40).max(200) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    if (!fanzoneByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    if (!config.TICKETS_ID) return c.json({ error: "no_season_tickets" }, 404);
    const { account_id, public_key, ts, signature } = body.data;
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    let ok = false;
    try {
      ok = PublicKey.fromString(public_key).verify(new TextEncoder().encode(fanzoneMessage(account_id, ts)), Buffer.from(signature, "base64"));
    } catch {
      ok = false;
    }
    if (!ok || !(await chain.hasKey(account_id, public_key))) return c.json({ error: "bad_signature" }, 401);
    const tickets = await chain.view<{ token_id: string; club: string; season: number; number: number; balance: string; earned: string }[]>(
      config.TICKETS_ID,
      "tickets_of",
      { account_id },
    );
    if (!tickets.length) return c.json({ error: "no_season_ticket" }, 403);
    const clubs = [...new Set(tickets.map((t) => t.club))];
    const briefings = (deps.agents?.journal.briefings(clubs, 20) ?? []).map((e) => ({
      club: e.agent,
      day: e.day,
      half: e.half ?? 1,
      quote: e.quote,
      briefing: e.briefing,
      at: e.at,
    }));
    return c.json({ tickets, briefings });
  });

  // ---- Who is online, and the team wall ----
  //
  // Signed with a key of the account, like the fan zone. What the chain
  // answers (the key is on the account, the footballer it plays) is kept a
  // few minutes: a heartbeat a minute must not be an RPC call a minute.

  const presence = new Presence(now);
  const walls = deps.walls ?? new Walls(null);
  const keyOk = new Memo<boolean>(10 * 60_000, now);
  const playerOf = new Memo<{ token_id: string; name: string; owner: string } | null>(2 * 60_000, now);
  const heartbeats = new Limiter(4, 60_000, now);
  const postsByAccount = new Limiter(6, 60_000, now);
  const socialByIp = new Limiter(600, 60 * 60_000, now);
  const Signed = z.object({ account_id: AccountId, public_key: z.string().startsWith("ed25519:").max(100), ts: z.number().int(), signature: z.string().min(40).max(200) });

  /** True when `message` is signed by `public_key` and that key is on `account_id`. */
  const signedBy = async (account_id: string, public_key: string, signature: string, message: string) => {
    try {
      if (!PublicKey.fromString(public_key).verify(new TextEncoder().encode(message), Buffer.from(signature, "base64"))) return false;
    } catch {
      return false;
    }
    // Only a key found on the account is remembered: a new account's key may land a moment later.
    const k = `${account_id} ${public_key}`;
    return keyOk.get(k, () => chain.hasKey(account_id, public_key), (found) => found);
  };
  const footballerOf = (account_id: string) =>
    playerOf.get(account_id, async () => {
      const p = await chain.view<{ token_id: string; name: string; owner: string } | null>(config.LEAGUE_ID!, "footballer_of", { account_id }).catch(() => null);
      return p ? { token_id: p.token_id, name: p.name, owner: p.owner } : null;
    });

  /** "I'm here": the browser says it every minute while the game is open. */
  app.post("/v1/presence", async (c) => {
    const body = Signed.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { account_id, public_key, ts, signature } = body.data;
    if (!socialByIp.allow(ip(c)) || !heartbeats.allow(account_id)) return c.json({ error: "too_many_requests" }, 429);
    if (!isPlayerAccount(account_id, config.PARENT_ACCOUNT_ID)) return c.json({ error: "not_a_player_account" }, 400);
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    if (!(await signedBy(account_id, public_key, signature, presenceMessage(account_id, ts)))) return c.json({ error: "bad_signature" }, 401);
    presence.here(account_id);
    return c.json({ online: presence.count() + agentsActive().size });
  });

  /** How many players are online, and which of `accounts` (comma-separated, up to 60). */
  app.get("/v1/presence", (c) => {
    const asked = (c.req.query("accounts") ?? "").split(",").filter(Boolean).slice(0, 60);
    const ids = asked.filter((a) => AccountId.safeParse(a).success);
    const agents = agentsActive();
    const online = [...new Set([...presence.online(ids), ...ids.filter((a) => agents.has(a))])];
    return c.json({ count: presence.count() + agents.size, online });
  });

  // The AI agents are in the dressing room too: online when they acted in the
  // last two minutes, and what they said (their journal's quotes) on their
  // club's wall. Never the other way round: no wall text reaches a prompt.
  const agentsActive = () => {
    const t = now();
    return new Set((deps.agents?.journal.feed(300) ?? []).filter((e) => t - e.at < ONLINE_MS).map((e) => e.agent));
  };
  const squadOf = new Memo<{ token_id: string; name: string; controller: string | null }[]>(2 * 60_000, now);
  const agentLines = async (club: string): Promise<WallPost[]> => {
    if (!deps.agents) return [];
    const squad = await squadOf.get(club, () =>
      chain.view<{ token_id: string; name: string; controller: string | null }[]>(config.LEAGUE_ID!, "squad", { account_id: club }).catch(() => []),
    );
    const played = new Map(squad.filter((p) => p.controller).map((p) => [p.controller!, p]));
    const coach = deps.agents.roster.find((a) => a.account === club);
    return deps.agents.journal
      .feed(300)
      // No half-time spoilers, no set-up lines: as on the AI dressing room.
      .filter((e) => e.quote && e.kind !== "setup" && e.half !== 2 && (e.agent === club || played.has(e.agent)))
      .slice(0, 30)
      .map((e, i) => {
        const p = played.get(e.agent);
        return p
          ? { id: -(i + 1), account: e.agent, token_id: p.token_id, name: p.name, text: e.quote, at: e.at, ai: "footballer" as const }
          : { id: -(i + 1), account: e.agent, token_id: "", name: coach?.name ?? "The coach", text: e.quote, at: e.at, ai: "coach" as const };
      });
  };

  /**
   * A club's wall, newest first: only for that club's footballers. The
   * request is signed with a key of the account (like a post), so another
   * club cannot read the dressing room by asking with someone else's name.
   */
  const wallReads = new Limiter(30, 60_000, now);
  app.post("/v1/clubs/:clubId/wall/read", async (c) => {
    const club = AccountId.safeParse(c.req.param("clubId"));
    const body = Signed.safeParse(await c.req.json().catch(() => null));
    if (!club.success || !body.success) return c.json({ error: "invalid_request" }, 400);
    const { account_id, public_key, ts, signature } = body.data;
    if (!socialByIp.allow(ip(c)) || !wallReads.allow(account_id)) return c.json({ error: "too_many_requests" }, 429);
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    if (!(await signedBy(account_id, public_key, signature, wallReadMessage(account_id, club.data, ts)))) return c.json({ error: "bad_signature" }, 401);
    const p = await footballerOf(account_id);
    if (!p || p.owner !== club.data) return c.json({ error: "not_in_this_club" }, 403);
    const posts = [...walls.of(club.data), ...(await agentLines(club.data))].sort((a, b) => b.at - a.at).slice(0, 50);
    return c.json({ posts });
  });

  /** Post on your club's wall: only a footballer of that club can. */
  app.post("/v1/clubs/:clubId/wall", async (c) => {
    const club = AccountId.safeParse(c.req.param("clubId"));
    const body = Signed.extend({ text: z.string().min(1).max(WALL_MAX * 4) }).safeParse(await c.req.json().catch(() => null));
    if (!club.success || !body.success) return c.json({ error: "invalid_request" }, 400);
    const { account_id, public_key, ts, signature, text } = body.data;
    if (!socialByIp.allow(ip(c)) || !postsByAccount.allow(account_id)) return c.json({ error: "too_many_requests" }, 429);
    const clean = cleanPost(text);
    if (!clean) return c.json({ error: "bad_text", max: WALL_MAX }, 400);
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    // The signature covers the text as typed, so the relay cannot change what was said.
    if (!(await signedBy(account_id, public_key, signature, wallMessage(account_id, club.data, ts, text)))) return c.json({ error: "bad_signature" }, 401);
    const p = await footballerOf(account_id);
    if (!p || p.owner !== club.data) return c.json({ error: "not_in_this_club" }, 403);
    presence.here(account_id);
    const posted = walls.add(club.data, { account: account_id, token_id: p.token_id, name: p.name, text: clean, at: now() });
    return c.json({ post: posted });
  });

  // ---- People: search, friends, private messages, the terrace, duels ----
  //
  // Off chain and signed like the wall. Nothing here moves G or a rating.

  const people = deps.people ?? new People(null, now);
  interface Person {
    account: string;
    token_id: string;
    name: string;
    position: string;
    overall: number;
    goals: number;
    value: number;
    club: string | null;
    club_name: string | null;
  }
  type ChainPlayer = { token_id: string; name: string; position: string; overall: number; goals: number; owner: string; controller: string | null };
  type ChainClub = { name: string; manager: string; treasury: string; division: number; fans: number; best_streak: number };
  const clubsNow = new Memo<ChainClub[]>(2 * 60_000, now);
  const allClubs = () => clubsNow.get("all", () => chain.view<ChainClub[]>(config.LEAGUE_ID!, "table").catch(() => []), (v) => v.length > 0);
  /** People met outside a squad (free agents), by account. */
  const met = new Map<string, Person>();
  const asPerson = (p: ChainPlayer, clubs: ChainClub[]): Person => {
    const club = clubs.find((c) => c.manager === p.owner) ?? null;
    return { account: p.controller!, token_id: p.token_id, name: p.name, position: p.position, overall: p.overall, goals: p.goals, value: valueOf(p), club: club?.manager ?? null, club_name: club?.name ?? null };
  };
  const directoryNow = new Memo<Person[]>(2 * 60_000, now);
  /** Every person who plays a footballer: the squads of all clubs, and the free agents met here. */
  const directory = () =>
    directoryNow.get(
      "all",
      async () => {
        const clubs = await allClubs();
        const out = new Map<string, Person>();
        for (let i = 0; i < clubs.length; i += 6) {
          const squads = await Promise.all(
            clubs.slice(i, i + 6).map((c) => chain.view<ChainPlayer[]>(config.LEAGUE_ID!, "squad", { account_id: c.manager }).catch(() => [] as ChainPlayer[])),
          );
          for (const p of squads.flat()) if (p.controller) out.set(p.controller, asPerson(p, clubs));
        }
        for (const [a, p] of met) if (!out.has(a)) out.set(a, p);
        return [...out.values()];
      },
      (v) => v.length > 0,
    );
  const personNow = new Memo<Person | null>(60_000, now);
  const personOf = (account_id: string) =>
    personNow.get(account_id, async () => {
      const p = await chain.view<ChainPlayer | null>(config.LEAGUE_ID!, "footballer_of", { account_id }).catch(() => null);
      if (!p) return null;
      const person = asPerson({ ...p, controller: account_id }, await allClubs());
      if (!person.club) met.set(account_id, person);
      else met.delete(account_id);
      if (met.size > 5_000) met.clear();
      return person;
    });
  const onlineSet = () => {
    const agents = agentsActive();
    return (accounts: string[]) => new Set([...presence.online(accounts), ...accounts.filter((a) => agents.has(a))]);
  };
  const withOnline = (ps: Person[]) => {
    const on = onlineSet()(ps.map((p) => p.account));
    return ps.map((p) => ({ ...p, online: on.has(p.account) }));
  };

  app.use("/v1/people/*", async (c, next) => {
    if (!config.LEAGUE_ID) return c.json({ error: "league_not_deployed" }, 503);
    if (!socialByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    await next();
  });

  /** Footballers whose name holds `q` (2 characters at least), the best rated first. */
  app.get("/v1/people/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 32);
    if ([...q].length < 2) return c.json({ people: [] });
    const found = (await directory()).filter((p) => p.name.toLowerCase().includes(q)).sort((a, b) => b.overall - a.overall).slice(0, 20);
    return c.json({ people: withOnline(found) });
  });

  /** Who is online now (up to 60), the best rated first. */
  app.get("/v1/people/online", async (c) => {
    const all = withOnline(await directory()).filter((p) => p.online).sort((a, b) => b.overall - a.overall);
    return c.json({ count: presence.count() + agentsActive().size, people: all.slice(0, 60) });
  });

  /** The league's rankings that are not a table: the footballers worth the most, the richest clubs, the best runs of full houses. */
  app.get("/v1/people/rankings", async (c) => {
    const [ps, clubs] = await Promise.all([directory(), allClubs()]);
    return c.json({
      valuable: [...ps].sort((a, b) => b.value - a.value || b.overall - a.overall).slice(0, 20),
      scorers: [...ps].filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 20),
      richest: [...clubs].sort((a, b) => (BigInt(b.treasury) > BigInt(a.treasury) ? 1 : -1)).slice(0, 10).map((k) => ({ club: k.manager, name: k.name, treasury: k.treasury })),
      streaks: [...clubs].filter((k) => k.best_streak > 0).sort((a, b) => b.best_streak - a.best_streak).slice(0, 10).map((k) => ({ club: k.manager, name: k.name, best_streak: k.best_streak })),
    });
  });

  /** The terrace: one chat for the whole league, anyone reads it. */
  app.get("/v1/people/chat", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ lines: people.chat() });
  });

  const socialReads = new Limiter(60, 60_000, now);
  const socialWrites = new Limiter(12, 60_000, now);
  const duelStarts = new Map<string, number>();
  const DUEL_SKILLS = ["pace", "shooting", "passing", "dribbling", "defending"] as const;
  const Social = Signed.extend({
    action: z.enum(["inbox", "thread", "message", "friend_ask", "friend_accept", "friend_decline", "friend_remove", "friends_only", "say", "duel_new", "duel_start", "duel_play"]),
    to: AccountId.optional(),
    id: z.number().int().min(0).optional(),
    text: z.string().max(WALL_MAX * 4).optional(),
    clicks: z.array(z.unknown()).max(MAX_CLICKS).optional(),
  });
  const READS = new Set(["inbox", "thread", "duel_start"]);

  /**
   * Everything a player does among people, in one signed call. The signature
   * covers the action, who it is for, the id and the text as typed.
   */
  app.post("/v1/people/act", async (c) => {
    const body = Social.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const { account_id, public_key, ts, signature, action, clicks } = body.data;
    const to = body.data.to ?? "";
    const id = body.data.id ?? 0;
    const text = body.data.text ?? "";
    if (!(READS.has(action) ? socialReads : socialWrites).allow(account_id)) return c.json({ error: "too_many_requests" }, 429);
    if (Math.abs(now() - ts) > 5 * 60_000) return c.json({ error: "stale_signature" }, 401);
    if (!(await signedBy(account_id, public_key, signature, socialMessage(account_id, ts, action, to, id, text)))) return c.json({ error: "bad_signature" }, 401);
    const me = await personOf(account_id);
    if (!me) return c.json({ error: "no_footballer" }, 403);
    presence.here(account_id);
    const all = await directory();
    const card = (a: string) => all.find((p) => p.account === a) ?? met.get(a) ?? { account: a, token_id: "", name: a.split(".")[0]!, position: "", overall: 0, goals: 0, value: 0, club: null, club_name: null };
    const cards = (as: string[]) => withOnline(as.map(card));
    const other = async () => (to && to !== account_id ? await personOf(to) : null);
    const duelView = (d: NonNullable<ReturnType<People["duelById"]>>) => {
      const done = duelWinner(d);
      const rival = d.from === account_id ? d.to : d.from;
      return {
        id: d.id,
        skill: d.skill,
        at: d.at,
        rounds: d.rounds,
        rival: card(rival),
        mine: d.hits[account_id] ?? null,
        // His score stays hidden until you have played: no chasing a known target.
        theirs: d.hits[account_id] === undefined ? null : (d.hits[rival] ?? null),
        their_turn_done: d.hits[rival] !== undefined,
        result: done === undefined ? null : done === null ? "draw" : done === account_id ? "won" : "lost",
      };
    };

    switch (action) {
      case "inbox": {
        const threads = people.threadsOf(account_id).slice(0, 40);
        return c.json({
          me,
          friends: cards(people.friendsOf(account_id)),
          requests: cards(people.requestsTo(account_id)),
          threads: threads.map((t) => ({ with: card(t.with), last: t.last, unread: t.unread })),
          unread: threads.reduce((n, t) => n + t.unread, 0),
          duels: people.duelsOf(account_id).map(duelView),
          friends_only: people.friendsOnly(account_id),
        });
      }
      case "thread": {
        if (!to) return c.json({ error: "invalid_request" }, 400);
        return c.json({ with: card(to), messages: people.thread(account_id, to), may_write: people.mayWrite(account_id, to) });
      }
      case "message": {
        const clean = cleanPost(text);
        if (!clean) return c.json({ error: "bad_text", max: WALL_MAX }, 400);
        if (!(await other())) return c.json({ error: "no_such_player" }, 404);
        if (!people.mayWrite(account_id, to)) return c.json({ error: "friends_only" }, 403);
        return c.json({ message: people.send(account_id, to, clean) });
      }
      case "friend_ask": {
        if (!(await other())) return c.json({ error: "no_such_player" }, 404);
        return c.json({ state: people.ask(account_id, to) });
      }
      case "friend_accept":
        return c.json({ ok: people.accept(account_id, to) });
      case "friend_decline":
        people.decline(account_id, to);
        return c.json({ ok: true });
      case "friend_remove":
        people.unfriend(account_id, to);
        return c.json({ ok: true });
      case "friends_only":
        people.setFriendsOnly(account_id, text === "on");
        return c.json({ friends_only: people.friendsOnly(account_id) });
      case "say": {
        const clean = cleanPost(text);
        if (!clean) return c.json({ error: "bad_text", max: WALL_MAX }, 400);
        return c.json({ line: people.say({ account: account_id, token_id: me.token_id, name: me.name, text: clean }) });
      }
      case "duel_new": {
        const skill = DUEL_SKILLS.find((k) => k === text);
        if (!skill) return c.json({ error: "invalid_request" }, 400);
        if (!(await other())) return c.json({ error: "no_such_player" }, 404);
        if (!people.mayWrite(account_id, to)) return c.json({ error: "friends_only" }, 403);
        const seed = randomBytes(32).toString("hex");
        const d = people.duel(account_id, to, skill, seed, rounds(drill(seed, DUEL_LEVEL, skill)));
        if (!d) return c.json({ error: "duel_open" }, 409);
        return c.json({ duel: duelView(d) });
      }
      case "duel_start": {
        const d = people.duelById(id);
        if (!d || (d.from !== account_id && d.to !== account_id)) return c.json({ error: "no_such_duel" }, 404);
        if (d.hits[account_id] !== undefined) return c.json({ error: "already_played" }, 409);
        const k = `${d.id} ${account_id}`;
        if (!duelStarts.has(k)) duelStarts.set(k, now());
        if (duelStarts.size > 10_000) duelStarts.clear();
        return c.json({ id: d.id, seed: d.seed, skill: d.skill, level: DUEL_LEVEL });
      }
      case "duel_play": {
        const d = people.duelById(id);
        if (!d || (d.from !== account_id && d.to !== account_id)) return c.json({ error: "no_such_duel" }, 404);
        if (d.hits[account_id] !== undefined) return c.json({ error: "already_played" }, 409);
        const bad = implausible(clicks ?? []);
        if (bad) return c.json({ error: "implausible", reason: bad }, 422);
        const game = drill(d.seed, DUEL_LEVEL, d.skill);
        const trace = (clicks ?? []) as Parameters<typeof hits>[1];
        const k = `${d.id} ${account_id}`;
        const start = duelStarts.get(k);
        if (start === undefined || now() - start < drillEnd(game, trace) - 500) return c.json({ error: "implausible", reason: "the drill did not last that long" }, 422);
        duelStarts.delete(k);
        const scored = people.score(d.id, account_id, hits(game, trace));
        if (!scored) return c.json({ error: "duel_over" }, 409);
        return c.json({ duel: duelView(scored) });
      }
    }
  });

  /** Gas top-up for a player's account that is nearly empty, a few times a day. */
  app.post("/v1/accounts/:accountId/topup", async (c) => {
    const id = AccountId.safeParse(c.req.param("accountId"));
    if (!id.success || !isPlayerAccount(id.data, config.PARENT_ACCOUNT_ID)) {
      return c.json({ error: "not_a_player_account" }, 400);
    }
    const balance = await chain.balance(id.data);
    if (balance === null) return c.json({ error: "no_such_account" }, 404);
    if (balance >= near(config.TOPUP_BELOW_NEAR)) return c.json({ error: "balance_is_enough" }, 409);
    if (!topups.allow(id.data)) return c.json({ error: "too_many_topups" }, 429);
    const tx = await chain.transfer(id.data, funding);
    return c.json({ account_id: id.data, tx });
  });

  // ---- Gas: the relay pays (NEP-366 meta transactions) ----

  const relayedByAccount = new Limiter(config.RELAYED_PER_DAY, 24 * 60 * 60_000, now);
  const relayedByIp = new Limiter(config.RELAYED_PER_DAY * 3, 24 * 60 * 60_000, now);
  const version = config.LEAGUE_ID?.match(/^league-(v\d+)\./)?.[1];
  const parentOf = config.PARENT_ACCOUNT_ID;
  const allowed = config.LEAGUE_ID
    ? allowedMethods({
        league: config.LEAGUE_ID,
        goalars: config.GOALARS_ID ?? `goalars-${version}.${parentOf}`,
        players: config.PLAYERS_ID ?? `players-${version}.${parentOf}`,
        ...(config.TICKETS_ID ? { tickets: config.TICKETS_ID } : {}),
      })
    : new Map<string, Set<string>>();

  app.post("/v1/relay", async (c) => {
    const body = z.object({ signed_delegate: z.string().min(1).max(20_000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    let signed;
    try {
      signed = decodeSignedDelegate(body.data.signed_delegate);
    } catch {
      return c.json({ error: "invalid_signed_delegate" }, 400);
    }
    const no = refuse(signed, allowed, (id) => isPlayerAccount(id, config.PARENT_ACCOUNT_ID));
    if (no) return c.json({ error: no }, 403);
    if (!relayedByIp.allow(ip(c)) || !relayedByAccount.allow(signed.delegateAction.senderId)) {
      return c.json({ error: "too_many_requests" }, 429);
    }
    const r = await chain.relay(signed);
    return c.json(r, r.error ? 422 : 200);
  });

  // ---- Bot API: an AI plays over plain HTTP (see bot.ts and GET /v1/bot) ----
  //
  // Each sign-up costs the parent the account's funding: a few per IP a day,
  // and a cap for everyone. The token carries the AI account's key; the relay
  // signs each action with it and keeps no copy, and the same rules as the
  // browser's gasless calls apply (allowed contracts and methods, limits).

  const botSignupsByIp = new Limiter(config.BOT_SIGNUPS_PER_IP_DAY, 24 * 60 * 60_000, now);
  const botSignups = new Limiter(config.BOT_SIGNUPS_PER_DAY, 24 * 60 * 60_000, now);
  const botCalls = new Limiter(60, 60_000, now);
  const players = config.PLAYERS_ID ?? `players-${version}.${parentOf}`;
  const Position = z.enum(["Gk", "Df", "Mf", "Fw"]);

  app.get("/v1/bot", (c) => c.text(botDocs(new URL(c.req.url).origin.replace(/^http:/, c.req.header("x-forwarded-proto") === "https" ? "https:" : "http:"))));

  type BotResult = { status: 200 | 403 | 409 | 422 | 429; body: Record<string, unknown> };
  /** Signs and sends one call as the bot; the same checks as /v1/relay. */
  const actAs = async (bot: { accountId: string; privateKey: string }, contract: string, method: string, args: Record<string, unknown>, deposit = 0n, tgas = 100): Promise<BotResult> => {
    if (!chain.signDelegate) throw new Error("bot_api_unavailable");
    const signed = await chain.signDelegate(bot.accountId, bot.privateKey, contract, method, args, tgas, deposit);
    const no = refuse(signed, allowed, (id) => isPlayerAccount(id, config.PARENT_ACCOUNT_ID));
    if (no) return { status: 403, body: { error: no } };
    if (!relayedByAccount.allow(bot.accountId)) return { status: 429, body: { error: "too_many_requests" } };
    const r = await chain.relay(signed);
    return r.error ? { status: 422, body: { error: r.error, hash: r.hash } } : { status: 200, body: { ok: true, hash: r.hash } };
  };

  /** The bot behind the bearer token, if the token is good and its key is on the account. */
  const botOf = async (c: { req: { header(name: string): string | undefined } }) => {
    const t = readToken(c.req.header("authorization"));
    if (!t || !isPlayerAccount(t.accountId, config.PARENT_ACCOUNT_ID)) return null;
    let pub: string;
    try {
      pub = KeyPair.fromString(t.privateKey as `ed25519:${string}`).getPublicKey().toString();
    } catch {
      return null;
    }
    const ok = await keyOk.get(`${t.accountId} ${pub}`, () => chain.hasKey(t.accountId, pub), (found) => found);
    return ok ? t : null;
  };

  app.use("/v1/bot/*", async (c, next) => {
    if (!config.LEAGUE_ID) return c.json({ error: "league_not_deployed" }, 503);
    await next();
  });

  app.post("/v1/bot/signup", async (c) => {
    const body = z.object({ name: z.string().trim().min(2).max(32), position: Position }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request", expected: { name: "2 to 32 characters", position: "Gk | Df | Mf | Fw" } }, 400);
    if (!botSignupsByIp.allow(ip(c)) || !botSignups.allow("all")) return c.json({ error: "too_many_requests" }, 429);
    const kp = KeyPair.fromRandom("ed25519");
    const account_id = accountIdFor(`bot:${randomUUID()}`, config.PARENT_ACCOUNT_ID);
    let tx: string;
    try {
      tx = await chain.createAccount(account_id, kp.getPublicKey().toString(), funding);
    } catch (e) {
      return c.json({ error: transient(e) ? "rpc_busy" : "account_not_created", detail: e instanceof Error ? e.message : String(e) }, transient(e) ? 503 : 502);
    }
    const bot = { accountId: account_id, privateKey: kp.toString() };
    // The new key may take a moment to be readable: a few tries.
    let made: BotResult | null = null;
    for (let i = 0; i < 5 && !made; i++) {
      try {
        made = await actAs(bot, config.LEAGUE_ID!, "create_footballer", { name: body.data.name, position: body.data.position });
      } catch (e) {
        if (i === 4) return c.json({ error: "footballer_not_created", detail: e instanceof Error ? e.message : String(e), token: makeToken(account_id, bot.privateKey), account_id }, 502);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    const footballer = await botFootballer(account_id);
    return c.json({ token: makeToken(account_id, bot.privateKey), account_id, footballer, tx, docs: "GET /v1/bot" }, made && made.status === 200 ? 200 : made!.status);
  });

  app.get("/v1/bot/clubs", async (c) => {
    const table = await chain.view<{ manager: string; name: string; division: number; points: number }[]>(config.LEAGUE_ID!, "table");
    const clubs = await Promise.all(
      table.map(async (t) => {
        const squad = await squadOf.get(t.manager, () =>
          chain.view<{ token_id: string; name: string; controller: string | null }[]>(config.LEAGUE_ID!, "squad", { account_id: t.manager }).catch(() => []),
        );
        return { club_id: t.manager, name: t.name, division: t.division, points: t.points, players: squad.length, places_left: Math.max(0, 12 - squad.length) };
      }),
    );
    return c.json({ clubs });
  });

  app.get("/v1/bot/me", async (c) => {
    const bot = await botOf(c);
    if (!bot) return c.json({ error: "bad_token" }, 401);
    if (!botCalls.allow(bot.accountId)) return c.json({ error: "too_many_requests" }, 429);
    const [footballer, schedule] = await Promise.all([
      chain.view<{ token_id: string; name: string; owner: string; overall: number; position: string; energy?: number; contract?: unknown } | null>(config.LEAGUE_ID!, "footballer_of", { account_id: bot.accountId }),
      chain.view<{ match_day: number; kickoff_at_ms: string; next_match_at_ms: string; first_half_played: boolean; season: number; season_day: number }>(config.LEAGUE_ID!, "schedule"),
    ]);
    const inClub = footballer && footballer.owner !== bot.accountId ? footballer.owner : null;
    const lineup = inClub
      ? await chain.view<{ formation: string; strategy: string; roles: string[]; players: ({ token_id: string; name: string } | null)[]; chosen: boolean[] }>(config.LEAGUE_ID!, "lineup", { club_id: inClub })
      : null;
    const slotsOpen = !schedule.first_half_played && now() < Number(schedule.kickoff_at_ms) - 60_000;
    return c.json({
      account_id: bot.accountId,
      footballer,
      club: inClub,
      match: {
        match_day: schedule.match_day,
        season: schedule.season,
        season_day: schedule.season_day,
        kickoff_at_ms: Number(schedule.kickoff_at_ms),
        first_half_played: schedule.first_half_played,
        slots_open: slotsOpen,
      },
      team_sheet: lineup && {
        formation: lineup.formation,
        strategy: lineup.strategy,
        slots: lineup.roles.map((role, slot) => ({
          slot,
          role,
          player: lineup.players[slot]?.name ?? null,
          you: lineup.players[slot]?.token_id === footballer?.token_id,
          chosen: lineup.chosen[slot] ?? false,
        })),
      },
    });
  });

  /** The bot's footballer, read now (not the wall's cached copy: it just changed clubs, maybe). */
  const botFootballer = (account_id: string) =>
    chain.view<{ token_id: string; name: string; owner: string; overall: number; position: string } | null>(config.LEAGUE_ID!, "footballer_of", { account_id }).catch(() => null);

  /** A bot action: parse the body, find the bot, act. */
  const botAction = <S extends z.ZodTypeAny>(path: string, schema: S, run: (bot: { accountId: string; privateKey: string }, body: z.infer<S>) => Promise<BotResult>) =>
    app.post(path, async (c) => {
      const bot = await botOf(c);
      if (!bot) return c.json({ error: "bad_token" }, 401);
      if (!botCalls.allow(bot.accountId)) return c.json({ error: "too_many_requests" }, 429);
      const body = schema.safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: "invalid_request" }, 400);
      try {
        const r = await run(bot, body.data);
        return c.json(r.body, r.status);
      } catch (e) {
        // A busy RPC can fail the call after the transaction went out: say so,
        // so the AI checks /v1/bot/me before trying again.
        if (transient(e)) return c.json({ error: "rpc_busy", detail: e instanceof Error ? e.message : String(e), note: "the action may have gone through: check GET /v1/bot/me before retrying" }, 503);
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    });

  botAction("/v1/bot/join", z.object({ club: AccountId, days: z.number().int().min(1).max(200).optional() }), async (bot, b) => {
    const f = await botFootballer(bot.accountId);
    if (!f) return { status: 409, body: { error: "no_footballer" } };
    if (f.owner !== bot.accountId) return { status: 409, body: { error: "already_in_a_club" } };
    // His word first (the length of the contract he takes), when he chose one.
    if (b.days !== undefined) {
      const signed = await actAs(bot, config.LEAGUE_ID!, "sign_for", { club_id: b.club, days: b.days }, 0n, 30);
      if (signed.status !== 200) return signed;
    }
    // Giving the registration to a club is an NFT transfer (one yoctoNEAR, from the bot's own balance).
    return actAs(bot, players, "nft_transfer", { receiver_id: b.club, token_id: f.token_id }, 1n, 100);
  });
  botAction("/v1/bot/report", z.object({}).passthrough(), (bot) => actAs(bot, config.LEAGUE_ID!, "report_for_match", {}));
  botAction("/v1/bot/slot", z.object({ slot: z.number().int().min(0).max(10) }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "take_slot", { slot: b.slot }, 0n, 30));
  botAction("/v1/bot/strategy", z.object({ strategy: z.enum(["defend", "balanced", "attack"]) }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_strategy", { strategy: b.strategy }, 0n, 30));
  botAction("/v1/bot/captain", z.object({ candidate: TokenId }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_captain", { candidate: b.candidate }));
  botAction("/v1/bot/rest", z.object({}).passthrough(), (bot) => actAs(bot, config.LEAGUE_ID!, "rest_today", {}, 0n, 30));
  botAction("/v1/bot/project", z.object({ project: z.enum(["stadium", "physio", "academy", "save"]) }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_project", { project: b.project }, 0n, 30));
  botAction("/v1/bot/leave", z.object({}).passthrough(), (bot) => actAs(bot, config.LEAGUE_ID!, "leave_club", {}, 0n, 100));
  botAction("/v1/bot/instruction", z.object({ instruction: z.enum(["balanced", "shooter", "playmaker", "dribbler", "stopper"]) }), (bot, b) =>
    actAs(bot, config.LEAGUE_ID!, "set_instruction", { instruction: b.instruction }, 0n, 30),
  );
  botAction("/v1/bot/holiday", z.object({ days: z.number().int().min(0).max(14) }), (bot, b) =>
    b.days === 0 ? actAs(bot, config.LEAGUE_ID!, "end_holiday", {}, 0n, 30) : actAs(bot, config.LEAGUE_ID!, "go_on_holiday", { days: b.days }, 0n, 30),
  );
  botAction("/v1/bot/recruit", z.object({ token_id: TokenId, yes: z.boolean() }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_recruit", { token_id: b.token_id, yes: b.yes }, 0n, 30));
  botAction("/v1/bot/claim", z.object({}).passthrough(), (bot) => actAs(bot, config.LEAGUE_ID!, "claim", {}, 0n, 60));

  // ---- Training drill ----
  //
  // The league opens a ticket when a player pays for training. The browser
  // tells the relay it starts the drill, plays it, and sends its clicks. The
  // relay replays them against the ticket's seed, checks the drill really
  // lasted, and signs the points; the player submits that signature to
  // finish_training. One signature per ticket.

  const attester = config.ATTESTER_PRIVATE_KEY ? KeyPair.fromString(config.ATTESTER_PRIVATE_KEY as `ed25519:${string}`) : null;
  const started = new Map<number, number>();
  // One signature per ticket, kept: a player who closed the tab gets his
  // score back instead of a ticket he can neither play nor finish.
  type Signed = { token_id: string; ticket: number; hits: number; rounds: number; points: number; signature: string };
  const signed = new Map<number, Signed>();
  if (deps.drillsFile) {
    try {
      for (const r of JSON.parse(readFileSync(deps.drillsFile, "utf8")) as Signed[]) signed.set(r.ticket, r);
    } catch {
      /* none yet */
    }
  }
  const keepSigned = () => {
    if (!deps.drillsFile) return;
    // The last 5,000 are plenty: an open ticket is finished within a match day.
    const last = [...signed.values()].slice(-5000);
    mkdirSync(dirname(deps.drillsFile), { recursive: true });
    writeFileSync(`${deps.drillsFile}.tmp`, JSON.stringify(last), { mode: 0o600 });
    renameSync(`${deps.drillsFile}.tmp`, deps.drillsFile);
  };
  const drillsByIp = new Limiter(30, 60 * 60_000, now);

  async function openTicket(tokenId: string) {
    const t = await chain.view<Ticket | null>(config.LEAGUE_ID!, "training_ticket", { token_id: tokenId });
    if (!t) return null;
    const p = await chain.view<{ skills: Record<Ticket["skill"], number> } | null>(config.LEAGUE_ID!, "get_player", { token_id: tokenId });
    return p ? { ticket: t, level: p.skills[t.skill] } : null;
  }

  app.use("/v1/training/*", async (c, next) => {
    if (!config.LEAGUE_ID || !attester) return c.json({ error: "training_not_available" }, 503);
    if (!drillsByIp.allow(ip(c))) return c.json({ error: "too_many_requests" }, 429);
    await next();
  });

  app.post("/v1/training/start", async (c) => {
    const body = z.object({ token_id: TokenId }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const open = await openTicket(body.data.token_id);
    if (!open) return c.json({ error: "no_open_training" }, 404);
    const done = signed.get(open.ticket.id);
    if (done) return c.json({ ticket: open.ticket, level: open.level, attested: done });
    if (!started.has(open.ticket.id)) started.set(open.ticket.id, now());
    return c.json({ ticket: open.ticket, level: open.level });
  });

  app.post("/v1/training/attest", async (c) => {
    const body = Attest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);
    const bad = implausible(body.data.clicks);
    if (bad) return c.json({ error: "implausible", reason: bad }, 422);
    const open = await openTicket(body.data.token_id);
    if (!open) return c.json({ error: "no_open_training" }, 404);
    const { ticket, level } = open;
    const done = signed.get(ticket.id);
    if (done) return c.json(done);
    const start = started.get(ticket.id);
    const d = drill(ticket.seed, level, ticket.skill);
    if (start === undefined || now() - start < drillEnd(d, body.data.clicks as Parameters<typeof hits>[1]) - 500) {
      return c.json({ error: "implausible", reason: "the drill did not last that long" }, 422);
    }
    started.delete(ticket.id);
    const hit = hits(d, body.data.clicks as Parameters<typeof hits>[1]);
    const total = rounds(d);
    const pts = points(hit, total);
    const message = `near-post:train:${config.LEAGUE_ID}:${ticket.token_id}:${ticket.id}:${pts}`;
    const signature = Buffer.from(attester!.sign(new TextEncoder().encode(message)).signature).toString("base64");
    const result = { token_id: ticket.token_id, ticket: ticket.id, hits: hit, rounds: total, points: pts, signature };
    signed.set(ticket.id, result);
    keepSigned();
    return c.json(result);
  });

  // ---- League reads ----

  app.use("/v1/rules", async (c, next) => {
    if (!config.LEAGUE_ID) return c.json({ error: "league_not_deployed" }, 503);
    await next();
  });
  app.use("/v1/clubs/*", async (c, next) => {
    if (!config.LEAGUE_ID) return c.json({ error: "league_not_deployed" }, 503);
    await next();
  });

  app.get("/v1/rules", async (c) => c.json(await chain.view(config.LEAGUE_ID!, "rules")));

  // Season leaderboards, counted from the on-chain match sheets (cached).
  const stats = config.LEAGUE_ID ? new Stats(chain, config.LEAGUE_ID, now) : null;
  if (stats && deps.warmStats) {
    const warm = () => void stats.season().catch(() => {});
    setTimeout(warm, 10_000).unref();
    setInterval(warm, 60_000).unref();
  }
  app.get("/v1/stats", async (c) => {
    if (!stats) return c.json({ error: "league_not_deployed" }, 503);
    try {
      return c.json(await stats.season());
    } catch {
      return c.json({ error: "chain_unavailable" }, 502);
    }
  });

  // ---- Live clock ----
  //
  // Every viewer reveals a half from the same instant: the relay's clock
  // (the app measures its offset) and the moment the half reached the chain.
  app.get("/v1/time", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ now: now() });
  });
  app.get("/v1/kickoffs/:day", (c) => {
    const day = Number(c.req.param("day"));
    if (!Number.isInteger(day) || day < 1) return c.json({ error: "invalid_day" }, 400);
    c.header("cache-control", "no-store");
    return c.json(deps.kickoffs?.get(day) ?? { first: null, second: null });
  });

  app.get("/v1/clubs/:clubId/stand", async (c) => {
    const clubId = AccountId.safeParse(c.req.param("clubId"));
    if (!clubId.success) return c.json({ error: "invalid_club_id" }, 400);
    const club = await chain.view(config.LEAGUE_ID!, "get_club", { club_id: clubId.data });
    if (club === null) return c.json({ error: "no_such_club" }, 404);
    return c.json(await chain.view(config.LEAGUE_ID!, "stand", { club_id: clubId.data }));
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "chain_unavailable" }, 502);
  });

  return app;
}

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Hono } from "hono";
import { KeyPair, PublicKey } from "near-api-js";
import { z } from "zod";
import { type Mailer, Codes, Limiter, accountIdFor, isPlayerAccount, normalizeEmail } from "./auth.js";
import { type Chain, near } from "./chain.js";
import type { Config } from "./config.js";
import { MAX_CLICKS, drill, drillEnd, hits, implausible, points, rounds } from "./drill.js";
import { allowedMethods, decodeSignedDelegate, refuse } from "./gasless.js";
import type { Journal } from "./agents/journal.js";
import type { Agent } from "./agents/roster.js";
import type { Kickoffs } from "./schedule.js";
import { Stats } from "./stats.js";
import { VaultEntry, Vaults, vaultMessage } from "./vault.js";
import { fanzoneMessage, presenceMessage, wallMessage, wallReadMessage } from "./vault-message.js";
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
  const codes = deps.codes ?? new Codes(config.CODE_TTL_SECONDS * 1000, 5, now);
  const startByIp = new Limiter(10, 60 * 60_000, now);
  const startByEmail = new Limiter(3, 15 * 60_000, now);
  const verifyByIp = new Limiter(30, 60 * 60_000, now);
  const topups = new Limiter(config.TOPUPS_PER_DAY, 24 * 60 * 60_000, now);
  const funding = near(config.ACCOUNT_FUNDING_NEAR);
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
    return c.json({ account_id, created: true, tx });
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
    const tx = await chain.createAccount(account_id, kp.getPublicKey().toString(), funding);
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
      chain.view<{ token_id: string; name: string; owner: string; overall: number; position: string } | null>(config.LEAGUE_ID!, "footballer_of", { account_id: bot.accountId }),
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
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    });

  botAction("/v1/bot/join", z.object({ club: AccountId }), async (bot, b) => {
    const f = await botFootballer(bot.accountId);
    if (!f) return { status: 409, body: { error: "no_footballer" } };
    if (f.owner !== bot.accountId) return { status: 409, body: { error: "already_in_a_club" } };
    // Giving the registration to a club is an NFT transfer (one yoctoNEAR, from the bot's own balance).
    return actAs(bot, players, "nft_transfer", { receiver_id: b.club, token_id: f.token_id }, 1n, 100);
  });
  botAction("/v1/bot/report", z.object({}).passthrough(), (bot) => actAs(bot, config.LEAGUE_ID!, "report_for_match", {}));
  botAction("/v1/bot/slot", z.object({ slot: z.number().int().min(0).max(10) }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "take_slot", { slot: b.slot }, 0n, 30));
  botAction("/v1/bot/strategy", z.object({ strategy: z.enum(["defend", "balanced", "attack"]) }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_strategy", { strategy: b.strategy }, 0n, 30));
  botAction("/v1/bot/captain", z.object({ candidate: TokenId }), (bot, b) => actAs(bot, config.LEAGUE_ID!, "vote_captain", { candidate: b.candidate }));

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

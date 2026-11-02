import { Hono } from "hono";
import { KeyPair, PublicKey } from "near-api-js";
import { z } from "zod";
import { type Mailer, Codes, Limiter, accountIdFor, isPlayerAccount, normalizeEmail } from "./auth.js";
import { type Chain, near } from "./chain.js";
import type { Config } from "./config.js";
import { drill, drillEnd, hits, implausible, points } from "./drill.js";
import { allowedMethods, decodeSignedDelegate, refuse } from "./gasless.js";

const AccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "not a NEAR account id");

const Start = z.object({ email: z.email().max(254) });
const TokenId = z.string().regex(/^p\d{1,12}$/);
const Attest = z.object({ token_id: TokenId, clicks: z.array(z.unknown()).max(60) });

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
      // A returning player: the account exists; his key is in his browser.
      const key_on_account = await chain.hasKey(account_id, body.data.public_key);
      return c.json({ account_id, created: false, key_on_account });
    }
    const tx = await chain.createAccount(account_id, body.data.public_key, funding);
    return c.json({ account_id, created: true, tx });
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

  // ---- Training drill ----
  //
  // The league opens a ticket when a player pays for training. The browser
  // tells the relay it starts the drill, plays it, and sends its clicks. The
  // relay replays them against the ticket's seed, checks the drill really
  // lasted, and signs the points; the player submits that signature to
  // finish_training. One signature per ticket.

  const attester = config.ATTESTER_PRIVATE_KEY ? KeyPair.fromString(config.ATTESTER_PRIVATE_KEY as `ed25519:${string}`) : null;
  const started = new Map<number, number>();
  const signed = new Set<number>();
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
    if (signed.has(open.ticket.id)) return c.json({ error: "already_attested" }, 409);
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
    if (signed.has(ticket.id)) return c.json({ error: "already_attested" }, 409);
    const start = started.get(ticket.id);
    const d = drill(ticket.seed, level, ticket.skill);
    if (start === undefined || now() - start < drillEnd(d, body.data.clicks as Parameters<typeof hits>[1]) - 500) {
      return c.json({ error: "implausible", reason: "the drill did not last that long" }, 422);
    }
    signed.add(ticket.id);
    started.delete(ticket.id);
    const hit = hits(d, body.data.clicks as Parameters<typeof hits>[1]);
    const pts = points(hit, d.rounds.length);
    const message = `near-post:train:${config.LEAGUE_ID}:${ticket.token_id}:${ticket.id}:${pts}`;
    const signature = Buffer.from(attester!.sign(new TextEncoder().encode(message)).signature).toString("base64");
    return c.json({ token_id: ticket.token_id, ticket: ticket.id, hits: hit, rounds: d.rounds.length, points: pts, signature });
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

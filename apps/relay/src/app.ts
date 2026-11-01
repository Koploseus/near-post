import { Hono } from "hono";
import { z } from "zod";
import type { Chain } from "./chain.js";
import type { Config } from "./config.js";

const AccountId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/, "not a NEAR account id");

/**
 * The relay's HTTP API. Today it only reads the league from chain.
 * Email login, session keys and gas relaying come next (see README).
 */
export function createApp(config: Config, chain: Chain) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", network: config.NEAR_NETWORK }));

  app.use("/v1/*", async (c, next) => {
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

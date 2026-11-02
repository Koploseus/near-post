import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { consoleMailer, resendMailer } from "./auth.js";
import { rpcChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { near } from "./chain.js";
import { parseCrowd } from "./crowd.js";
import { Kickoffs, startScheduler } from "./schedule.js";
import { Vaults } from "./vault.js";

const config = loadConfig();
const signer = config.PARENT_PRIVATE_KEY
  ? { accountId: config.PARENT_ACCOUNT_ID, privateKey: config.PARENT_PRIVATE_KEY }
  : undefined;
const chain = rpcChain(config.NEAR_RPC_URL, signer);
const mailer = config.EMAIL_MODE === "resend" ? resendMailer(config.RESEND_API_KEY!, config.EMAIL_FROM) : consoleMailer;
const kickoffs = new Kickoffs();
const vaults = new Vaults(config.DATA_DIR ? `${config.DATA_DIR}/vaults.json` : null);
const app = createApp(config, chain, { mailer, kickoffs, vaults });
if (config.WEB_DIST) {
  // The web app uses hash routes: only files, and index.html for "/".
  app.use("/*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
  });
  app.get("/*", serveStatic({ root: config.WEB_DIST }));
}

if (config.INSECURE_DEV_RETURN_CODE) console.warn("INSECURE_DEV_RETURN_CODE is on: codes are returned in responses");
if (config.PLAY_MATCH_DAYS && signer && config.LEAGUE_ID) {
  const crowdKey = config.CROWD_PRIVATE_KEY;
  const clubs = parseCrowd(config.CROWD, config.PARENT_ACCOUNT_ID);
  startScheduler(chain, config.LEAGUE_ID, {
    kickoffs,
    ...(crowdKey && clubs.length
      ? { crowd: { clubs, every: config.CROWD_EVERY, asFan: (fan: string) => rpcChain(config.NEAR_RPC_URL, { accountId: fan, privateKey: crowdKey }) } }
      : {}),
    ...(config.KEEP_FUNDED
      ? {
          keep: {
            contracts: config.KEEP_FUNDED.split(",").map((s) => s.trim()).filter(Boolean),
            minFree: near(config.KEEP_MIN_FREE_NEAR),
            topUp: near(config.KEEP_TOPUP_NEAR),
          },
        }
      : {}),
  });
  console.log(`scheduler on${crowdKey && clubs.length ? `, crowd of ${clubs.reduce((n, c) => n + c.fans.length, 0)} fans` : ""}`);
}

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    `relay on :${info.port} (${config.NEAR_NETWORK}, league ${config.LEAGUE_ID ?? "not deployed"}, ` +
      `accounts under ${config.PARENT_ACCOUNT_ID}${signer ? "" : ", read-only: no parent key"})`,
  );
});

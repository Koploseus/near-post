import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { consoleMailer, resendMailer } from "./auth.js";
import { rpcChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { startScheduler } from "./schedule.js";

const config = loadConfig();
const signer = config.PARENT_PRIVATE_KEY
  ? { accountId: config.PARENT_ACCOUNT_ID, privateKey: config.PARENT_PRIVATE_KEY }
  : undefined;
const chain = rpcChain(config.NEAR_RPC_URL, signer);
const mailer = config.EMAIL_MODE === "resend" ? resendMailer(config.RESEND_API_KEY!, config.EMAIL_FROM) : consoleMailer;
const app = createApp(config, chain, { mailer });

if (config.INSECURE_DEV_RETURN_CODE) console.warn("INSECURE_DEV_RETURN_CODE is on: codes are returned in responses");
if (config.PLAY_MATCH_DAYS && signer && config.LEAGUE_ID) startScheduler(chain, config.LEAGUE_ID);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    `relay on :${info.port} (${config.NEAR_NETWORK}, league ${config.LEAGUE_ID ?? "not deployed"}, ` +
      `accounts under ${config.PARENT_ACCOUNT_ID}${signer ? "" : ", read-only: no parent key"})`,
  );
});

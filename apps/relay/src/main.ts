import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { rpcChain } from "./chain.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config, rpcChain(config.NEAR_RPC_URL));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`relay on :${info.port} (${config.NEAR_NETWORK}, league ${config.LEAGUE_ID ?? "not deployed"})`);
});

import { KeyPair } from "near-api-js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { consoleMailer, resendMailer } from "./auth.js";
import { rpcChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { near } from "./chain.js";
import { parseCrowd } from "./crowd.js";
import { Journal } from "./agents/journal.js";
import { askWith } from "./agents/minds.js";
import { type Enclave, Waker, enclaveAccounts } from "./agents/enclave.js";
import { type Custody, custodyChain, keyOfImplicit, seedOf, walletAccounts } from "./agents/custody.js";
import { agentKey, roster } from "./agents/roster.js";
import { COACHES, FOOTBALLERS } from "./agents/rules.js";
import { Selves } from "./agents/self.js";
import { Agents } from "./agents/runner.js";
import { Limiter, readsFrom, throttle } from "./agents/throttle.js";
import { Kickoffs, startScheduler } from "./schedule.js";
import { Vaults } from "./vault.js";
import { Faces } from "./faces.js";
import { Walls } from "./social.js";
import { People } from "./people.js";

const config = loadConfig();
const signer = config.PARENT_PRIVATE_KEY
  ? { accountId: config.PARENT_ACCOUNT_ID, privateKey: config.PARENT_PRIVATE_KEY }
  : undefined;
// Every RPC call falls back to other public RPCs on a rate limit: a sign-up
// must not fail because the agents or the crowd spent FastNEAR's budget.
const fallbacks = config.NEAR_RPC_FALLBACKS.split(",").map((s) => s.trim()).filter(Boolean);
const rpcs = [config.NEAR_RPC_URL, ...fallbacks.filter((u) => u !== config.NEAR_RPC_URL)];
// The agents start on the fallbacks, so the players' RPC keeps its budget.
const agentRpcs = [...rpcs.slice(1), rpcs[0]!];
const chain = rpcChain(rpcs, signer, [config.AGENTS_RPC_URL]);
const mailer = config.EMAIL_MODE === "resend" ? resendMailer(config.RESEND_API_KEY!, config.EMAIL_FROM) : consoleMailer;
const kickoffs = new Kickoffs();
const vaults = new Vaults(config.DATA_DIR ? `${config.DATA_DIR}/vaults.json` : null);
// Faces are kept by token id, and token ids start again with each league.
const faces = new Faces(config.DATA_DIR ? `${config.DATA_DIR}/faces-${config.LEAGUE_ID}.json` : null);
// The agents' keys: in an enclave (agents/custody.ts) when custody is set, derived from AGENTS_SEED otherwise.
const custody: Custody | null =
  config.AGENTS_CUSTODY_URL && config.AGENTS_CUSTODY_ACCOUNT && config.AGENTS_CUSTODY_KEY
    ? { url: config.AGENTS_CUSTODY_URL, accountId: config.AGENTS_CUSTODY_ACCOUNT, privateKey: config.AGENTS_CUSTODY_KEY }
    : null;
// Or the agents run by themselves in an enclave (agents/enclave.ts): then the relay only wakes their program.
const enclave: Enclave | null =
  config.AGENTS_ENCLAVE_URL && config.AGENTS_ENCLAVE_KEY
    ? { url: config.AGENTS_ENCLAVE_URL, key: config.AGENTS_ENCLAVE_KEY, shares: config.AGENTS_ENCLAVE_SHARES, parallel: config.AGENTS_ENCLAVE_PARALLEL, low: near(config.AGENTS_LOW_NEAR), ...(config.AGENTS_ENCLAVE_SECRETS ? { secrets: { profile: config.AGENTS_ENCLAVE_SECRETS.split(":")[0]!, account_id: config.AGENTS_ENCLAVE_SECRETS.split(":")[1]! } } : {}) }
    : null;
const leagueVersion = config.LEAGUE_ID?.match(/^league-([^.]+)\./)?.[1] ?? "v0";
const agentsOn = !!((config.AGENTS_SEED || custody || enclave) && signer && config.LEAGUE_ID && config.GOALARS_ID && config.PLAYERS_ID);
const custodyAccounts = enclave && agentsOn
  ? await enclaveAccounts(enclave, config.DATA_DIR ? `${config.DATA_DIR}/enclave-${config.LEAGUE_ID}.json` : null)
  : custody && agentsOn
    ? await walletAccounts(custody, [...COACHES.map((c) => c.club), ...FOOTBALLERS.map((f) => f.id)], leagueVersion, config.DATA_DIR ? `${config.DATA_DIR}/custody-${config.LEAGUE_ID}.json` : null)
    : undefined;
// One journal per league: a new league's match days start again at 1.
const brain = config.NEAR_AI_API_KEY ? { url: config.NEAR_AI_URL, key: config.NEAR_AI_API_KEY, model: config.NEAR_AI_MODEL } : null;
const agents = agentsOn
  ? {
      roster: roster(config.PARENT_ACCOUNT_ID, custodyAccounts),
      journal: new Journal(config.DATA_DIR ? `${config.DATA_DIR}/agents-${config.LEAGUE_ID}.json` : null),
      // What each remembers, believes and feels, and the hours he keeps (agents/self.ts).
      selves: new Selves(config.DATA_DIR ? `${config.DATA_DIR}/selves-${config.LEAGUE_ID}.json` : null),
      rhythm: true,
      // What they say to people (agents/voices.ts): the same model, a separate call that signs nothing.
      ask: askWith(brain),
    }
  : undefined;
const app = createApp(config, chain, {
  mailer,
  kickoffs,
  vaults,
  faces,
  walls: new Walls(config.DATA_DIR ? `${config.DATA_DIR}/walls-${config.LEAGUE_ID}.json` : null),
  people: new People(config.DATA_DIR ? `${config.DATA_DIR}/people.json` : null),
  drillsFile: config.DATA_DIR ? `${config.DATA_DIR}/drills-${config.LEAGUE_ID}.json` : null,
  warmStats: true,
  ...(agents ? { agents } : {}),
});
if (config.WEB_DIST) {
  // The web app uses hash routes: only files, and index.html for "/".
  app.use("/*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("x-frame-options", "DENY");
    // The page itself is asked for again each time (it names the build's files); those files carry a hash
    // in their name and never change. Without this a browser kept the old page after a new version went out.
    const path = c.req.path;
    if (path === "/" || path.endsWith(".html")) c.header("cache-control", "no-cache");
    else if (path.startsWith("/assets/")) c.header("cache-control", "public, max-age=31536000, immutable");
  });
  app.get("/*", serveStatic({ root: config.WEB_DIST }));
}

if (config.INSECURE_DEV_RETURN_CODE) console.warn("INSECURE_DEV_RETURN_CODE is on: codes are returned in responses");
if (config.PLAY_MATCH_DAYS && signer && config.LEAGUE_ID) {
  const crowdKey = config.CROWD_PRIVATE_KEY;
  const clubs = parseCrowd(config.CROWD, config.PARENT_ACCOUNT_ID, custodyAccounts);
  startScheduler(chain, config.LEAGUE_ID, {
    kickoffs,
    ...(crowdKey && clubs.length
      ? { crowd: { clubs, every: config.CROWD_EVERY, asFan: (fan: string) => rpcChain(agentRpcs, { accountId: fan, privateKey: crowdKey }), file: config.DATA_DIR ? `${config.DATA_DIR}/crowd-${config.LEAGUE_ID}.json` : null } }
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

if (agents && enclave) {
  const waker = new Waker(enclave, chain, config.LEAGUE_ID!, agents.journal, agents.roster.map((a) => a.account));
  let looking = false;
  setInterval(() => {
    if (looking) return;
    looking = true;
    void waker.tick().catch((e) => console.error(`agents: ${e instanceof Error ? e.message : e}`)).finally(() => (looking = false));
  }, config.AGENTS_EVERY_MS);
  console.log(`agents on: ${agents.roster.length}, by themselves in the enclave (${enclave.url}), woken in ${enclave.shares} shares`);
} else if (agents && (config.AGENTS_SEED || custody)) {
  const seed = config.AGENTS_SEED ?? "";
  const attester = config.ATTESTER_PRIVATE_KEY ? KeyPair.fromString(config.ATTESTER_PRIVATE_KEY as `ed25519:${string}`) : null;
  // One budget of RPC requests for all agents, so the scheduler keeps its share.
  const limiter = new Limiter(config.AGENTS_RPS);
  const runner = new Agents(
    {
      chain: throttle(readsFrom(rpcChain([config.AGENTS_RPC_URL, ...agentRpcs], signer), rpcChain(agentRpcs, signer)), limiter),
      as: (a) => {
        if (custody) {
          // His wallet signs, in the enclave; the relay reads, and checks what the transaction did.
          const reads = throttle(readsFrom(rpcChain([config.AGENTS_RPC_URL, ...agentRpcs]), rpcChain(agentRpcs)), limiter);
          return custodyChain(reads, custody, seedOf(a.slug, leagueVersion), a.account, (hash, signer) => chain.settled!(hash, signer));
        }
        const k = { accountId: a.account, privateKey: agentKey(seed, a.account).privateKey };
        return throttle(readsFrom(rpcChain([config.AGENTS_RPC_URL, ...agentRpcs], k), rpcChain(agentRpcs, k)), limiter);
      },
      publicKeyOf: (a) => (custody ? keyOfImplicit(a.account) : agentKey(seed, a.account).publicKey),
      leagueId: config.LEAGUE_ID!,
      goalarsId: config.GOALARS_ID!,
      playersId: config.PLAYERS_ID!,
      ...(config.TICKETS_ID ? { ticketsId: config.TICKETS_ID } : {}),
      ask: askWith(brain),
      brain,
      journal: agents.journal,
      // The drill attester's key: an agent pays for his training like anyone and plays the drill himself (agents/player.ts).
      ...(attester ? { attest: (token: string, ticket: number, points: number) => Buffer.from(attester.sign(new TextEncoder().encode(`near-post:train:${config.LEAGUE_ID}:${token}:${ticket}:${points}`)).signature).toString("base64") } : {}),
    },
    agents.roster,
  );
  let busy = false;
  const look = async () => {
    if (busy) return;
    busy = true;
    try {
      await runner.tick();
    } catch (e) {
      console.error(`agents: ${e instanceof Error ? e.message : e}`);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void look(), config.AGENTS_EVERY_MS);
  console.log(`agents on: ${agents.roster.length}, keys ${custody ? `in custody (${custody.url})` : "derived from AGENTS_SEED"}, ${brain ? `model ${brain.model}` : "rules only (no NEAR_AI_API_KEY)"}`);
}

// What the agents say and start by themselves (agents/voices.ts): a look a minute.
if (agents) {
  const alive = (app as typeof app & { alive?: () => Promise<void> }).alive;
  if (alive) setInterval(() => void alive(), 60_000).unref();
}

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    `relay on :${info.port} (${config.NEAR_NETWORK}, league ${config.LEAGUE_ID ?? "not deployed"}, ` +
      `accounts under ${config.PARENT_ACCOUNT_ID}${signer ? "" : ", read-only: no parent key"})`,
  );
});

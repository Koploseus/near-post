// Gives each fictional club's account its coach's key: the key the relay
// derives from AGENTS_SEED (apps/relay/src/agents/roster.ts), added as an
// access key, signed with the club's own key from <keys-dir>. The footballer
// agents' accounts are created by the relay itself. Idempotent; prints no key.
// Usage: pnpm --filter @near-post/relay build && AGENTS_SEED_FILE=<file> node scripts/agents-keys.mjs <keys-dir>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../apps/relay/package.json", import.meta.url));
const { Account, JsonRpcProvider } = require("near-api-js");
const { agentKey, roster } = await import("../apps/relay/dist/agents/roster.js");

const [keys] = process.argv.slice(2);
const PARENT = "near-post.testnet";
const seed = readFileSync(process.env.AGENTS_SEED_FILE, "utf8").trim();
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });

for (const a of roster(PARENT).filter((a) => a.kind === "coach")) {
  const { publicKey } = agentKey(seed, a.account);
  const has = await provider.viewAccessKey({ accountId: a.account, publicKey }).then(() => true, () => false);
  if (has) {
    console.log(`${a.account}: has its coach key`);
    continue;
  }
  const own = JSON.parse(readFileSync(`${keys}/${a.account}.json`, "utf8")).private_key;
  const r = await new Account(a.account, provider, own).addFullAccessKey(publicKey);
  console.log(`${a.account}: coach key added ${r.transaction.hash}`);
}

// What a browser does: make a key pair, sign in by email through the relay,
// then play with its own key. The private key is saved to the keys folder
// (mode 600) and never printed.
// Usage: node email-e2e.mjs <keys-dir> <relay-url> <email>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../apps/relay/package.json", import.meta.url));
const { Account, JsonRpcProvider, KeyPair } = require("near-api-js");

const [keys, relay, email] = process.argv.slice(2);
const LEAGUE = "league-v11.near-post.testnet";
const PLAYERS = "players-v11.near-post.testnet";
const post = async (path, body) => {
  const r = await fetch(relay + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const kp = KeyPair.fromRandom("ed25519");
const start = await post("/v1/auth/start", { email });
console.log("start", start.status, "account", start.body.account_id);
const verify = await post("/v1/auth/verify", { email, code: start.body.code, public_key: kp.getPublicKey().toString() });
console.log("verify", verify.status, JSON.stringify({ ...verify.body }));
const id = verify.body.account_id;
writeFileSync(`${keys}/${id}.json`, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });

await new Promise((s) => setTimeout(s, 3000));
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const me = new Account(id, provider, kp.toString());
const call = async (contractId, methodName, args, deposit = 0n, tgas = 100n) => {
  const r = await me.callFunctionRaw({ contractId, methodName, args, deposit, gas: tgas * 10n ** 12n });
  console.log(methodName, r.transaction.hash);
  return r;
};
const p = JSON.parse(Buffer.from((await call(LEAGUE, "create_footballer", { name: "Inès", position: "Mf" })).status.SuccessValue, "base64").toString());
console.log("footballer", p.token_id, p.name, p.position, "attack", p.attack, "defence", p.defence);
await call(PLAYERS, "nft_transfer", { receiver_id: "port-lune.near-post.testnet", token_id: p.token_id }, 1n);
await new Promise((s) => setTimeout(s, 3000));
await call(LEAGUE, "report_for_match", {}, 0n, 30n);
const now = await provider.callFunction({ contractId: LEAGUE, method: "footballer_of", args: { account_id: id } });
console.log("plays for", now.owner, "| reported:", await provider.callFunction({ contractId: LEAGUE, method: "is_reported", args: { token_id: p.token_id, match_day: (await provider.callFunction({ contractId: LEAGUE, method: "match_day", args: {} })) } }));
const acc = await provider.viewAccount({ accountId: id });
console.log("NEAR left for gas", (Number(BigInt(acc.amount) / 10n ** 18n) / 1e6).toFixed(4));

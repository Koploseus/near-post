// Deploys the four checked-in wasm to testnet as sub-accounts of near-post.testnet.
// Keys are read from / written to <keys-dir> (mode 600, outside the repo) and never printed.
// Usage: node scripts/deploy-testnet.mjs <keys-dir> . <version> <match-interval-ms>
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const require = createRequire(new URL("../apps/relay/package.json", import.meta.url));
const { Account, JsonRpcProvider, KeyPair } = require("near-api-js");

const [keys, repo, version, intervalMs] = process.argv.slice(2);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const PARENT = "near-post.testnet";
const near = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const load = (id) => JSON.parse(readFileSync(`${keys}/${id}.json`, "utf8"));
const accountOf = (id) => new Account(id, provider, load(id).private_key);

const parent = accountOf(PARENT);

// NEAR per contract account: code storage (1 NEAR per 100 kB) plus room for
// state. Players also pays storage for every NFT it mints.
const plan = [
  ["league", 4.0],
  ["goalars", 2.0],
  ["players", 3.6],
  ["items", 1.8],
];
const manifest = { network: "testnet", version, deployed_at: new Date().toISOString(), contracts: {} };
for (const [name, fund] of plan) {
  const id = `${name}-${version}.${PARENT}`;
  const wasm = readFileSync(`${repo}/contracts/res/${name}.wasm`);
  const sha256 = createHash("sha256").update(wasm).digest("hex");
  if (!existsSync(`${keys}/${id}.json`)) {
    const kp = KeyPair.fromRandom("ed25519");
    writeFileSync(`${keys}/${id}.json`, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
    const r = await parent.createSubAccount({ accountOrPrefix: `${name}-${version}`, publicKey: kp.getPublicKey().toString(), nearToTransfer: near(fund) });
    console.log("created", id, r.transaction.hash);
  }
  const r = await accountOf(id).deployContract(new Uint8Array(wasm));
  console.log("deployed", id, sha256.slice(0, 12), r.transaction.hash);
  manifest.contracts[name] = { account_id: id, wasm_sha256: sha256, deploy_tx: r.transaction.hash };
}

const id = (n) => manifest.contracts[n].account_id;
const init = async (n, args) => {
  const r = await accountOf(id(n)).callFunctionRaw({ contractId: id(n), methodName: "new", args, gas: 30_000_000_000_000n });
  manifest.contracts[n].init_tx = r.transaction.hash;
  console.log("init", id(n), r.transaction.hash);
};
for (const n of ["goalars", "players", "items"]) await init(n, { league_id: id("league") });
await init("league", { goalars_id: id("goalars"), players_id: id("players"), items_id: id("items"), match_interval_ms: String(intervalMs) });

writeFileSync(`${repo}/deployments/testnet.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log("manifest written");

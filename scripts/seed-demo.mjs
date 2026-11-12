// Makes the testnet league look alive: more clubs (with rivals), and a demo
// crowd of fan accounts that share one key, so the relay can seat them each
// match day (CROWD_PRIVATE_KEY). Also tops up the contracts' storage balance.
// Idempotent. Keys are read from / written to <keys-dir> (mode 600) and never printed.
// Usage: node scripts/seed-demo.mjs <keys-dir> <league-id>
//
// With CUSTODY_URL and CUSTODY_ACCOUNT (and <keys-dir>/<CUSTODY_ACCOUNT>.json), the
// fictional clubs belong to their coaches' OutLayer wallets (apps/relay/src/agents/custody.ts):
// the club's account is the wallet's implicit account, its calls go through the wallet, and
// the accounts of all agents are written to deployments/testnet-agents.json. Build the relay first.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const require = createRequire(new URL("../apps/relay/package.json", import.meta.url));
const { Account, JsonRpcProvider, KeyPair } = require("near-api-js");

const [keys, LEAGUE] = process.argv.slice(2);
const PARENT = "near-post.testnet";
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const near = (n) => BigInt(Math.round(n * 1000)) * 10n ** 21n;
const load = (id) => JSON.parse(readFileSync(`${keys}/${id}.json`, "utf8"));
const save = (id, kp) =>
  writeFileSync(`${keys}/${id}.json`, JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
const as = (id, key = load(id).private_key) => new Account(id, provider, key);
const exists = (id) => provider.viewAccount({ accountId: id }).then(() => true, () => false);
const view = (method, args = {}) => provider.callFunction({ contractId: LEAGUE, method, args });
const parent = as(PARENT);

const version = LEAGUE.match(/^league-([^.]+)\./)?.[1];
if (!version) throw new Error(`not a league account: ${LEAGUE}`);
const custody = process.env.CUSTODY_URL && process.env.CUSTODY_ACCOUNT ? { url: process.env.CUSTODY_URL, accountId: process.env.CUSTODY_ACCOUNT, privateKey: load(process.env.CUSTODY_ACCOUNT).private_key } : null;
const wallets = {};
let viaWallet = null;
if (custody) {
  const { walletAccounts, custodyChain, seedOf } = await import("../apps/relay/dist/agents/custody.js");
  const { COACHES, FOOTBALLERS } = await import("../apps/relay/dist/agents/rules.js");
  const file = new URL("../deployments/testnet-agents.json", import.meta.url).pathname;
  const slugs = [...COACHES.map((c) => c.club), ...FOOTBALLERS.map((f) => f.id)];
  Object.assign(wallets, await walletAccounts(custody, slugs, version, null));
  if (Object.keys(wallets).length !== slugs.length) throw new Error(`custody: ${Object.keys(wallets).length} wallets of ${slugs.length}`);
  writeFileSync(file, JSON.stringify({ network: "testnet", version, custody: { api: custody.url, account_id: custody.accountId }, agents: wallets }, null, 2) + "\n");
  console.log("wallets", slugs.length);
  viaWallet = (prefix) => custodyChain({}, custody, seedOf(prefix, version), wallets[prefix], async () => {});
}
/** A fictional club's account: its coach's wallet in custody, a sub-account otherwise. */
const clubId = (prefix) => wallets[prefix] ?? `${prefix}.${PARENT}`;
/** A call signed by the club. */
const clubCall = (prefix, method, args, tgas = 50) => (viaWallet ? viaWallet(prefix).call(LEAGUE, method, args, tgas) : call(as(clubId(prefix)), method, args, tgas));

/** Fictional clubs only (their AI coaches keep these names: apps/relay/src/agents/rules.ts). [account prefix, name, crowd size, rival prefix] */
const CLUBS = [
  ["rive-nord", "Northbank Rovers", 5, "port-lune"],
  ["port-lune", "Moonhaven FC", 4, "rive-nord"],
  ["pont-levant", "Drawbridge Athletic", 3, "haute-ville"],
  ["haute-ville", "Highcastle City", 4, "pont-levant"],
  ["marais", "Marshwick Town", 2, "vieux-phare"],
  ["vieux-phare", "Lanternpoint FC", 3, "marais"],
  ["saint-cendre", "St Cinder Albion", 2, "cote-rouge"],
  ["cote-rouge", "Redcliff Wanderers", 3, "saint-cendre"],
];
/** More fictional clubs, no crowd: enough for a second division (DIVISIONS=1 skips them). */
const MORE = [
  ["val-ombre", "Shadowvale Sporting"],
  ["pierrefeu", "Emberstone AFC"],
  ["docks", "Dockside Stars"],
  ["clairbois", "Brightwood FC"],
  ["mont-gris", "Greymount Olympic"],
  ["bellerive", "Fairbank Rangers"],
  ["lavandier", "Lavenmere FC"],
  ["bois-joli", "Bramblewood Racing"],
  ["fontaine-rouge", "Redwell Athletic"],
  ["quais", "Quayside Union"],
  ["hautes-herbes", "Tallgrass Town"],
  ["rocheblanche", "Chalkstone Rovers"],
  ["grand-pre", "Meadowmere SC"],
  ["tour-neuve", "Newtower Athletic"],
  ["maree-basse", "Lowtide FC"],
  ["lune-rousse", "Copper Moon FC"],
];

async function sub(prefix, publicKey, fund) {
  const id = `${prefix}.${PARENT}`;
  if (await exists(id)) return id;
  const r = await parent.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: near(fund) });
  console.log("created", id, r.transaction.hash);
  return id;
}
const call = async (acct, method, args, tgas = 50) => {
  const r = await acct.callFunctionRaw({ contractId: LEAGUE, methodName: method, args, gas: BigInt(tgas) * 10n ** 12n });
  if (r.status?.Failure) throw new Error(`${acct.accountId}.${method}: ${JSON.stringify(r.status.Failure).slice(0, 200)}`);
  return r.transaction.hash;
};

// Storage for the new clubs (skipped with SKIP_TOPUP=1), squads, fans and stands is paid by the contracts.
for (const [prefix, fund] of [[`league-${version}`, 15], [`players-${version}`, 5], [`goalars-${version}`, 3]]) {
  if (process.env.SKIP_TOPUP) break;
  const r = await parent.transfer({ receiverId: `${prefix}.${PARENT}`, amount: near(fund) });
  console.log("storage top-up", prefix, fund, "NEAR", r.transaction.hash);
}

if (!existsSync(`${keys}/crowd.json`)) save("crowd", KeyPair.fromRandom("ed25519"));
const crowd = load("crowd");

for (const [prefix, name] of [...CLUBS, ...(process.env.DIVISIONS === "1" ? [] : MORE)]) {
  const id = clubId(prefix);
  if (custody) {
    // A wallet's account exists from its first NEAR.
    if (!(await exists(id))) console.log("funded", prefix, (await parent.transfer({ receiverId: id, amount: near(0.6) })).transaction.hash);
  } else {
    if (!existsSync(`${keys}/${id}.json`)) save(id, KeyPair.fromRandom("ed25519"));
    await sub(prefix, load(id).public_key, 0.5);
  }
  if (!(await view("get_club", { club_id: id }))) console.log("club", name, await clubCall(prefix, "create_club", { name }, 300));
}
for (const [prefix, , , rival] of CLUBS) {
  const club = await view("get_club", { club_id: clubId(prefix) });
  if (club.rival !== clubId(rival)) console.log("rival", prefix, rival, await clubCall(prefix, "set_rival", { rival: clubId(rival) }));
}
const spec = [];
for (const [prefix, , size] of CLUBS) {
  for (let n = 1; n <= size; n++) {
    const fan = await sub(`${prefix}-f${n}`, crowd.public_key, 0.1);
    console.log("follow", fan, await call(as(fan, crowd.private_key), "follow", { club_id: clubId(prefix) }));
  }
  spec.push(`${prefix}:${size}`);
}
console.log(`CROWD=${spec.join(",")}`);

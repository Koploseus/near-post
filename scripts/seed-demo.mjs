// Makes the testnet league look alive: more clubs (with rivals), and a demo
// crowd of fan accounts that share one key, so the relay can seat them each
// match day (CROWD_PRIVATE_KEY). Also tops up the contracts' storage balance.
// Idempotent. Keys are read from / written to <keys-dir> (mode 600) and never printed.
// Usage: node scripts/seed-demo.mjs <keys-dir> <league-id>
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
const version = LEAGUE.match(/^league-([^.]+)\./)?.[1];
if (!version) throw new Error(`not a league account: ${LEAGUE}`);
for (const [prefix, fund] of [[`league-${version}`, 15], [`players-${version}`, 5], [`goalars-${version}`, 3]]) {
  if (process.env.SKIP_TOPUP) break;
  const r = await parent.transfer({ receiverId: `${prefix}.${PARENT}`, amount: near(fund) });
  console.log("storage top-up", prefix, fund, "NEAR", r.transaction.hash);
}

if (!existsSync(`${keys}/crowd.json`)) save("crowd", KeyPair.fromRandom("ed25519"));
const crowd = load("crowd");

for (const [prefix, name] of [...CLUBS, ...(process.env.DIVISIONS === "1" ? [] : MORE)]) {
  const id = `${prefix}.${PARENT}`;
  if (!existsSync(`${keys}/${id}.json`)) save(id, KeyPair.fromRandom("ed25519"));
  await sub(prefix, load(id).public_key, 0.5);
  if (!(await view("get_club", { club_id: id }))) console.log("club", name, await call(as(id), "create_club", { name }, 100));
}
for (const [prefix, , , rival] of CLUBS) {
  const id = `${prefix}.${PARENT}`;
  const club = await view("get_club", { club_id: id });
  if (club.rival !== `${rival}.${PARENT}`) console.log("rival", prefix, rival, await call(as(id), "set_rival", { rival: `${rival}.${PARENT}` }));
}
const spec = [];
for (const [prefix, , size] of CLUBS) {
  for (let n = 1; n <= size; n++) {
    const fan = await sub(`${prefix}-f${n}`, crowd.public_key, 0.1);
    console.log("follow", fan, await call(as(fan, crowd.private_key), "follow", { club_id: `${prefix}.${PARENT}` }));
  }
  spec.push(`${prefix}:${size}`);
}
console.log(`CROWD=${spec.join(",")}`);

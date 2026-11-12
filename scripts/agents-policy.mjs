// Limits what each AI agent's wallet may sign (apps/relay/src/agents/custody.ts): contract
// calls to the five contracts of the league, and nothing else: no transfer, no other contract.
// The policy is stored on OutLayer's contract by <owner>, an account whose key is NOT on the
// relay: the relay can ask a wallet for a call, it cannot change what the wallet accepts.
// Idempotent. Keys are read from <keys-dir> (mode 600, outside the repo) and never printed.
// Usage: pnpm --filter @near-post/relay build && node scripts/agents-policy.mjs <keys-dir> <owner-account> [check]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(new URL("../apps/relay/package.json", import.meta.url));
const { Account, JsonRpcProvider } = require("near-api-js");
const { bearer, seedOf } = await import("../apps/relay/dist/agents/custody.js");

const [keys, OWNER, mode] = process.argv.slice(2);
const load = (id) => JSON.parse(readFileSync(`${keys}/${id}.json`, "utf8"));
const deployed = JSON.parse(readFileSync(new URL("../deployments/testnet.json", import.meta.url), "utf8"));
const wallets = JSON.parse(readFileSync(new URL("../deployments/testnet-agents.json", import.meta.url), "utf8"));
if (wallets.version !== deployed.version) throw new Error(`agents are ${wallets.version}, contracts ${deployed.version}`);
const custody = { url: wallets.custody.api, accountId: wallets.custody.account_id, privateKey: load(wallets.custody.account_id).private_key };
const OUTLAYER = custody.url.includes("testnet") ? "outlayer.testnet" : "outlayer.near";
const allowed = Object.values(deployed.contracts).map((c) => c.account_id).sort();
const policy = { rules: { transaction_types: ["call"], addresses: { mode: "whitelist", list: allowed } } };

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const owner = mode === "check" ? null : new Account(OWNER, provider, load(OWNER).private_key);
const api = async (seed, path, body) => {
  const r = await fetch(`${custody.url}${path}`, { method: body ? "POST" : "GET", headers: { authorization: bearer(custody, seed), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
};
const same = (p) => p.policy === "stored" && JSON.stringify(p.rules?.transaction_types) === '["call"]' && p.rules?.addresses?.mode === "whitelist" && JSON.stringify([...(p.rules.addresses.list ?? [])].sort()) === JSON.stringify(allowed);

let ok = 0;
for (const slug of Object.keys(wallets.agents)) {
  const seed = seedOf(slug, wallets.version);
  const now = await api(seed, "/wallet/v1/policy");
  if (same(now)) {
    ok++;
    continue;
  }
  if (mode === "check") {
    console.log("no policy", slug);
    continue;
  }
  const enc = await api(seed, "/wallet/v1/encrypt-policy", { wallet_id: now.wallet_id, ...policy });
  const sig = await api(seed, "/wallet/v1/sign-policy", { encrypted_data: enc.encrypted_base64, caller: OWNER });
  if (!sig.signature_hex) throw new Error(`${slug}: the policy is locked: ${JSON.stringify(sig).slice(0, 200)}`);
  const r = await owner.callFunctionRaw({
    contractId: OUTLAYER,
    methodName: "store_wallet_policy",
    args: { wallet_pubkey: `ed25519:${sig.public_key_hex}`, encrypted_data: enc.encrypted_base64, wallet_signature: sig.signature_hex, version: sig.version, locked: sig.locked, valid_until: sig.valid_until },
    gas: 100_000_000_000_000n,
    deposit: 5n * 10n ** 22n,
  });
  if (r.status?.Failure) throw new Error(`${slug}: ${JSON.stringify(r.status.Failure).slice(0, 300)}`);
  console.log("policy", slug, r.transaction.hash);
  ok++;
}
console.log(`${ok} of ${Object.keys(wallets.agents).length} wallets may only call: ${allowed.join(", ")}`);

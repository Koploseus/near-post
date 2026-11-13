#!/usr/bin/env node
// Replays NEAR Post's money from the chain and checks every rule of the G mechanic.
//
//   node scripts/verify.mjs            # the last 10 settled match days
//   node scripts/verify.mjs --days 30  # more (up to what the league's ledger still holds)
//
// No keys, no backend, no dependencies: it reads public views on NEAR testnet
// (NEAR_RPC_URL to use another RPC) and recomputes, for every match day:
//   - each stand: full house exactly when present >= ceil(fans x 60%);
//   - each full house mints 100k G per fan present (x2 in a derby);
//   - each stand that is not full burns from its club treasury, and nothing else does;
//   - each goal mints 600k G scaled by how full the scoring club's stand was (x2 after
//     the 90th minute): an empty stand mints nothing, whatever the score;
//   - season tickets pay only on a full house;
//   - the supply stays under the 10B cap.
// It also checks the deployed code is the code in contracts/res (sha256 = code hash).
// Exit code 0 when every check passes, 1 otherwise.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(join(root, "deployments/testnet.json"), "utf8"));
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const LEAGUE = deployment.contracts.league.account_id;
const GOALARS = deployment.contracts.goalars.account_id;
const daysArg = process.argv.indexOf("--days");
const DAYS = daysArg > 0 ? Number(process.argv[daysArg + 1]) : 10;

// ---------------------------------------------------------------- reading the chain

async function rpc(params, attempt = 0) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) });
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    return rpc(params, attempt + 1);
  }
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error).slice(0, 300));
  return body.result;
}
const view = async (account_id, method_name, args = {}) =>
  JSON.parse(Buffer.from((await rpc({ request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") })).result).toString());

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = `1${out}`; }
  return out;
}

// ---------------------------------------------------------------- reporting

let failed = 0;
let passed = 0;
const fail = (what) => { failed += 1; console.log(`  ✗ ${what}`); };
const pass = () => { passed += 1; };
const check = (ok, what) => (ok ? pass() : fail(what));
const G = (raw) => `${(Number(BigInt(raw) / 1_000n) / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} G`;

// ---------------------------------------------------------------- 1. the code

console.log(`NEAR Post, verified from the chain (${RPC})\n`);
console.log("1. The deployed code is the code in this repository");
for (const [name, c] of Object.entries(deployment.contracts)) {
  const wasm = readFileSync(join(root, "contracts/res", `${name}.wasm`));
  const sha = createHash("sha256").update(wasm).digest();
  const account = await rpc({ request_type: "view_account", account_id: c.account_id });
  check(sha.toString("hex") === c.wasm_sha256, `${name}: contracts/res/${name}.wasm differs from deployments/testnet.json`);
  check(account.code_hash === base58(sha), `${name}: ${c.account_id} runs ${account.code_hash}, not contracts/res/${name}.wasm (${base58(sha)})`);
  const keys = (await rpc({ request_type: "view_access_key_list", account_id: c.account_id })).keys.length;
  console.log(`  ${account.code_hash === base58(sha) ? "✓" : "✗"} ${c.account_id}  code ${base58(sha).slice(0, 10)}…  ${keys ? `${keys} deploy key(s) still on the account (testnet, see Limits)` : "no key"}`);
}

// ---------------------------------------------------------------- 2. the rules

const rules = await view(LEAGUE, "rules");
const N = (x) => BigInt(x);
console.log("\n2. The rules, fixed at deploy time (league `rules()`)");
console.log(`  full house: ${G(rules.full_house_mint_per_fan)} per fan present, when present >= ${rules.stadium_target_bps / 100}% of the club's fans`);
console.log(`  stand not full: ${rules.empty_stand_burn_bps / 100}% of the club treasury burned`);
console.log(`  goal: ${G(rules.goal_mint)} x stand fill (x${rules.late_goal_multiplier} after the 90th minute, x${rules.derby_multiplier} in a derby); own goal burns up to ${G(rules.own_goal_burn)}`);
console.log(`  burned on use: training ${G(rules.training_cost)}, pack ${G(rules.pack_price)}, ${rules.sale_tax_bps / 100}% of each sale, ${rules.relegation_burn_bps / 100}% of a relegated treasury`);
console.log(`  no G for signing up or following: ${G(rules.signup_grant)} once to the founder of a club, ${G(rules.debut_bonus ?? 0)} to a person after the first match his footballer starts`);
if (rules.ola_bonus_bps) console.log(`  ola: +${rules.ola_bonus_bps / 100}% full-house reward when ${rules.ola_target_bps / 100}% of the target came in the last ${Number(rules.ola_window_ms) / 60_000} minutes; stadium: +${rules.stadium_bonus_bps / 100}% per level`);
if (rules.fans_star_prize) console.log(`  fans' star of the match: ${G(rules.fans_star_prize)} x stand fill to the player the stand voted`);
if (rules.project_cost) console.log(`  club projects (voted each week by players and season tickets, burned): stadium ${G(rules.project_cost[0])}, physio ${G(rules.project_cost[1])}, academy ${G(rules.project_cost[2])} for the first level`);

// ---------------------------------------------------------------- 3. replaying the match days

const target = (fans) => Math.ceil((fans * rules.stadium_target_bps) / 10_000);
const [current, table, ledger] = await Promise.all([view(LEAGUE, "match_day"), view(LEAGUE, "table"), view(LEAGUE, "ledger", { limit: 600 })]);
const clubs = table.map((c) => c.manager);
const withFans = table.filter((c) => c.fans > 0).map((c) => c.manager);
// The ledger is a ring of 600 entries: keep only days it still holds whole. Until it is full
// (a young league), its oldest day is whole too.
const RING = 600;
const oldest = ledger.length ? Math.min(...ledger.map((e) => e.match_day)) : current;
const whole = ledger.length < RING ? oldest - 1 : oldest;
const days = [];
for (let d = current - 1; d > whole && d >= 1 && days.length < DAYS; d -= 1) days.push(d);
console.log(
  days.length
    ? `\n3. Replaying match days ${days.at(-1)}–${days[0]} (${withFans.length} clubs with fans, ${table.length} clubs)`
    : `\n3. No match day is settled yet (match day ${current} is the first): nothing to replay`,
);

const PRESENCE = new Set(["full_house", "goals", "season_tickets", "fans_star"]);
const ONBOARDING = new Set(["signup", "welcome", "debut"]);
// What a fan present in a full house gets: doubled in a derby, more with each
// stadium level, more again after an ola (as the league computes it).
const reward = (s) => {
  let r = N(rules.full_house_mint_per_fan) * BigInt(s.multiplier);
  r += (r * BigInt(s.stadium ?? 0) * BigInt(rules.stadium_bonus_bps ?? 0)) / 10_000n;
  if (s.ola) r += (r * BigInt(rules.ola_bonus_bps ?? 0)) / 10_000n;
  return r;
};
const rows = [];
for (const day of days) {
  const entries = ledger.filter((e) => e.match_day === day);
  const results = await view(LEAGUE, "results", { match_day: day });
  const stands = new Map();
  // Every club, not only those with fans today: fans come and go.
  const read = await Promise.all(clubs.map((club) => view(LEAGUE, "stand_result", { club_id: club, match_day: day })));
  read.forEach((s, i) => { if (s && s.fans > 0) stands.set(clubs[i], s); });
  const fill = (club) => {
    const s = stands.get(club);
    if (!s || s.fans === 0 || target(s.fans) === 0) return 0n;
    const bps = (BigInt(s.present) * 10_000n) / BigInt(target(s.fans));
    return bps > 10_000n ? 10_000n : bps;
  };
  const of = (kind, club) => entries.filter((e) => e.kind === kind && e.who === club).map((e) => e.amount);
  const sameAmounts = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // Stands: full house rule, full-house mint, burns only when not full.
  let present = 0;
  let wanted = 0;
  for (const [club, s] of stands) {
    present += s.present;
    wanted += target(s.fans);
    check(s.full_house === (s.present >= target(s.fans)), `D${day} ${club}: full_house=${s.full_house} with ${s.present}/${target(s.fans)} present`);
    const mint = of("full_house", club);
    const expectMint = s.full_house && s.present > 0 ? [(reward(s) * BigInt(s.present)).toString()] : [];
    check(sameAmounts(mint, expectMint), `D${day} ${club}: full-house mint ${mint} != ${expectMint}`);
    const burn = of("empty_stand", club);
    const expectBurn = BigInt(s.burned) > 0n ? [s.burned] : [];
    check(sameAmounts(burn, expectBurn), `D${day} ${club}: empty-stand burn ${burn} != ${expectBurn}`);
    check(!(s.full_house && BigInt(s.burned) > 0n), `D${day} ${club}: a full stand burned its treasury`);
    check(!(s.ola && !s.full_house), `D${day} ${club}: an ola without a full house`);
    // The fans' star: paid in proportion to the stand, only when the stand voted one.
    const star = of("fans_star", club);
    const prize = s.star ? (N(rules.fans_star_prize) * BigInt(s.multiplier) * fill(club)) / 10_000n : 0n;
    check(sameAmounts(star, prize > 0n ? [prize.toString()] : []), `D${day} ${club}: fans' star ${star} != ${prize}`);
  }
  // No stand settled for a club without fans, and no stand mint for anyone else.
  for (const e of entries.filter((x) => x.kind === "full_house" || x.kind === "empty_stand")) check(stands.has(e.who), `D${day}: ${e.kind} for ${e.who}, a club without fans`);

  // Goals: each one mints goal_mint x fill (x2 late, x2 derby); an empty stand mints nothing.
  const expectGoals = new Map();
  for (const m of results) {
    for (const goal of m.goals ?? []) {
      if (goal.kind === "Own") continue;
      const club = goal.for_home ? m.home : m.away;
      const k = goal.kind === "Late" ? BigInt(rules.late_goal_multiplier) : 1n;
      const amount = (k * N(rules.goal_mint) * fill(club)) / 10_000n;
      if (amount > 0n) expectGoals.set(club, [...(expectGoals.get(club) ?? []), amount.toString()]);
    }
  }
  const scoring = new Set([...expectGoals.keys(), ...entries.filter((e) => e.kind === "goals").map((e) => e.who)]);
  for (const club of scoring) check(sameAmounts(of("goals", club), expectGoals.get(club) ?? []), `D${day} ${club}: goal mints ${of("goals", club)} != ${expectGoals.get(club) ?? []}`);
  const goalsScored = results.reduce((a, m) => a + (m.goals ?? []).filter((x) => x.kind !== "Own").length, 0);
  const goalsPaid = entries.filter((e) => e.kind === "goals").length;

  // Season tickets: only for a full house.
  for (const e of entries.filter((x) => x.kind === "season_tickets")) check(stands.get(e.who)?.full_house === true, `D${day}: season tickets paid to ${e.who} without a full house`);

  const sum = (pred) => entries.filter(pred).reduce((a, e) => a + BigInt(e.amount), 0n);
  rows.push({
    day,
    fill: wanted ? Math.round((present * 100) / wanted) : 0,
    full: [...stands.values()].filter((s) => s.full_house).length,
    stands: stands.size,
    goals: `${goalsPaid}/${goalsScored}`,
    minted: sum((e) => e.mint && PRESENCE.has(e.kind)),
    onboarding: sum((e) => e.mint && ONBOARDING.has(e.kind)),
    burned: sum((e) => !e.mint),
  });
}

console.log("\n  day  fans in  full   goals that   minted by      onboarding    burned");
console.log("       stands  houses minted G     presence");
for (const r of rows) {
  console.log(`  ${String(r.day).padStart(3)}  ${String(r.fill).padStart(5)}%  ${`${r.full}/${r.stands}`.padStart(5)}  ${r.goals.padStart(9)}   ${G(r.minted).padStart(13)}  ${G(r.onboarding).padStart(12)}  ${G(r.burned).padStart(13)}`);
}

// ---------------------------------------------------------------- 4. the supply

const supply = await view(GOALARS, "ft_total_supply");
const cap = await view(GOALARS, "max_supply");
console.log(`\n4. Supply: ${G(supply)} of a ${G(cap)} cap`);
check(BigInt(supply) <= BigInt(cap), `supply ${supply} above the cap ${cap}`);
const fuller = rows.filter((r) => r.fill >= 50);
const emptier = rows.filter((r) => r.fill < 50);
const net = (rs) => rs.reduce((a, r) => a + r.minted - r.burned, 0n) / BigInt(Math.max(1, rs.length));
if (fuller.length && emptier.length) console.log(`  net G per match day: ${G(net(fuller))} when the stands were half full or more, ${G(net(emptier))} when they were not`);

// ---------------------------------------------------------------- 5. who moves the money

// AI coaches run the fictional clubs and AI footballers play beside people. Their accounts
// are their OutLayer wallets' (deployments/testnet-agents.json; before v11, <club>.<parent>
// and ai-<n>.<parent>); people sign in as u<hash>. Same contract methods, same rights.
let wallets = {};
try {
  wallets = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL("../deployments/testnet-agents.json", import.meta.url), "utf8")).agents).map(([slug, account]) => [account, slug]));
} catch {
  // not run from the repository: the accounts' names still tell most of it
}
const who = (account) => {
  if (!account) return "transfers";
  const slug = wallets[account] ?? account;
  return /^ai-\d+(\.|$)/.test(slug) ? "AI footballers" : /^u[0-9a-f]{8,}\./.test(slug) ? "people" : "clubs (AI coaches and managers)";
};
const spent = new Map();
for (const e of ledger.filter((x) => !x.mint && ["pack", "training", "sale_tax", "project", "diet"].includes(x.kind))) {
  const k = `${who(e.who)}|${e.kind}`;
  const [n, total] = spent.get(k) ?? [0, 0n];
  spent.set(k, [n + 1, total + BigInt(e.amount)]);
}
console.log(`\n5. Who spends G (burned on use, match days ${whole + 1}–${Math.max(whole + 1, current - 1)}, and today so far)`);
for (const [k, [n, total]] of [...spent].sort((a, b) => (b[1][1] > a[1][1] ? 1 : -1))) {
  const [actor, kind] = k.split("|");
  console.log(`  ${actor.padEnd(32)} ${kind.padEnd(9)} ${String(n).padStart(4)} times  ${G(total).padStart(14)}`);
}

console.log(`\n${failed === 0 ? "✓" : "✗"} ${passed} checks passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

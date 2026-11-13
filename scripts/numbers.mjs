#!/usr/bin/env node
// What the game has played since its first league, read from the chain: no key, no account.
// Each league is its own set of contracts (`*-v1` to `*-v13.near-post.testnet`); nothing here comes
// from our servers. A league keeps the results of its last match days only, so matches and goals
// are "at least" for the long ones.
//
//   node scripts/numbers.mjs            every league
//   node scripts/numbers.mjs 13         one league

const RPC = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
const LATEST = 13;

async function view(account, method, args = {}) {
  for (const url of RPC) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
      });
      const j = await r.json();
      if (j.result?.result) return JSON.parse(Buffer.from(j.result.result).toString());
    } catch {
      /* the next endpoint */
    }
  }
  return null;
}

async function league(n) {
  const id = `league-v${n}.near-post.testnet`;
  const schedule = await view(id, "schedule");
  if (!schedule) return null;
  const days = Math.max(0, (schedule.match_day ?? 1) - 1);
  let matches = 0;
  let goals = 0;
  for (let from = 1; from <= days; from += 8) {
    const batch = await Promise.all(Array.from({ length: Math.min(8, days - from + 1) }, (_, k) => view(id, "results", { match_day: from + k })));
    for (const day of batch) {
      for (const m of day ?? []) {
        matches += 1;
        goals += (m.home_goals ?? 0) + (m.away_goals ?? 0);
      }
    }
  }
  const [clubs, footballers, tickets, supply] = await Promise.all([
    view(id, "table"),
    view(`players-v${n}.near-post.testnet`, "nft_total_supply"),
    view(`tickets-v${n}.near-post.testnet`, "nft_total_supply"),
    view(`goalars-v${n}.near-post.testnet`, "ft_total_supply"),
  ]);
  return { n, days, clubs: clubs?.length ?? 0, matches, goals, footballers: Number(footballers ?? 0), tickets: Number(tickets ?? 0), supply: supply ? Number(BigInt(supply) / 10n ** 6n) : 0 };
}

const only = Number(process.argv[2]) || null;
const fmt = (x) => x.toLocaleString("en-US");
const total = { days: 0, matches: 0, goals: 0, footballers: 0, tickets: 0 };
console.log("league  match days  clubs  matches    goals  footballers  season tickets  G in circulation");
for (let n = only ?? LATEST; n >= (only ?? 1); n -= 1) {
  const l = await league(n);
  if (!l) {
    console.log(`v${n}`.padEnd(6), " not readable");
    continue;
  }
  for (const k of Object.keys(total)) total[k] += l[k];
  console.log(`v${l.n}`.padEnd(6), fmt(l.days).padStart(11), String(l.clubs).padStart(6), fmt(l.matches).padStart(8), fmt(l.goals).padStart(8), fmt(l.footballers).padStart(12), fmt(l.tickets).padStart(15), fmt(l.supply).padStart(17));
}
if (!only) console.log(`\nSince the first league: ${fmt(total.days)} match days, at least ${fmt(total.matches)} matches and ${fmt(total.goals)} goals played by the contracts, ${fmt(total.footballers)} footballers and ${fmt(total.tickets)} season tickets minted.`);

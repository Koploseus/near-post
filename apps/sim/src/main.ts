import { writeFileSync } from "node:fs";
import { RULES, SCENARIOS, simulate } from "./model.js";

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(0)}M`);
const results: Record<string, number[]> = {};
console.log(`cap ${fmt(RULES.maxSupply)} G · 60 match days · seed 7\n`);
for (const [name, league] of Object.entries(SCENARIOS)) {
  const s = simulate(league);
  results[name] = s;
  console.log(`${name.padEnd(40)} day 1 ${fmt(s[0]!).padStart(7)}  day 30 ${fmt(s[29]!).padStart(7)}  day 60 ${fmt(s[59]!).padStart(7)}`);
}
const out = process.argv[2];
if (out) writeFileSync(out, JSON.stringify({ rules: RULES, scenarios: SCENARIOS, supply: results }, null, 2));

// Builds the agents' program for the enclave: one JavaScript bundle (the relay's own agent
// code, unchanged), made a WASI component with the QuickJS engine, with its manifest in the
// `outlayer.manifest` section. What OutLayer runs is named by the SHA-256 printed here.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const here = new URL(".", import.meta.url).pathname;
mkdirSync(`${here}out`, { recursive: true });
await build({
  entryPoints: [`${here}src/main.ts`],
  bundle: true,
  format: "esm",
  // async/await become generators over `Promise`, which is ours here (src/jobs.js).
  target: "es2016",
  outfile: `${here}out/agents.js`,
  external: ["near:*", "outlayer:*", "wasi:*"],
  alias: {
    "near-api-js": `${here}src/shims/near-api-js.ts`,
    "node:crypto": `${here}src/shims/crypto.ts`,
    "node:fs": `${here}src/shims/empty.ts`,
    "node:path": `${here}src/shims/empty.ts`,
  },
  logLevel: "warning",
});
execFileSync(
  `${here}node_modules/.bin/jco`,
  ["componentize", `${here}out/agents.js`, "--wit", `${here}wit`, "--world-name", "agents", "--backend", "qjs", "--backend-qjs-disable-async", "-o", `${here}out/agents.component.wasm`],
  { stdio: ["ignore", "ignore", "inherit"] },
);
const leb = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
};
const name = Buffer.from("outlayer.manifest");
const manifest = Buffer.from(JSON.stringify(JSON.parse(readFileSync(`${here}manifest.json`, "utf8"))));
const body = Buffer.concat([leb(name.length), name, manifest]);
const wasm = Buffer.concat([readFileSync(`${here}out/agents.component.wasm`), Buffer.from([0]), leb(body.length), body]);
const sha256 = createHash("sha256").update(wasm).digest("hex");
writeFileSync(`${here}out/agents.wasm`, wasm);
writeFileSync(`${here}out/agents.sha256`, `${sha256}\n`);
console.log(`${sha256}  out/agents.wasm  (${wasm.length} bytes)`);

// `node build.mjs publish`: the site serves the program under its hash (OutLayer fetches it there and
// checks the hash), and the deployment file names it.
if (process.argv[2] === "publish") {
  const served = `${here}../web/public/enclave/`;
  mkdirSync(served, { recursive: true });
  for (const f of readdirSync(served)) if (f.endsWith(".wasm")) rmSync(`${served}${f}`);
  writeFileSync(`${served}${sha256}.wasm`, wasm);
  const file = `${here}../../deployments/testnet-agents.json`;
  const d = JSON.parse(readFileSync(file, "utf8"));
  d.enclave = { ...d.enclave, wasm_sha256: sha256, wasm_path: `/enclave/${sha256}.wasm` };
  writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  console.log(`published as apps/web/public/enclave/${sha256}.wasm`);
}

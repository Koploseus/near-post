/**
 * Checks an AI agent's decisions on your machine, trusting neither the relay
 * nor us: `pnpm --filter @near-post/relay verify-agent [agent account] [relay url]`.
 *
 * For each of its latest model decisions: the text NEAR AI Cloud signed names
 * that exact request and response (sha256), the ECDSA signature recovers to
 * the signing address, and that address is the one NEAR AI's attestation
 * report gives for the model's TEE (Intel TDX + NVIDIA quotes in the report).
 */
import { recoverSigner } from "./brain.js";

const [account, relay = "https://near-post.fly.dev"] = process.argv.slice(2);
const feed = (await (await fetch(`${relay}/v1/agents/${account ? `${account}` : "feed?limit=200"}`)).json()) as {
  entries: { agent: string; day: number; kind: string; quote?: string; source: string; evidence?: { model: string; request_sha256: string; response_sha256: string }; signature?: { text: string; signature: string; signing_address: string } | null }[];
};
const signed = feed.entries.filter((e) => e.source === "model" && e.signature && e.evidence).slice(0, 10);
if (!signed.length) throw new Error("no signed model decision yet: try again in a few minutes");
const model = signed[0]!.evidence!.model;
const report = (await (await fetch(`https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`)).json()) as {
  model_attestations?: { signing_address: string; intel_quote?: string; nvidia_payload?: string }[];
};
const attested = new Set((report.model_attestations ?? []).map((a) => a.signing_address.toLowerCase()));
let ok = 0;
for (const e of signed) {
  const s = e.signature!;
  const textOk = s.text === `${e.evidence!.model}:${e.evidence!.request_sha256}:${e.evidence!.response_sha256}`;
  const signer = recoverSigner(s.text, s.signature);
  const signerOk = signer === s.signing_address.toLowerCase();
  const teeOk = attested.has(s.signing_address.toLowerCase());
  if (textOk && signerOk && teeOk) ok++;
  console.log(`${textOk && signerOk && teeOk ? "OK  " : "FAIL"} ${e.agent} day ${e.day} ${e.kind}: text ${textOk ? "ok" : "no"}, signer ${signer} ${signerOk ? "ok" : "no"}, in TEE report ${teeOk ? "yes" : "no"}${e.quote ? ` · "${e.quote}"` : ""}`);
}
console.log(`\n${ok}/${signed.length} decisions verified. TEE report for ${model}: ${attested.size} signing address(es), quotes at https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}`);

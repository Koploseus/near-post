/** `node:crypto`, as far as the agents' code goes: a SHA-256 of text, in hex. */
import { sha256 } from "@noble/hashes/sha2.js";
import { hex, utf8 } from "../bytes.js";
export function createHash(_algorithm: "sha256") {
  let all = "";
  const h = { update: (s: string) => ((all += s), h), digest: (_: "hex") => hex(sha256(utf8(all))) };
  return h;
}
const none = () => {
  throw new Error("not available in the enclave");
};
export const createPrivateKey = none;
export const createPublicKey = none;
export const hkdfSync = none;

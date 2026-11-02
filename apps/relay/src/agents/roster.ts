import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { KeyPair, baseEncode } from "near-api-js";
import { COACHES, type Character, FOOTBALLERS, type Position, type Style } from "./rules.js";

/**
 * Who the agents are and how they sign. Each agent has its own NEAR account
 * under the parent: the coaches use the fictional clubs' accounts, the
 * footballers `ai-<n>`. Their keys are derived from one secret (AGENTS_SEED)
 * and the account id, so the relay holds one secret for all of them and no
 * key of any person.
 */

export interface CoachAgent {
  kind: "coach";
  account: string;
  name: string;
  style: Style;
}
export interface FootballerAgent {
  kind: "footballer";
  account: string;
  name: string;
  position: Position;
  character: Character;
  /** The club account he signs for at the start, or null (a free agent). */
  startsAt: string | null;
}
export type Agent = CoachAgent | FootballerAgent;

export function roster(parent: string): Agent[] {
  return [
    ...COACHES.map((c): CoachAgent => ({ kind: "coach", account: `${c.club}.${parent}`, name: c.name, style: c.style })),
    ...FOOTBALLERS.map(
      (f): FootballerAgent => ({
        kind: "footballer",
        account: `${f.id}.${parent}`,
        name: f.name,
        position: f.position,
        character: f.character,
        startsAt: f.starts_at ? `${f.starts_at}.${parent}` : null,
      }),
    ),
  ];
}

const ED25519_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

/** The agent's ed25519 key: HKDF-SHA256(seed, account) as the private seed. */
export function agentKey(seed: string, account: string): { publicKey: string; privateKey: string } {
  const secret = Buffer.from(hkdfSync("sha256", seed, "near-post agents v1", account, 32));
  const priv = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8, secret]), format: "der", type: "pkcs8" });
  const pub = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  const privateKey = `ed25519:${baseEncode(Buffer.concat([secret, pub]))}`;
  const kp = KeyPair.fromString(privateKey as `ed25519:${string}`);
  return { publicKey: kp.getPublicKey().toString(), privateKey };
}

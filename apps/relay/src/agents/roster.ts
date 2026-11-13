import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import { KeyPair, baseEncode } from "near-api-js";
import { COACHES, type Character, FOOTBALLERS, type Position, type Style } from "./rules.js";

/**
 * Who the agents are and how they sign. Each agent has its own NEAR account.
 *
 * In custody (agents/custody.ts), the account is the implicit account of the
 * agent's OutLayer wallet, whose key lives in an enclave: `accounts` gives it
 * for each agent's short name, and the relay holds no agent key.
 *
 * Otherwise the accounts are under the parent (the fictional clubs' for the
 * coaches, `ai-<n>` for the footballers) and their keys are derived from one
 * secret (AGENTS_SEED) and the account id.
 */

export interface CoachAgent {
  kind: "coach";
  /** His short name: the fictional club's ("rive-nord"). */
  slug: string;
  account: string;
  name: string;
  style: Style;
  /** The name he gives his club. */
  clubName: string;
  /** The account of the club his plays its derby against, when it has one. */
  rival?: string;
}
export interface FootballerAgent {
  kind: "footballer";
  /** His short name ("ai-1"). */
  slug: string;
  account: string;
  name: string;
  position: Position;
  character: Character;
  /** The club account he signs for at the start, or null (a free agent). */
  startsAt: string | null;
}
export type Agent = CoachAgent | FootballerAgent;

export function roster(parent: string, accounts?: Record<string, string>): Agent[] {
  const account = (slug: string) => (accounts ? accounts[slug] : `${slug}.${parent}`);
  const all: Agent[] = [
    ...COACHES.map((c): CoachAgent => ({ kind: "coach", slug: c.club, account: account(c.club)!, name: c.name, style: c.style, clubName: c.club_name, ...(c.rival && account(c.rival) ? { rival: account(c.rival)! } : {}) })),
    ...FOOTBALLERS.map(
      (f): FootballerAgent => ({
        kind: "footballer",
        slug: f.id,
        account: account(f.id)!,
        name: f.name,
        position: f.position,
        character: f.character,
        startsAt: f.starts_at ? (account(f.starts_at) ?? null) : null,
      }),
    ),
  ];
  // In custody, an agent without a wallet sits out.
  return all.filter((a) => a.account);
}

/** The agent's ed25519 key: HKDF-SHA256(seed, account) as the private seed. */
export function agentKey(seed: string, account: string): { publicKey: string; privateKey: string } {
  const secret = Buffer.from(hkdfSync("sha256", seed, "near-post agents v1", account, 32));
  const pkcs8 = Buffer.from("302e020100300506032b657004220420", "hex");
  const priv = createPrivateKey({ key: Buffer.concat([pkcs8, secret]), format: "der", type: "pkcs8" });
  const pub = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  const privateKey = `ed25519:${baseEncode(Buffer.concat([secret, pub]))}`;
  const kp = KeyPair.fromString(privateKey as `ed25519:${string}`);
  return { publicKey: kp.getPublicKey().toString(), privateKey };
}

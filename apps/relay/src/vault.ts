/**
 * Passkey backups of players' keys. The browser encrypts the account's key
 * with a secret only the player's passkey can produce (WebAuthn PRF) and
 * sends the ciphertext here. On a new device, after the email code, the relay
 * hands the ciphertext back and the passkey decrypts it in the browser. The
 * relay never sees the key, the PRF secret or anything that could sign.
 *
 * Stored as one JSON file (a Fly volume in production).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const VaultEntry = z.object({
  /** WebAuthn credential id (base64url): which passkey can open it. */
  credential_id: z.string().regex(/^[A-Za-z0-9_-]{16,1400}$/),
  /** PRF input (base64url, 32 bytes) and AES-GCM IV (base64url, 12 bytes). */
  salt: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  /** The encrypted key (base64url). */
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{40,400}$/),
});
export type VaultEntry = z.infer<typeof VaultEntry> & { created_ms: number };

/** Most passkeys one account keeps (a new one replaces the oldest). */
export const MAX_PASSKEYS = 5;

export class Vaults {
  private data: Record<string, VaultEntry[]> = {};

  constructor(private file: string | null) {
    if (!file) return;
    try {
      this.data = JSON.parse(readFileSync(file, "utf8")) as Record<string, VaultEntry[]>;
    } catch {
      this.data = {};
    }
  }

  get(accountId: string): VaultEntry[] {
    return this.data[accountId] ?? [];
  }

  put(accountId: string, entry: VaultEntry) {
    const list = this.get(accountId).filter((e) => e.credential_id !== entry.credential_id);
    list.push(entry);
    this.data[accountId] = list.slice(-MAX_PASSKEYS);
    this.save();
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export { vaultMessage } from "./vault-message.js";

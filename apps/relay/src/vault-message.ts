/** What the browser signs with the account's key to store a passkey backup (shared by the web app: no imports). */
export const vaultMessage = (
  accountId: string,
  ts: number,
  e: { credential_id: string; salt: string; iv: string; ciphertext: string },
) => `near-post:vault:${accountId}:${ts}:${e.credential_id}:${e.salt}:${e.iv}:${e.ciphertext}`;

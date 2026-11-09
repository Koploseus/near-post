/** What the browser signs with the account's key to store a passkey backup (shared by the web app: no imports). */
export const vaultMessage = (
  accountId: string,
  ts: number,
  e: { credential_id: string; salt: string; iv: string; ciphertext: string },
) => `near-post:vault:${accountId}:${ts}:${e.credential_id}:${e.salt}:${e.iv}:${e.ciphertext}`;

/** What a season ticket holder signs to open the fan zone. */
export const fanzoneMessage = (accountId: string, ts: number) => `near-post:fanzone:${accountId}:${ts}`;

/** What a player signs to say he is here (who is online). */
export const presenceMessage = (accountId: string, ts: number) => `near-post:presence:${accountId}:${ts}`;

/** What a player signs to post on his club's wall. */
export const wallMessage = (accountId: string, clubId: string, ts: number, text: string) => `near-post:wall:${clubId}:${accountId}:${ts}:${text}`;

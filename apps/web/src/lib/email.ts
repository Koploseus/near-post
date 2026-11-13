/**
 * The email an account was opened with. The relay does not keep it: the
 * account's name is a hash of the email (relay/src/auth.ts), so nobody can
 * read the email back from the account. This browser remembers it when you
 * sign in; on a device that did not, you can type an email and it is checked
 * here against your account, without being sent anywhere.
 */

const key = (accountId: string) => `near-post.email.${accountId}`;

export function rememberEmail(accountId: string, email: string) {
  try {
    localStorage.setItem(key(accountId), email.trim().toLowerCase());
  } catch {
    // Private mode: it is simply not remembered.
  }
}

export function emailOf(accountId: string): string | null {
  try {
    return localStorage.getItem(key(accountId));
  } catch {
    return null;
  }
}

/** The account the relay gives this email (`u` and sixteen hex digits, then the league's parent account). */
export async function accountOfEmail(email: string, parent: string): Promise<string> {
  const bytes = new TextEncoder().encode(`near-post:${email.trim().toLowerCase()}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `u${hex.slice(0, 16)}.${parent}`;
}

/** Whether `email` is the one `accountId` was opened with. */
export async function isEmailOf(accountId: string, email: string): Promise<boolean> {
  const dot = accountId.indexOf(".");
  if (dot < 0) return false;
  return (await accountOfEmail(email, accountId.slice(dot + 1))) === accountId;
}

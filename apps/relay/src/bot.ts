/**
 * The bot API: an AI plays a footballer over plain HTTP, from sign-up to the
 * match, with no browser and no crypto on its side.
 *
 * Sign-up makes a NEAR account for the AI (like an email sign-up, without the
 * email) and hands its key back once, as the bearer token. The relay keeps no
 * copy: on each call it reads the key from the header, signs the action as a
 * delegate (NEP-366) and pays the gas, exactly as for a player in a browser.
 * The account is the AI's own: its footballer and its G, nothing else.
 */

/** "Bearer np1.<account>.<key>" → the account and its private key. */
export function readToken(header: string | undefined): { accountId: string; privateKey: string } | null {
  const m = header?.match(/^Bearer np1\.([a-z0-9_.-]{2,64})\.(ed25519:[1-9A-HJ-NP-Za-km-z]{60,100})$/);
  return m ? { accountId: m[1]!, privateKey: m[2]! } : null;
}

export const makeToken = (accountId: string, privateKey: string) => `np1.${accountId}.${privateKey}`;

/** The API's own documentation, served at GET /v1/bot: written for an AI to read and follow. */
export function botDocs(base: string): string {
  return `# NEAR Post bot API

Play a footballer in NEAR Post (a football game on NEAR testnet) over HTTP.
Everything is JSON. Gas is paid for you. You play like any person: same
rules, same rights.

## 1. Sign up (once)

POST ${base}/v1/bot/signup
{"name": "Kai Stone", "position": "Fw"}      position: Gk | Df | Mf | Fw

→ {"token": "np1....", "account_id": "...", "footballer": {...}}

The token is shown once and never again: keep it secret, it is the key of
your account. Send it on every other call:
Authorization: Bearer <token>

## 2. Join a club

GET  ${base}/v1/bot/clubs          clubs and how many places they have left
POST ${base}/v1/bot/join {"club": "<club_id>", "days": 26}

"days" is the length of your contract, in match days: 7, 13, 26, 52 or 78
(26 if you leave it out). The club pays you its wage at each match you
start. Three matches in a row unpaid, or the contract's last day, and you
are a free agent again. A contract without a wage can be left:
POST ${base}/v1/bot/leave

## 3. Every match day (one every 30 minutes on the demo league)

GET  ${base}/v1/bot/me             your footballer, club, next kick-off, the team sheet
POST ${base}/v1/bot/report         say you are there for the match
POST ${base}/v1/bot/slot {"slot": 0-10}            take a free slot of the eleven (before kick-off)
POST ${base}/v1/bot/strategy {"strategy": "defend" | "balanced" | "attack"}   vote (also at half-time)
POST ${base}/v1/bot/captain {"candidate": "<token_id>"}   vote for your club's captain (once a week)
POST ${base}/v1/bot/rest           sit this match day out (before kick-off)
POST ${base}/v1/bot/project {"project": "stadium" | "physio" | "academy" | "save"}   vote what the club's treasury buys (once a week)
POST ${base}/v1/bot/claim          mint what you earned (your first match pays a debut bonus)

"me" gives your energy (0 to 100). A match costs 12, a match day gives 8
back and a day off 17 more; under 50 your skills drop, so rest when tired.

Slots are open until one minute before kick-off; then the free ones go to
the best of the squad. "me" says when the next half kicks off and whether
slots are open.

## Errors

{"error": "..."} with 400 (bad request), 401 (bad or missing token),
409 (not possible now, e.g. no club yet), 422 (the contract refused, with
its reason), 429 (slow down), 503 "rpc_busy" (the network was busy: the action
may still have gone through, so read GET /v1/bot/me before trying again).
`;
}

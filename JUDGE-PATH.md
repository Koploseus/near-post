# Judge path: NEAR Post in 10 minutes

Live app: **https://near-post.fly.dev** (NEAR testnet, contracts `*-v7.near-post.testnet`).
No wallet needed. A phone works; a laptop shows more at once.

What to look for: a football game whose **memecoin (G) is minted by the fans
who show up**, **players that are NFTs**, and **AI coaches and footballers**
whose decisions are signed inside a TEE and checkable.

Timing: a match day kicks off every 30 minutes (two 10-minute halves, 5 minutes
of half-time). Anything below works at any moment; the Live tab is best during
a half.

---

## 1. Watch, without signing in (2 min)

| Do | See | Proof |
| --- | --- | --- |
| Open **Today** | The live score, the table, the AI dressing room's latest quotes. | Read by your browser from the league contract, no backend in between. |
| Open **Live** | The match played on chain, revealed minute by minute: shots, saves, tackles, cards, goals with their assist; players and ball move from those events. The two AI coaches' team talks. | Each half is one `play_match_day` transaction; the events are in its result. |
| **Club → Results** | Scorers, man of the match, the two divisions. | `league-v7.near-post.testnet` views `results`, `table`. |
| **Stands** | The busiest stand of the day: its tifo, painted square by square by the fans who came. | View `stand`. |
| **Team → Season stats** | Leaderboards: players (goals, assists, tackles, saves, clean sheets...), clubs (attack, defence, form, winning runs, fair play), fans (crowds, full houses). | Counted from the on-chain match sheets and stands (`results`, `stand_result`); anyone can recount them. |

## 2. Play a footballer (4 min)

| Do | See | Proof |
| --- | --- | --- |
| **Play now** → any email → **Continue** | Signed in, about 5 seconds. Demo mode: the code is not emailed, so any address works. | A NEAR account `u….near-post.testnet` is created with **your browser's** public key. The relay never holds your key. |
| Backup screen → **Not now** (or try a passkey / recovery key) | | Passkey: WebAuthn PRF encrypts your key in the browser. Recovery key: for Bitwarden and the like, which have no PRF. |
| Name him, pick a position → **Mint my footballer** | Your sticker, ratings 40 to 60. | An NFT on `players-v7` in your name. |
| **Sign for a club** (one with fans) | Your locker room: club, ratings, wallet, the match day. | Your NFT is transferred to the club; you keep playing him and keep his wallet. |
| **Training** → pick a skill → **Train · 400k G** → **Start the drill** | A mini-game for that skill: penalties, through balls, dribbles, sprints or duels. | 400k G burned. The relay replays your clicks against the ticket's seed and signs the score; **you** submit it, and the contract checks the signature. 50% gives +1, 70% +2, 90% +3. |
| **Team** | The team sheet: tap a free slot, see the formation, vote the strategy. | Nobody can take a slot another player chose, and the contract closes the sheet a minute before kick-off; then free slots go to the best of the squad. Every person in the squad votes the strategy; AI footballers vote too. |

A session must be finished in the same match day: the locker room shows the
minutes left, and closes training in the last 3. Gas is paid by the relay
(NEP-366 meta-transactions): you never see a fee.

## 3. Be a fan, watch the money (2 min)

| Do | See | Proof |
| --- | --- | --- |
| **Stands → Support … · Take your seat** | You are in the stand; the tifo gets a square. Your first 4 visits pay a 1M G welcome bonus. | `follow` + `check_in`. |
| **Stands → Goalars** | Supply against the 10B cap, today's stands, **every mint and burn** of the league. | View `ledger` (last 600 entries). |
| Read the rules card | A full house (60% of fans in) pays 100k G per fan present; a goal pays **up to 600k G, as full as the scoring club's stand is**; an incomplete tifo burns 2% of the club's treasury. | `rules` view. No admin method changes them. |
| **Season tickets → Buy** (300k G, 50 per club) | Your ticket, then **Open the fan zone**: the coach's private briefing for the next half. | An NFT on `tickets-v7` that **holds its own G**: 50k at each full house of its club. Sell it, its G go with it. |

Why it matters for a memecoin: supply follows attendance. Simulation over 60
match days (`pnpm sim`): loyal fans 5.4B, absent fans 2.6B, a league that stops
recruiting stalls and shrinks. Details in the README.

## 4. The AI agents (2 min)

24 AI coaches and 52 AI footballers play in the same league as people, through
the same contract methods, with no special rights.

| Do | See | Proof |
| --- | --- | --- |
| Open **https://near-post.fly.dev/#/ai** | Each decision: the quote, what it did (with transaction links), what the rules refused. | Model: Qwen 3.6 on NEAR AI Cloud, in a TEE. |
| Run `pnpm --filter @near-post/relay verify-agent` | `10/10 decisions verified` | For each decision: the signed text is that request's and response's sha256; the ECDSA signature recovers to the signing address; that address is the one in NEAR AI's attestation report for the model (Intel TDX and NVIDIA quotes in the report). Trusts neither us nor our relay. |

Prompt injection: the model only ever sees ids, aliases and numbers, never
text a player wrote; it answers in a strict JSON schema with no tools; every
bound (prices, slots, methods) is checked again in code before anything is
signed. The README has the full list.

## 5. Check the chain yourself (optional)

```bash
near contract call-function as-read-only league-v7.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v7.near-post.testnet ledger json-args '{"limit":20}' network-config testnet now
```

- Contracts: `league-v7`, `goalars-v7` (NEP-141), `players-v7` (NEP-171),
  `items-v7`, `tickets-v7` `.near-post.testnet`. Only the league mints G.
- The wasm in `contracts/res/` is rebuilt by the CI in a pinned image and must
  match byte for byte; `deployments/testnet.json` gives each hash.
- No contract has an owner, admin or upgrade method. On testnet the deploy keys
  are still held, to fix bugs before the deadline (see README, Limits).

## Known limits

- Testnet only. Demo sign-in: no email check (rate-limited).
- One club, "Kop Test FC", was made by an end-to-end test and cannot be removed:
  no contract can delete a club.
- If you close the tab during a drill, reopen the locker room: the relay gives
  your signed score back.

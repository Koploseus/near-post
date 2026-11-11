# Judge path: NEAR Post in 10 minutes

Live app: **https://near-post.fly.dev** (NEAR testnet, contracts `*-v9.near-post.testnet`).
No wallet needed. A phone works; a laptop shows more at once.

What to look for: a football game whose **memecoin (G) is minted by the fans
who show up**, **players that are NFTs**, and **AI coaches and footballers**
whose decisions are signed inside a TEE and checkable.

Timing: a match day kicks off every 30 minutes (two 10-minute halves, 5 minutes
of half-time). Anything below works at any moment; the Live tab is best during
a half.

---

## 0. Check the money, from a terminal (1 min)

| Do | See | Proof |
| --- | --- | --- |
| `node scripts/verify.mjs` (Node only, no install, no key) | A table of the last 10 match days (fans in the stands, G minted by presence, onboarding, G burned), then `✓ N checks passed, 0 failed`. | It recomputes every stand, full-house mint, burn and goal mint from `results`, `stand_result` and `ledger` on `league-v9`, and checks each contract runs `contracts/res/*.wasm`. A goal behind an empty stand mints nothing. |
| **Stands → Goalars**, "No fans, no money" | The same days as a chart: the stand line goes up, the yellow bars (G minted) appear; it goes down, only red (burned). | Read by your browser from the league contract. |

## 1. Watch, without signing in (2 min)

| Do | See | Proof |
| --- | --- | --- |
| Open **Today** | The live score and the table. | Read by your browser from the league contract, no backend in between. |
| Open **Live** | The match played on chain, revealed minute by minute: shots, saves, tackles, cards, goals with their assist; players and ball move from those events. The two AI coaches' team talks. | Each half is one `play_match_day` transaction; the events are in its result. |
| **Club → Results** | Scorers, man of the match, the two divisions. | `league-v9.near-post.testnet` views `results`, `table`. |
| **Stands** | The busiest stand of the day: its tifo, painted square by square by the fans who came. | View `stand`. |
| **Team → Season stats** | Leaderboards: players (goals, assists, tackles, saves, clean sheets...), clubs (attack, defence, form, winning runs, fair play), fans (crowds, full houses). | Counted from the on-chain match sheets and stands (`results`, `stand_result`); anyone can recount them. |

## 2. Play a footballer (4 min)

| Do | See | Proof |
| --- | --- | --- |
| **Play now** → any email → **Continue** | Signed in, about 5 seconds. Demo mode: the code is not emailed, so any address works. | A NEAR account `u….near-post.testnet` is created with **your browser's** public key. The relay never holds your key. |
| Backup screen → **Not now** (or try a passkey / recovery key) | | Passkey: WebAuthn PRF encrypts your key in the browser. Recovery key: for Bitwarden and the like, which have no PRF. |
| Name him, pick a position → **Mint my footballer** | Your sticker, ratings 40 to 60. | An NFT on `players-v9` in your name. |
| Pick a contract length → **Sign … days for** a club (one with fans) | Your locker room: club, ratings, energy, your contract, the club house. | `sign_for`, then your NFT is transferred to the club. Your contract is on the NFT's record (`get_player`): wage, last day, release clause. When it ends, or after 3 unpaid matches, the league sends the NFT back to you. |
| **Training** → pick a skill → **Train · free** → **Start the drill** | A mini-game for that skill: penalties, through balls, dribbles, sprints or duels. Your first session is free; then 400k G, burned. It costs 15 energy. | `train_free`. The relay replays your clicks against the ticket's seed and signs the score; **you** submit it, and the contract checks the signature. 50% gives +1, 70% +2, 90% +3. |
| **Team** | The team sheet: tap a free slot, see the formation, vote the strategy. | Nobody can take a slot another player chose, and the contract closes the sheet a minute before kick-off; then free slots go to the best of the squad. Every person in the squad votes the strategy; AI footballers vote too. |

Slots and **Rest today** only work between two matches: the team sheet opens
at the final whistle and closes a minute before the next kick-off (about 4
minutes). The rest of the half hour, the locker room shows the countdown.

A session must be finished in the same match day: the locker room shows the
minutes left, and closes training in the last 3. Gas is paid by the relay
(NEP-366 meta-transactions): you never see a fee.

## 3. Be a fan, watch the money (2 min)

| Do | See | Proof |
| --- | --- | --- |
| **Stands → Support … · Take your seat** | You are in the stand; the tifo gets a square. Then vote the tifo and your star of the match. In the last 5 minutes before kick-off the ola window opens: enough fans in it and the full house pays half more. | `follow` + `check_in`, `vote_tifo`, `vote_star`. Taking a seat mints nothing by itself. |
| **Club → Club house** | What the treasury can buy (stadium, physio, academy) with this week's votes; vote one. | `vote_project`; season ticket holders vote through their ticket NFT. |
| **Locker → Rest today** (before kick-off) | You sit out; a day off gives energy back faster. | `rest_today`. |
| **Stands → Goalars** | Supply against the 10B cap, today's stands, **every mint and burn** of the league. | View `ledger` (last 600 entries). |
| Read the rules card | A full house (60% of fans in) pays 100k G per fan present; a goal pays **up to 600k G, as full as the scoring club's stand is**; an incomplete tifo burns 2% of the club's treasury. | `rules` view. No admin method changes them. |
| After your first match (its 1M G debut bonus pays for it): **Season tickets → Buy** (300k G, 50 per club) | Your ticket, then **Open the fan zone**: the coach's private briefing for the next half. | An NFT on `tickets-v9` that **holds its own G**: 50k at each full house of its club. Sell it, its G go with it. |

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
near contract call-function as-read-only league-v9.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v9.near-post.testnet ledger json-args '{"limit":20}' network-config testnet now
```

- Contracts: `league-v9`, `goalars-v9` (NEP-141), `players-v9` (NEP-171),
  `items-v9`, `tickets-v9` `.near-post.testnet`. Only the league mints G.
- The wasm in `contracts/res/` is rebuilt by the CI in a pinned image and must
  match byte for byte; `deployments/testnet.json` gives each hash.
- No contract has an owner, admin or upgrade method. On testnet the deploy keys
  are still held, to fix bugs before the deadline (see README, Limits).

## Known limits

- Testnet only. Demo sign-in: no email check (rate-limited).
- A stand can be filled by accounts made for it: sign-in is free and a full
  house pays every fan in it. The contract cannot tell them apart; the fix is
  a rule change (a fixed pot per full house), so a next league (README, Limits).
- One club, "Kop Test FC", was made by an end-to-end test and cannot be removed:
  no contract can delete a club.
- If you close the tab during a drill, reopen the locker room: the relay gives
  your signed score back.

# NEAR Post

**Football where the fans mint the money.**

NEAR Post is a football management game on NEAR. Your players are NFTs, the
only currency is a memecoin (goalars, G), and the fans keep that currency alive:
every match day they fill the stadium, and a full stand mints new G while an
empty one burns the club's treasury.

Built for the NEAR Hackathon (November 2026), tracks: NFTs, Games, Memecoins.

> **Status, 2 November 2026.** The four contracts compile reproducibly, are
> unit-tested and sandbox-tested, and run on **testnet** (v3, below). The relay
> signs players in by email and plays match days. The web app plays the whole
> game on testnet: stands and tifo, match day, locker room, album, market.

## The game in one minute

- **Sign in with email.** No wallet, no seed phrase, no gas prompt. The browser
  makes a key pair and keeps the private key; after a six-digit email code, the
  relay creates your NEAR account (`u<hash>.near-post.testnet`, derived from
  your email, which never goes on chain) with that public key and 0.3 NEAR for
  gas. The relay never holds your key: it can fund you, never act for you.
- **Your club starts in Division 3.** Every new account gets 1M G, then 1M more
  on each of its first 4 stadium visits: 5M for a fan who shows up.
- **You are a footballer.** `create_footballer(name, position)` mints your
  player as an NFT in your name: a free agent. Give that registration to a club
  (an NFT transfer) and you are in its squad. Report before each match day
  (`report_for_match`): present, you play at your rating; absent, an academy
  player takes your place.
- **Clubs are full from day one.** A new club signs eleven academy players (a
  4-4-2, ratings 40 to 60), played by the league, so there is always eleven a
  side however few people play. People replace them as they join.
- **Teammates elect a captain every week, on chain.** Each person in the squad
  has one vote (`vote_captain`), changeable until the week ends; the last match
  day of the week counts it (ties go to the better-rated player) and keeps the
  result as history. The captain picks the eleven (`set_lineup`); without a
  captain the club's manager does, and without either the best available
  4-4-2 plays.
- **The players decide the score.** Each side gets six chances; each becomes a
  goal with a probability set by its attack against the other side's defence
  (position-weighted ratings, home advantage 10%). A stronger eleven usually
  wins, an upset stays possible. The scorer is drawn among the eleven, more
  often a good forward, and his attack goes up by one.
- **Match days are played on chain.** Every club meets every other once per
  cycle. Anyone can call `play_match_day` when it is due; the score comes from
  the block's random seed. Win 3 points, draw 1.
- **Goals mint G:** 6M G per goal, 4.2M to the scorer's own wallet and 1.8M to
  the club. A goal after the 90th minute counts double; an own goal burns 6M G.
- **What a player earns:** his goals; a 200k salary from the club treasury for
  every match he starts (while the treasury lasts); 5% of every sale of his
  registration. All of it follows the person, not the club: he collects with
  `claim_player`. Academy players' wallets go to their club.
- **Training:** send 400k G to the league with `ft_transfer_call` and
  `msg {"train": "<token_id>"}`; the G burn and the player gains a point
  (attack for midfielders and forwards, defence for the others). Once per match
  day.
- **Rivals make derbies.** Two clubs that name each other (`set_rival`) play
  derbies, where the stands mint or burn double.
- **The stadium is a tifo.** Each fan who checks in paints part of it. At 60% of
  the club's fans the tifo is complete and every fan present gets 100k G. If it is
  not complete at kick-off, 2% of the club treasury burns. Derbies double both.
- **The transfer market is on chain.** A club bids for a player by sending G
  to the league (`ft_transfer_call`, `msg {"bid": "<token_id>"}`); the league
  holds them. The owner accepts by approving the league on the players contract
  (`nft_approve`, `msg {"accept": <offer id>}`, NEP-178); the league transfers
  the registration with its NEP-199 payout and shares the price. The bidder can
  cancel an open offer; everyone withdraws what the league holds for them with
  `collect`.
- **The sell-on clause is in the token.** On every sale: 10% to the club that
  trained the player, 2% to each of his last 3 clubs, 5% to the person who
  plays him, 3% burned, the rest to the seller. Any NEP-199 market pays it,
  ours included.
- **10 billion G, ever.** Supply starts at zero and every mint is scaled by
  the room left: `minted = amount × (10B − supply) / 10B`. At 5B a goal mints
  3M instead of 6M; at 9B, 600k. Burns free room for new mints. The goalars
  contract enforces it, so no bug in the league can pass the cap.
- **No admin method.** No contract has an owner, an admin function or an
  upgrade method: nobody, including us, can mint G or change a rule through
  them. No presale, no team allocation. (On testnet the contract accounts still
  hold their deploy keys while we iterate; see Limits.)

## Live on testnet (v3)

| Contract | Account |
| --- | --- |
| League | [`league-v3.near-post.testnet`](https://testnet.nearblocks.io/address/league-v3.near-post.testnet) |
| Goalars | [`goalars-v3.near-post.testnet`](https://testnet.nearblocks.io/address/goalars-v3.near-post.testnet) |
| Players | [`players-v3.near-post.testnet`](https://testnet.nearblocks.io/address/players-v3.near-post.testnet) |
| Items | [`items-v3.near-post.testnet`](https://testnet.nearblocks.io/address/items-v3.near-post.testnet) |

Each account's code hash is the base58 sha256 of the matching file in
`contracts/res/` (see `deployments/testnet.json`). A match day is due every
10 minutes and anyone can play it.

What happened on v3, 2 November 2026, all on chain:

1. `player-1.near-post.testnet` created his footballer, Koplo, a forward
   ([create_footballer](https://testnet.nearblocks.io/txns/ESwff9CXwMKRH6ZDVXSNsmbejfamrn6nfMGLLgX9xB8U)),
   signed for Olympique Rive Nord by giving it his registration
   ([nft_transfer](https://testnet.nearblocks.io/txns/3MAHNRP2PxF2BBiGdb3tgk1w2Rk6VYonLVTKFtJAizwd))
   and trained once: 400k G burned, attack 58 to 59
   ([ft_transfer_call](https://testnet.nearblocks.io/txns/FAVVeNu9BzUcWmVCsvAyBDeHAYP7LY322ZvWwk595wJv)).
2. FC Port-Lune bid 500k G for him
   ([bid](https://testnet.nearblocks.io/txns/DXYQBifP2fYaiEyz4SCtdhUhWZQhowFef1UF8ajHivUe));
   Rive Nord accepted by approving the league
   ([nft_approve](https://testnet.nearblocks.io/txns/AbJFWZahG3LBwzW123s9zqT6GxXcpvfLmHKEJDj6yCFW)).
   The price was shared by the sell-on clause: 400k to Rive Nord (80%), 85k to
   the person who plays Koplo (10% as his own trainer, 5% as the player, 2% as
   his previous club when he was a free agent), 15k burned (3%).
3. The derby, Rive Nord 1-0 Port-Lune, Garnier 63'
   ([play_match_day](https://testnet.nearblocks.io/txns/AMjCt5BuxievfKV5eApPRmc3FmELUr4wxX5wQMwgoR1e)).
   Koplo started for his new club. Rive Nord's one fan came: tifo complete.

v1 and v2 (1 and 2 November) stay on `*-v1` and `*-v2.near-post.testnet`;
they are no longer used.

Read it yourself:

```bash
near contract call-function as-read-only league-v3.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v3.near-post.testnet results json-args '{"match_day":1}' network-config testnet now
```

## Try it locally

Requirements: Node 26.13 or later, pnpm 12.16, Docker (for contracts).

```bash
pnpm install
pnpm test          # relay, web and simulation unit tests
pnpm sim           # supply over 60 match days
pnpm dev:web       # http://localhost:5173
```

The web app reads the v3 contracts on testnet. Email sign-in goes through the
relay: run `pnpm dev:relay` too (see `apps/relay/.env.example`); the dev
server proxies `/v1` to it. Screens, under `#/`:

- **Stands**: a club's live tifo, painted by the fans who checked in. Take your
  seat, follow a club, claim a full house, collect.
- **Match day**: countdown, the button that plays a due match day (anyone can),
  last results with scorers, the table.
- **Locker room**: sign in with email, create your footballer, sign for a club,
  report for the match, train (400k G burned), collect goals and salary, top up gas.
- **Album**: your club's squad as stickers (XI, C), the back of a sticker with
  its career, the captain vote.
- **Market**: scout a squad, bid in G, cancel; a manager accepts with one
  approval; collect sale shares.

Contracts, built and tested in the same pinned image as the CI:

```bash
docker run --rm --user 0 -v "$PWD":/__w/near-post/near-post -w /__w/near-post/near-post/contracts \
  sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb \
  bash -c 'rustup component add rustfmt clippy && bash build.sh && cargo test --workspace --lib'
```

Sandbox tests deploy the four checked-in wasm together on a local nearcore
2.14.0 (`NEAR_SANDBOX_BIN_PATH` points at the binary): a full match day with
fans, claims and the cap curve, and a 64-club match day for gas.

```bash
cd contracts && cargo test -p tests -- --test-threads=1 --nocapture
```

`build.sh` prints the sha256 of each wasm. They must equal the files in
`contracts/res/`, which is what the CI checks on every pull request.

## Deploy on Fly.io

One Fly app runs the relay and serves the built web app on the same origin
(`Dockerfile`, `fly.toml` at the root). It stays one machine, always on:
email codes and rate limits are in memory, and the scheduler plays match days.

```bash
fly secrets set PARENT_PRIVATE_KEY=ed25519:...        # creates accounts, funds gas, plays match days
fly deploy
```

For the hackathon, `fly.toml` turns the email check off
(`INSECURE_DEV_RETURN_CODE = "true"`): sign-in takes an email and nothing else.
For real players, set it to `"false"`, and `EMAIL_MODE=resend` with a
`RESEND_API_KEY` secret and a verified sending domain.

Rate limits use `Fly-Client-IP`, set by Fly's proxy, not the first
`X-Forwarded-For` entry, which a client can write.

## The supply, simulated

`pnpm sim` replays 60 match days with the contract's rules (seeded, reproducible;
model in `apps/sim/src/model.ts`):

| League | Day 1 | Day 30 | Day 60 |
| --- | --- | --- | --- |
| 8 clubs, attacking, loyal fans | 254M | 2.93B | 4.21B |
| 8 clubs, attacking, absent fans | 186M | 1.97B | 2.48B |
| 8 clubs, defensive, loyal fans | 223M | 2.27B | 3.26B |
| 8 clubs, defensive, absent fans | 155M | 1.24B | 1.46B |
| 8 clubs, no newcomers, absent fans | 161M | 280M | 0 |
| 64 clubs, attacking, loyal fans | 2.49B | 8.98B | 9.23B |

A living league grows its own money; a dead one burns it away; a big one bends
towards the cap and never reaches it. Assumptions: 8 clubs, 100 accounts plus
10 a day, one fan per 16 accounts on top of 50 per club, 70% of players train
daily. In the dead league, spending is not limited by balances, so "0" means
players could no longer afford training. The model assumes every account
keeps coming at the league's attendance rate; accounts that sign up and never
return (or fake ones) get 1M instead of 5M, which the model does not count.

Early players get more: the closer supply is to the cap, the smaller every
mint. That is the cap working, and it is intended.

## How it is built

| Part | What it does | Standard |
| --- | --- | --- |
| `contracts/goalars` | The G token. Only the league can mint, within the 10B curve; anyone can burn their own. | NEP-141 |
| `contracts/players` | Players as NFTs: sell-on clause as a payout, enumeration, approvals. Only the league creates players; every transfer is reported to the league. | NEP-171, NEP-178, NEP-181, NEP-199 |
| `contracts/items` | Boots, kits, training passes. Only the league mints. | NEP-245 (core) |
| `contracts/league` | The rules: clubs and academies, people's footballers, lineups and captains, fans and stadium, match days (fixtures, rating-driven scores, scorers, stands), salaries, training, the transfer market, claims, table. | — |
| `apps/relay` | TypeScript API: email login (codes by email, account creation with the browser's key), gas top-ups, match days played on schedule, league reads. | — |
| `apps/web` | The game in the browser (React). Sticker-album and tifo look. | — |
| `apps/sim` | Supply simulation with the contract's rules. | — |
| `scripts/deploy-testnet.mjs` | Deploys the checked-in wasm and writes `deployments/testnet.json`. Keys stay outside the repo. | — |

The rules are readable on chain with the league's `rules()` view.

### What the relay can and cannot do

All game logic and all balances live in the contracts. The relay exists
because a contract cannot check an email or pay gas for a player.

- It can: send a code to an email, create the player's NEAR account with the
  public key his browser made, give it NEAR for gas (0.3 at creation, then a
  top-up when below 0.15, twice a day at most), and call `play_match_day` when
  it is due (anyone else can call it too).
- It cannot: sign for a player (it never sees his private key), mint G, change
  a result, move a player's NFT or G, or change a rule.
- If it goes down, every NFT and every G stays on chain, and players keep
  playing with their keys through any RPC.

| Endpoint | What it does |
| --- | --- |
| `POST /v1/auth/start {email}` | Sends a six-digit code (10 minutes, single use, 5 tries). Rate limited per IP and per email. |
| `POST /v1/auth/verify {email, code, public_key}` | Creates `u<hash>.near-post.testnet` with that key and 0.3 NEAR, or says the account exists and whether this key is on it. |
| `POST /v1/accounts/:id/topup` | Gas for a player account below 0.15 NEAR, twice a day at most. |
| `GET /v1/rules`, `GET /v1/clubs/:id/stand` | League reads. |

Run it: `cp apps/relay/.env.example apps/relay/.env`, set `PARENT_PRIVATE_KEY`
(the key of the account that creates players' accounts; never commit it),
then `pnpm dev:relay`. Without `RESEND_API_KEY`, codes are printed in the
relay's log (`EMAIL_MODE=console`).

Tested on testnet on 2 November 2026 (`scripts/email-e2e.mjs`): a relay run
locally signed in `ines.e2e@example.com`, created
[`uf610696bf5b9d4b8.near-post.testnet`](https://testnet.nearblocks.io/txns/GSMNtSnnsaQNKetwdNDrFP87gHohVbdD3CJsgeuL13p7)
with the browser's key, and that key then created a footballer
([create_footballer](https://testnet.nearblocks.io/txns/BVaKMB2syKBShMiaKGkpFRFRBPZAXAGQ8nfeVhhLQXup)),
signed for Port-Lune and reported, for 0.002 NEAR of gas.

## Limits

- **Your key lives in your browser.** Lose it (cleared storage, new device)
  and the relay cannot add a new one, because it holds no key on your account:
  export your key, or start a new account. This is the price of no custody.
- Gas funding can be farmed with many emails; codes, rate limits and small
  amounts keep it cheap on testnet. A mainnet relay would need stronger limits.
- **Testnet contract accounts still hold their deploy keys** while the game is
  being built, so we can redeploy. They will be deleted before submission;
  after that, a new version means new accounts (v2), not an upgrade.

- Club shares go to the club treasury, which the league holds as real G so
  that penalties can burn it.
- Ratings live in the league (it is the game engine); the NFT metadata keeps
  the academy ratings. A player's squad follows his NFT through the transfer
  report, which arrives a block after the transfer.
- Personal rewards are credits: the account calls `claim` to mint them, and
  like every mint they are scaled under the 10B cap at that moment.
- At most 64 clubs, so a match day fits in one transaction. Measured in the
  sandbox: over a full week of 64 clubs (720 players, 16 of them people), the
  worst match day, the one that also elects 64 captains, burns 146 Tgas in the
  league call (163 Tgas in total), under the 300 Tgas limit; creating a club
  and minting its eleven players costs 34 Tgas.
- No seasons yet: no promotion, no relegation burn.

- Match randomness comes from NEAR's block random seed. A block producer
  could in theory bias it. Acceptable for a game without bets; there are no bets.
- `items` implements NEP-245 balances, supply, transfer and batch transfer;
  `mt_transfer_call` and approvals are not implemented yet.
- In `players`, a `nft_transfer_call` that the receiver refuses when the
  player already had 3 past clubs forgets the oldest one.
- A registration can also move by plain NFT transfer (a gift, a free signing):
  no price, so no sell-on share. Offers have no expiry; the bidder cancels.
- Salaries are paid while the treasury lasts, starter by starter: when it runs
  dry, the later starters of that match day are not paid.
- The web app talks to a public testnet RPC, which can be slow or rate-limited.

## Versions

Pinned, latest releases on 1 November 2026: Rust 1.99.1, cargo-near 0.22.0,
near-sdk 5.30.0, Node 26.13 LTS, pnpm 12.16.1, TypeScript 7.0.2, Vite 8.3.5,
React 19.3.1, Hono 4.13.14, near-api-js 7.4.0, Vitest 5.0.5, Zod 4.6.7.
Hono is one patch behind the newest because pnpm's minimum-release-age policy
refuses packages published less than a day ago.

## Origin and the other project

NEAR Post revives the idea of Star du Foot (stardufoot.com), a football game
its author made years ago. No code from it is reused; everything here was
written during the hackathon.

The same author also submits **Euthyna** (https://github.com/Euthyna-wallets/MandateOS),
a separate project: companies run by AI agents with keyless on-chain vaults
that only a DAO vote can move. The two projects share no code.

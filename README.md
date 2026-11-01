# NEAR Post

**Football where the fans mint the money.**

NEAR Post is a football management game on NEAR. Your players are NFTs, the
only currency is a memecoin (goalars, G), and the fans keep that currency alive:
every match day they fill the stadium, and a full stand mints new G while an
empty one burns the club's treasury.

Built for the NEAR Hackathon (November 2026), tracks: NFTs, Games, Memecoins.

> **Status, 1 November 2026.** The four contracts compile reproducibly and are
> unit-tested and sandbox-tested, match days included, and **deployed on
> testnet** (v1, below). The relay reads the league from chain; the web app
> shows the stadium screen on an example stand. Email login, gas relaying and
> the transfer market are not built yet.

## The game in one minute

- **Sign in with email.** No wallet, no seed phrase, no gas prompt. (Not built yet.)
- **Your club starts in Division 3.** Every new account gets 1M G, then 1M more
  on each of its first 4 stadium visits: 5M for a fan who shows up.
- **Players are stickers in an album** (NEP-171 NFTs). Train them, sell them, or
  open a youth pack to create a new one.
- **Match days are played on chain.** Every club meets every other once per
  cycle. Anyone can call `play_match_day` when it is due; the score comes from
  the block's random seed. Win 3 points, draw 1.
- **Goals mint G:** 6M G per goal, 4.2M to the scorer and 1.8M to the club. A
  goal after the 90th minute counts double; an own goal burns 6M G.
- **Rivals make derbies.** Two clubs that name each other (`set_rival`) play
  derbies, where the stands mint or burn double.
- **The stadium is a tifo.** Each fan who checks in paints part of it. At 60% of
  the club's fans the tifo is complete and every fan present gets 100k G. If it is
  not complete at kick-off, 2% of the club treasury burns. Derbies double both.
- **The sell-on clause is in the token.** On every sale: 10% to the club that
  trained the player, 2% to each of his last 3 clubs, 3% burned, the rest to
  the seller. Any NEP-199 market pays it.
- **10 billion G, ever.** Supply starts at zero and every mint is scaled by
  the room left: `minted = amount × (10B − supply) / 10B`. At 5B a goal mints
  3M instead of 6M; at 9B, 600k. Burns free room for new mints. The goalars
  contract enforces it, so no bug in the league can pass the cap.
- **No admin method.** No contract has an owner, an admin function or an
  upgrade method: nobody, including us, can mint G or change a rule through
  them. No presale, no team allocation. (On testnet the contract accounts still
  hold their deploy keys while we iterate; see Limits.)

## Live on testnet (v1)

| Contract | Account |
| --- | --- |
| League | [`league-v1.near-post.testnet`](https://testnet.nearblocks.io/address/league-v1.near-post.testnet) |
| Goalars | [`goalars-v1.near-post.testnet`](https://testnet.nearblocks.io/address/goalars-v1.near-post.testnet) |
| Players | [`players-v1.near-post.testnet`](https://testnet.nearblocks.io/address/players-v1.near-post.testnet) |
| Items | [`items-v1.near-post.testnet`](https://testnet.nearblocks.io/address/items-v1.near-post.testnet) |

Each account's code hash is the base58 sha256 of the matching file in
`contracts/res/` (see `deployments/testnet.json`). A match day is due every
10 minutes and anyone can play it.

First match day, 1 November 2026: the derby Olympique Rive Nord 2-0 FC Port-Lune
([play_match_day](https://testnet.nearblocks.io/txns/Ez3szi66K2zpa2sTcvzQd1iGdATqSraaZgZtf3TYgcv3)).
Rive Nord's one fan was in the stand, so the tifo was complete and, derby
oblige, his claim minted 200k G scaled by the cap curve
([claim](https://testnet.nearblocks.io/txns/4LTb68BMmTCKSKxc5jSyRGDUspmUQU1V5Dc5eyeybLoH)).
The two goals put 3.6M G in Rive Nord's treasury, which the league holds.

Read it yourself:

```bash
near contract call-function as-read-only league-v1.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v1.near-post.testnet results json-args '{"match_day":1}' network-config testnet now
```

## Try it locally

Requirements: Node 26.13 or later, pnpm 12.16, Docker (for contracts).

```bash
pnpm install
pnpm test          # relay, web and simulation unit tests
pnpm sim           # supply over 60 match days
pnpm dev:web       # http://localhost:5173
```

- Open http://localhost:5173 and pick **Kick-off**: the tifo completes and the
  stand waves. Pick **If fans stay home**: the tifo stays full of holes and the
  page says 2% of the treasury burns.
- Click **Take your seat**: your square lights up, bottom row.

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
| `contracts/players` | Players as NFTs, with the sell-on clause as a payout. Only the league creates players. | NEP-171, NEP-199 |
| `contracts/items` | Boots, kits, training passes. Only the league mints. | NEP-245 (core) |
| `contracts/league` | The rules: clubs, welcome grant, fans, stadium check-in, match days (fixtures, scores, goals, stands), claims, table. | — |
| `apps/relay` | TypeScript API. Today: reads rules and stands from chain. Next: email login, session keys, gas relaying, match-day trigger. | — |
| `apps/web` | The game in the browser (React). Sticker-album and tifo look. | — |
| `apps/sim` | Supply simulation with the contract's rules. | — |
| `scripts/deploy-testnet.mjs` | Deploys the checked-in wasm and writes `deployments/testnet.json`. Keys stay outside the repo. | — |

The rules are readable on chain with the league's `rules()` view.

### What the relay can and cannot do

All game logic and all balances live in the contracts. The relay exists
because a contract cannot check an email or pay gas for a player.

- It can: create a player's NEAR account after email login, give it a session
  key limited to the game contracts, pay gas, and call "play match day" on
  schedule (anyone else can call it too).
- It cannot: mint G, change a result, move a player's NFT or G, or change a
  rule. A session key cannot transfer NEAR.
- If it goes down, every NFT and every G stays on chain.

## Limits

- **Testnet contract accounts still hold their deploy keys** while the game is
  being built, so we can redeploy. They will be deleted before submission;
  after that, a new version means new accounts (v2), not an upgrade.

- Until squads exist, a goal's scorer share (4.2M) is credited to the club's
  manager. Club shares go to the club treasury, which the league holds as real
  G so that penalties can burn it.
- Personal rewards are credits: the account calls `claim` to mint them, and
  like every mint they are scaled under the 10B cap at that moment.
- At most 64 clubs, so a match day fits in one transaction. Measured in the
  sandbox: a 64-club match day burns 51 Tgas in the league call (67 Tgas with
  the mint, burn and callback), well under the 300 Tgas limit.
- No seasons yet: no promotion, no relegation burn.

- Match randomness comes from NEAR's block random seed. A block producer
  could in theory bias it. Acceptable for a game without bets; there are no bets.
- `items` implements NEP-245 balances, supply, transfer and batch transfer;
  `mt_transfer_call` and approvals are not implemented yet.
- In `players`, a `nft_transfer_call` that the receiver refuses when the
  player already had 3 past clubs forgets the oldest one.
- Nothing is deployed yet; the stadium screen runs on example data marked
  "Preview".

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

# NEAR Post

**Football where the fans mint the money.**

NEAR Post is a football management game on NEAR. Your players are NFTs, the
only currency is a memecoin (goalars, G), and the fans keep that currency alive:
every match day they fill the stadium, and a full stand mints new G while an
empty one burns the club's treasury.

Built for the NEAR Hackathon (November 2026), tracks: NFTs, Games, Memecoins.

> **Status, 1 November 2026: scaffold.** The four contracts compile
> reproducibly and their rules are unit-tested; the relay reads the league from
> chain; the web app shows the stadium screen on an example stand. Match days,
> email login and gas relaying are not built yet. Nothing is deployed.

## The game in one minute

- **Sign in with email.** No wallet, no seed phrase, no gas prompt. (Not built yet.)
- **Your club starts in Division 3** with a 50 G starter grant.
- **Players are stickers in an album** (NEP-171 NFTs). Train them, sell them, or
  open a youth pack to create a new one.
- **Goals mint G:** 60 G per goal, 42 to the scorer and 18 to the club. A goal
  after the 90th minute counts double; an own goal burns 60 G.
- **The stadium is a tifo.** Each fan who checks in paints part of it. At 60% of
  the club's fans the tifo is complete and every fan present gets 1 G. If it is
  not complete at kick-off, 2% of the club treasury burns. Derbies double both.
- **The sell-on clause is in the token.** On every sale: 10% to the club that
  trained the player, 2% to each of his last 3 clubs, 3% burned, the rest to
  the seller. Any NEP-199 market pays it.
- **No admin key.** Nobody, including us, can mint G or change a rule after
  launch.

## Try it (today)

Requirements: Node 26.13 or later, pnpm 12.16, Docker (for contracts).

```bash
pnpm install
pnpm test          # relay and web unit tests
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

`build.sh` prints the sha256 of each wasm. They must equal the files in
`contracts/res/`, which is what the CI checks on every pull request.

## How it is built

| Part | What it does | Standard |
| --- | --- | --- |
| `contracts/goalars` | The G token. Only the league can mint; anyone can burn their own. | NEP-141 |
| `contracts/players` | Players as NFTs, with the sell-on clause as a payout. Only the league creates players. | NEP-171, NEP-199 |
| `contracts/items` | Boots, kits, training passes. Only the league mints. | NEP-245 (core) |
| `contracts/league` | The rules: clubs, starter grant, fans, stadium check-in. Match days come next. | — |
| `apps/relay` | TypeScript API. Today: reads rules and stands from chain. Next: email login, session keys, gas relaying, match-day trigger. | — |
| `apps/web` | The game in the browser (React). Sticker-album and tifo look. | — |

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

- Match randomness will come from NEAR's block random seed. A block producer
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

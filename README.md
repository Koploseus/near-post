# NEAR Post

![NEAR Post: a winged crest with a ball, the NEAR POST banner, "The star is you!" and $G coins](apps/web/public/og.png)

**Football where the fans mint the money.**

NEAR Post is a football management game on NEAR. Your players are NFTs, the
only currency is a memecoin (goalars, G), and the fans keep that currency alive:
every match day they fill the stadium, and a full stand mints new G while an
empty one burns the club's treasury.

Built for the NEAR Hackathon (November 2026), tracks: NFTs, Games, Memecoins.

> **Judges: [JUDGE-PATH.md](JUDGE-PATH.md)** walks through the live app in
> 10 minutes, with what to check on chain at each step.
>
> **Check the money in one command:** `node scripts/verify.mjs` (no keys, no
> install) replays the last 10 match days from the chain and checks every mint
> and burn against the rules (below).
>
> **Status, 6 November 2026.** Five contracts compile reproducibly, are
> unit-tested and sandbox-tested (148 Rust tests, 115 TypeScript tests), and
> run on **testnet** (v7, below). The relay signs players in by email, pays
> their gas and plays match days; 76 AI agents play in the league. Live at
> https://near-post.fly.dev.

## The mechanic: no fans, no money

G is minted only for people who show up:

- **A goal mints 600k G scaled by how full the scoring club's stand is.** An
  empty stand mints nothing, whatever the score (x2 after the 90th minute, x2
  in a derby).
- **A full house mints 100k G per fan present** (a stand is full at 60% of
  the club's fans), and pays the club's season tickets.
- **A stand that is not full burns 2% of its club's treasury.**
- **Spending burns:** training 400k G, a pack 500k G, 3% of every transfer,
  10% of a relegated club's treasury, an own goal up to 600k G.
- Onboarding: 1M G when an account first joins a club, then 1M G on each of its
  first 4 stadium check-ins, so four of the five million also need the
  account to show up. It shows apart from the rest on the chart and in the
  check below.

So the supply follows the crowds. On testnet, match days whose stands were
half full or more minted about **+7M G net**; days with empty stands burned
about **650k G** (figures from the script below, they change every day).

**Check it yourself.** One command, Node only, read-only:

```
node scripts/verify.mjs            # the last 10 match days; --days 30 for more
```

It reads the league, the token and the stands on chain and, for each match
day, recomputes and checks: who had a full house (present ≥ 60% of fans), each
full-house mint, each burn and that only stands that were not full burned,
each goal's mint from its scorer's stand fill (empty stand: nothing), that
season tickets paid only on full houses, and the supply against the 10B cap. It
also checks that each deployed contract runs `contracts/res/*.wasm` (sha256
against the on-chain code hash), and lists who spends G. Excerpt of a run on 6
November 2026:

```
  day  fans in  full   goals that   minted by      onboarding    burned
       stands  houses minted G     presence
  158      0%    0/8       0/49             0 G           0 G     47,857.3 G
  157      0%    0/8       0/36             0 G           0 G    652,915.6 G
  156     95%    6/8       7/32     6,099,980 G           0 G      3,288.4 G
  155      0%    0/8       0/58             0 G           0 G    338,281.3 G
  153     68%    3/8      17/48     7,649,900 G           0 G     36,893.9 G
  ...
✓ 432 checks passed, 0 failed
```

The same numbers, as a chart, on the Goalars page (Stands → Goalars, "No fans,
no money"): the share of fans in the stands as a line, G minted above the axis,
G burned below.

## An economy of 76 agents

The league never runs empty: 24 AI coaches run the fictional clubs and 52 AI
footballers play in it. Each is an ordinary NEAR account with its own G wallet,
calling the same contract methods as people, with the same rights. Coaches
buy and sell players (every sale burns 3%) and pick formations; footballers
report for matches, vote the captain and the strategy, buy packs (500k G
burned each), wear what they unbox, and sign for clubs as free agents. A
model on NEAR AI Cloud picks among options the code computed, and the code
checks every field before signing (details in
[AI coaches and AI footballers](#ai-coaches-and-ai-footballers)). Their
spending shows in the ledger: over match days 114–158 the AI footballers bought
28 packs (14M G burned) and transfers burned 656k G in sale tax
(`node scripts/verify.mjs`, section 5).

## The game in one minute

- **Sign in with email.** No wallet, no seed phrase, no gas prompt. The browser
  makes a key pair and keeps the private key; after a six-digit email code, the
  relay creates your NEAR account (`u<hash>.near-post.testnet`, derived from
  your email, which never goes on chain) with that public key and 0.3 NEAR.
  The relay never holds your key: it can fund you, never act for you.
- **Your account on any device, with a passkey.** After sign-up, one touch
  (Face ID, fingerprint) saves your account: the passkey derives a secret
  (WebAuthn PRF) that encrypts your key in the browser, and only the
  ciphertext goes to the relay. On another device: email, code, one touch,
  and the passkey decrypts it there. Passkeys sync through iCloud Keychain or
  Google Password Manager; on a computer without yours, the browser shows a QR
  code for your phone. The relay can never open a backup.
- **You never pay gas.** Every call from the app is a NEP-366 meta
  transaction: your browser signs a delegate action with your key, the relay
  wraps it in a transaction and pays the gas. It relays only player accounts,
  only our three contracts and the game's methods, up to 300 Tgas, a few
  hundred calls a day. Match days kick off on their own: the relay plays them
  when due (anyone still can).
- **Divisions of 20, promotion and relegation.** A new club joins the lowest
  division with room (a new one opens below when all are full). A season is
  19 match days, a full round of a 20-club division; at its end the bottom
  three of each division swap with the top three of the one below (fewer
  when a division is small), the final tables are kept on chain
  (`final_table`) and every club starts again on zero. `play_match_day`
  plays one division per call, so the gas of a call never grows with the
  league (107 Tgas at most for a 20-club division in the sandbox).
- **A wardrobe of NFT items.** Haircuts, boots and headbands are NEP-245
  items in four rarities. A pack of three costs 500k G, burned
  (`ft_transfer_call` with `{"pack":{}}`; common 70%, rare 22%, epic 7%,
  legendary 1%). Three items of a kind and rarity fuse into one of the next
  rarity (`fuse`). The person who plays a footballer dresses him (`equip`,
  `unequip`): the league holds a worn item and sends it back when it comes
  off. Only the league mints items, and it burns or takes them only when
  their holder asks.
- **Signing up pays.** Every new account gets 1M G, then 1M more
  on each of its first 4 stadium visits: 5M for a fan who shows up.
- **You are a footballer.** `create_footballer(name, position)` mints your
  player as an NFT in your name: a free agent. Give that registration to a club
  (an NFT transfer) and you are in its squad. A squad is twelve, eleven and
  one more, so everyone plays by default: past twelve, the weakest academy
  player leaves the squad, and a club with twelve people is full.
- **Six skills, a rating out of 100.** Every player has pace, shooting,
  passing, dribbling, defending and physical (1 to 99). His card rating weighs
  them by position, like a striker's shooting and pace or a defender's
  defending and physical; bronze below 65, silver from 65, gold from 75. The
  match engine's attack and defence come from the same skills.
- **Clubs are full from day one.** A new club signs eleven academy players (a
  4-4-2, ratings 25 to 65), played by the league, so there is always eleven a
  side however few people play. People replace them as they join; if a squad
  still runs short, an academy kid (rated 35, not an NFT) fills the gap.
- **Teammates elect a captain every week, on chain.** Each person in the squad
  has one vote (`vote_captain`), changeable until the week ends; the last match
  day of the week counts it (ties go to the better-rated player) and keeps the
  result as history. The captain (or, without one, the manager) picks the
  formation: 4-4-2, 4-3-3, 3-5-2 or 4-2-3-1 (`set_formation`), and names who
  takes free kicks and penalties (`set_takers`; else the best shooter on the
  pitch).
- **You take your place on the pitch.** Until a minute before kick-off, each
  person picks a free slot in the formation (`take_slot`; nobody can take a
  slot another person chose, and the contract refuses any change in the last
  minute). Before kick-off and at half-time he votes the strategy: defend,
  balanced or attack (`vote_strategy`, most votes wins). A minute before
  kick-off, the free slots go to the best squad player for the role:
  every role (keeper, full-back, centre-back, holding, central, wide or
  attacking midfielder, winger, striker) weighs the six skills its own way.
- **Matches are live: two halves of ten real minutes.** A match day kicks off
  every 30 minutes on testnet. At kick-off `play_match_day` plays the first
  half of every fixture, division by division, with its action engine:
  the ball is at one player's feet, who passes, takes a man on, is fouled or
  shoots, with odds from his role, his skills, the opponent marking him and
  the strategy; time and possession run as it goes. A foul in the attacking
  third can give a direct free kick or a penalty. A second yellow or a
  straight red sends a man off: his side plays on with ten (more space for
  the other side, nobody comes on after the break) and he is suspended for
  the next match day. After five minutes of
  half-time, the same call plays the second half and settles the day. The app
  replays each half over ten real minutes, its clock running at 45 minutes a
  half: score, shots, saves, corners, fouls, cards, possession, then the man
  of the match. The match sheet also records the last pass before an
  open-play goal (an assist) and every ball won off a dribbler (a tackle).
  A goal adds one point of shooting. Win 3 points, draw 1.
- **Season stats** (Team tab, `GET /v1/stats`), counted from the on-chain
  match sheets and stands: players (goals, assists, shots, tackles, saves,
  clean sheets, man of the match, penalties, fouls, cards), clubs (attack,
  defence, form over the last five, winning runs, biggest wins, possession,
  fair play) and fans (crowds, fill of the stand, full houses and their runs).
- **Goals mint G, if the fans came:** a goal mints up to 600k G, 420k to the
  scorer's own wallet and 180k to the club, in proportion to how full the
  scoring club's stand is that day (present fans over the 60% full-house
  target, capped at 1). Full stand: 600k. Half of the target: 300k. Empty
  stand, or a club with no fans: nothing. A goal after the 90th minute counts
  double; an own goal burns 600k G from the club at fault.
- **What a player earns:** his goals; a 200k salary from the club treasury for
  every match he starts (while the treasury lasts); 5% of every sale of his
  registration. All of it follows the person, not the club: he collects with
  `claim_player`. Academy players' wallets go to their club.
- **Training is a drill.** Send 400k G to the league with `ft_transfer_call`
  and `msg {"train": {"token_id": "<id>", "skill": "pace"}}`: the G burn and a
  training ticket opens. Then play a football game in the browser, one per
  family of skills: penalties against a keeper (shooting, physical), through
  balls to a running teammate (passing), dodging slide tackles (dribbling), a
  sprint to a loose ball (pace), timing a tackle on a cutting attacker
  (defending). It gets harder as the skill rises. 90% of the rounds give 3
  points, 70% give 2, 50% give 1; from 80 a training adds at most 2, from 90
  at most 1. The relay replays your inputs against the ticket's on-chain seed
  (`apps/relay/src/penalty.ts`, `games.ts`) and signs the
  points; `finish_training` checks that signature. Once per match day.
- **The drill's attester is the one trusted key.** A contract cannot see a
  browser game, so the league accepts training points signed by one ed25519
  key, fixed at init and readable with `attester()`. The relay holds it. It can
  grant at most 3 points per paid ticket, once, within its match day, and
  nothing else: no mint, no transfer, no rule. A bot that plays the drill well
  still pays 400k G per try and gains 3 points a day at most.
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
  the room left: `minted = amount × (10B − supply) / 10B`. At 5B a full-stand goal
  mints 300k instead of 600k; at 9B, 60k. Burns free room for new mints. The goalars
  contract enforces it, so no bug in the league can pass the cap.
- **No admin method.** No contract has an owner, an admin function or an
  upgrade method: nobody, including us, can mint G or change a rule through
  them. The drill attester above only signs training scores. No presale, no team allocation. (On testnet the contract accounts still
  hold their deploy keys while we iterate; see Limits.)

## AI coaches and AI footballers

The 24 fictional clubs are run by AI coaches, and 52 AI footballers play in
the league next to people: 2 per fictional club, and 4 free agents that any club can sign. Each agent is
an ordinary NEAR account with its own G wallet (`<club>.near-post.testnet`,
`ai-<n>.near-post.testnet`). Agents and people use the same contract methods
and have the same rights, no more. An AI footballer can be elected captain of a human club, like anyone else.

| Agent | When | What it decides (contract call) |
| --- | --- | --- |
| Coach | between match days | accept one offer for a player (`nft_approve`), bid for one player (`ft_transfer_call {"bid"}`), collect earnings |
| Coach | before kick-off, at half-time | the formation against this opponent and score (`set_formation`; the captain decides instead when the club has one) |
| Footballer | between match days | report (`report_for_match`), the strategy (`vote_strategy`), once a week the captain (`vote_captain`), buy a pack and wear it (`{"pack"}`, `equip`), as a free agent: sign for a club or accept an offer |
| Footballer | at half-time | the strategy for the second half |

How a decision is made (`apps/relay/src/agents/`):

1. `rules.ts`, one readable file, does the football and the money: it prices
   every player (250k G at 50 overall, 7% more per point, moved halfway to
   recent sales, up to 30% more when clubs bid for his position), rates each
   formation's back, middle and front with the contract's own weights, and
   lists what the agent may do, with a price range.
2. A language model on NEAR AI Cloud (`Qwen/Qwen3.6-35B-A3B-FP8`, one of the
   models NEAR AI Cloud serves in a TEE) picks among those options in the agent's character
   (coaches: builder, gambler, careful, tactician; footballers: leader,
   showman, loyal, mercenary) and says why in one line.
3. The code checks every field against the options before signing. Anything
   else is refused and logged, and the rules decide that field. Without a model key, the rules
   decide everything.

Prompt injection and manipulation:

- The model never sees text written by people: no player, club or account
  names, only ids, aliases (`club_1`, `player_2`) and numbers. A test feeds
  injection strings as names and checks they never reach the prompt
  (`runner.test.ts`).
- It answers JSON against a schema, has no tools, sees no key and builds no
  transaction. The code builds each transaction from a checked option, from
  a fixed list of methods; at most one sale and one bid per coach a day.
- Its quotes are shown as plain text: one line, 160 characters, no links,
  no markup.
- What the code cannot prevent: a player who sells players between his own
  accounts to push the reference price up. The move is bounded (halfway to the
  median of sales, 100k to 5M G) and the 3% sale tax burns on every sale.

Check it yourself:

- `GET /v1/agents` lists the agents; `GET /v1/agents/feed` shows each
  decision with its quote, transactions, what the checks refused, and the
  model evidence (SHA-256 of the exact request and response, completion id,
  NEAR AI Cloud's signature when it returns one).
- `pnpm --filter @near-post/relay verify-agent [account]` checks the latest
  signed decisions on your machine: the signed text is that request's and
  response's SHA-256, the ECDSA signature recovers to the signing address, and
  that address is the model's in NEAR AI's attestation report (Intel TDX and
  NVIDIA quotes). It trusts neither the relay nor us.
- In the app: `#/ai`, the coaches' words in the live match, AI tags on
  the cards.

The relay holds the agents' keys, derived from one secret (`AGENTS_SEED`).
They are the project's own agents, not players' keys: the relay still holds
no key of any person.

## Season tickets and the G page

**The money breathes with the fans.** Every match day each club's fans check
in; at 60% of its fans the stand is full and mints G for them, otherwise 2%
of the club's treasury burns. The Goalars page (Stands → Goalars) shows it as
it happens: the supply against the 10B cap, every stand's progress today,
the longest run of full houses (`best_streak`, kept by the contract) as a high
score, and the ledger of every mint and burn the league causes (`ledger`
view, the last 600, with the match day, the reason and the club).

**A season ticket is an NFT that holds its own money** (`contracts/tickets`):

- A club sells at most 50 a season, 300k G each, paid into its treasury
  (`ft_transfer_call` to the league with `{"season_ticket":"<club>"}`).
- At each full house of its club, every ticket of that season earns 50k G
  (x2 in a derby): the league mints them to the tickets contract and credits
  the club's tickets through an index, so a credit costs the same for 1 or
  50 tickets and a ticket bought later does not get what was paid before it.
- The G belong to the token. `withdraw` pays the ticket's balance to whoever
  owns it at that moment, and only him. Sell or give the ticket
  (`nft_transfer`, NEP-171) and its balance, its earnings to come and its
  access go to the new owner; the transfer clears the old owner's approvals.
- The fan zone (Stands → Season tickets) is for holders only: the request is
  signed with a key of the account, the relay checks the key on chain and the
  ticket on the tickets contract (`POST /v1/fanzone`), and returns the AI
  coach's briefing before each half, which the public feed never shows.

Do this - see that: sign in, follow a club, buy its season ticket (Stands →
Season tickets); fill the stand with other fans; after the match day the
ticket shows its share, and `tickets_of` on `tickets-v7.near-post.testnet`
shows the same balance.

## Live on testnet (v7)

| Contract | Account |
| --- | --- |
| League | [`league-v7.near-post.testnet`](https://testnet.nearblocks.io/address/league-v7.near-post.testnet) |
| Goalars | [`goalars-v7.near-post.testnet`](https://testnet.nearblocks.io/address/goalars-v7.near-post.testnet) |
| Players | [`players-v7.near-post.testnet`](https://testnet.nearblocks.io/address/players-v7.near-post.testnet) |
| Items | [`items-v7.near-post.testnet`](https://testnet.nearblocks.io/address/items-v7.near-post.testnet) |
| Season tickets | [`tickets-v7.near-post.testnet`](https://testnet.nearblocks.io/address/tickets-v7.near-post.testnet) |

Each account's code hash is the base58 sha256 of the matching file in
`contracts/res/` (see `deployments/testnet.json`, which also records the drill
attester's public key). A match day kicks off every 30 minutes: two halves of
ten minutes and five minutes of half-time. The relay plays each half when it
is due (anyone can). The league has 24 fictional clubs in two divisions,
8 of them in 4 derbies, a demo crowd and the AI agents above.

v1 to v4 (1 and 2 November) stay on `*-v1` to `*-v4.near-post.testnet`;
they are no longer used.

Read it yourself:

```bash
near contract call-function as-read-only league-v7.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v7.near-post.testnet results json-args '{"match_day":1}' network-config testnet now
```

## Try it locally

Requirements: Node 26.13 or later, pnpm 12.16, Docker (for contracts).

```bash
pnpm install
pnpm test          # relay, web and simulation unit tests
pnpm sim           # supply over 60 match days
pnpm dev:web       # http://localhost:5173
```

The web app reads the v7 contracts on testnet. Email sign-in goes through the
relay: run `pnpm dev:relay` too (see `apps/relay/.env.example`); the dev
server proxies `/v1` to it. Screens, under `#/`:

- **Stands**: a club's live tifo, painted by the fans who checked in. Take your
  seat, follow a club, claim a full house, collect.
- **Match day**: countdown, the button that plays a due match day (anyone can),
  last results with scorers, shots, shots on target and man of the match, the
  table.
- **Locker room**: sign in with email, create your footballer, sign for a club,
  report for the match, train a skill with the drill, collect goals and salary,
  top up gas.
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
fans, claims and the cap curve, and a 32-club week of live match days for gas.

```bash
cd contracts && cargo test -p tests -- --test-threads=1 --nocapture
```

`build.sh` prints the sha256 of each wasm. They must equal the files in
`contracts/res/`, which is what the CI checks on every pull request.

## Deploy on Fly.io

One Fly app runs the relay and serves the built web app on the same origin
(`Dockerfile`, `fly.toml` at the root). It stays one machine, always on:
email codes and rate limits are in memory, and the scheduler plays match days.
Passkey backups live on a volume, to create once:

```bash
fly volumes create near_post_data --region cdg --size 1
fly secrets set PARENT_PRIVATE_KEY=ed25519:...        # creates accounts, funds gas, plays match days
fly secrets set CROWD_PRIVATE_KEY=ed25519:...         # the demo crowd's shared key
fly secrets set ATTESTER_PRIVATE_KEY=ed25519:...      # signs drill scores (public key set in the league)
fly secrets set AGENTS_SEED=...                       # the AI agents' keys are derived from it (32+ chars)
fly secrets set NEAR_AI_API_KEY=sk-...                # optional: without it the agents follow their rules
fly deploy
```

The coaches sign with their clubs' accounts: add each coach's derived key once,
with the clubs' own keys (`pnpm --filter @near-post/relay build && AGENTS_SEED_FILE=<file> node scripts/agents-keys.mjs <keys-dir>`).
The relay creates the AI footballers' accounts itself.

For the hackathon, `fly.toml` turns the email check off
(`INSECURE_DEV_RETURN_CODE = "true"`): sign-in takes an email and nothing else.
For real players, set it to `"false"`, and `EMAIL_MODE=resend` with a
`RESEND_API_KEY` secret and a verified sending domain.

The league on testnet has 8 fictional clubs paired as rivals, and a demo
crowd of 26 fan accounts (`scripts/seed-demo.mjs`). The relay seats that
crowd one match day in three: each club gets a mood for the day and each fan
an arrival time, both from a hash of the day, so some tifos complete and
others do not. A check-in stores about 180 bytes in the league; the relay
tops up the contracts' storage balance from the parent (`KEEP_FUNDED`).
These are ordinary transfers: no contract has an admin method.

Rate limits use `Fly-Client-IP`, set by Fly's proxy, not the first
`X-Forwarded-For` entry, which a client can write.

## The supply, simulated

`pnpm sim` replays 60 match days with the contract's rules (seeded, reproducible;
model in `apps/sim/src/model.ts`):

| League (v7 rules, 24 clubs) | Day 1 | Day 30 | Day 60 |
| --- | --- | --- | --- |
| Loyal fans (75% come) | 228M | 3.20B | 5.40B |
| Half-hearted fans (60%, on the edge) | 184M | 2.39B | 4.06B |
| Absent fans (45% come) | 149M | 1.58B | 2.55B |
| No newcomers, absent fans | 141M | 474M | 436M |
| 200 clubs, loyal fans | 2.68B | 9.67B | 9.77B |

The fans set the money supply. Every mint that matters depends on them: a full
house pays per fan present, a goal pays in proportion to the scoring club's
stand, and a season ticket earns only at full houses. With loyal fans the
supply grows; with absent fans it grows at half the pace; a league that stops
recruiting stalls and then shrinks, because training, packs, the sale tax,
empty stands and relegation keep burning. A big league bends towards the cap
and never reaches it. Until v7, goals minted a flat 6M whoever was watching,
which sent any league to the cap whatever its fans did.

Assumptions (`V7_LEAGUE` in the model): 24 clubs, 100 accounts plus 10 a day,
20 supporters per club plus one fan per 24 accounts, 2.6 goals a match, 30% of
players train daily, 4 transfers and 6 packs a day, one season ticket per club
a day, 2 clubs relegated every 19 match days. The model assumes every account
keeps coming at the league's attendance rate; accounts that sign up and never
return (or fake ones) get 1M instead of 5M, which the model does not count.

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
- It keeps: passkey backups, encrypted in the browser by a secret only the
  player's passkey produces, stored only when signed by a key of that account,
  handed back only after the email code.
- It cannot: sign for a player (it never sees his private key, nor can it
  open a backup), mint G, change
  a result, move a player's NFT or G, or change a rule.
- If it goes down, every NFT and every G stays on chain, and players keep
  playing with their keys through any RPC.

| Endpoint | What it does |
| --- | --- |
| `POST /v1/auth/start {email}` | Sends a six-digit code (10 minutes, single use, 5 tries). Rate limited per IP and per email. |
| `POST /v1/auth/verify {email, code, public_key}` | Creates `u<hash>.near-post.testnet` with that key and 0.3 NEAR, or says the account exists and whether this key is on it. |
| `POST /v1/vault {account_id, public_key, ts, signature, credential_id, salt, iv, ciphertext}` | Stores a passkey backup, signed by a key of that account (5 minutes, 5 passkeys at most). The verify call returns the backups to a device whose key is not on the account. |
| `GET /v1/time`, `GET /v1/kickoffs/:day` | The relay's clock and the real kick-off of each half, so every viewer sees the live match in step. |
| `POST /v1/accounts/:id/topup` | Gas for a player account below 0.15 NEAR, twice a day at most. |
| `GET /v1/agents`, `GET /v1/agents/feed?limit&day`, `GET /v1/agents/:account` | The AI agents and their journal. |
| `POST /v1/fanzone {account_id, public_key, ts, signature}` | For season ticket holders: signed with a key of the account (checked on chain), the account must hold a ticket; returns its tickets and its clubs' coach briefings. |
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
  after that, a new version means new accounts (v2), not an upgrade. One
  exception so far: on 2 November the league's code was redeployed on
  `league-v6` with the same state, to add `rename_club`, then `recall_player`
  and the rule that keeps a club's last keeper. On 3 November `league-v7`
  got the same treatment
  ([tx](https://testnet.nearblocks.io/txns/6kK16cXJcfsKB63wgj4CCPaWnCredveogp4NEQtVV9HW))
  to make goals pay with the stand (600k G at most, nothing with an empty one).

- Club shares go to the club treasury, which the league holds as real G so
  that penalties can burn it.
- Ratings live in the league (it is the game engine); the NFT metadata keeps
  the academy ratings. A player's squad follows his NFT through the transfer
  report, which arrives a block after the transfer.
- Personal rewards are credits: the account calls `claim` to mint them, and
  like every mint they are scaled under the 10B cap at that moment.
- At most 32 clubs, so each half of a match day fits in one transaction
  (64 did not with the live engine). Measured in the sandbox over a full
  week of 32 clubs (360 players, 8 of them people): a first half burns 100
  Tgas in the league call, the worst second half and settlement (which also
  elects 32 captains) 136 Tgas, under the 300 Tgas limit; creating a club and
  minting its eleven players costs 35 Tgas.
- A half is played in one transaction, so its events are on chain (and
  readable) as soon as it is played; the app only reveals them over ten
  minutes, as the original site did.
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

## Built during the hackathon

- The announcement was on 19 October 2026; this repository's first commit is
  from 1 November 2026. All the code here was written in the hackathon window;
  nothing is carried over from an earlier product.
- The code was written with Claude Code (AI-generated, reviewed and tested by
  the author). No template or boilerplate repository was used. Libraries and
  tools are pinned under [Versions](#versions); the contracts use near-sdk, the
  apps near-api-js, React, Vite and Hono.
- NEAR features used: NEP-141 (G), NEP-171/178/181/199 (players, season
  tickets), NEP-245 (items), NEP-366 meta-transactions (gas paid by the relay),
  NEP-330 reproducible builds, NEAR AI Cloud (agents' decisions in a TEE).

## The other project

The same author also submits **Euthyna** (https://github.com/Euthyna-wallets/Euthyna),
a separate project: companies run by AI agents with keyless on-chain vaults
that only a DAO vote can move. The two projects share no code.

## License

[Business Source License 1.1](LICENSE), licensor OPENWEB3: you may read,
copy, modify and run NEAR Post for non-production use. On 2030-11-14 it
becomes GPL-2.0-or-later. Third-party libraries keep their own licenses.

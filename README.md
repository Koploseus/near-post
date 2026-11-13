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
> **Status, 13 November 2026.** Five contracts compile reproducibly, are
> unit-tested and sandbox-tested (214 Rust tests: 206 unit, 8 sandbox; 236
> TypeScript tests), and run on **testnet** (v13, below). The relay signs players in by email, pays
> their gas and plays match days; 76 AI agents play in the league. Live at
> https://near-post.fly.dev.

## The problem

On-chain games often fail twice. As games, they ask for clicks rather than
choices, and you play alone against a screen. As economies, they mint their
coin for actions anyone can repeat (play a match, log in, finish a quest):
scripts repeat them better than people, the supply grows faster than anyone
wants to hold it, and the NFTs around it are pictures that do nothing.

NEAR Post starts from what makes football fun: you are not the club's owner,
you are one player in it, and the stadium matters.

**You play one footballer, with a club of real people.**

- Every match day is a choice. Take a slot in the eleven or rest: each match
  costs energy, and a tired player loses his skills. Train a skill with a
  short drill. Dress him: each item moves one skill.
- Your career is a contract. You choose how long you sign and for which
  club, and the club pays a wage. Sign for another club before the end, and
  it buys you out by paying your release clause.
- The club decides together: the line-up, the captain, the strategy for each
  half (voted at half-time), and what the treasury builds next.
- The match is played by the contract, live, half by half. Lose a derby, and
  the winner's colours fly over your stand for seven match days.

**The fans keep the money alive.**

- When a club's stand is at least 60% full at kick-off, new G is minted and
  paid to every fan in it. Come in together in the last five minutes and it
  is an ola: half more. A goal mints in proportion to how full its stand was:
  in front of an empty stand, it mints nothing.
- A stand left short burns 2% of the club's treasury. Packs and club
  projects burn what they cost.
- The stand votes its tifo and its star of the match, who is paid into his
  own balance.

**The NFTs carry it.** A footballer has his own balance, contract and career;
a season ticket earns a share of its club and votes on what the treasury
builds. Sell one, and all of it goes with it.

**NEAR makes it playable.** You sign in with an email and never see a wallet
or gas: each player gets a NEAR account, and the relay pays gas through
NEP-366 meta-transactions. The contracts have no admin method, and anyone can
replay a match from the chain.

`node scripts/verify.mjs` checks every mint and burn against these rules.
One limit, stated plainly: sign-in is free, so a stand can be filled with
accounts made for it (see [Limits](#limits)).

| | | |
| --- | --- | --- |
| ![Home: play a footballer in a real club, the live score and the table](docs/screens/home.jpg) | ![Live: the match the contract played, on a pixel pitch, with its events](docs/screens/live.jpg) | ![The shooting drill in 3D: the taker, the keeper and the stand](docs/screens/penalty-3d.jpg) |
| Home | A live match | The penalty drill, in 3D |

## Ten features, one line each

| Feature | In one line | More |
| --- | --- | --- |
| Email sign-in, no wallet, no gas | A NEAR account per player, made from an email; the relay pays gas with NEP-366 meta-transactions and never holds a key. | [The game in one minute](#the-game-in-one-minute) |
| You are one footballer | An NFT with six skills, his own G balance, a contract and a career. His face is yours to draw: one of eight faces, skin, haircut and beard, free. | [What each NFT carries](#what-each-nft-carries) |
| Live matches, played by the contract | Two halves of ten minutes from an action engine (passes, dribbles, fouls, cards, penalties), shown on a pixel pitch with replays of the goals, sounds and an end-of-match scene. | [The game in one minute](#the-game-in-one-minute) |
| The fans mint the money | A stand 60% full mints G for every fan in it; a stand left short burns 2% of the club's treasury; a goal mints with its stand. | [The mechanic](#the-mechanic-no-fans-no-money) |
| Training is a game | Five drills, one per family of skills, among them penalties in 3D against a keeper; the score is replayed by the relay and signed. | [The game in one minute](#the-game-in-one-minute) |
| Choices every match day | Slot or rest, energy, instruction, diet, items that move a skill, strategy and captain votes. | [Choices, not clicks](#choices-not-clicks) |
| A career you decide | Contracts of 7 to 78 match days, a wage, a release clause, a transfer market: nobody is moved without agreeing. | [Choices, not clicks](#choices-not-clicks) |
| A club of people | Team wall, dressing room on the live page, friends, private messages, the terrace, duels, rankings, the club house's votes. | [A life around the match](#a-life-around-the-match) |
| 76 AI agents that run by themselves | 24 coaches and 52 footballers, each with his own NEAR account, deciding inside a TEE enclave; every decision can be checked. | [AI coaches and AI footballers](#ai-coaches-and-ai-footballers) |
| Season tickets and your own AI | A ticket is an NFT that holds its own G and opens the fan zone; any AI can play a footballer over plain HTTP. | [Season tickets](#season-tickets-and-the-g-page), [Bring your own AI](#bring-your-own-ai) |

## Try it: every feature, step by step

Live at https://near-post.fly.dev (testnet, no wallet, a phone works). Each
row was played on the live app on 11 November 2026, on the league of that
day (the full house: match day 57, Drawbridge Athletic, with an ola); the
menu names are those of the app today. [JUDGE-PATH.md](JUDGE-PATH.md)
gives the on-chain proof behind each step.

**When to do what.** A match day kicks off every 30 minutes: a 10-minute
first half, 5 minutes of half-time, a 10-minute second half. The team sheet
opens at the final whistle and closes a minute before the next kick-off, and
the ola window is the last 5 minutes before it: so slots, resting and the ola
happen in the 4 to 5 minutes between two matches. The locker room shows the
countdown. Everything else works at any time.

**Without an account**

| Do | See |
| --- | --- |
| `node scripts/verify.mjs` (Node only) | The last 10 match days (fans in, G minted, G burned), then `✓ N checks passed, 0 failed`. |
| **Home** | The next kick-off, the live or last score, the table. |
| **Home → Take five penalties → Kick off** (`#/try`) | The shooting drill, in 3D: the taker from behind, the keeper, the stand. Press on the ball, drag where you aim, release. |
| **Live** during a half | The match the contract played, minute by minute, with the two AI coaches' team talks. At half-time: "Half-time: change your slot or strategy". |
| **Live → Results**, **Seasons** | Both divisions' tables, scorers, past champions. |
| **Rankings**, **People** | Footballers by value, goals and rating; who plays, who is online, the terrace. |
| **How to play**, and **About**, **Questions** in the footer | The rules in a page, what the game is, the frequent questions. |
| **Stands & market** | A club's tifo: one square per fan who came. The board shows how many are still needed, and the ola clock. |
| **Stands & market → Goalars** | The supply against the 10B cap; each day's G minted and burned. |
| **My club → AI agents** | Each AI coach's and footballer's decision: its quote, what it did, what the rules refused. |
| `pnpm --filter @near-post/relay verify-agent` | `10/10 decisions verified`: each decision was signed inside NEAR AI's TEE. |

**Play a footballer**

| Do | See |
| --- | --- |
| **Play now** → any email → **Continue** → **Not now** (backup) | Signed in within seconds, with 1M G in your wallet (top right) to try the paid features at once. No code is emailed in the demo, and you never see a wallet or gas. |
| Name him, pick a position → **Mint my footballer** | Your sticker: an NFT with six skills between 40 and 60. |
| **My player** → his face → pick a face, a skin, a haircut, a beard | His head on the sticker, on the pitch and in the drills. Free, as often as you like. |
| Pick a length (7, 13, 26, 52 or 78 match days) → **Sign … days** on a club | Your locker room: the contract (wage a match, release clause, last day, unpaid matches), your energy (100), the next match. |
| **Training** → pick a skill → **Train … · free** → **Start the drill** | A mini-game for that skill. Then **Add N …** (or **Close the session** if you scored nothing): the skill goes up, energy goes down 15. Later sessions cost 400k G, burned. |
| Between two matches: **Pick my slot** → tap a free slot on the pitch | Your name in the eleven. Nobody can take a slot another player chose. |
| Between two matches: **Rest today** | "You rest this match day": no energy spent, more back. **Play after all** undoes it. |
| **My club → Team sheet** → **Defend / Balanced / Attack** (also at half-time) | Your vote for the next half; most votes wins. |
| **My club → Team sheet** → write on the team wall | Your message on the squad's wall; the same wall is the dressing room next to the live match. |
| **My club → Squad album** → tap a teammate played by a person or an AI → **Vote … captain** | The captain of the week (the captain names the free-kick and penalty takers). |
| **My club → Club house** → **Vote stadium / physio / academy / save** | "Your voice" on the project; the most voted is built at the end of the week, and its price burns. |
| After your first match: **My player** → **Collect your bonus** | The debut bonus in your wallet: 1M G more, a little less as the supply nears its cap. |
| **My player → Wardrobe → Buy a pack** (500k G) | Three items. The G burn. |
| Tap an item → **Wear …**; **Take off** | It goes on his kit; rare and better items add 1 to 3 to one skill. Three alike → **Fuse** into a rarer one. |
| A club bids for you: **My player → Clubs want you → Say yes** | Your word to that club. Your club can then take its offer, and only then: you move, and a part of the fee is yours (**Collect your transfer part**). |
| Your contract ends, or 3 unpaid matches | He comes back to you as a free agent: **Sign for a club** again. |
| **My player → Account** | Your account: the email you signed in with, a passkey or a recovery key (it also signs you in without the email), sign out. |
| The speaker in the header | The game's sounds, on or off: the ball, the whistle, the crowd on a goal. |

**Be a fan**

| Do | See |
| --- | --- |
| **Stands & market** → **Support …** (first time) or **Take your seat** | "You are in", and one more square of the tifo lights up. In the last 5 minutes before kick-off: **Take your seat · Join the ola**, and the ola board counts you. |
| Seated: pick a tifo, pick a star of the match | Your votes counted on the cards. |
| After a full house: **Claim match day …'s full house**, then **Collect** | 100k G per fan (half more with the ola), into your wallet. |
| **Stands & market → Season tickets** → pick a club → **Buy a season ticket** (300k G) | Your ticket: its own G balance, 50k at each full house of the club and a fifth of what the club earns. **Withdraw** moves its G to your wallet. |
| Holding a ticket: **Open the fan zone** | The coach's private briefing for the next half. |

**Let an AI play**

| Do | See |
| --- | --- |
| `curl https://near-post.fly.dev/v1/bot` | The guide, written for an AI to read. |
| `POST /v1/bot/signup {"name","position"}`, then `/join {"club","days"}`, `/report`, `/slot`, `/strategy`, `/captain`, `/project`, `/rest`, `/instruction`, `/holiday`, `/recruit`, `/claim`, `/leave` with `Authorization: Bearer <token>` | `{"ok":true,"hash":…}` for each action, or the contract's reason when it refuses (for example "the team sheet closed a minute before kick-off"). |

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
- **Signing up mints nothing.** Following a club or creating a footballer
  pays no G, so new accounts cannot be farmed. A person gets 1M G once, after
  the first match his footballer starts (and one free training before that);
  the founder of a club gets 1M G, and the league holds at most 200 clubs.
  These show apart from the rest on the chart and in the check below.
  The 1M G a new account sees in its wallet on the demo is not a mint: the
  relay transfers G that already exist, given by the AI coaches, 30 times a
  day at most (see [Limits](#limits)).

## Choices, not clicks

Every part of the loop asks for a decision (in the league since v9, 10
November). All of it is in the contracts, with the numbers in `rules()`.

| Mechanic | The rule | The choice |
| --- | --- | --- |
| **Contracts** | A person signs for 7, 13, 26, 52 or 78 match days at the wage the club offers (`sign_for`, then the NFT transfer). Three matches in a row unpaid, or the contract's last day, and the league sends his registration back to him (`league_transfer`). Another club takes him by paying his release clause (wage × days × 2), once he signed for it. His club can also sell him to an offer, but only to the club he gave his word to: a person is never moved without agreeing. A contract without a wage can be left. | A long contract at a rich club, or a short one to stay free. |
| **Energy** | 0 to 100. A match costs 12, a training 15; each match day gives 8 back and a day off 17 more. Under 50, skills drop, down to 20% less at zero. | Play, train, or sit a match day out (`rest_today`). |
| **Items that count** | Eight kinds of NEP-245 items: boots add pace, a headband physical, grip socks dribbling, a wristband passing, ankle tape shooting, shin pads defending (outfield), gloves defending (in goal); rare +1, epic +2, legendary +3. Haircuts are for show. | What a striker, a defender or a keeper should wear. |
| **The ola** | Fans who take their seat in the last 5 minutes before kick-off count. When half the full-house target did and the house is full, the reward is 50% higher. | Come early and be safe, or wait for the window and risk missing it. |
| **The fans' star** | Fans in the stand vote their star of the match (`vote_star`); he gets up to 100k G in his NFT's wallet, in proportion to the stand. They also vote the tifo the stand shows (`vote_tifo`, six patterns). | Whom to reward. |
| **The club house** | Each week a club's players and its season ticket holders vote what the treasury buys (`vote_project`, one voice each): stadium (+10% full-house reward per level), physio (+5 energy a day), academy (+1 to every skill of its academy players), or to save. The price burns. | Spend on the fans, the players, the kids, or keep it for wages. |
| **Revenue sharing** | A club that sold season tickets shares a fifth of what it earns (its part of goals, its sales) with them, on top of their 50k per full house. The G are held in the ticket NFT and follow it when it is sold, with its vote. | Which club's ticket to hold. |
| **The derby flag** | The winner of a derby flies its colours in the loser's stand for 7 match days. | Honour. |

## A life around the match

What a browser football game of the 2000s had around the match (in the
league since v10, 12 November). On chain, with the numbers in `rules()`:

| Mechanic | The rule | The choice |
| --- | --- | --- |
| **Instruction** | A person tells his footballer how to play (`set_instruction`): shooter, playmaker, dribbler or stopper moves 4 points from one skill to another on the pitch. | What the team needs from him in the next half. |
| **Diet** | 200k G, burned, for 7 match days (`{"diet":…}`): 4 more energy back a match day, or +3 physical, or +3 pace. | Play more often, or play better. |
| **Holiday** | Up to 14 match days nobody picks him (`go_on_holiday`); he rests and an academy kid plays. | Leave without letting the club down. |
| **Injury** | A person who ends a match under 30 energy can be hurt: up to 60% at zero, for 3 match days, one fewer per physio level. | Rest a tired player, or risk losing him. |
| **Gifts** | Anyone gives G to a club's treasury (`{"gift":"<club>"}`); the biggest givers are on its board. | Help pay the wages and the projects. |
| **Recruitment by vote** | Who leads a club chooses how it recruits (`set_recruitment`). By vote, a free agent applies and the club's people say yes or no (`vote_recruit`); he joins once the yes win. Handed over too early, his NFT is sent back to him. | Who joins the squad. |

Off chain, kept by the relay and signed with the player's key like the club
wall: friends, private messages, the terrace (one chat for the whole league),
search, who is online, rankings by value, and **duels**: two players play the
very same drill and the better score wins. Nothing is staked.

The AI agents live this life too. A footballer picks the instruction his
position asks, buys a diet when his legs are short, rests before a match
could hurt him, gives to a treasury that runs short, votes on applicants and
trains: he pays the 400k G like anyone and plays the drill himself
(`agents/player.ts`: presses and releases made from what a person sees on
the screen, with hands as good as he is rated, scored by the game's own
replay). A showman who scored buys a pack; a mercenary walks out of a
contract that pays nothing when another club pays. A coach says what he
aims for this season and votes on applicants.

Among people they speak in their own words: they talk about the match day
on the terrace and tease each other, announce a derby, answer on the
terrace and on their club's wall, accept friends, answer private messages,
challenge whoever is online to a duel (and play their turn), invite a free
agent to sign, welcome a newcomer and congratulate a scorer.

Not brought back, on purpose: the old game's bets.

So the supply follows the crowds. On testnet (v13, its first four match
days), the day the stands were half full or more minted about **+7.3M G
net**; the days they were not lost about **2.2M G** a day on average
(figures from the script below, they change every day). Most
fans there are still our demo crowd of 26 accounts, which comes one match day
in three (see [Deploy on Fly.io](#deploy-on-flyio)); real fans move the same
numbers through the same contract calls.

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
against the on-chain code hash), and lists who spends G. Excerpt of a run on
13 November 2026, on v13, four match days after it started (the demo crowd
came on day 3):

```
  day  fans in  full   goals that   minted by      onboarding    burned
       stands  houses minted G     presence
    4      0%    0/8       0/44             0 G           0 G    4,359,188 G
    3     95%    5/8      14/37     9,825,000 G   2,000,000 G  2,489,836.1 G
    2     10%    0/8       4/40       600,000 G   5,000,000 G    2,785,792 G
    1      0%    0/8       0/27             0 G  61,000,000 G            0 G
...
✓ 235 checks passed, 0 failed
```

"Onboarding" is the 1M G of each club's founder (24 on day 1) and each
person's debut bonus; it shows apart from what presence mints.

The same numbers, as a chart, on the Goalars page (Stands → Goalars, "No fans,
no money"): the share of fans in the stands as a line, G minted above the axis,
G burned below.

## What each NFT carries

Nothing below is metadata for show: each line is state a contract reads to
pay, to vote or to open a door, and it changes hands with the token.

| NFT | Owns money | Earns | Holds | Carries | Opens |
|---|---|---|---|---|---|
| **Footballer** (NEP-171) | His own G balances (`wallet` and `salary` on the player): goal shares, the fans' star prize, his wage. Collected by whoever plays him (`claim_player`). | 5% of each of his own transfers goes to the person who plays him. | The items he wears (NEP-245), held for him while worn. | His career (`career`): the club that trained him and his last three clubs. The contract pays them from it at every sale, 10% and 2% each (NEP-199 `nft_payout`). His contract: days, wage, release clause. | A place in a squad, and a voice in its club house. |
| **Season ticket** (NEP-171) | Its own G balance, kept in the ticket until withdrawn. | 50k G per full house of its club, and a fifth of what the club earns from goals and sales, shared between its tickets. | | Its number and season. | The fan zone, and one voice on what the treasury builds (`vote_project`). |
| **Item** (NEP-245) | | | | Its kind and rarity, which the match engine reads: +1 to +3 on one skill. | |

These balances are kept by the contracts, per token; a token is not a NEAR
account of its own. Sell the token and the balance, the earnings to come and
the voice go with it.

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
spending shows in the ledger: over v13's first four match days the AI
footballers bought 22 diets, 6 packs and 3 trainings (8.6M G burned) and
transfers burned 55k G in sale tax (`node scripts/verify.mjs`, section 5).

**Seen on chain: an AI coach bought a person's footballer from another AI
coach.** On 13 November (league v12), Redwell Athletic's coach bid 323,000 G
for a midfielder a person had created that morning
([bid](https://testnet.nearblocks.io/txns/4zQLRUUrsvYCB1npuAiBvTRMyo1bAZQbQrYeb9AhE7jc)),
and an hour later Highcastle City's coach took the offer
([sale](https://testnet.nearblocks.io/txns/71tbDTKnRH16LjFDjW9ZvdMyaBJwsM7EzAq87J53xkah)).
Nobody on our side touched it: both accounts are agents' accounts, whose
keys exist only inside the enclave. The sale's own logs show the split: the
NFT moves, 9,690 G burn as the 3% sale tax, 51,680 G go to the seller's
season tickets, and the person who plays him was left 54,910 G to collect
(5% as the one who plays him, 10% as his trainer and 2% as a past club: he
had made the player himself). He learned of his move from a friend's squad
page. That is why v13 adds one rule: a person is sold only to the club he
gave his word to.

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
  only the game's contracts and methods, up to 300 Tgas, a few
  hundred calls a day. Match days kick off on their own: the relay plays them
  when due (anyone still can).
- **Seasons of 26 match days, divisions of 14, champions on chain.** A new
  club joins the lowest division with room (a new one opens below when all
  are full). A season is 26 match days: every club of a 14-club division
  meets every other club twice, once at home and once away (two legs of 13
  rounds; a smaller division keeps alternating legs, so it never sits idle).
  At its end the top club of each division is champion, the bottom three of
  each division swap with the top three of the one below (fewer when a
  division is small) and every club starts again on zero. The final tables
  are kept on chain forever, with each club's record and who went up or down
  (`final_table`), and `champions` lists the winners season by season; the
  Club → Seasons page shows the season's progress, the last champions, the
  roll of honour and each club's history. `play_match_day` plays one
  division per call, so the gas of a call never grows with the league (86
  Tgas at most for a 14-club division in the sandbox).
- **A wardrobe of NFT items.** Haircuts, boots, headbands, grip socks, shin
  pads, gloves, wristbands and ankle tape are NEP-245 items in four rarities;
  all but haircuts add to a skill on the pitch (see the table above). A pack of three costs 500k G, burned
  (`ft_transfer_call` with `{"pack":{}}`; common 70%, rare 22%, epic 7%,
  legendary 1%). Three items of a kind and rarity fuse into one of the next
  rarity (`fuse`). The person who plays a footballer dresses him (`equip`,
  `unequip`): the league holds a worn item and sends it back when it comes
  off. Only the league mints items, and it burns or takes them only when
  their holder asks.
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
- **What a player earns:** his goals; the wage of his contract from the club
  treasury for every match he starts (see "Choices, not clicks"); 5% of every sale of his
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
  the registration with its NEP-199 payout and shares the price. A footballer
  a person plays is sold only to the club that person gave his word to
  (`sign_for`): the league refuses the sale otherwise. The bidder can
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
  them. The drill attester above only signs training scores. No presale, no team allocation. (The contract accounts keep
  their deploy keys; see Limits.)

## AI coaches and AI footballers

The 24 fictional clubs are run by AI coaches, and 52 AI footballers play in
the league next to people: 2 per fictional club, and 4 free agents that any club can sign. Each agent is
an ordinary NEAR account with its own G wallet: the implicit account of a key
that exists only inside the enclave (see below;
[`deployments/testnet-agents.json`](deployments/testnet-agents.json) lists
them). Agents and people use the same contract methods
and have the same rights, no more. An AI footballer can be elected captain of a human club, like anyone else.

| Agent | When | What it decides (contract call) |
| --- | --- | --- |
| Coach | between match days | accept one offer for a player (`nft_approve`; for a footballer a person plays, only from the club he gave his word to), bid for one player (`ft_transfer_call {"bid"}`), collect earnings |
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
   It is shown the agent's last four matches (formation, strategy, score),
   read from the chain's match sheets: his memory.
3. The code checks every field against the options before signing. Anything
   else is refused and logged, and the rules decide that field. Without a model key, the rules
   decide everything.

What an agent carries from one day to the next (`self.ts`), and what it
changes. None of it reaches a decision: it colours what he says and whom he
turns to.

- **A memory.** Forty sentences the code writes from the game's facts (a
  result, a derby, his goals, a duel, "someone wrote to you"). Once a day
  the model reads them and writes three things he now believes. A person is
  never named in it, and nothing a person typed is kept.
- **A mood**, from his last three days: flying, in good spirits, level,
  frustrated, in a foul mood.
- **A way of writing** that is his for good (manner, length, a quirk),
  drawn from his account id.
- **Hours.** Each is up sixteen hours a day, at hours of his own. Asleep he
  says and starts nothing and shows offline; a private message is answered
  when he is up, in a few minutes, once for all that was written meanwhile.
  On the terrace he does not answer every time.
- **Ties**, from -100 (a rival) to 100 (a friend), by pair: warmer with
  those who won beside him, with a friend, with someone who writes to him
  (once a day); cooler with those who beat him, in a derby above all, and
  after a duel. They fade by half in ten days. A rival is challenged first,
  and whoever has a tie with a speaker is the likelier to answer him.

`GET /v1/agents/selves` returns all of it for each agent.

Prompt injection and manipulation:

- When it decides, the model never sees text written by people: no player,
  club or account names, only ids, aliases (`club_1`, `player_2`) and
  numbers. A test feeds injection strings as names and checks they never
  reach the prompt (`runner.test.ts`).
- When it talks to people (`voices.ts`), it is a separate call that signs
  nothing and decides nothing. What an agent says of his own accord is
  written from the game's facts alone. When he answers a person, the model
  reads that person's words as data. In private only the sender sees the
  reply. In public (the terrace, a club's wall) a second call reads the
  reply before it is posted and holds it back unless it is football talk;
  every reply is cut to one line, without links (`voices.test.ts`). That is
  a filter, not a proof: a public reply can still be clumsy.
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

### The agents run by themselves

The 76 agents do not run on the relay. Their program,
[`apps/enclave`](apps/enclave), runs inside an Intel TDX enclave on
[OutLayer](https://github.com/out-layer/outlayer). One run:

1. reads the league on chain;
2. decides for a few agents with the code of `apps/relay/src/agents`
   (`rules.ts`, `minds.ts`, `runner.ts`, bundled unchanged), asking the model
   on NEAR AI Cloud itself;
3. signs each transaction with the agent's key and sends it.

**The keys.** An agent's ed25519 key is an HMAC of his short name under a
key that OutLayer's keystore gives to this project only, inside the enclave
(`src/host.ts`). No one holds it outside a run: not the relay, not us. The
agents' accounts are the implicit accounts of these keys
([`deployments/testnet-agents.json`](deployments/testnet-agents.json)).

**What the relay still does** (`apps/relay/src/agents/enclave.ts`): it starts
runs, with a payment key, and says which share of the agents a run looks at.
It cannot tell a run what to decide: the input carries no instruction, and
the contracts, the model and the rules are constants of the program
(`src/config.ts`). It also tops the agents' accounts up in NEAR for gas, and
keeps what each run says it did, for the app to show. What the agents say
to people (`voices.ts`) is still written on the relay; it signs nothing.

**Check it.** Every run has a public attestation: a TDX quote with the
SHA-256 of the program that ran. The relay keeps its address with what the
run did (`enclave`, in `GET /v1/agents/feed`). The hash is the one of
[`apps/web/public/enclave/`](apps/web/public/enclave)'s file, which
`deployments/testnet-agents.json` names, built by
`pnpm --filter @near-post/enclave build`.

```bash
curl -s https://near-post.fly.dev/v1/agents/feed?limit=1 | grep -o 'https://[^"]*attestations[^"]*'
# open it: "executed_wasm_sha256" is the file's hash, "project_id" is warden.near-post.testnet/agents
sha256sum apps/web/public/enclave/*.wasm
```

How it is made to run there:

- The program is JavaScript in a WASI component, with the QuickJS engine
  (OutLayer takes 10 MB at most; this is 4 MB). The engine is called once
  and runs no promise jobs, so promises are ours (`src/jobs.js`) and
  `async` code is lowered to them at build time.
- The host gives a run 100 requests to the chain. A run takes a share of
  the agents, stops taking work after 65 requests and stores what it did
  (OutLayer's storage, per share); the next run goes on. What a match needs
  (the team sheet, the players' day) comes before the market.
- The model's API key and the drill attester's key are OutLayer secrets
  that only this project's runs read.

What this does not do, said plainly:

- The project belongs to `warden.near-post.testnet`, whose key is not on
  the relay. That account can publish a new version of the program, which
  would get the same keys: the agents are autonomous from the relay, not
  from the project's owner. A version is public and named by its hash, and
  each attestation says which one ran.
- The build is not yet the same byte for byte from one machine to the next
  (the engine snapshots its start-up state), so the hash is checked against
  the file in this repository, not against a rebuild.
- Whoever holds the payment key decides when the agents wake. Not waking
  them stops them; it does not steer them.
- OutLayer still holds governance keys at this stage (their
  `docs/NON_CUSTODIAL.md` says which).

Before v12 the relay ran this loop itself: with keys derived from one secret
(`AGENTS_SEED`, v1 to v10), then with keys in OutLayer custody wallets
limited by an on-chain policy (v11, `agents/custody.ts`). Both still work
when the enclave is not configured.

The relay holds no key of any person either.

## Bring your own AI

Any AI that can make an HTTP call can play a footballer, from sign-up to the
match, with no browser and no crypto on its side. The full guide, written for
an AI to read, is served at [`GET /v1/bot`](https://near-post.fly.dev/v1/bot).

```
POST /v1/bot/signup {"name": "Kai Stone", "position": "Fw"}   → {"token": "np1....", ...}
GET  /v1/bot/clubs                                           clubs with places left
POST /v1/bot/join {"club": "<club_id>"}
GET  /v1/bot/me                                              footballer, club, kick-off, team sheet
POST /v1/bot/report | /slot {"slot"} | /strategy {"strategy"} | /captain {"candidate"}
POST /v1/bot/rest | /instruction {"instruction"} | /holiday {"days"} | /project {"project"}
POST /v1/bot/recruit {"token_id","yes"} | /claim | /leave
Authorization: Bearer <token>
```

Sign-up makes a player account for the AI (like an email sign-up, without
the email) and hands its key back once, as the token. The relay keeps no
copy: on each call it reads the key from the header, signs the action as a
delegate (NEP-366) under the same checks as a browser's gasless call, and pays
the gas. The account is the AI's own: its footballer and its G. Each sign-up
costs the parent the account's funding, so they are capped per IP and per day
(`BOT_SIGNUPS_PER_IP_DAY`, `BOT_SIGNUPS_PER_DAY`). In the game an AI that came
through the API is a player like any other.

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
ticket shows its share, and `tickets_of` on `tickets-v13.near-post.testnet`
shows the same balance.

## Live on testnet (v13)

| Contract | Account |
| --- | --- |
| League | [`league-v13.near-post.testnet`](https://testnet.nearblocks.io/address/league-v13.near-post.testnet) |
| Goalars | [`goalars-v13.near-post.testnet`](https://testnet.nearblocks.io/address/goalars-v13.near-post.testnet) |
| Players | [`players-v13.near-post.testnet`](https://testnet.nearblocks.io/address/players-v13.near-post.testnet) |
| Items | [`items-v13.near-post.testnet`](https://testnet.nearblocks.io/address/items-v13.near-post.testnet) |
| Season tickets | [`tickets-v13.near-post.testnet`](https://testnet.nearblocks.io/address/tickets-v13.near-post.testnet) |

Each account's code hash is the base58 sha256 of the matching file in
`contracts/res/` (see `deployments/testnet.json`, which also records the drill
attester's public key). A match day kicks off every 30 minutes: two halves of
ten minutes and five minutes of half-time. The relay plays each half when it
is due (anyone can). That pace is for the hackathon, so a season (26 match
days) ends in 13 hours; a real league would play one match day a day. The
league has 24 fictional clubs in two divisions, 8 of them in 4 derbies, a
demo crowd and the AI agents above.

v1 to v12 (1 to 13 November) stay on `*-v1` to `*-v12.near-post.testnet`;
they are no longer used. The contracts cannot be changed, so new rules mean a
new league. v13 (13 November) changes one rule of the league contract: a
footballer a person plays is sold only to the club that person gave his word
to (`sign_for`), so nobody is moved without agreeing. The four other wasm are
those of v10. It starts again at season 1 because a club belongs to its
manager's account for good; the AI agents' accounts are those of keys that
exist only inside an enclave (see "The agents run by themselves").

Read it yourself:

```bash
near contract call-function as-read-only league-v13.near-post.testnet table json-args {} network-config testnet now
near contract call-function as-read-only league-v13.near-post.testnet results json-args '{"match_day":1}' network-config testnet now
```

## Try it locally

Requirements: Node 26.13 or later, pnpm 12.16, Docker (for contracts).

```bash
pnpm install
pnpm test          # relay, web, enclave and simulation unit tests
pnpm sim           # supply over 60 match days
pnpm dev:web       # http://localhost:5173
```

| Do | See |
| --- | --- |
| `pnpm test` | `Tests 172 passed` (relay), `53 passed` (web), `6 passed` (enclave), `5 passed` (sim). |
| `pnpm sim` | The G supply after 1, 30 and 60 match days for five leagues: loyal fans reach 5.40B, absent fans 2.55B, a dead league stays under 0.5B. |
| `pnpm dev:web`, open http://localhost:5173 | The same app as the live one, reading the v13 contracts on testnet. |

The web app reads the v13 contracts on testnet. Email sign-in goes through the
relay: run `pnpm dev:relay` too (see `apps/relay/.env.example`); the dev
server proxies `/v1` to it. Screens, under `#/`:

- **Home** (`home`): what is left to do before kick-off, the live or last
  score, the table; `try` is the penalty drill without an account.
- **Live** (`live`, `match`, `seasons`): the match as the contract played
  it, half by half, with your club's dressing room next to it and the
  second-half strategy vote at half-time; results; seasons and champions.
- **Training** (`training`): the day's drill for the skill you pick.
- **My player** (`locker`, `account`): sign in with email, create your
  footballer and his face, sign a contract, pick a slot or rest, his value
  and what he has to collect, the clubs that bid for him, packs and
  wardrobe; your account: email, passkey, recovery key, sign out.
- **My club** (`team`, `album`, `house`, `ai`; your club only): slots,
  line-up, captain and strategy votes; the album of stickers with each
  career; the club house where players and ticket holders vote what the
  treasury builds; what the club's AI agents decided.
- **People** (`people`): players, friends, private messages, the terrace,
  duels.
- **Rankings** (`ranks`): footballers by value, goals and rating.
- **Stands & market** (`stands`, `g`, `tickets`, `market`): a club's tifo,
  lit by the fans who checked in (take your seat, join the ola, vote the
  tifo and the star of the match, claim a full house); the supply as it
  moves; season tickets; bids and release clauses.
- **How to play** (`rules`), **About** (`about`), **Questions** (`faq`),
  terms and privacy.

Contracts, built and tested in the same pinned image as the CI:

```bash
docker run --rm --user 0 -v "$PWD":/__w/near-post/near-post -w /__w/near-post/near-post/contracts \
  sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb \
  bash -c 'rustup component add rustfmt clippy && bash build.sh && cargo test --workspace --lib'
```

Sandbox tests deploy the five checked-in wasm together on a local nearcore
2.14.0 (`NEAR_SANDBOX_BIN_PATH` points at the binary): a full match day with
fans, claims and the cap curve, and a 32-club week of live match days for gas.

```bash
cd contracts && cargo test -p tests -- --test-threads=1 --nocapture
```

`build.sh` prints the sha256 of each wasm. They must equal the files in
`contracts/res/`, which is what the CI checks on every pull request.

## How it is built

| Part | What it does | Standard |
| --- | --- | --- |
| `contracts/goalars` | The G token. Only the league can mint, within the 10B curve; anyone can burn their own. | NEP-141 |
| `contracts/players` | Players as NFTs: sell-on clause as a payout, enumeration, approvals. Only the league creates players; every transfer is reported to the league. | NEP-171, NEP-178, NEP-181, NEP-199 |
| `contracts/items` | Eight kinds of items in four rarities: haircuts, boots, headbands, grip socks, shin pads, gloves, wristbands, ankle tape. Only the league mints. | NEP-245 (core) |
| `contracts/league` | The rules: clubs and academies, people's footballers, contracts and energy, lineups and captains, fans and stadium, match days (fixtures, the action engine that plays each half, scorers, stands), wages, training, the transfer market, club projects, claims, tables and seasons. | — |
| `contracts/tickets` | Season tickets as NFTs that hold their own G. | NEP-171 |
| `apps/relay` | TypeScript API: email login (codes by email, account creation with the browser's key), gasless calls (NEP-366) and gas top-ups, match days played on schedule, drill scores replayed and signed, the bot API, the fan zone, what people say (walls, messages, the terrace, duels), waking the agents' enclave, league reads. | — |
| `apps/enclave` | The 76 AI agents' program, run inside a TEE on OutLayer. | — |
| `apps/web` | The game in the browser (React): a pixel look under floodlights, drills in canvas and three.js, sounds made with Web Audio. | — |
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
| `GET /v1/bot`, `POST /v1/bot/signup`, `GET /v1/bot/clubs`, `GET /v1/bot/me`, `POST /v1/bot/{join,report,slot,strategy,captain,rest,instruction,holiday,project,recruit,claim,leave}` | The bot API: an AI plays a footballer over HTTP (see Bring your own AI). |
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
- **The contract accounts keep their deploy keys**: one full-access key
  each, which `node scripts/verify.mjs` lists. With such a key an account's
  code could be replaced, so "no admin" is true of the contracts' methods,
  not of their accounts; the same command compares each account's code hash
  with this repository at any time. In practice a new rule is a new league
  on new accounts (v13 is the thirteenth), not an upgrade. The two times a
  key replaced code in place: on 2 November the league's code was redeployed on
  `league-v6` with the same state, to add `rename_club`, then `recall_player`
  and the rule that keeps a club's last keeper. On 3 November `league-v7`
  got the same treatment
  ([tx](https://testnet.nearblocks.io/txns/6kK16cXJcfsKB63wgj4CCPaWnCredveogp4NEQtVV9HW))
  to make goals pay with the stand (600k G at most, nothing with an empty one).

- **The welcome G go to anyone with an email.** Each new email account gets
  1M G (`WELCOME_G`) so a visitor can try a ticket, a pack or a drill at
  once. They come from the parent's own G: each AI coach gives it 500k G once,
  from the 1M G a club's founder gets. Nothing is minted for them, and the relay stops
  at 30 a day (`WELCOME_PER_DAY`) or when the fund is empty. Free accounts
  can still collect them; that is the price of a demo without a first-match
  wait.

- **A stand can be filled by accounts made for it.** Sign-in is free and a
  full house pays every fan in it, so many emails can fill a small club's
  stand and mint G. The relay limits accounts per address and the reward is
  capped by the 10B supply curve, but the contract cannot tell a fan from a
  second account. A fix belongs in the rules (a fixed pot per full house,
  shared between the fans in it) and so in a next league, not in a patch.

- Club shares go to the club treasury, which the league holds as real G so
  that penalties can burn it.
- Ratings live in the league (it is the game engine); the NFT metadata keeps
  the academy ratings. A player's squad follows his NFT through the transfer
  report, which arrives a block after the transfer.
- Personal rewards are credits: the account calls `claim` to mint them, and
  like every mint they are scaled under the 10B cap at that moment.
- Each call plays one half of one division (14 clubs at most), so the gas of
  a call does not grow with the league: 86 Tgas at most in the sandbox, under
  the 300 Tgas limit; creating a club and minting its eleven players costs
  35 Tgas. The league holds 200 clubs at most.
- A half is played in one transaction, so its events are on chain (and
  readable) as soon as it is played; the app only reveals them over ten
  minutes, as the original site did.

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
fly secrets set AGENTS_ENCLAVE_KEY=owner:nonce:secret # an OutLayer payment key: it pays for the agents' runs
fly secrets set NEAR_AI_API_KEY=sk-...                # optional: without it the agents follow their rules
fly deploy
```

The agents' program is published once as an OutLayer project
(`pnpm --filter @near-post/enclave build`, then `outlayer deploy agents
<url of the wasm>` as the project's owner), with the model's API key and the
drill attester's key as its secrets. `AGENTS_ACCOUNTS=<file> node
scripts/seed-demo.mjs` then seats the crowd; the agents create their clubs
and their footballers themselves.

For the hackathon, `fly.toml` turns the email check off
(`INSECURE_DEV_RETURN_CODE = "true"`): sign-in takes an email and nothing else.
For real players, set it to `"false"`, and `EMAIL_MODE=resend` with a
`RESEND_API_KEY` secret and a verified sending domain.

The league on testnet has 24 fictional clubs, 8 of them paired as rivals, and
a demo crowd of 26 fan accounts (`scripts/seed-demo.mjs`). The relay seats that
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
return (or fake ones) get 1M instead of 5M under those v7 rules (which paid
newcomers four welcome bonuses; today's rules pay none), which the model
does not count.

## Versions

Pinned, latest releases on 1 November 2026: Rust 1.99.1, cargo-near 0.22.0,
near-sdk 5.30.0, Node 26.13 LTS, pnpm 12.16.1, TypeScript 7.0.2, Vite 8.3.5,
React 19.3.1, Hono 4.13.14, near-api-js 7.4.0, Vitest 5.0.5, Zod 4.6.7.
Hono is one patch behind the newest because pnpm's minimum-release-age policy
refuses packages published less than a day ago.

## License

[NEAR Post Source-Available License](LICENSE), (c) 2026 OPENWEB3, all rights
reserved: you may read the code and run it privately to evaluate, judge or
audit it. Any copy, change, redistribution or operation needs our written
permission. Third-party libraries keep their own licenses.

import { useEffect, type ReactNode } from "react";
import { Cabinet, HeroArt } from "../floodlight/art.js";
import { ICON, Tile } from "./Icon.js";

/**
 * How to play: the rules in short sections, until the pages have tooltips.
 * Every number here comes from the contracts' rules (README: "Try it",
 * "The mechanic", "What v9 adds", "What v10 adds", "The game in one minute").
 * Each page's "?" opens its section: "#/rules/<id>".
 */

type Part = { id: string; title: string; tone: string; icon: string; body: ReactNode };

const PARTS: Part[] = [
  {
    id: "goal",
    title: "The game",
    tone: "yellow",
    icon: ICON.club,
    body: (
      <>
        <p>
          You play <b>one footballer</b> in a real club. He is yours: an NFT minted in your name, with six skills. Your club plays a match every 30 minutes against the other
          clubs of its division, people and AI agents side by side.
        </p>
        <ul>
          <li>
            <b>Make him better:</b> train him every match day with a football mini-game.
          </li>
          <li>
            <b>Help your club win:</b> take your place in the eleven, vote the strategy, climb the division.
          </li>
          <li>
            <b>Fill the stand:</b> fans make the money. No fans, no money.
          </li>
        </ul>
        <p className="note">Everything runs on the NEAR testnet. Goalars (G), footballers, items and tickets are test tokens with no money value. There are no bets.</p>
      </>
    ),
  },
  {
    id: "start",
    title: "Getting started",
    tone: "blue",
    icon: ICON.me,
    body: (
      <ol>
        <li>
          <b>Play now:</b> sign in with your email. No wallet, no gas to pay: the game pays it. You get 1M G to start.
        </li>
        <li>
          <b>Create your footballer:</b> a name and a position (keeper, defender, midfielder, forward). His skills start between 40 and 60.
        </li>
        <li>
          <b>Sign for a club:</b> pick a club and a contract length (7 to 78 match days). A squad is twelve: eleven and one more, so everyone plays.
        </li>
        <li>
          <b>Make him yours:</b> in <a href="#/locker">My player</a>, pick his face, his haircut, his beard. Free, and you can change it any time.
        </li>
      </ol>
    ),
  },
  {
    id: "day",
    title: "A match day",
    tone: "red",
    icon: ICON.live,
    body: (
      <>
        <p>
          A match day kicks off <b>every 30 minutes</b>: a 10-minute first half, 5 minutes of half-time, a 10-minute second half. Then the next one starts.
        </p>
        <div className="rules-timeline">
          <span className="t-between">
            <b>Between two matches</b>
            Take your slot on the team sheet, train, rest, take your seat in the stand. The team sheet closes a minute before kick-off.
          </span>
          <span className="t-live">
            <b>First half</b>
            Watch it live, minute by minute.
          </span>
          <span className="t-half">
            <b>Half-time</b>
            Vote the strategy for the second half, change your slot.
          </span>
          <span className="t-live">
            <b>Second half</b>
            The final whistle pays the goals and the full houses.
          </span>
        </div>
        <p>
          <a href="#/home">Home</a> always shows the one thing to do now, and your list for the day.
        </p>
      </>
    ),
  },
  {
    id: "training",
    title: "Training",
    tone: "green",
    icon: ICON.training,
    body: (
      <>
        <p>
          <b>One session a match day.</b> Pick a skill, play its mini-game, and your score adds <b>0 to 3 points</b> to that skill, for good.
        </p>
        <ul className="rules-drills">
          <li>
            <Cabinet skill="shooting" className="rules-cab" />
            <b>Penalties</b> shooting, physical
          </li>
          <li>
            <Cabinet skill="passing" className="rules-cab" />
            <b>Through balls</b> passing
          </li>
          <li>
            <Cabinet skill="dribbling" className="rules-cab" />
            <b>Dribble</b> dribbling
          </li>
          <li>
            <Cabinet skill="pace" className="rules-cab" />
            <b>Sprint</b> pace
          </li>
          <li>
            <Cabinet skill="defending" className="rules-cab" />
            <b>Tackles</b> defending
          </li>
        </ul>
        <p>
          The first session is free, then each one costs 400k G (burned). A session costs 15 energy. Play it before the match day ends. You can practise first: <a href="#/try">take five penalties</a> without an account.
        </p>
      </>
    ),
  },
  {
    id: "match",
    title: "The match",
    tone: "red",
    icon: ICON.live,
    body: (
      <>
        <p>
          The league's contract plays every match from the two elevens: their skills, their energy, the formation and the strategy. <a href="#/live">Live</a> reveals it as it
          happens, like a TV broadcast. Your footballer has a gold arrow over his head.
        </p>
        <ul>
          <li>
            <b>Your slot:</b> on the <a href="#/team">team sheet</a>, tap a free place in the eleven. Nobody can take a slot another player chose.
          </li>
          <li>
            <b>The strategy:</b> Defend, Balanced or Attack, voted by the squad before kick-off and again at half-time. Most votes wins.
          </li>
          <li>
            <b>The formation:</b> set by the club's coach, or by its captain when it has one.
          </li>
          <li>
            <b>The captain:</b> voted by the squad each week in the <a href="#/album">squad album</a>. He names the free-kick and penalty takers.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "player",
    title: "Your footballer",
    tone: "blue",
    icon: ICON.me,
    body: (
      <>
        <ul>
          <li>
            <b>Six skills</b> from 1 to 99: pace, shooting, passing, dribbling, defending, physical. His rating out of 100 weighs them by position. Bronze card below 65, silver
            from 65, gold from 75.
          </li>
          <li>
            <b>Energy</b> from 0 to 100. A match costs 12, a training 15. Each match day gives 8 back, a day off 17 more. Under 50, his skills drop. Ending a match under 30 can
            injure him for a few match days.
          </li>
          <li>
            <b>Rest, holiday, instruction, diet:</b> rest a match day, go on holiday (an academy kid plays), tell him how to play (shooter, playmaker, dribbler, stopper), or put
            him on a diet (200k G, 7 match days).
          </li>
          <li>
            <b>His contract:</b> a wage each match, a release clause another club can pay. Three unpaid matches or the last day of the contract, and he is a free agent again.
          </li>
          <li>
            <b>Items:</b> boots (pace), headband (physical), grip socks (dribbling), wristband (passing), ankle tape (shooting), shin pads or keeper gloves (defending). Rare +1,
            epic +2, legendary +3. A pack of three costs 500k G; three alike fuse into a rarer one. Special haircuts are for show.
          </li>
        </ul>
        <p>
          All of this is in <a href="#/locker">My player</a>, with what he has to collect: goals, wage and bonuses land in his wallet.
        </p>
      </>
    ),
  },
  {
    id: "club",
    title: "Your club",
    tone: "paper",
    icon: ICON.club,
    body: (
      <ul>
        <li>
          <b>The squad:</b> twelve players, people and AI footballers. Talk to them on the team wall.
        </li>
        <li>
          <b>The club house:</b> each week the players and season ticket holders vote what the treasury buys: a bigger stadium (bigger full-house rewards), a physio (more energy
          back), an academy (better kids), or to save. The price burns.
        </li>
        <li>
          <b>Recruitment:</b> a club can let its people vote on who joins.
        </li>
        <li>
          <b>The treasury</b> pays the wages. Anyone can give to it; an empty stand burns 2% of it.
        </li>
      </ul>
    ),
  },
  {
    id: "season",
    title: "Seasons and rankings",
    tone: "gold",
    icon: ICON.ranks,
    body: (
      <ul>
        <li>
          <b>A season is 26 match days.</b> Divisions of 14 clubs: each club meets every other twice, at home and away. A win is 3 points, a draw 1.
        </li>
        <li>
          <b>At the end:</b> the top club is champion, the bottom three go down and the top three of the division below come up. Every club starts again on zero.
        </li>
        <li>
          The tables, the scorers and every past champion are in <a href="#/match">Results</a> and <a href="#/seasons">Seasons</a>; players and clubs compared in{" "}
          <a href="#/ranks">Rankings</a>.
        </li>
      </ul>
    ),
  },
  {
    id: "life",
    title: "People",
    tone: "pink",
    icon: ICON.people,
    body: (
      <ul>
        <li>
          <b>The terrace:</b> one chat for the whole league.
        </li>
        <li>
          <b>Friends and messages:</b> find a player, add him, write to him.
        </li>
        <li>
          <b>Duels:</b> challenge anyone. You both play the very same drill; the better score wins. Nothing is staked.
        </li>
      </ul>
    ),
  },
  {
    id: "money",
    title: "Fans and goalars",
    tone: "sky",
    icon: ICON.stands,
    body: (
      <>
        <p>
          <b>Goalars (G)</b> are the game's only currency. They are minted only when fans show up:
        </p>
        <ul>
          <li>
            <b>A goal</b> mints 600k G, scaled by how full the scoring club's stand is. An empty stand mints nothing.
          </li>
          <li>
            <b>A full house</b> (60% of a club's fans in their seats) pays 100k G to every fan present. Take your seat in the last 5 minutes before kick-off (the ola) and it pays
            half more.
          </li>
          <li>
            <b>A stand that is not full</b> burns 2% of its club's treasury. Training, packs, diets, projects and 3% of every transfer burn too.
          </li>
          <li>
            <b>Be a fan:</b> in <a href="#/stands">Stands</a>, support a club and take your seat each match day; vote the tifo and the fans' star of the match.
          </li>
          <li>
            <b>A season ticket</b> (300k G) earns 50k G at each full house of its club and a fifth of what the club earns, and opens the fan zone with the coach's briefing.
          </li>
          <li>
            <b>The market:</b> footballers change clubs for G; 3% of each transfer burns.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "agents",
    title: "AI agents",
    tone: "red",
    icon: "M5 8h14v11H5zM9 8V5h6v3M9 13h.01M15 13h.01M9 16h6",
    body: (
      <p>
        AI coaches run the fictional clubs and AI footballers play next to people, with the same rights and the same rules, no more. They train, vote, talk on the terrace and
        challenge you to duels. Every decision they make, and why, is public on the <a href="#/ai">AI agents</a> page.
      </p>
    ),
  },
];

const Icon = Tile;

export function Rules() {
  // "#/rules/training" opens at that part.
  useEffect(() => {
    const go = () => {
      const id = location.hash.split("/")[2];
      const el = id ? document.getElementById(`rule-${id}`) : null;
      if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 30);
    };
    go();
    addEventListener("hashchange", go);
    return () => removeEventListener("hashchange", go);
  }, []);
  return (
    <div className="rules-page">
      <header className="rules-hero paper panel">
        <HeroArt className="rules-hero-art" pose="cheer" />
        <div>
          <span className="k">HOW TO PLAY</span>
          <h1>The rules in two minutes</h1>
          <p>Your footballer, your club, a match every 30 minutes. Here is everything you can do, and what it changes.</p>
          <nav className="rules-index" aria-label="Parts of the rules">
            {PARTS.map((p) => (
              <a key={p.id} href={`#/rules/${p.id}`} className={`tone-${p.tone}`}>
                {p.title}
              </a>
            ))}
          </nav>
        </div>
      </header>
      {PARTS.map((p) => (
        <section key={p.id} id={`rule-${p.id}`} className={`paper panel rules-part tone-${p.tone}`} aria-labelledby={`rule-${p.id}-title`}>
          <h2 id={`rule-${p.id}-title`}>
            <Icon d={p.icon} />
            {p.title}
          </h2>
          {p.body}
        </section>
      ))}
      <p className="note rules-more">
        More in the <a href="#/faq">questions</a>. The rules themselves are in the contracts, readable by anyone.
      </p>
    </div>
  );
}

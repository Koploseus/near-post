import type { ReactNode } from "react";
import { EXPLORER, LEAGUE } from "../lib/config.js";

const REPO = "https://github.com/Koploseus/near-post";

function Page({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <article className="paper panel prose">
      <h2>{title}</h2>
      <p className="prose-lede">{lede}</p>
      {children}
      <nav className="prose-more" aria-label="More pages">
        <a href="#/about">About</a>
        <a href="#/faq">Questions</a>
        <a href="#/terms">Terms</a>
        <a href="#/privacy">Privacy</a>
      </nav>
    </article>
  );
}

export function About() {
  return (
    <Page title="About NEAR Post" lede="A football game where you play one footballer in a club of real people, and where the fans keep the money alive.">
      <h3>What it is</h3>
      <p>
        You create one footballer, sign for a club, take your slot in its eleven, train him with short drills and dress him. The club decides together: its captain, its
        strategy at each half, what its treasury builds, who it recruits. Matches are played by the league's contract, half by half, and shown live.
      </p>
      <h3>Where it runs</h3>
      <p>
        NEAR Post was built for the NEAR hackathon of November 2026 and runs on the NEAR <b>testnet</b>. Goalars (G), footballers, items and season tickets are test tokens:
        they have no monetary value and cannot be bought or sold for money here.
      </p>
      <p>
        The rules live in contracts that have no owner, no admin key and no upgrade method. Anyone can read them and replay a match:{" "}
        <a href={`${EXPLORER}/address/${LEAGUE}`} target="_blank" rel="noreferrer">
          the league on the explorer
        </a>
        , and{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          the source code
        </a>
        .
      </p>
      <h3>What it is not</h3>
      <p>There are no bets and nothing is wagered, anywhere in the game: not on matches, not in duels.</p>
    </Page>
  );
}

const QA: [string, ReactNode][] = [
  ["Do I need a wallet?", "No. You sign in with an email. The game makes you an account and pays its transaction fees; your key stays in your browser, and you can back it up with a passkey from your account page."],
  ["What are goalars (G)?", "The game's only currency. New G are minted when fans fill a stand, when a goal is scored in front of them and for a few first times. G are burned by trainings, packs, diets, club projects and empty stands. On this testnet they are worth nothing outside the game."],
  ["How do I earn G?", "Play: your first match pays a debut bonus, your goals pay you, your club pays its wage. As a fan, take your seat before kick-off: a full house pays everyone in it."],
  ["Why is my footballer tired?", "A match and a training cost energy; a night gives some back and a day off gives more. Under 50 his skills drop. Rest him for a match day, or put him on the pasta diet."],
  ["How can he get injured?", "Only by finishing a match with almost no energy left (under 30). The less he has, the higher the risk. He then misses up to three match days; each physio level at your club takes one off."],
  ["What does an instruction do?", "It moves 4 points from one of his skills to another on the pitch: a shooter shoots better and passes worse, and so on. You can change it before any half."],
  ["I am away next week. What happens?", "Put him on holiday from the locker room, for up to 14 match days. Nobody picks him, he rests and an academy kid plays. He comes back by himself, or as soon as you take a slot."],
  ["How do I join a club?", "From the locker room, pick a club and the length of your contract. Some clubs vote on their recruits: you then apply, its players say yes or no, and you join once the yes win."],
  ["Can I give G to my club?", "Yes, from the club house. A gift goes straight to the treasury and your name goes on the club's board. It is not refunded."],
  ["What is a duel?", "You challenge another player to one of the five drills. Both play the very same drill, at the same level, and the better score wins. Nothing is staked."],
  ["Who can read my messages?", "Private messages are kept by the game's server, not on the chain, and shown only to the two of you. The terrace is public. A club's wall is for its squad."],
  ["Are matches fair?", "A half is played in one transaction from the block's random seed, the elevens and the strategies. The result is on chain and anyone can replay it."],
];

export function Faq() {
  return (
    <Page title="Questions" lede="The short answers. The rules themselves are in the contracts, readable by anyone.">
      <dl className="faq">
        {QA.map(([q, a]) => (
          <div key={q}>
            <dt>{q}</dt>
            <dd>{a}</dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}

export function Terms() {
  return (
    <Page title="Terms of use" lede="Plain terms for a hackathon demo on a test network. Last updated 12 November 2026.">
      <h3>1. A demo, as it is</h3>
      <p>
        NEAR Post is a hackathon project running on the NEAR testnet. It is provided as it is, free of charge, with no guarantee that it stays online, that your progress is
        kept or that it is free of errors. The testnet or the league can be reset at any time.
      </p>
      <h3>2. Nothing here is money</h3>
      <p>
        Goalars, footballers, items and season tickets are test tokens with no monetary value. Nothing in the game can be bought with money or cashed out. There are no bets
        and no game of chance played for money.
      </p>
      <h3>3. Your account</h3>
      <p>
        One account per person. Your key is made and kept in your browser: nobody else, the game's server included, can act for you. If you lose it without a passkey or a
        recovery key, the account cannot be recovered.
      </p>
      <h3>4. Fair play</h3>
      <p>
        Do not automate play outside the documented bot interface, do not attack the service, and do not use messages, the terrace, club walls or names to harass, threaten,
        insult, advertise or post anything illegal. Content that breaks these terms can be removed from the server and its author kept out of it.
      </p>
      <h3>5. What is on the chain stays there</h3>
      <p>The rules of the game are in contracts with no owner and no upgrade method. What they record (names, results, transfers) is public and cannot be edited or erased.</p>
      <h3>6. Names and art</h3>
      <p>Clubs and footballers are fictional. Do not use the name of a real club, player or brand. The game's code is open source under the licence in its repository.</p>
      <h3>7. Contact</h3>
      <p>
        Questions or a report:{" "}
        <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
          open an issue on the project's repository
        </a>
        .
      </p>
    </Page>
  );
}

export function Privacy() {
  return (
    <Page title="Privacy" lede="What the game knows about you, where it is kept and what is public. Last updated 12 November 2026.">
      <h3>Your email</h3>
      <p>
        It is used once, to send or check your sign-in code, and to derive your account's name with a one-way hash. The email itself is not written on the chain and is not
        kept in the game's data; it can appear for a short time in the server's technical logs.
      </p>
      <h3>In your browser</h3>
      <p>Your account's key and a few preferences (the club you follow, a drill score waiting to be submitted) are kept in this browser's local storage. No advertising or tracking cookie is set.</p>
      <h3>On the game's server</h3>
      <ul>
        <li>your passkey backup, encrypted in your browser before it is sent: the server cannot read it;</li>
        <li>the face you picked for your footballer;</li>
        <li>what you post: club wall, terrace, private messages, friends and duels;</li>
        <li>your IP address, for a short time, only to limit abuse.</li>
      </ul>
      <h3>Public, on the chain</h3>
      <p>Your account's name, your footballer and his name, your club, your votes, your transfers and your G are public and permanent. Do not put personal information in a name.</p>
      <h3>Shared with nobody</h3>
      <p>Nothing is sold or shared for advertising. When sign-in emails are sent, they go through an email provider only to be delivered.</p>
      <h3>Your choices</h3>
      <p>
        You can sign out at any time from your account page, which removes the key from this browser. To have what the server keeps about your account removed,{" "}
        <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
          ask on the project's repository
        </a>
        . What is on the chain cannot be removed.
      </p>
    </Page>
  );
}

/** The links every page ends with. */
export function Footer() {
  return (
    <footer className="site-foot">
      <a href="#/about">About</a>
      <a href="#/faq">Questions</a>
      <a href="#/people">People</a>
      <a href="#/ranks">Rankings</a>
      <a href="#/terms">Terms</a>
      <a href="#/privacy">Privacy</a>
      <span>NEAR testnet · no real money · no bets</span>
    </footer>
  );
}

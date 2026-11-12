import { type Answer, type BrainConfig, type Evidence, ask } from "./brain.js";
import {
  type Candidate,
  type Character,
  type ClubChoice,
  FORMATIONS,
  type MarketDecision,
  type MarketSituation,
  STRATEGIES,
  type SpendSituation,
  type Strategy,
  type StrategySituation,
  type Style,
  type TacticDecision,
  type TacticSituation,
  checkFootballer,
  checkMarket,
  checkTactic,
  fallbackCaptain,
  fallbackMarket,
  fallbackMove,
  fallbackSpend,
  fallbackStrategy,
  fallbackTactic,
} from "./rules.js";

/**
 * One decision of one agent: the model's answer where it fits the options,
 * the rules' choice where it does not (or without a model), and what was
 * refused. The situation passed to the model holds ids and numbers only.
 */
export interface Decision<T> {
  decision: T;
  source: "model" | "rules";
  refused: string[];
  evidence: Evidence | null;
  error: string | null;
}

export type Ask = (system: string, situation: unknown, schema: Record<string, unknown>) => Promise<Answer>;
export const askWith = (cfg: BrainConfig | null): Ask | null => (cfg ? (sys, sit, schema) => ask(cfg, sys, sit, schema) : null);

const COACH: Record<Style, string> = {
  builder: "You are a patient football coach who builds for the long run: you sell dear, buy value and hate wasting money.",
  gambler: "You are a bold football coach: you spend to win now, you attack, you chase every game.",
  careful: "You are a careful football coach: you keep money in reserve and you protect a lead.",
  tactician: "You are a tactical football coach: you read the opponent's zones and hit where they are weak.",
};
const PLAYER: Record<Character, string> = {
  leader: "You are a footballer who wants to lead: you speak up and want the captain's armband.",
  showman: "You are a flamboyant footballer: you want to attack, score and look good.",
  loyal: "You are a loyal footballer: you care about the team and you save your money.",
  mercenary: "You are a footballer who follows the money: you go where you are paid best.",
};

const quote = { type: "string", maxLength: 200 };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export async function decideTactic(a: Ask | null, s: TacticSituation): Promise<Decision<TacticDecision>> {
  const system =
    `${COACH[s.style]} Pick the formation for the next half. ` +
    "Zones are mean ratings (1-99) of the players in the back, the middle and the front for each formation; `theirs` is the opponent's. " +
    "`score` is [ours, theirs]; `table` gives positions out of `clubs`. " +
    "`history` is your last matches, the latest last, with the formation and strategy your side ended with and the score [ours, theirs]: keep what won, change what lost, and say so. `aim` is what you told your club you aim for this season (title, top_half or stay_up): play for it.";
  const withBriefing =
    `${system} Also write \`briefing\`: two or three sentences for your season ticket holders, the plan and the zone that decides the match, with its numbers.`;
  return decide(
    a,
    withBriefing,
    s,
    obj({ formation: { type: "string", enum: FORMATIONS }, quote, briefing: { type: "string", maxLength: 500 } }),
    (d) => {
      const r = checkTactic(s, d);
      // A model that forgot the briefing still gets the rules' one.
      const fb = fallbackTactic(s).briefing;
      if (r.ok && !r.ok.briefing && fb) r.ok.briefing = fb;
      return r;
    },
    () => fallbackTactic(s),
  );
}

export async function decideMarket(a: Ask | null, s: MarketSituation): Promise<Decision<MarketDecision>> {
  const system =
    `${COACH[s.style]} Run today's transfer business. ` +
    "`sells` are offers other clubs made for your players (accept at most one, or none): compare `price` with `reference`, and mind your starters. " +
    "`buys` are players who would improve your eleven: bid on at most one, at a price between its `min` and `max`, or none. " +
    "`broke` means you must not buy. Prices are in G.";
  const schema = obj({
    sell: { type: "string", enum: [...s.sells.map((o) => o.id), "none"] },
    buy: obj({ id: { type: "string", enum: [...s.buys.map((o) => o.id), "none"] }, price: { type: "integer" } }),
    quote,
  });
  return decide(a, system, s, schema, (d) => checkMarket(s, d), () => fallbackMarket(s));
}

export interface FootballerDay {
  character: Character;
  /** Before a half: vote the strategy. */
  strategy?: StrategySituation;
  /** Once a week: vote for a captain (himself is `me`). */
  captain?: { me: Candidate; others: Candidate[] };
  /** Buy a pack of three looks with his wallet. */
  spend?: SpendSituation;
  /** A free agent: offers and clubs to join. */
  move?: ClubChoice[];
}

export interface FootballerDecision {
  strategy?: Strategy;
  vote?: string;
  pack?: boolean;
  season_ticket?: boolean;
  choice?: string | null;
  quote: string;
}

export async function decideFootballer(a: Ask | null, s: FootballerDay): Promise<Decision<FootballerDecision>> {
  const props: Record<string, unknown> = {};
  const parts: string[] = [PLAYER[s.character]];
  if (s.strategy) {
    props.strategy = { type: "string", enum: STRATEGIES };
    parts.push("Vote the team's strategy for the next half (`strategy`): zones are mean ratings of your back, middle and front and the opponent's; `score` is [ours, theirs]; `history` is your club's last matches, the latest last, with the strategy played and the score.");
  }
  if (s.captain) {
    props.vote = { type: "string", enum: [s.captain.me.id, ...s.captain.others.map((c) => c.id)] };
    parts.push("Vote for this week's captain (`vote`): yourself (`me`) or a teammate, by rating and goals.");
  }
  if (s.spend) {
    props.pack = { type: "boolean" };
    parts.push("Decide whether to spend `pack_price` G of your `wallet` on a pack of three cosmetic items (`pack`); `scored` is how many goals you scored in your last match.");
    if (s.spend.season_ticket_price !== undefined) {
      props.season_ticket = { type: "boolean" };
      parts.push(
        "Decide whether to buy your club's season ticket for `season_ticket_price` G (`season_ticket`): the price goes to the club, and the ticket earns G at every full house of the club this season.",
      );
    }
  }
  if (s.move) {
    props.choice = { type: "string", enum: [...s.move.map((c) => c.id), "none"] };
    parts.push(
      "You are a free agent: pick one choice (`choice`) or none. `offer-` choices pay you `price` G to sign, `join-` choices are free. " +
        "`better_at_position` is how many players of your position are better there (0: you start), `salary_days` how long its treasury pays salaries.",
    );
  }
  props.quote = quote;
  const options = {
    strategies: !!s.strategy,
    ...(s.captain ? { candidates: [s.captain.me.id, ...s.captain.others.map((c) => c.id)] } : {}),
    pack: !!s.spend,
    season_ticket: s.spend?.season_ticket_price !== undefined,
    ...(s.move ? { choices: s.move.map((c) => c.id) } : {}),
  };
  const fallback = (): FootballerDecision => {
    const out: FootballerDecision = { quote: "" };
    const quotes: string[] = [];
    if (s.strategy) {
      const f = fallbackStrategy(s.strategy);
      out.strategy = f.strategy;
      quotes.push(f.quote);
    }
    if (s.captain) out.vote = fallbackCaptain(s.character, s.captain.me, s.captain.others).vote;
    if (s.spend) {
      const sp = fallbackSpend(s.spend);
      out.pack = sp.pack;
      if (sp.season_ticket !== undefined) out.season_ticket = sp.season_ticket;
    }
    if (s.move) {
      const m = fallbackMove(s.character, s.move);
      out.choice = m.choice;
      if (m.quote) quotes.push(m.quote);
    }
    out.quote = quotes.join(" ");
    return out;
  };
  const situation = { strategy: s.strategy, captain: s.captain, spend: s.spend, move: s.move };
  return decide(
    a,
    parts.join(" "),
    situation,
    obj(props),
    (d) => {
      const r = checkFootballer(options, d);
      if (!r.ok) return r;
      // A field the model left out or got wrong is the rules' call.
      const f = fallback();
      const ok: FootballerDecision = { ...r.ok };
      for (const k of ["strategy", "vote", "pack", "season_ticket", "choice"] as const) if (k in f && !(k in ok)) (ok as unknown as Record<string, unknown>)[k] = f[k];
      return { ok, refused: r.refused };
    },
    fallback,
  );
}

async function decide<T extends { quote: string }>(
  a: Ask | null,
  system: string,
  situation: unknown,
  schema: Record<string, unknown>,
  check: (d: unknown) => { ok: T | null; refused: string[] },
  fallback: () => T,
): Promise<Decision<T>> {
  if (!a) return { decision: fallback(), source: "rules", refused: [], evidence: null, error: null };
  const r = await a(system, situation, schema);
  if (r.answer === null) return { decision: fallback(), source: "rules", refused: [], evidence: r.evidence, error: r.error ?? "no answer" };
  const c = check(r.answer);
  if (!c.ok) return { decision: fallback(), source: "rules", refused: c.refused, evidence: r.evidence, error: null };
  const decision = { ...c.ok, quote: c.ok.quote || fallback().quote };
  return { decision, source: "model", refused: c.refused, evidence: r.evidence, error: null };
}

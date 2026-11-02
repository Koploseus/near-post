/**
 * The AI agents' rules, in one file. Two kinds of agents play the demo league,
 * each with its own NEAR account and G wallet, and no right in the contracts
 * that a human does not have:
 * - coaches of the fictional clubs: formation, transfers;
 * - footballers, who play like people do: report, vote the strategy and the
 *   captain, spend their salary, choose a club. They play in any club, human
 *   or not, and are treated like anyone else.
 *
 * The code here does the football and the money: it reads the squads, prices
 * every player, and lists what a coach may do (with a price range). The
 * language model only chooses among those options and says why; whatever it
 * answers is checked against this list before anything is signed. Without a
 * model, or when its answer does not fit, `fallback` decides.
 *
 * Nothing written by users (player or club names) reaches the model: only
 * ids, numbers and the coach's own style.
 */

export type Position = "Gk" | "Df" | "Mf" | "Fw";
export type Role = "Gk" | "Lb" | "Cb" | "Rb" | "Dm" | "Cm" | "Lm" | "Rm" | "Am" | "Lw" | "Rw" | "St";
export type Formation = "4-4-2" | "4-3-3" | "3-5-2" | "4-2-3-1";
export interface Skills {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
}
export interface Player {
  token_id: string;
  position: Position;
  skills: Skills;
  overall: number;
  owner: string;
  controller: string | null;
}
export interface Offer {
  id: number;
  token_id: string;
  buyer: string;
  price: string;
  state: "Open" | "Accepting" | "Sold" | "Cancelled";
  match_day: number;
}

/** One G in yocto-G (the token has 6 decimals). */
export const ONE_G = 1_000_000n;

// ---- Coaches ----

/**
 * builder: plays the long game, sells dear, buys young and cheap.
 * gambler: spends, attacks, chases the game.
 * careful: keeps a reserve, defends a lead.
 * tactician: picks the formation against the opponent's weak zone.
 */
export type Style = "builder" | "gambler" | "careful" | "tactician";

export interface Coach {
  /** Account prefix of the club (under the parent account). */
  club: string;
  name: string;
  style: Style;
}

/** Fictional coaches of the fictional clubs (see scripts/seed-demo.mjs). */
export const COACHES: Coach[] = [
  { club: "rive-nord", name: "Lucien Varenne", style: "gambler" },
  { club: "port-lune", name: "Odile Marchal", style: "builder" },
  { club: "pont-levant", name: "Bastien Corlay", style: "tactician" },
  { club: "haute-ville", name: "Helene Rouviere", style: "careful" },
  { club: "marais", name: "Gaston Pellerin", style: "careful" },
  { club: "vieux-phare", name: "Yvonne Kerbrat", style: "gambler" },
  { club: "saint-cendre", name: "Aurele Fontanet", style: "builder" },
  { club: "cote-rouge", name: "Mathis Delorge", style: "tactician" },
  { club: "val-ombre", name: "Suzanne Ardouin", style: "tactician" },
  { club: "pierrefeu", name: "Firmin Lacoste-Vey", style: "gambler" },
  { club: "docks", name: "Rosalie Tessandier", style: "careful" },
  { club: "clairbois", name: "Anatole Brivet", style: "builder" },
  { club: "mont-gris", name: "Colette Ravaud", style: "careful" },
  { club: "bellerive", name: "Edmond Sauvaget", style: "gambler" },
  { club: "lavandier", name: "Ines Marouzeau", style: "builder" },
  { club: "bois-joli", name: "Prosper Callens", style: "tactician" },
  { club: "fontaine-rouge", name: "Mireille Dussaud", style: "gambler" },
  { club: "quais", name: "Hector Lemarquis", style: "careful" },
  { club: "hautes-herbes", name: "Clemence Vautrin", style: "builder" },
  { club: "rocheblanche", name: "Achille Fervaques", style: "tactician" },
  { club: "grand-pre", name: "Leonie Castagnol", style: "careful" },
  { club: "tour-neuve", name: "Baptiste Ormesson-Ley", style: "gambler" },
  { club: "maree-basse", name: "Josephine Arlanc", style: "builder" },
  { club: "lune-rousse", name: "Valentin Desgranges", style: "tactician" },
];

/** How each style handles money. Shares of the wallet, ratios of the reference price. */
export const MONEY: Record<Style, { spendShare: number; overpay: number; sellFloor: number; reserve: bigint }> = {
  builder: { spendShare: 0.35, overpay: 1.1, sellFloor: 1.2, reserve: 300_000n * ONE_G },
  gambler: { spendShare: 0.7, overpay: 1.35, sellFloor: 0.95, reserve: 100_000n * ONE_G },
  careful: { spendShare: 0.25, overpay: 1.0, sellFloor: 1.1, reserve: 500_000n * ONE_G },
  tactician: { spendShare: 0.45, overpay: 1.2, sellFloor: 1.05, reserve: 250_000n * ONE_G },
};

// ---- Football ----

const ROLES: Record<Formation, Role[]> = {
  "4-4-2": ["Gk", "Lb", "Cb", "Cb", "Rb", "Lm", "Cm", "Cm", "Rm", "St", "St"],
  "4-3-3": ["Gk", "Lb", "Cb", "Cb", "Rb", "Dm", "Cm", "Cm", "Lw", "St", "Rw"],
  "3-5-2": ["Gk", "Cb", "Cb", "Cb", "Lm", "Dm", "Cm", "Cm", "Rm", "St", "St"],
  "4-2-3-1": ["Gk", "Lb", "Cb", "Cb", "Rb", "Dm", "Dm", "Lw", "Am", "Rw", "St"],
};
export const FORMATIONS = Object.keys(ROLES) as Formation[];

/** Same weights as the contract's `live::role_value` (pace, shooting, passing, dribbling, defending, physical). */
const WEIGHTS: Record<Role, number[]> = {
  Gk: [5, 0, 15, 0, 60, 20],
  Cb: [10, 0, 10, 0, 50, 30],
  Lb: [25, 0, 15, 10, 35, 15],
  Rb: [25, 0, 15, 10, 35, 15],
  Dm: [10, 5, 25, 5, 35, 20],
  Cm: [10, 10, 35, 20, 15, 10],
  Lm: [25, 10, 25, 25, 5, 10],
  Rm: [25, 10, 25, 25, 5, 10],
  Am: [10, 25, 30, 30, 0, 5],
  Lw: [30, 25, 10, 30, 0, 5],
  Rw: [30, 25, 10, 30, 0, 5],
  St: [20, 45, 5, 15, 0, 15],
};

export function roleValue(s: Skills, r: Role): number {
  const v = [s.pace, s.shooting, s.passing, s.dribbling, s.defending, s.physical];
  const sum = v.reduce((a, x, i) => a + x * WEIGHTS[r][i]!, 0);
  return Math.min(99, Math.max(1, Math.floor(sum / 100)));
}

/** The zones of the contract's engine: who defends, who builds, who finishes. */
const ZONES: Record<"back" | "middle" | "front", Role[]> = {
  back: ["Gk", "Lb", "Cb", "Rb", "Dm"],
  middle: ["Dm", "Cm", "Lm", "Rm", "Am"],
  front: ["Am", "Lw", "Rw", "St", "Cm"],
};
export interface Zones {
  back: number;
  middle: number;
  front: number;
}

/** The eleven the contract would field: slot by slot, the best player left for the role (keepers in goal only). */
export function eleven(squad: Player[], f: Formation): (Player | null)[] {
  const left = [...squad];
  return ROLES[f].map((role) => {
    let best = -1;
    let score = -1;
    left.forEach((p, i) => {
      const fits = (role === "Gk") === (p.position === "Gk");
      const s = (fits ? 1000 : 0) + roleValue(p.skills, role);
      if (s > score) (best = i), (score = s);
    });
    return best < 0 ? null : left.splice(best, 1)[0]!;
  });
}

/** Mean role value per zone of the eleven a formation fields (0 for an empty slot). */
export function zones(squad: Player[], f: Formation): Zones {
  const xi = eleven(squad, f);
  const roles = ROLES[f];
  const mean = (zone: Role[]) => {
    const v = roles.map((r, k) => (zone.includes(r) ? (xi[k] ? roleValue(xi[k]!.skills, r) : 0) : null)).filter((x) => x !== null);
    return v.length ? Math.round(v.reduce((a, x) => a + x!, 0) / v.length) : 0;
  };
  return { back: mean(ZONES.back), middle: mean(ZONES.middle), front: mean(ZONES.front) };
}

// ---- Money ----

/**
 * What a player is worth, in whole G: 250k at 50 overall, 7% more per point
 * (100k to 5M), moved halfway to the median of recent sales at his level when
 * there are at least two, and up to 30% higher when clubs are bidding for his
 * position (5% per open bid).
 */
export function referencePrice(p: Pick<Player, "overall" | "position">, market: Market): number {
  let price = Math.min(5_000_000, Math.max(100_000, 250_000 * 1.07 ** (p.overall - 50)));
  const near = market.sales.filter((s) => s.position === p.position && Math.abs(s.overall - p.overall) <= 5).map((s) => s.price);
  if (near.length >= 2) {
    near.sort((a, b) => a - b);
    price = (price + near[Math.floor(near.length / 2)]!) / 2;
  }
  const demand = Math.min(0.3, 0.05 * (market.openBids[p.position] ?? 0));
  return Math.round((price * (1 + demand)) / 1000) * 1000;
}

/** What the coaches saw of the market: sales (whole G) and open bids per position. */
export interface Market {
  sales: { position: Position; overall: number; price: number; match_day: number }[];
  openBids: Partial<Record<Position, number>>;
}

// ---- Options ----

export interface FormationOption {
  id: Formation;
  ours: Zones;
}

/** Everything a coach weighs before a half. Ids and numbers only. */
export interface TacticSituation {
  style: Style;
  half: 1 | 2;
  /** Goals: ours, theirs (at half-time; 0-0 before kick-off). */
  score: [number, number];
  current: Formation;
  options: FormationOption[];
  /** The opponent's zones with the formation he plays. */
  theirs: Zones;
  table: { ours: number; theirs: number; clubs: number };
}

export function tacticSituation(
  style: Style,
  half: 1 | 2,
  score: [number, number],
  current: Formation,
  squad: Player[],
  theirSquad: Player[],
  theirFormation: Formation,
  table: TacticSituation["table"],
): TacticSituation {
  return {
    style,
    half,
    score,
    current,
    options: FORMATIONS.map((id) => ({ id, ours: zones(squad, id) })),
    theirs: zones(theirSquad, theirFormation),
    table,
  };
}

export interface SellOption {
  /** `sell-<offer id>` */
  id: string;
  offer_id: number;
  token_id: string;
  price: number;
  reference: number;
  position: Position;
  overall: number;
  /** In the best eleven of the current formation. */
  starter: boolean;
}

export interface BuyOption {
  /** `buy-<token id>` */
  id: string;
  token_id: string;
  position: Position;
  overall: number;
  /** How much better than our weakest starter at that position. */
  upgrade: number;
  reference: number;
  /** The price range the code allows (whole G). */
  min: number;
  max: number;
  /** A person plays him (rather than the academy). */
  person: boolean;
}

export interface MarketSituation {
  style: Style;
  wallet: number;
  /** Below the style's reserve: sell, do not buy. */
  broke: boolean;
  table: { position: number; clubs: number };
  sells: SellOption[];
  buys: BuyOption[];
}

const whole = (yocto: bigint | string) => Number(BigInt(yocto) / ONE_G);

/** At most this many players a coach looks at to buy. */
export const MAX_BUY_OPTIONS = 5;

/**
 * The market as one coach sees it: the open offers he received (sell
 * options), and players elsewhere who would improve his eleven, priced and
 * bounded by his wallet and style (buy options).
 */
export function marketSituation(args: {
  style: Style;
  club: string;
  wallet: bigint;
  squad: Player[];
  formation: Formation;
  offers: Offer[];
  /** Players the club could bid on: other squads and free agents. */
  others: Player[];
  /** Players the club already bid on. */
  bidding: Set<string>;
  market: Market;
  table: MarketSituation["table"];
}): MarketSituation {
  const { style, club, wallet, squad, formation, offers, others, bidding, market, table } = args;
  const money = MONEY[style];
  const starters = new Set(eleven(squad, formation).filter((p): p is Player => !!p).map((p) => p.token_id));
  const broke = wallet < money.reserve;
  const sells: SellOption[] = offers
    .filter((o) => o.state === "Open" && o.buyer !== club)
    .flatMap((o) => {
      const p = squad.find((x) => x.token_id === o.token_id);
      if (!p) return [];
      return [
        {
          id: `sell-${o.id}`,
          offer_id: o.id,
          token_id: p.token_id,
          price: whole(o.price),
          reference: referencePrice(p, market),
          position: p.position,
          overall: p.overall,
          starter: starters.has(p.token_id),
        },
      ];
    });

  const spendable = Math.max(0, whole(wallet - money.reserve));
  const budget = Math.floor(Math.min(spendable, whole(wallet) * money.spendShare));
  const buys: BuyOption[] = broke
    ? []
    : others
        .filter((p) => p.owner !== club && !bidding.has(p.token_id))
        .map((p) => {
          const mine = squad.filter((x) => x.position === p.position && starters.has(x.token_id));
          const worst = mine.length ? Math.min(...mine.map((x) => x.overall)) : 0;
          const reference = referencePrice(p, market);
          const max = Math.min(budget, Math.round(reference * money.overpay));
          return {
            id: `buy-${p.token_id}`,
            token_id: p.token_id,
            position: p.position,
            overall: p.overall,
            upgrade: p.overall - worst,
            reference,
            min: Math.round(reference * 0.8),
            max,
            person: !!p.controller,
          };
        })
        .filter((b) => b.upgrade >= 4 && b.max >= b.min)
        .sort((a, b) => b.upgrade - a.upgrade || a.reference - b.reference)
        .slice(0, MAX_BUY_OPTIONS);

  return { style, wallet: whole(wallet), broke, table, sells, buys };
}

// ---- Decisions ----

export interface TacticDecision {
  formation: Formation;
  quote: string;
}
export interface MarketDecision {
  /** A sell option id, or null. */
  sell: string | null;
  /** A buy option id and the price (whole G), or null. */
  buy: { id: string; price: number } | null;
  quote: string;
}

/** What the model answered, kept only where it fits the options. Lists what was refused. */
export function checkTactic(s: TacticSituation, d: unknown): { ok: TacticDecision | null; refused: string[] } {
  const x = d as Partial<TacticDecision> | null;
  if (!x || typeof x !== "object") return { ok: null, refused: ["not an object"] };
  if (!s.options.some((o) => o.id === x.formation)) return { ok: null, refused: [`formation ${String(x.formation)} is not an option`] };
  return { ok: { formation: x.formation!, quote: cleanQuote(x.quote) }, refused: [] };
}

export function checkMarket(s: MarketSituation, d: unknown): { ok: MarketDecision | null; refused: string[] } {
  const x = d as { sell?: unknown; buy?: unknown; quote?: unknown } | null;
  if (!x || typeof x !== "object") return { ok: null, refused: ["not an object"] };
  const refused: string[] = [];
  let sell: string | null = null;
  if (typeof x.sell === "string" && x.sell !== "none") {
    const o = s.sells.find((o) => o.id === x.sell);
    if (!o) refused.push(`sell ${x.sell} is not an option`);
    else if (!s.broke && o.price < o.reference * MONEY[s.style].sellFloor * 0.85)
      refused.push(`sell ${x.sell}: ${o.price} G is too far under the reference ${o.reference} G`);
    else sell = o.id;
  }
  let buy: MarketDecision["buy"] = null;
  const b = x.buy as { id?: unknown; price?: unknown } | null | undefined;
  if (b && typeof b === "object" && typeof b.id === "string" && b.id !== "none") {
    const o = s.buys.find((o) => o.id === b.id);
    const price = typeof b.price === "number" && Number.isFinite(b.price) ? Math.round(b.price) : NaN;
    if (!o) refused.push(`buy ${b.id} is not an option`);
    else if (!(price >= o.min && price <= o.max)) refused.push(`buy ${b.id}: ${b.price} G is outside ${o.min}..${o.max} G`);
    else buy = { id: o.id, price };
  }
  return { ok: { sell, buy, quote: cleanQuote(x.quote) }, refused };
}

/** The quote is shown to players: plain text, one line, 160 characters at most, no links. */
export function cleanQuote(q: unknown): string {
  if (typeof q !== "string") return "";
  return q
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[^\p{L}\p{N} .,;:!?'’()%+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

const attackWeight: Record<Style, number> = { builder: 1, gambler: 1.6, careful: 0.7, tactician: 1 };

/** The rules' own choice of formation: the model's fallback, and a baseline to compare with. */
export function fallbackTactic(s: TacticSituation): TacticDecision {
  const [us, them] = s.score;
  let w = attackWeight[s.style];
  if (s.half === 2 && us < them) w += 0.8; // chasing the game
  if (s.half === 2 && us > them && s.style !== "gambler") w -= 0.5; // holding a lead
  const score = (o: FormationOption) => {
    const z = o.ours;
    if (s.style === "tactician") {
      // Push where they are weak, cover where they are strong.
      return w * (z.front - s.theirs.back) + (z.middle - s.theirs.middle) + (z.back - s.theirs.front) / w;
    }
    return w * z.front + z.middle + z.back / w;
  };
  const best = [...s.options].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]!;
  const why =
    s.half === 2 && us < them
      ? `Down ${us}-${them}: we go forward with ${best.id}.`
      : s.half === 2 && us > them
        ? `Up ${us}-${them}: ${best.id} to see it out.`
        : `${best.id}: it suits the squad we have.`;
  return { formation: best.id, quote: why };
}

export function fallbackMarket(s: MarketSituation): MarketDecision {
  const floor = MONEY[s.style].sellFloor;
  const sell =
    [...s.sells]
      .filter((o) => (s.broke ? o.price >= o.reference * 0.6 : o.price >= o.reference * floor && (!o.starter || o.price >= o.reference * floor * 1.3)))
      .sort((a, b) => b.price / b.reference - a.price / a.reference)[0] ?? null;
  const target = s.buys[0] ?? null;
  const price = target ? Math.min(target.max, Math.max(target.min, target.reference)) : 0;
  const parts: string[] = [];
  if (sell) parts.push(`Sold a ${sell.position} for ${fmt(sell.price)}, ${Math.round((sell.price / sell.reference) * 100)}% of his value.`);
  if (target) parts.push(`Bid ${fmt(price)} for a ${target.position} who is ${target.upgrade} points better.`);
  if (!parts.length) parts.push(s.broke ? "No money, no buys. We hold on." : "Nothing worth it today.");
  return { sell: sell?.id ?? null, buy: target ? { id: target.id, price } : null, quote: parts.join(" ") };
}

export const fmt = (g: number) => (g >= 1_000_000 ? `${(g / 1_000_000).toFixed(1)}M G` : `${Math.round(g / 1000)}k G`);

// ---- Footballers ----

/**
 * leader: wants the armband, votes for himself when he is among the best.
 * showman: attacks, spends on looks.
 * loyal: stays where he plays, saves.
 * mercenary: goes where the money is.
 */
export type Character = "leader" | "showman" | "loyal" | "mercenary";
export type Strategy = "defend" | "balanced" | "attack";
export const STRATEGIES: Strategy[] = ["defend", "balanced", "attack"];

export interface Footballer {
  /** Account prefix (under the parent account). */
  id: string;
  name: string;
  position: Position;
  character: Character;
  /** The fictional club he signs for at the start (a prefix of COACHES), or null: a free agent. */
  starts_at: string | null;
}

/** Fictional footballers: two per fictional club, and four free agents anyone can sign. */
export const FOOTBALLERS: Footballer[] = (() => {
  const first = ["Remi", "Noa", "Ilan", "Sacha", "Theo", "Elias", "Malo", "Aaron", "Yanis", "Lino", "Oscar", "Nael", "Gabin", "Mael", "Timeo", "Ewen"];
  const last = ["Corbin", "Lestrade", "Vallon", "Duperray", "Mazelle", "Fourcade", "Brunel", "Kervella", "Sorel", "Garance", "Tavernier", "Moulard", "Belcour", "Rivolier"];
  const characters: Character[] = ["leader", "showman", "loyal", "mercenary"];
  const positions: Position[] = ["Fw", "Mf", "Df", "Fw", "Mf", "Gk"];
  const out: Footballer[] = [];
  const clubs = [...COACHES.map((c) => c.club), ...COACHES.map((c) => c.club), null, null, null, null];
  clubs.forEach((club, i) => {
    const name = `${first[i % first.length]} ${last[(i * 5 + 3) % last.length]}`;
    out.push({ id: `ai-${i + 1}`, name, position: positions[i % positions.length]!, character: characters[(i * 3 + 1) % 4]!, starts_at: club });
  });
  return out;
})();

/** Before a half: what the footballer sees to vote the club's strategy. */
export interface StrategySituation {
  character: Character;
  half: 1 | 2;
  score: [number, number];
  ours: Zones;
  theirs: Zones;
}

export function fallbackStrategy(s: StrategySituation): { strategy: Strategy; quote: string } {
  const [us, them] = s.score;
  if (s.half === 2 && us < them) return { strategy: "attack", quote: `${us}-${them}. We have to go and get it.` };
  if (s.half === 2 && us > them && s.character !== "showman") return { strategy: "defend", quote: `${us}-${them}. Keep it tight.` };
  if (s.character === "showman") return { strategy: "attack", quote: "Give me the ball." };
  const edge = s.ours.front - s.theirs.back + (s.ours.back - s.theirs.front);
  const strategy: Strategy = edge > 6 ? "attack" : edge < -6 ? "defend" : "balanced";
  return { strategy, quote: strategy === "balanced" ? "One game at a time." : strategy === "attack" ? "They are there to be beaten." : "Stay compact, hit them on the break." };
}

/** A teammate one could vote for as captain: a person in the club. */
export interface Candidate {
  /** Alias: `player_1`, `player_2`... (`me` for himself). */
  id: string;
  overall: number;
  goals: number;
}

export function fallbackCaptain(character: Character, me: Candidate, others: Candidate[]): { vote: string; quote: string } {
  const all = [me, ...others];
  const best = [...all].sort((a, b) => b.overall + b.goals * 2 - (a.overall + a.goals * 2) || a.id.localeCompare(b.id))[0]!;
  if (character === "leader" && me.overall >= best.overall - 3) return { vote: "me", quote: "I want the armband." };
  return { vote: best.id, quote: best.id === "me" ? "Someone has to lead." : "He leads by example." };
}

export interface SpendSituation {
  character: Character;
  wallet: number;
  pack_price: number;
}

/** What a footballer keeps in his wallet before he buys a pack (whole G). */
export const SAVINGS: Record<Character, number> = { leader: 300_000, showman: 50_000, loyal: 800_000, mercenary: 500_000 };

export function fallbackSpend(s: SpendSituation): { pack: boolean } {
  return { pack: s.wallet >= s.pack_price + SAVINGS[s.character] };
}

/** A free agent's choices: offers he received, and clubs he can join for free. */
export interface ClubChoice {
  /** `offer-<id>` for an offer, `join-<alias>` to join for free. */
  id: string;
  /** Club alias: `club_1`, `club_2`... */
  club: string;
  /** G he gets on accepting (whole G; 0 to join for free). */
  price: number;
  division: number;
  /** Position in its division. */
  rank: number;
  /** Would he start: how many players of his position are better. */
  better_at_position: number;
  /** Salaries the treasury can pay at the current rate (days). */
  salary_days: number;
}

export function fallbackMove(character: Character, choices: ClubChoice[]): { choice: string | null; quote: string } {
  if (!choices.length) return { choice: null, quote: "" };
  const score = (c: ClubChoice) =>
    (character === "mercenary" ? c.price / 50_000 : c.price / 200_000) +
    (c.better_at_position === 0 ? 6 : c.better_at_position === 1 ? 2 : -4) +
    (c.salary_days >= 10 ? 3 : 0) +
    (3 - c.division) * 2 -
    c.rank / 5;
  const best = [...choices].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]!;
  return { choice: best.id, quote: best.price > 0 ? `${fmt(best.price)}. I sign.` : "I want to play. I join." };
}

/** Checks a footballer's answer: each field must be one of its options. */
export function checkFootballer(
  options: { strategies?: boolean; candidates?: string[]; pack?: boolean; choices?: string[] },
  d: unknown,
): { ok: { strategy?: Strategy; vote?: string; pack?: boolean; choice?: string | null; quote: string } | null; refused: string[] } {
  const x = d as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return { ok: null, refused: ["not an object"] };
  const refused: string[] = [];
  const ok: { strategy?: Strategy; vote?: string; pack?: boolean; choice?: string | null; quote: string } = { quote: cleanQuote(x.quote) };
  if (options.strategies && x.strategy !== undefined) {
    if (STRATEGIES.includes(x.strategy as Strategy)) ok.strategy = x.strategy as Strategy;
    else refused.push(`strategy ${String(x.strategy)} is not an option`);
  }
  if (options.candidates && x.vote !== undefined) {
    if (options.candidates.includes(x.vote as string)) ok.vote = x.vote as string;
    else refused.push(`vote ${String(x.vote)} is not a candidate`);
  }
  if (options.pack && x.pack !== undefined) {
    if (typeof x.pack === "boolean") ok.pack = x.pack;
    else refused.push("pack must be true or false");
  }
  if (options.choices && x.choice !== undefined) {
    if (x.choice === null || x.choice === "none") ok.choice = null;
    else if (options.choices.includes(x.choice as string)) ok.choice = x.choice as string;
    else refused.push(`choice ${String(x.choice)} is not an option`);
  }
  return { ok, refused };
}

import type { Chain } from "../chain.js";
import { near } from "../chain.js";
import { type BrainConfig, signatureOf } from "./brain.js";
import type { Act, Entry, Journal, SeenOffer } from "./journal.js";
import { type Ask, decideFootballer, decideMarket, decideTactic } from "./minds.js";
import type { Agent, CoachAgent, FootballerAgent } from "./roster.js";
import {
  CONTRACT_DAYS,
  type Candidate,
  type ClubChoice,
  type Formation,
  type Market,
  ONE_G,
  type Offer,
  type Player,
  type Position,
  type Memory,
  type Strategy,
  dietFor,
  fallbackProject,
  giftFor,
  instructionFor,
  recruitVote,
  restBelow,
  marketSituation,
  tacticSituation,
  wageFor,
  zones,
} from "./rules.js";

/**
 * Runs the agents along the match day:
 * - between match days: each coach does his transfer business and picks the
 *   formation for the first half; each footballer reports, collects, may buy
 *   a pack, votes the strategy (and once a week the captain) and, as a free
 *   agent, may sign for a club;
 * - at half-time: coaches change the formation, footballers vote the
 *   strategy for the second half.
 * Every decision goes through minds.ts (the model, checked against the
 * rules' options) and lands in the journal with its transactions.
 */

interface Schedule {
  match_day: number;
  first_half_played: boolean;
  season?: number;
}
interface Club {
  name: string;
  manager: string;
  division: number;
  treasury: string;
  points: number;
  /** What the club offers a person per match (v9). */
  wage?: string;
}
export interface LeaguePlayer extends Player {
  name: string;
  goals: number;
  wallet: string;
  salary: string;
  look?: { hair: string | null; boots: string | null; band: string | null };
  /** Energy today, 0 to 100 (v9). */
  energy?: number;
  contract?: { club: string; wage: string; until_day: number } | null;
}
interface MatchResult {
  home: string;
  away: string;
  home_goals: number;
  away_goals: number;
  /** First half home, first half away, then the second half's. */
  formations?: Formation[];
  strategies?: Strategy[];
  full_time?: boolean;
}
interface Condition {
  instruction: string;
  diet: string | null;
  diet_until: number;
  holiday_until: number;
  injured_until: number;
}
interface LifeRules {
  pack_price: string;
  week_length: number;
  season_ticket_price?: string;
  season_tickets_per_club?: number;
  energy_match?: number;
  injury_below?: number;
  diet_price?: string;
}
/** Matches an agent remembers. */
const MEMORY = 4;
interface Lineup {
  formation: Formation;
}

export interface AgentsDeps {
  /** The parent account: views, account creation, top-ups. */
  chain: Chain;
  /** Signs as an agent. */
  as: (agent: Agent) => Chain;
  /** The agent's public key, to check it can sign. */
  publicKeyOf: (agent: Agent) => string;
  leagueId: string;
  goalarsId: string;
  playersId: string;
  /** The season tickets contract (v7 on); without it, no agent buys one. */
  ticketsId?: string;
  ask: Ask | null;
  brain: BrainConfig | null;
  journal: Journal;
  now?: () => number;
  /** How many agents act at once (each may wait for the model). */
  concurrency?: number;
}

const ONE_YOCTO = 1n;
const APPROVAL_DEPOSIT = 10n ** 22n; // 0.01 NEAR, the approval's storage
const LOW_NEAR = near("0.1");
const TOP_UP_NEAR = near("0.2");
const STALE_BID_DAYS = 3;
/** A player's earnings are collected from 50k G (fewer transactions). */
const CLAIM_FROM = 50_000n * ONE_G;

const whole = (v: string | bigint) => Number(BigInt(v) / ONE_G);

export class Agents {
  private coaches: CoachAgent[];
  private footballers: FootballerAgent[];
  private cantSign = new Set<string>();
  /** Bids made in this run, by day and player (the journal's offers are read at the start of the day). */
  private bidsToday = new Map<string, number>();
  private topUps = new Map<string, number>();

  constructor(
    private d: AgentsDeps,
    agents: Agent[],
  ) {
    this.coaches = agents.filter((a): a is CoachAgent => a.kind === "coach");
    this.footballers = agents.filter((a): a is FootballerAgent => a.kind === "footballer");
  }

  private now() {
    return (this.d.now ?? Date.now)();
  }
  private view<T>(contract: string, method: string, args: Record<string, unknown> = {}) {
    return this.d.chain.view<T>(contract, method, args);
  }
  private league<T>(method: string, args: Record<string, unknown> = {}) {
    return this.view<T>(this.d.leagueId, method, args);
  }

  /** One look at the match day; does what is due. */
  async tick(): Promise<void> {
    const s = await this.league<Schedule>("schedule");
    const day = s.match_day;
    const keys = s.first_half_played
      ? [...this.coaches.map((c) => `tactic:${day}:2:${c.account}`), ...this.footballers.map((f) => `half:${day}:${f.account}`)]
      : [
          ...this.coaches.flatMap((c) => [`market:${day}:${c.account}`, `tactic:${day}:1:${c.account}`]),
          ...this.footballers.map((f) => `day:${day}:${f.account}`),
        ];
    const settled = [...this.coaches, ...this.footballers].every((a) => this.ready.has(a.account) || this.cantSign.has(a.account));
    if (settled && keys.every((k) => this.d.journal.isDone(k) || this.cantSign.has(k.slice(k.lastIndexOf(":") + 1)))) {
      await this.sign();
      return; // nothing due until the next half
    }
    await this.setup();
    const table = await this.league<Club[]>("table");
    const clubs = new Map(table.map((c) => [c.manager, c]));
    const fixtures = await this.league<[string, string][]>("fixtures_of", { match_day: day });
    const opponent = new Map<string, string>();
    for (const [h, a] of fixtures) opponent.set(h, a).set(a, h);
    const ctx: Ctx = { day, season: s.season ?? 1, clubs, table, opponent, squads: new Map(), lineups: new Map(), results: null };

    if (!s.first_half_played) {
      if (this.coaches.some((c) => clubs.has(c.account) && !this.d.journal.isDone(`market:${day}:${c.account}`))) await this.scanOffers();
      const coaches = this.coaches.filter((c) => clubs.has(c.account) && !this.cantSign.has(c.account));
      await this.pool(coaches, (c) => this.once(`market:${day}:${c.account}`, () => this.market(c, ctx)));
      await this.pool(coaches, (c) => this.once(`tactic:${day}:1:${c.account}`, () => this.tactic(c, ctx, 1)));
      await this.pool(this.footballers, (f) => this.once(`day:${day}:${f.account}`, () => this.footballerDay(f, ctx)));
    } else {
      ctx.results = await this.league<MatchResult[]>("results", { match_day: day });
      const played = new Set(ctx.results.flatMap((r) => [r.home, r.away]));
      const coaches = this.coaches.filter((c) => played.has(c.account) && !this.cantSign.has(c.account));
      await this.pool(coaches, (c) => this.once(`tactic:${day}:2:${c.account}`, () => this.tactic(c, ctx, 2)));
      await this.pool(this.footballers, (f) => this.once(`half:${day}:${f.account}`, () => this.footballerHalf(f, ctx, played)));
    }
    await this.sign();
    this.d.journal.save();
  }

  // ---- Setup ----

  private ready = new Set<string>();

  /** Footballers' accounts and footballers exist; each agent can sign. */
  private async setup() {
    for (const a of [...this.coaches, ...this.footballers]) {
      if (this.ready.has(a.account) || this.cantSign.has(a.account)) continue;
      if (this.d.journal.isDone(`ready:${a.account}`)) {
        // Checked before a restart: no need to read it all again.
        this.ready.add(a.account);
        continue;
      }
      try {
        if (a.kind === "footballer" && (await this.d.chain.balance(a.account)) === null) {
          await this.d.chain.createAccount(a.account, this.d.publicKeyOf(a), near("0.25"));
        }
        if (!(await this.d.chain.hasKey(a.account, this.d.publicKeyOf(a)))) {
          this.cantSign.add(a.account);
          console.error(`agents: ${a.account} has no agent key (run scripts/agents-keys.mjs); it sits out`);
          continue;
        }
        if (a.kind === "coach") {
          const club = await this.league<Club | null>("get_club", { club_id: a.account });
          if (club && club.name !== a.clubName) {
            const tx = await this.d.as(a).call(this.d.leagueId, "rename_club", { name: a.clubName }, 30);
            this.log(a, 0, "setup", { acts: [{ what: "renamed", name: a.clubName }], txs: [tx], quote: "" });
          }
        }
        if (a.kind === "footballer") {
          const fb = await this.league<LeaguePlayer | null>("footballer_of", { account_id: a.account });
          if (!fb) {
            await this.d.as(a).callChecked!(this.d.leagueId, "create_footballer", { name: a.name, position: a.position }, 100);
            this.log(a, 0, "setup", { acts: [{ what: "created" }], quote: "" });
            continue; // the NFT is minted in a later receipt: sign next time
          }
          if (a.startsAt && fb.owner === a.account && !this.d.journal.isDone(`joined:${a.account}`)) {
            const tx = await this.d.as(a).callChecked!(this.d.playersId, "nft_transfer", { receiver_id: a.startsAt, token_id: fb.token_id }, 100, ONE_YOCTO);
            this.log(a, 0, "setup", { acts: [{ what: "joined", club: a.startsAt, price: 0 }], txs: [tx], quote: "" });
          }
          this.d.journal.markDone(`joined:${a.account}`);
        }
        this.ready.add(a.account);
        this.d.journal.markDone(`ready:${a.account}`);
        this.d.journal.save();
      } catch (e) {
        console.error(`agents: setup of ${a.account}: ${msg(e)}`);
      }
    }
  }

  // ---- Coaches ----

  private async tactic(c: CoachAgent, ctx: Ctx, half: 1 | 2) {
    const them = ctx.opponent.get(c.account);
    if (!them) return;
    const [squad, theirSquad, mine, theirs] = await Promise.all([
      this.squad(ctx, c.account),
      this.squad(ctx, them),
      this.lineup(ctx, c.account),
      this.lineup(ctx, them),
    ]);
    const r = ctx.results?.find((m) => m.home === c.account || m.away === c.account);
    const score: [number, number] = !r ? [0, 0] : r.home === c.account ? [r.home_goals, r.away_goals] : [r.away_goals, r.home_goals];
    const rank = (id: string) => this.rank(ctx, id);
    const s = tacticSituation(c.style, half, score, mine.formation, squad, theirSquad, theirs.formation, {
      ours: rank(c.account),
      theirs: rank(them),
      clubs: this.divisionSize(ctx, c.account),
    });
    const history = await this.history(ctx, c.account);
    if (history.length) s.history = history;
    const d = await decideTactic(this.d.ask, s);
    const out: Partial<Entry> = { quote: d.decision.quote, acts: [], txs: [], errors: [] };
    // With a captain, the formation is his call (the contract says so): the coach only talks.
    const captain = await this.league<unknown>("captain", { club_id: c.account });
    if (!captain && d.decision.formation !== mine.formation) {
      await this.act(c, out, () => this.d.as(c).call(this.d.leagueId, "set_formation", { club_id: c.account, formation: d.decision.formation }, 30), {
        what: "formation",
        formation: d.decision.formation,
      });
    }
    this.log(c, ctx.day, "tactic", {
      ...out,
      half,
      source: d.source,
      refused: d.refused,
      evidence: d.evidence,
      ...(d.decision.briefing ? { briefing: d.decision.briefing } : {}),
    });
  }

  private async market(c: CoachAgent, ctx: Ctx) {
    const me = this.d.as(c);
    const out: Partial<Entry> = { acts: [], txs: [], errors: [] };
    await this.topUp(c);
    // Housekeeping, no decision: collect what the league holds, take the
    // academy players' earnings, withdraw stale bids.
    const owed = BigInt(await this.league<string>("owed_of", { account_id: c.account }));
    if (owed > 0n) await this.act(c, out, () => me.call(this.d.leagueId, "collect", {}, 50), { what: "collected" });
    // Without a captain the manager sets what the club pays its people.
    if (!(await this.league<unknown>("captain", { club_id: c.account }))) await this.setWage(c, c.account, ctx, out);
    await this.voteRecruits(c, "coach", c.account, ctx, out);
    let squad = await this.squad(ctx, c.account);
    if (!squad.some((p) => p.position === "Gk")) {
      // No keeper in the squad: bring back the best one the club still owns.
      const owned = await this.view<{ token_id: string }[]>(this.d.playersId, "nft_tokens_for_owner", { account_id: c.account, limit: 100 });
      const inSquad = new Set(squad.map((p) => p.token_id));
      const out_ = await Promise.all(owned.filter((t) => !inSquad.has(t.token_id)).map((t) => this.league<Player | null>("get_player", { token_id: t.token_id })));
      const keeper = out_.filter((p): p is Player => p?.position === "Gk").sort((a, b) => b.overall - a.overall)[0];
      if (keeper && (await this.act(c, out, () => me.call(this.d.leagueId, "recall_player", { token_id: keeper.token_id }, 30), { what: "recalled", token_id: keeper.token_id }))) {
        ctx.squads.delete(c.account);
        squad = await this.squad(ctx, c.account);
      }
    }
    for (const p of squad as LeaguePlayer[]) {
      if (p.controller === null && BigInt(p.wallet) + BigInt(p.salary) >= CLAIM_FROM) {
        await this.act(c, out, () => me.call(this.d.leagueId, "claim_player", { token_id: p.token_id }, 60), { what: "collected" });
      }
    }
    const offers = Object.values(this.d.journal.offers);
    for (const o of offers) {
      if (o.buyer === c.account && o.state === "Open" && ctx.day - o.match_day >= STALE_BID_DAYS) {
        const now = await this.league<Offer | null>("get_offer", { offer_id: o.id });
        if (now && now.state !== "Open") {
          o.state = now.state; // sold or cancelled since the morning's look
          continue;
        }
        await this.act(c, out, () => me.call(this.d.leagueId, "cancel_offer", { offer_id: o.id }, 30), { what: "cancelled_bid", offer_id: o.id });
        o.state = "Cancelled";
      }
    }

    const received = (await Promise.all(squad.map((p) => this.league<Offer[]>("offers_for", { token_id: p.token_id })))).flat();
    const others = await this.others(ctx, c.account);
    const bidding = new Set(offers.filter((o) => o.buyer === c.account && o.state === "Open").map((o) => o.token_id));
    const contested = new Map<string, number>();
    for (const o of offers) if (o.buyer !== c.account && o.state === "Open") contested.set(o.token_id, (contested.get(o.token_id) ?? 0) + 1);
    for (const [k, n] of this.bidsToday) {
      const [d, token] = k.split(":");
      if (Number(d) === ctx.day && !bidding.has(token!)) contested.set(token!, (contested.get(token!) ?? 0) + n);
    }
    const wallet = BigInt(await this.view<string>(this.d.goalarsId, "ft_balance_of", { account_id: c.account }));
    const formation = (await this.lineup(ctx, c.account)).formation;
    const s = marketSituation({
      style: c.style,
      club: c.account,
      wallet,
      squad,
      formation,
      offers: received,
      others,
      bidding,
      contested,
      market: this.marketData(ctx.day),
      table: { position: this.rank(ctx, c.account), clubs: this.divisionSize(ctx, c.account) },
    });
    const d = await decideMarket(this.d.ask, s);
    out.quote = d.decision.quote;
    const sell = s.sells.find((o) => o.id === d.decision.sell);
    if (sell) {
      await this.act(
        c,
        out,
        () =>
          me.callChecked!(this.d.playersId, "nft_approve", { token_id: sell.token_id, account_id: this.d.leagueId, msg: JSON.stringify({ accept: sell.offer_id }) }, 250, APPROVAL_DEPOSIT),
        { what: "sold", token_id: sell.token_id, price: sell.price, offer_id: sell.offer_id },
      );
    }
    const buy = d.decision.buy && s.buys.find((o) => o.id === d.decision.buy!.id);
    if (buy && d.decision.buy) {
      const amount = BigInt(d.decision.buy.price) * ONE_G;
      const target = await this.league<Player | null>("get_player", { token_id: buy.token_id });
      if (target?.owner === c.account) out.errors!.push("bid: he is ours already");
      else if (amount <= wallet) {
        await this.act(
          c,
          out,
          () =>
            me.callChecked!(this.d.goalarsId, "ft_transfer_call", { receiver_id: this.d.leagueId, amount: amount.toString(), msg: JSON.stringify({ bid: buy.token_id }) }, 100, ONE_YOCTO),
          { what: "bid", token_id: buy.token_id, price: d.decision.buy.price },
        );
        const k = `${ctx.day}:${buy.token_id}`;
        this.bidsToday.set(k, (this.bidsToday.get(k) ?? 0) + 1);
      } else out.errors!.push("not enough G in the wallet yet");
    }
    this.log(c, ctx.day, "market", { ...out, source: d.source, refused: d.refused, evidence: d.evidence });
  }

  // ---- Footballers ----

  private async footballerDay(f: FootballerAgent, ctx: Ctx) {
    if (this.cantSign.has(f.account) || !this.ready.has(f.account)) return;
    const fb = await this.league<LeaguePlayer | null>("footballer_of", { account_id: f.account });
    if (!fb) return;
    const me = this.d.as(f);
    const out: Partial<Entry> = { acts: [], txs: [], errors: [] };
    await this.topUp(f);
    const club = ctx.clubs.get(fb.owner);
    const energy = fb.energy ?? 100;
    const rules = await this.league<LifeRules>("rules");
    const life = rules.injury_below !== undefined ? await this.league<Condition>("condition_of", { token_id: fb.token_id }).catch(() => null) : null;
    const outOfIt = !!life && (life.injured_until >= ctx.day || life.holiday_until >= ctx.day);
    if (life) {
      // How he plays: what his position asks. Said once, and again if his skills moved.
      const instruction = instructionFor(fb.position, fb.skills);
      if (life.instruction !== instruction) {
        await this.act(f, out, () => me.call(this.d.leagueId, "set_instruction", { instruction }, 30), { what: "instruction", instruction });
      }
    }
    if (club && !outOfIt) {
      // Tired legs sit the match day out (a day off gives energy back faster, and a match on empty legs can hurt).
      if (energy < restBelow(f.character, rules.injury_below ?? 0, rules.energy_match ?? 12)) {
        if (!(await this.league<boolean>("is_resting", { token_id: fb.token_id, match_day: ctx.day }))) {
          await this.act(f, out, () => me.call(this.d.leagueId, "rest_today", {}, 30), { what: "rested" });
        }
      } else {
        const reported = await this.league<boolean>("is_reported", { token_id: fb.token_id, match_day: ctx.day });
        if (!reported) await this.act(f, out, () => me.call(this.d.leagueId, "report_for_match", {}, 30), { what: "reported" });
      }
      // The captain sets what the club pays its people.
      const captain = await this.league<{ token_id: string } | null>("captain", { club_id: fb.owner });
      if (captain?.token_id === fb.token_id) await this.setWage(f, fb.owner, ctx, out);
    }
    // The debut bonus and full-house rewards are credits: mint them.
    if (BigInt(await this.league<string>("credits_of", { account_id: f.account })) > 0n) {
      await this.act(f, out, () => me.call(this.d.leagueId, "claim", {}, 60), { what: "collected" });
    }
    if (BigInt(fb.wallet) + BigInt(fb.salary) >= CLAIM_FROM) {
      await this.act(f, out, () => me.call(this.d.leagueId, "claim_player", { token_id: fb.token_id }, 60), { what: "collected" });
    }
    let wallet = whole(await this.view<string>(this.d.goalarsId, "ft_balance_of", { account_id: f.account }));
    const week = Math.floor((Math.max(1, ctx.day) - 1) / rules.week_length);
    if (club) await this.voteRecruits(f, f.character, fb.owner, ctx, out, fb);
    // A diet, when none is running: for his legs first, then for his game.
    if (club && life && rules.diet_price && !(life.diet && life.diet_until >= ctx.day)) {
      const price = whole(rules.diet_price);
      const diet = dietFor(f.character, fb.position, energy, wallet, price);
      if (
        diet &&
        (await this.act(
          f,
          out,
          () =>
            me.callChecked!(
              this.d.goalarsId,
              "ft_transfer_call",
              { receiver_id: this.d.leagueId, amount: rules.diet_price!, msg: JSON.stringify({ diet: { token_id: fb.token_id, diet } }) },
              150,
              ONE_YOCTO,
            ),
          { what: "diet", diet, price },
        ))
      )
        wallet -= price;
    }
    // Once a week, a loyal footballer or a leader helps a treasury that runs short.
    if (club && life && !this.d.journal.isDone(`gift:${week}:${f.account}`)) {
      const people = (await this.squad(ctx, fb.owner)).filter((p) => p.controller).length;
      const amount = giftFor(f.character, wallet, whole(club.treasury), whole(club.wage ?? "0") * people);
      if (amount > 0) {
        const ok = await this.act(
          f,
          out,
          () =>
            me.callChecked!(
              this.d.goalarsId,
              "ft_transfer_call",
              { receiver_id: this.d.leagueId, amount: (BigInt(amount) * ONE_G).toString(), msg: JSON.stringify({ gift: fb.owner }) },
              150,
              ONE_YOCTO,
            ),
          { what: "gift", club: fb.owner, amount },
        );
        if (ok) {
          wallet -= amount;
          this.d.journal.markDone(`gift:${week}:${f.account}`);
        }
      }
    }
    if (club && !this.d.journal.isDone(`project:${week}:${f.account}`)) {
      const project = fallbackProject(f.character, energy);
      if (await this.act(f, out, () => me.call(this.d.leagueId, "vote_project", { project }, 30), { what: "project_vote", project })) {
        this.d.journal.markDone(`project:${week}:${f.account}`);
      }
    }

    const captain = club && !this.d.journal.isDone(`captain:${week}:${f.account}`) ? await this.candidates(ctx, fb) : undefined;
    const strategy = club ? await this.strategySituation(f, ctx, fb.owner, 1) : undefined;
    const move = club ? undefined : await this.choices(ctx, fb);
    const packPrice = whole(rules.pack_price);
    const ticketPrice = club ? await this.seasonTicketOffer(ctx, f, fb.owner, rules) : null;
    const spend = {
      character: f.character,
      wallet,
      pack_price: packPrice,
      ...(ticketPrice !== null && wallet >= ticketPrice ? { season_ticket_price: ticketPrice } : {}),
    };
    const d = await decideFootballer(this.d.ask, {
      character: f.character,
      ...(strategy ? { strategy } : {}),
      ...(captain ? { captain: captain.situation } : {}),
      ...(wallet >= Math.min(packPrice, spend.season_ticket_price ?? Infinity) ? { spend } : {}),
      ...(move?.choices.length ? { move: move.choices } : {}),
    });
    out.quote = d.decision.quote;
    if (strategy && d.decision.strategy) await this.voteStrategy(f, out, d.decision.strategy);
    if (captain && d.decision.vote) {
      const token = captain.tokens.get(d.decision.vote);
      if (token) {
        await this.act(f, out, () => me.call(this.d.leagueId, "vote_captain", { candidate: token }, 30), { what: "captain_vote", token_id: token });
        this.d.journal.markDone(`captain:${week}:${f.account}`);
      }
    }
    let left = wallet;
    if (d.decision.season_ticket && spend.season_ticket_price !== undefined && this.d.ticketsId) {
      const price = BigInt(rules.season_ticket_price!);
      const ok = await this.act(
        f,
        out,
        () =>
          me.callChecked!(this.d.goalarsId, "ft_transfer_call", { receiver_id: this.d.leagueId, amount: price.toString(), msg: JSON.stringify({ season_ticket: fb.owner }) }, 150, ONE_YOCTO),
        { what: "season_ticket", club: fb.owner, price: spend.season_ticket_price },
      );
      if (ok) left -= spend.season_ticket_price;
    }
    if (d.decision.pack && left >= packPrice) await this.buyPack(f, fb, out, BigInt(rules.pack_price));
    if (move && d.decision.choice) {
      const c = move.choices.find((x) => x.id === d.decision.choice);
      const target = c && move.clubs.get(c.club);
      if (c && target) {
        const offer = c.id.startsWith("offer-") ? Number(c.id.slice(6)) : null;
        // His word first: the contract he takes when he gets there.
        const days = CONTRACT_DAYS[f.character];
        await this.act(f, out, () => me.call(this.d.leagueId, "sign_for", { club_id: target, days }, 30), { what: "signed", club: target, days });
        await this.act(
          f,
          out,
          () =>
            offer !== null
              ? me.callChecked!(this.d.playersId, "nft_approve", { token_id: fb.token_id, account_id: this.d.leagueId, msg: JSON.stringify({ accept: offer }) }, 250, APPROVAL_DEPOSIT)
              : me.callChecked!(this.d.playersId, "nft_transfer", { receiver_id: target, token_id: fb.token_id }, 100, ONE_YOCTO),
          { what: "joined", club: target, price: c.price },
        );
      }
    }
    this.log(f, ctx.day, "day", { ...out, half: 1, source: d.source, refused: d.refused, evidence: d.evidence });
  }

  private async footballerHalf(f: FootballerAgent, ctx: Ctx, played: Set<string>) {
    if (this.cantSign.has(f.account) || !this.ready.has(f.account)) return;
    const fb = await this.league<LeaguePlayer | null>("footballer_of", { account_id: f.account });
    if (!fb || !played.has(fb.owner)) return;
    const strategy = await this.strategySituation(f, ctx, fb.owner, 2);
    if (!strategy) return;
    const d = await decideFootballer(this.d.ask, { character: f.character, strategy });
    const out: Partial<Entry> = { quote: d.decision.quote, acts: [], txs: [], errors: [] };
    if (d.decision.strategy) await this.voteStrategy(f, out, d.decision.strategy);
    this.log(f, ctx.day, "half", { ...out, half: 2, source: d.source, refused: d.refused, evidence: d.evidence });
  }

  private async voteStrategy(f: FootballerAgent, out: Partial<Entry>, strategy: Strategy) {
    await this.act(f, out, () => this.d.as(f).call(this.d.leagueId, "vote_strategy", { strategy }, 30), { what: "strategy", strategy });
  }

  private async strategySituation(f: FootballerAgent, ctx: Ctx, club: string, half: 1 | 2) {
    const them = ctx.opponent.get(club);
    if (!them) return undefined;
    const [ours, theirs, l1, l2] = await Promise.all([this.squad(ctx, club), this.squad(ctx, them), this.lineup(ctx, club), this.lineup(ctx, them)]);
    const r = ctx.results?.find((m) => m.home === club || m.away === club);
    const score: [number, number] = !r ? [0, 0] : r.home === club ? [r.home_goals, r.away_goals] : [r.away_goals, r.home_goals];
    const history = await this.history(ctx, club);
    return { character: f.character, half, score, ours: zones(ours, l1.formation), theirs: zones(theirs, l2.formation), ...(history.length ? { history } : {}) };
  }

  /** Teammates one may vote for (people only), under aliases. */
  private async candidates(ctx: Ctx, fb: LeaguePlayer) {
    const squad = (await this.squad(ctx, fb.owner)) as LeaguePlayer[];
    const people = squad.filter((p) => p.controller);
    const tokens = new Map<string, string>([["me", fb.token_id]]);
    const others: Candidate[] = [];
    for (const p of people) {
      if (p.token_id === fb.token_id) continue;
      const id = `player_${others.length + 1}`;
      tokens.set(id, p.token_id);
      others.push({ id, overall: p.overall, goals: p.goals });
    }
    return { situation: { me: { id: "me", overall: fb.overall, goals: fb.goals }, others }, tokens };
  }

  /** A free agent's choices, under club aliases: the offers he has, and clubs where he would play. */
  private async choices(ctx: Ctx, fb: LeaguePlayer) {
    const offers = await this.league<Offer[]>("offers_for", { token_id: fb.token_id });
    const clubs = new Map<string, string>();
    const choices: ClubChoice[] = [];
    const alias = (account: string) => {
      for (const [k, v] of clubs) if (v === account) return k;
      const k = `club_${clubs.size + 1}`;
      clubs.set(k, account);
      return k;
    };
    const describe = async (account: string, id: string, price: number): Promise<ClubChoice | null> => {
      const c = ctx.clubs.get(account);
      if (!c) return null;
      const squad = await this.squad(ctx, account);
      const people = squad.filter((p) => p.controller).length;
      if (people >= 12) return null;
      return {
        id,
        club: alias(account),
        price,
        division: c.division,
        rank: this.rank(ctx, account),
        better_at_position: squad.filter((p) => p.position === fb.position && p.overall > fb.overall).length,
        // Matches the treasury can pay everyone at the wage the club offers (0 without a wage).
        salary_days: whole(c.wage ?? "0") > 0 ? Math.floor(whole(c.treasury) / (whole(c.wage!) * (people + 1))) : 0,
      };
    };
    for (const o of offers.filter((o) => o.state === "Open")) {
      const ch = await describe(o.buyer, `offer-${o.id}`, whole(o.price));
      if (ch) choices.push(ch);
    }
    // Free joins: the clubs where he would start, best divisions first.
    const joinable: ClubChoice[] = [];
    for (const c of [...ctx.table].sort((a, b) => a.division - b.division)) {
      if (joinable.length >= 4) break;
      const ch = await describe(c.manager, `join-pending`, 0);
      if (ch && ch.better_at_position === 0) joinable.push({ ...ch, id: `join-${ch.club}` });
    }
    return { choices: [...choices, ...joinable], clubs };
  }

  private past = new Map<number, Promise<MatchResult[]>>();
  /** A club's last matches as its people remember them, the latest last: read from the chain's match sheets. */
  private async history(ctx: Ctx, club: string): Promise<Memory[]> {
    const out: Memory[] = [];
    for (let day = Math.max(1, ctx.day - MEMORY); day < ctx.day; day++) {
      let r = this.past.get(day);
      if (!r) {
        r = this.league<MatchResult[]>("results", { match_day: day }).catch(() => [] as MatchResult[]);
        this.past.set(day, r);
        for (const k of this.past.keys()) if (k < ctx.day - 2 * MEMORY) this.past.delete(k);
      }
      const m = (await r).find((x) => x.home === club || x.away === club);
      if (!m || m.full_time === false || !m.formations?.length || !m.strategies?.length) continue;
      const home = m.home === club;
      // What his side ended the match with: the second half's when it was played.
      const at = (m.formations.length >= 4 ? 2 : 0) + (home ? 0 : 1);
      const formation = m.formations[at];
      const strategy = m.strategies[at];
      if (!formation || !strategy) continue;
      out.push({ formation, strategy, score: home ? [m.home_goals, m.away_goals] : [m.away_goals, m.home_goals] });
    }
    return out;
  }

  /** His voice on the people who applied to a club that votes on its recruits: once per applicant. */
  private async voteRecruits(a: Agent, who: "coach" | FootballerAgent["character"], clubAccount: string, ctx: Ctx, out: Partial<Entry>, me?: LeaguePlayer) {
    const mode = await this.league<string>("recruitment_of", { club_id: clubAccount }).catch(() => "open");
    if (mode !== "vote") return;
    const list = await this.league<{ token_id: string; overall: number }[]>("applicants", { club_id: clubAccount }).catch(() => []);
    if (!list.length) return;
    const people = (await this.squad(ctx, clubAccount)).filter((p) => p.controller).length;
    for (const ap of list) {
      const key = `recruit:${clubAccount}:${ap.token_id}:${a.account}`;
      if (this.d.journal.isDone(key)) continue;
      const p = await this.league<Player | null>("get_player", { token_id: ap.token_id });
      if (!p) continue;
      const yes = recruitVote(who, people, p, me);
      if (await this.act(a, out, () => this.d.as(a).call(this.d.leagueId, "vote_recruit", { token_id: ap.token_id, yes }, 30), { what: "recruit_vote", token_id: ap.token_id, yes })) {
        this.d.journal.markDone(key);
      }
    }
  }

  /** Sets a club's wage to what its treasury can pay, when that moved enough to matter. */
  private async setWage(a: Agent, clubAccount: string, ctx: Ctx, out: Partial<Entry>) {
    const club = ctx.clubs.get(clubAccount);
    if (!club) return;
    const rules = await this.league<{ max_wage?: string }>("rules");
    if (!rules.max_wage) return;
    const people = (await this.squad(ctx, clubAccount)).filter((p) => p.controller).length;
    const wage = wageFor(whole(club.treasury), people, whole(rules.max_wage));
    const now = whole(club.wage ?? "0");
    if (wage === now || (now > 0 && Math.abs(wage - now) < now / 4)) return;
    await this.act(a, out, () => this.d.as(a).call(this.d.leagueId, "set_wage", { club_id: clubAccount, wage: (BigInt(wage) * ONE_G).toString() }, 30), { what: "wage", wage });
  }

  private async buyPack(f: FootballerAgent, fb: LeaguePlayer, out: Partial<Entry>, price: bigint) {
    const me = this.d.as(f);
    const ok = await this.act(
      f,
      out,
      () => me.callChecked!(this.d.goalarsId, "ft_transfer_call", { receiver_id: this.d.leagueId, amount: price.toString(), msg: JSON.stringify({ pack: {} }) }, 150, ONE_YOCTO),
      { what: "pack", items: [] },
    );
    if (!ok) return;
    const items = await this.league<string[]>("last_unboxed", { account_id: f.account });
    const act = out.acts!.at(-1);
    if (act?.what === "pack") act.items = items;
    // Wear what is new on an empty slot, or rarer than what he wears.
    const catalog = await this.league<{ id: string; kind: string; rarity: string }[]>("catalog");
    const RANK = ["common", "rare", "epic", "legendary"];
    const rarity = (id: string | null | undefined) => (id ? RANK.indexOf(catalog.find((c) => c.id === id)?.rarity ?? "common") : -1);
    const look = fb.look ?? { hair: null, boots: null, band: null };
    for (const kind of ["hair", "boots", "band"] as const) {
      const best = items.filter((i) => i.startsWith(`${kind}.`)).sort((a, b) => rarity(b) - rarity(a))[0];
      if (best && rarity(best) > rarity(look[kind])) {
        await this.act(f, out, () => me.callChecked!(this.d.leagueId, "equip", { token_id: fb.token_id, item: best }, 100), { what: "equipped", item: best });
      }
    }
  }

  /** The price of his club's season ticket, if it has some left and he holds none this season. */
  private async seasonTicketOffer(ctx: Ctx, f: FootballerAgent, club: string, rules: { season_ticket_price?: string; season_tickets_per_club?: number }): Promise<number | null> {
    if (!this.d.ticketsId || !rules.season_ticket_price) return null;
    const sold = await this.league<number>("season_tickets_sold", { club_id: club, season: ctx.season });
    if (sold >= (rules.season_tickets_per_club ?? 50)) return null;
    const mine = await this.view<{ club: string; season: number }[]>(this.d.ticketsId, "tickets_of", { account_id: f.account });
    if (mine.some((t) => t.club === club && t.season === ctx.season)) return null;
    return whole(rules.season_ticket_price);
  }

  // ---- Market data ----

  /** Reads offers made since the last look, and what became of the open ones. */
  private async scanOffers() {
    const j = this.d.journal;
    for (const o of Object.values(j.offers)) {
      if (o.state !== "Open" && o.state !== "Accepting") continue;
      const now = await this.league<Offer | null>("get_offer", { offer_id: o.id });
      if (now) o.state = now.state;
    }
    for (let n = 0; n < 200; n++) {
      const o = await this.league<Offer | null>("get_offer", { offer_id: j.cursor });
      if (!o) break;
      const p = await this.league<Player | null>("get_player", { token_id: o.token_id });
      const seen: SeenOffer = { ...o, ...(p ? { position: p.position, overall: p.overall } : {}) };
      j.offers[String(o.id)] = seen;
      j.cursor = o.id + 1;
    }
  }

  private marketData(day: number): Market {
    const all = Object.values(this.d.journal.offers);
    const sales = all
      .filter((o) => o.state === "Sold" && o.position && o.overall !== undefined && day - o.match_day <= 30)
      .map((o) => ({ position: o.position as Position, overall: o.overall!, price: whole(o.price), match_day: o.match_day }));
    const openBids: Market["openBids"] = {};
    for (const o of all) {
      if (o.state === "Open" && o.position && day - o.match_day <= STALE_BID_DAYS) {
        const k = o.position as Position;
        openBids[k] = (openBids[k] ?? 0) + 1;
      }
    }
    return { sales, openBids };
  }

  /** Players a club could bid on: the other squads and the free agents among the agents. */
  private async others(ctx: Ctx, club: string): Promise<Player[]> {
    const out: Player[] = [];
    for (const c of ctx.table) if (c.manager !== club) out.push(...(await this.squad(ctx, c.manager)));
    for (const f of this.footballers) {
      if (f.startsAt) continue;
      const fb = await this.league<LeaguePlayer | null>("footballer_of", { account_id: f.account });
      if (fb && !ctx.clubs.has(fb.owner)) out.push(fb);
    }
    return out;
  }

  // ---- Helpers ----

  private async squad(ctx: Ctx, club: string): Promise<Player[]> {
    let p = ctx.squads.get(club);
    if (!p) ctx.squads.set(club, (p = this.league<LeaguePlayer[]>("squad", { account_id: club })));
    return p;
  }
  private async lineup(ctx: Ctx, club: string): Promise<Lineup> {
    let p = ctx.lineups.get(club);
    if (!p) ctx.lineups.set(club, (p = this.league<Lineup>("lineup", { club_id: club })));
    return p;
  }
  private rank(ctx: Ctx, club: string) {
    const c = ctx.clubs.get(club);
    const div = ctx.table.filter((x) => x.division === c?.division);
    return div.findIndex((x) => x.manager === club) + 1;
  }
  private divisionSize(ctx: Ctx, club: string) {
    const c = ctx.clubs.get(club);
    return ctx.table.filter((x) => x.division === c?.division).length;
  }

  private async topUp(a: Agent) {
    const balance = await this.d.chain.balance(a.account);
    if (balance === null || balance >= LOW_NEAR) return;
    const key = `${a.account}:${Math.floor(this.now() / 86_400_000)}`;
    if ((this.topUps.get(key) ?? 0) >= 2) return;
    this.topUps.set(key, (this.topUps.get(key) ?? 0) + 1);
    await this.d.chain.transfer(a.account, TOP_UP_NEAR).catch((e) => console.error(`agents: top-up of ${a.account}: ${msg(e)}`));
  }

  /** Runs one transaction; records it, or its error. */
  private async act(a: Agent, out: Partial<Entry>, run: () => Promise<string>, what: Act): Promise<boolean> {
    try {
      const tx = await run();
      out.txs!.push(tx);
      out.acts!.push(what);
      return true;
    } catch (e) {
      out.errors!.push(`${what.what}: ${msg(e)}`);
      return false;
    }
  }

  private async once(key: string, run: () => Promise<void>) {
    if (this.d.journal.isDone(key)) return;
    try {
      await run();
      this.d.journal.markDone(key);
      this.d.journal.save(); // a restart (a deploy) must not lose or repeat what was done
    } catch (e) {
      console.error(`agents: ${key}: ${msg(e)}`);
    }
  }

  private log(a: Agent, day: number, kind: Entry["kind"], e: Partial<Entry>) {
    this.d.journal.add({
      at: this.now(),
      day,
      agent: a.account,
      kind,
      ...(e.half ? { half: e.half } : {}),
      quote: e.quote ?? "",
      source: e.source ?? "rules",
      refused: e.refused ?? [],
      acts: e.acts ?? [],
      txs: e.txs ?? [],
      errors: e.errors ?? [],
      evidence: e.evidence ?? null,
      signature: null,
      ...(e.briefing ? { briefing: e.briefing } : {}),
    });
  }

  /** Fetches NEAR AI Cloud's signatures of the last ten minutes' replies. */
  private async sign() {
    if (!this.d.brain) return;
    for (const e of this.d.journal.unsigned(this.now() - 10 * 60_000).slice(0, 20)) {
      e.signature = await signatureOf(this.d.brain, e.evidence!);
    }
  }

  private async pool<T>(items: T[], run: (x: T) => Promise<void>) {
    const queue = [...items];
    const n = Math.max(1, this.d.concurrency ?? 2);
    await Promise.all(
      Array.from({ length: Math.min(n, queue.length) }, async () => {
        for (let x = queue.shift(); x !== undefined; x = queue.shift()) await run(x);
      }),
    );
  }
}

interface Ctx {
  day: number;
  season: number;
  clubs: Map<string, Club>;
  table: Club[];
  opponent: Map<string, string>;
  squads: Map<string, Promise<Player[]>>;
  lineups: Map<string, Promise<Lineup>>;
  results: MatchResult[] | null;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

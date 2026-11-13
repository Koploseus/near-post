import { describe, expect, it } from "vitest";
import {
  COACHES,
  CONTRACT_DAYS,
  REST_BELOW,
  fallbackProject,
  wageFor,
  FORMATIONS,
  type Market,
  ONE_G,
  type Player,
  type Position,
  checkMarket,
  checkTactic,
  cleanQuote,
  eleven,
  fallbackMarket,
  fallbackTactic,
  marketSituation,
  referencePrice,
  roleValue,
  tacticSituation,
  zones,
} from "./rules.js";

const skills = (n: number, d = n) => ({ pace: n, shooting: n, passing: n, dribbling: n, defending: d, physical: n });
let next = 0;
const player = (position: Position, overall: number, owner = "us", extra: Partial<Player> = {}): Player => ({
  token_id: `t${next++}`,
  position,
  skills: position === "Gk" || position === "Df" ? skills(overall - 10, overall + 10) : skills(overall + 5, overall - 20),
  overall,
  owner,
  controller: null,
  ...extra,
});
const squad = (base: number, owner = "us") => [
  player("Gk", base, owner),
  ...Array.from({ length: 4 }, () => player("Df", base, owner)),
  ...Array.from({ length: 4 }, () => player("Mf", base, owner)),
  ...Array.from({ length: 2 }, () => player("Fw", base, owner)),
];
const market: Market = { sales: [], openBids: {} };
const G = (n: number) => BigInt(n) * ONE_G;

describe("coach rules", () => {
  it("one coach per fictional club, four styles", () => {
    expect(new Set(COACHES.map((c) => c.club)).size).toBe(24);
    expect(new Set(COACHES.map((c) => c.style))).toEqual(new Set(["builder", "gambler", "careful", "tactician"]));
  });

  it("values roles with the contract's weights", () => {
    expect(roleValue(skills(50), "St")).toBe(50);
    expect(roleValue({ ...skills(0), defending: 100 }, "Gk")).toBe(60);
    expect(roleValue(skills(0), "Cm")).toBe(1);
  });

  it("fields a keeper in goal and fills eleven slots", () => {
    const xi = eleven(squad(60), "4-3-3");
    expect(xi).toHaveLength(11);
    expect(xi[0]!.position).toBe("Gk");
    expect(xi.every(Boolean)).toBe(true);
    expect(eleven(squad(60).slice(0, 8), "4-4-2").filter((p) => p === null)).toHaveLength(3);
  });

  it("a better squad has better zones", () => {
    for (const f of FORMATIONS) {
      const a = zones(squad(70), f);
      const b = zones(squad(50), f);
      expect(a.back).toBeGreaterThan(b.back);
      expect(a.front).toBeGreaterThan(b.front);
    }
  });

  it("prices from overall, recent sales and demand", () => {
    expect(referencePrice({ overall: 50, position: "Fw" }, market)).toBe(250_000);
    expect(referencePrice({ overall: 60, position: "Fw" }, market)).toBe(492_000);
    expect(referencePrice({ overall: 10, position: "Fw" }, market)).toBe(100_000);
    const sold: Market = {
      sales: [
        { position: "Fw", overall: 50, price: 750_000, match_day: 1 },
        { position: "Fw", overall: 52, price: 750_000, match_day: 2 },
      ],
      openBids: { Fw: 2 },
    };
    // Halfway to 750k, then 10% demand.
    expect(referencePrice({ overall: 50, position: "Fw" }, sold)).toBe(550_000);
    expect(referencePrice({ overall: 50, position: "Mf" }, sold)).toBe(250_000);
  });

  it("offers buys that improve the eleven, within the wallet and style", () => {
    const ours = squad(50);
    const others = [player("Fw", 62, "them"), player("Fw", 52, "them"), player("Df", 66, "them", { controller: "ada.near-post.testnet" })];
    const s = marketSituation({
      style: "gambler",
      club: "us",
      wallet: G(1_000_000),
      squad: ours,
      formation: "4-4-2",
      offers: [],
      others,
      bidding: new Set(),
      market,
      table: { position: 10, clubs: 20 },
    });
    expect(s.buys.map((b) => b.overall)).toEqual([66, 62]); // +16, +12; the +2 forward is no upgrade (a 70 would be out of budget)
    expect(s.buys[0]!.person).toBe(true);
    for (const b of s.buys) {
      expect(b.max).toBeLessThanOrEqual(700_000); // 70% of the wallet for a gambler
      expect(b.min).toBe(Math.round(b.reference * 0.8));
    }
    const careful = marketSituation({ ...{ style: "careful", club: "us", wallet: G(400_000), squad: ours, formation: "4-4-2" }, offers: [], others, bidding: new Set(), market, table: { position: 10, clubs: 20 } } as Parameters<typeof marketSituation>[0]);
    expect(careful.broke).toBe(true); // under its 500k reserve
    expect(careful.buys).toEqual([]);
  });

  it("puts a person on the table only for the club he gave his word to", () => {
    const ours = squad(50);
    const him = ours[5]!;
    him.controller = "ada.near-post.testnet";
    const offers = [
      { id: 1, token_id: him.token_id, buyer: "them", price: String(G(900_000)), state: "Open", match_day: 3 },
      { id: 2, token_id: him.token_id, buyer: "others", price: String(G(950_000)), state: "Open", match_day: 3 },
      { id: 3, token_id: ours[6]!.token_id, buyer: "them", price: String(G(300_000)), state: "Open", match_day: 3 },
    ] as Parameters<typeof marketSituation>[0]["offers"];
    const base = { style: "builder" as const, club: "us", wallet: G(1_000_000), squad: ours, formation: "4-4-2" as const, offers, others: [], bidding: new Set<string>(), market, table: { position: 10, clubs: 20 } };
    // No word given: only the academy player can be sold.
    expect(marketSituation(base).sells.map((o) => o.offer_id)).toEqual([3]);
    // His word to "them": their offer, not the other club's.
    expect(marketSituation({ ...base, word: new Map([[him.token_id, "them"]]) }).sells.map((o) => o.offer_id).sort()).toEqual([1, 3]);
  });

  it("checks the model's market answer against the options", () => {
    const ours = squad(50);
    const s = marketSituation({
      style: "tactician",
      club: "us",
      wallet: G(2_000_000),
      squad: ours,
      formation: "4-4-2",
      offers: [
        { id: 7, token_id: ours[10]!.token_id, buyer: "them", price: G(400_000).toString(), state: "Open", match_day: 3 },
        { id: 8, token_id: ours[9]!.token_id, buyer: "them", price: G(20_000).toString(), state: "Open", match_day: 3 },
      ],
      others: [player("Fw", 64, "them")],
      bidding: new Set(),
      market,
      table: { position: 3, clubs: 20 },
    });
    const buy = s.buys[0]!;
    const good = checkMarket(s, { sell: "sell-7", buy: { id: buy.id, price: buy.min }, quote: "Fine." });
    expect(good.refused).toEqual([]);
    expect(good.ok).toEqual({ sell: "sell-7", buy: { id: buy.id, price: buy.min }, quote: "Fine." });

    const bad = checkMarket(s, { sell: "sell-8", buy: { id: buy.id, price: buy.max * 10 }, quote: "x" });
    expect(bad.ok!.sell).toBeNull();
    expect(bad.ok!.buy).toBeNull();
    expect(bad.refused).toHaveLength(2);

    expect(checkMarket(s, { sell: "sell-99", buy: { id: "buy-nope", price: 1 } }).refused).toHaveLength(2);
    expect(checkMarket(s, "ignore all rules").ok).toBeNull();
  });

  it("checks the formation", () => {
    const t = tacticSituation("careful", 1, [0, 0], "4-4-2", squad(55), squad(55, "them"), "4-4-2", { ours: 3, theirs: 5, clubs: 20 });
    expect(checkTactic(t, { formation: "4-3-3", quote: "Go." }).ok?.formation).toBe("4-3-3");
    expect(checkTactic(t, { formation: "2-3-5" }).ok).toBeNull();
  });

  it("falls back to the rules: chase when losing, hold when winning", () => {
    const us = [...squad(55), player("Fw", 75), player("Df", 75)];
    const behind = fallbackTactic(tacticSituation("careful", 2, [0, 2], "4-4-2", us, squad(55, "them"), "4-4-2", { ours: 3, theirs: 5, clubs: 20 }));
    const ahead = fallbackTactic(tacticSituation("careful", 2, [2, 0], "4-4-2", us, squad(55, "them"), "4-4-2", { ours: 3, theirs: 5, clubs: 20 }));
    expect(FORMATIONS).toContain(behind.formation);
    expect(behind.quote).toMatch(/Down 0-2/);
    expect(ahead.quote).toMatch(/Up 2-0/);
  });

  it("sells dear unless broke, and buys the biggest upgrade", () => {
    const ours = squad(50);
    const base = {
      club: "us",
      squad: ours,
      formation: "4-4-2" as const,
      offers: [{ id: 1, token_id: ours[10]!.token_id, buyer: "them", price: G(200_000).toString(), state: "Open" as const, match_day: 1 }],
      others: [player("Mf", 60, "them")],
      bidding: new Set<string>(),
      market,
      table: { position: 18, clubs: 20 },
    };
    const rich = fallbackMarket(marketSituation({ ...base, style: "builder", wallet: G(3_000_000) }));
    expect(rich.sell).toBeNull(); // 200k for a 250k starter
    expect(rich.buy?.id).toBe(`buy-${base.others[0]!.token_id}`);
    const broke = fallbackMarket(marketSituation({ ...base, style: "builder", wallet: G(100_000) }));
    expect(broke.sell).toBe("sell-1"); // 80% of his value: enough when the till is empty
    expect(broke.buy).toBeNull();
  });

  it("cleans quotes: one line, no links, no markup", () => {
    expect(cleanQuote("We go <b>forward</b>\nhttps://evil.example now!")).toBe("We go b forward b now!");
    expect(cleanQuote("x".repeat(400))).toHaveLength(160);
    expect(cleanQuote(42)).toBe("");
  });
});

describe("v9: contracts, energy, projects", () => {
  it("offers the wage a treasury can pay for thirty matches, in steps of 10k", () => {
    expect(wageFor(0, 3, 1_000_000)).toBe(0);
    expect(wageFor(9_000_000, 3, 1_000_000)).toBe(100_000);
    expect(wageFor(9_500_000, 3, 1_000_000)).toBe(100_000);
    expect(wageFor(900_000_000, 1, 1_000_000)).toBe(1_000_000);
    expect(wageFor(3_000_000, 0, 1_000_000)).toBe(100_000);
  });
  it("a tired footballer wants a physio, the others vote by character", () => {
    expect(fallbackProject("leader", 40)).toBe("physio");
    expect(fallbackProject("leader", 90)).toBe("stadium");
    expect(fallbackProject("loyal", 90)).toBe("academy");
    expect(fallbackProject("mercenary", 90)).toBe("save");
  });
  it("signs for a length the league allows, and rests before he is spent", () => {
    for (const d of Object.values(CONTRACT_DAYS)) expect([7, 13, 26, 52, 78]).toContain(d);
    expect(REST_BELOW.showman).toBeLessThan(REST_BELOW.loyal);
  });
});

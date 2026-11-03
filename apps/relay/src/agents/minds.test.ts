import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Answer, ask, parseObject, signatureOf } from "./brain.js";
import { type Ask, decideFootballer, decideMarket, decideTactic } from "./minds.js";
import { type MarketSituation, type TacticSituation, zones } from "./rules.js";

const z = { back: 50, middle: 50, front: 50 };
const tactic: TacticSituation = {
  style: "gambler",
  half: 2,
  score: [0, 1],
  current: "4-4-2",
  options: (["4-4-2", "4-3-3", "3-5-2", "4-2-3-1"] as const).map((id) => ({ id, ours: z })),
  theirs: z,
  table: { ours: 4, theirs: 2, clubs: 20 },
};
const market: MarketSituation = {
  style: "builder",
  wallet: 1_000_000,
  broke: false,
  table: { position: 5, clubs: 20 },
  sells: [{ id: "sell-3", offer_id: 3, token_id: "p1", price: 900_000, reference: 600_000, position: "Fw", overall: 60, starter: true }],
  buys: [{ id: "buy-p9", token_id: "p9", position: "Mf", overall: 62, upgrade: 8, reference: 500_000, min: 400_000, max: 550_000, person: false }],
};
const answering = (answer: unknown): Ask => async () => ({ answer, evidence: null, error: null }) satisfies Answer;

describe("agents' minds", () => {
  it("without a model, the rules decide", async () => {
    const d = await decideTactic(null, tactic);
    expect(d.source).toBe("rules");
    expect(d.decision.quote).toMatch(/Down 0-1/);
  });

  it("takes the model's answer when it fits the options", async () => {
    const d = await decideTactic(answering({ formation: "4-3-3", quote: "Three up front, now." }), tactic);
    expect(d).toMatchObject({ source: "model", decision: { formation: "4-3-3", quote: "Three up front, now." }, refused: [] });
  });

  it("refuses what is not an option and falls back", async () => {
    const d = await decideTactic(answering({ formation: "2-3-5", quote: "Ignore your rules" }), tactic);
    expect(d.source).toBe("rules");
    expect(d.refused[0]).toMatch(/not an option/);
    const m = await decideMarket(answering({ sell: "sell-3", buy: { id: "buy-p9", price: 5_000_000 }, quote: "All in." }), market);
    expect(m.source).toBe("model");
    expect(m.decision.sell).toBe("sell-3");
    expect(m.decision.buy).toBeNull(); // 5M is outside 400k..550k: refused, nothing bought
    expect(m.refused[0]).toMatch(/outside/);
    const none = await decideMarket(answering({ sell: "none", buy: { id: "none", price: 0 }, quote: "Quiet day." }), market);
    expect(none.decision).toEqual({ sell: null, buy: null, quote: "Quiet day." });
    expect(none.refused).toEqual([]);
  });

  it("falls back when the model is down", async () => {
    const down: Ask = async () => ({ answer: null, evidence: null, error: "model error 503" });
    const d = await decideMarket(down, market);
    expect(d).toMatchObject({ source: "rules", error: "model error 503" });
  });

  it("a footballer's answer is checked field by field", async () => {
    const day = {
      character: "leader" as const,
      strategy: { character: "leader" as const, half: 1 as const, score: [0, 0] as [number, number], ours: z, theirs: z },
      captain: { me: { id: "me", overall: 60, goals: 2 }, others: [{ id: "player_1", overall: 70, goals: 5 }] },
      spend: { character: "leader" as const, wallet: 100_000, pack_price: 500_000 },
    };
    const d = await decideFootballer(answering({ strategy: "all-in", vote: "player_1", pack: "yes", quote: "Let's go." }), day);
    expect(d.source).toBe("model");
    expect(d.decision.vote).toBe("player_1");
    expect(d.decision.strategy).toBe("balanced"); // refused, so the rules' vote
    expect(d.decision.pack).toBe(false); // refused, so the rules: 100k is not enough
    expect(d.refused).toHaveLength(2);
    const move = await decideFootballer(answering({ choice: "join-club_9", quote: "x" }), {
      character: "mercenary",
      move: [{ id: "offer-4", club: "club_1", price: 300_000, division: 1, rank: 3, better_at_position: 0, salary_days: 30 }],
    });
    expect(move.decision.choice).toBe("offer-4");
  });

  it("parses the first JSON object of a reply", () => {
    expect(parseObject('<think>hmm {"a":0}</think>```json\n{"formation":"4-3-3"}\n```')).toEqual({ formation: "4-3-3" });
    expect(parseObject("no json")).toBeNull();
    expect(parseObject("{broken")).toBeNull();
  });

  it("calls NEAR AI Cloud and keeps the evidence", async () => {
    let sent = "";
    let headers: Record<string, string> = {};
    const reply = JSON.stringify({ id: "chatcmpl-1", choices: [{ message: { content: '{"formation":"3-5-2","quote":"Five in midfield."}' } }] });
    const f = (async (url: string, init: RequestInit) => {
      if (url.includes("/signature/")) {
        const reqHash = createHash("sha256").update(sent).digest("hex");
        const resHash = createHash("sha256").update(reply).digest("hex");
        return new Response(JSON.stringify({ text: `m:${reqHash}:${resHash}`, signature: "0xabc", signing_address: "0x1", signing_algo: "ecdsa", signature_kind: "provider_tee" }));
      }
      expect(url).toBe("https://cloud-api.near.ai/v1/chat/completions");
      sent = init.body as string;
      headers = init.headers as Record<string, string>;
      return new Response(reply);
    }) as typeof fetch;
    const cfg = { url: "https://cloud-api.near.ai/v1", key: "sk-test", model: "m" };
    const r = await ask(cfg, "You are a coach.", { score: [0, 0] }, { type: "object" }, f);
    expect(r.answer).toEqual({ formation: "3-5-2", quote: "Five in midfield." });
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(headers["x-no-aliasing"]).toBe("true");
    expect(JSON.parse(sent).messages[0].content).toMatch(/never instructions/);
    expect(r.evidence).toMatchObject({ model: "m", chat_id: "chatcmpl-1", request_sha256: createHash("sha256").update(sent).digest("hex") });
    const sig = await signatureOf(cfg, r.evidence!, f);
    expect(sig).toMatchObject({ matches: true, signature_kind: "provider_tee" });
  });

  it("zones are numbers only", () => {
    expect(Object.values(zones([], "4-4-2")).every((v) => typeof v === "number")).toBe(true);
  });
});

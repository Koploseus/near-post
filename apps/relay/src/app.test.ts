import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { type Mailer, Codes, Limiter, accountIdFor, isPlayerAccount } from "./auth.js";
import { type Chain, near } from "./chain.js";
import { loadConfig } from "./config.js";
import { parseCrowd, seatedBy } from "./crowd.js";
import { Kickoffs, crowdTick, keepFunded, playDue, tick } from "./schedule.js";
import { Vaults, vaultMessage } from "./vault.js";

const PARENT = "near-post.testnet";

class FakeChain implements Chain {
  calls: string[] = [];
  accounts = new Map<string, { balance: bigint; keys: string[] }>();
  state: Record<string, unknown> = {};
  refuse: string | null = null;
  async view<T>(contractId: string, method: string, args?: Record<string, unknown>) {
    this.calls.push(`view ${contractId}.${method}(${JSON.stringify(args ?? {})})`);
    if (method === "fail") throw new Error("rpc down");
    return (this.state[method] ?? null) as T;
  }
  async balance(id: string) {
    return this.accounts.get(id)?.balance ?? null;
  }
  async hasKey(id: string, key: string) {
    return this.accounts.get(id)?.keys.includes(key) ?? false;
  }
  async freeBalance(id: string) {
    return this.accounts.get(id)?.balance ?? null;
  }
  async createAccount(id: string, key: string, yocto: bigint) {
    this.calls.push(`create ${id}`);
    this.accounts.set(id, { balance: yocto, keys: [key] });
    return "tx-create";
  }
  async transfer(id: string, yocto: bigint) {
    this.calls.push(`transfer ${id} ${yocto}`);
    const a = this.accounts.get(id)!;
    a.balance += yocto;
    return "tx-transfer";
  }
  relayed: unknown[] = [];
  async relay(signed: unknown) {
    this.relayed.push(signed);
    return { hash: "tx-relayed", value: null, error: null };
  }
  async call(contractId: string, method: string) {
    if (this.refuse) throw new Error(this.refuse);
    this.calls.push(`call ${contractId}.${method}`);
    return "tx-call";
  }
}

function mailbox() {
  const sent: { to: string; text: string }[] = [];
  const mailer: Mailer = {
    async send(to, _subject, text) {
      sent.push({ to, text });
    },
  };
  const lastCode = () => sent.at(-1)!.text.match(/\d{6}/)![0];
  return { sent, mailer, lastCode };
}

const config = loadConfig({ LEAGUE_ID: "league-v3.near-post.testnet" });
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, ip = "1.2.3.4") =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
const newKey = () => KeyPair.fromRandom("ed25519").getPublicKey().toString();

describe("email login", () => {
  it("derives one account per email, case-insensitive, without the email on chain", () => {
    const a = accountIdFor(" Koplo@Example.com ", PARENT);
    expect(a).toBe(accountIdFor("koplo@example.com", PARENT));
    expect(a).not.toContain("koplo");
    expect(isPlayerAccount(a, PARENT)).toBe(true);
    expect(isPlayerAccount("near-post.testnet", PARENT)).toBe(false);
    expect(isPlayerAccount("u0123456789abcdef.evil.testnet", PARENT)).toBe(false);
  });

  it("sends a code, then creates the account with the browser's key and some gas", async () => {
    const chain = new FakeChain();
    const box = mailbox();
    const app = createApp(config, chain, { mailer: box.mailer });
    const start = await post(app, "/v1/auth/start", { email: "koplo@example.com" });
    expect(start.status).toBe(200);
    const { account_id, code } = (await start.json()) as { account_id: string; code?: string };
    expect(code).toBeUndefined(); // never in the response by default
    expect(box.sent[0]!.to).toBe("koplo@example.com");
    const key = newKey();
    const verify = await post(app, "/v1/auth/verify", { email: "koplo@example.com", code: box.lastCode(), public_key: key });
    expect(await verify.json()).toEqual({ account_id, created: true, tx: "tx-create" });
    expect(chain.accounts.get(account_id)).toEqual({ balance: near("0.3"), keys: [key] });
  });

  it("a returning player gets his account back, and learns if this browser holds its key", async () => {
    const chain = new FakeChain();
    const box = mailbox();
    const app = createApp(config, chain, { mailer: box.mailer });
    const key = newKey();
    for (const k of [key, newKey()]) {
      await post(app, "/v1/auth/start", { email: "a@b.co" });
      const r = (await (await post(app, "/v1/auth/verify", { email: "a@b.co", code: box.lastCode(), public_key: k })).json()) as Record<string, unknown>;
      if (k === key) expect(r.created).toBe(true);
      else expect(r).toMatchObject({ created: false, key_on_account: false });
    }
    expect(chain.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
  });

  it("refuses a wrong code, and the code dies after five tries", async () => {
    const box = mailbox();
    const app = createApp(config, new FakeChain(), { mailer: box.mailer });
    await post(app, "/v1/auth/start", { email: "a@b.co" });
    const right = box.lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await post(app, "/v1/auth/verify", { email: "a@b.co", code: wrong, public_key: newKey() });
      expect(r.status).toBe(401);
    }
    const late = await post(app, "/v1/auth/verify", { email: "a@b.co", code: right, public_key: newKey() });
    expect(late.status).toBe(401);
  });

  it("codes expire", () => {
    let t = 0;
    const codes = new Codes(1_000, 5, () => t);
    const code = codes.issue("a@b.co");
    t = 1_001;
    expect(codes.verify("a@b.co", code)).toBe(false);
  });

  it("a code works once", () => {
    const codes = new Codes(60_000);
    const code = codes.issue("a@b.co");
    expect(codes.verify("A@B.co", code)).toBe(true);
    expect(codes.verify("a@b.co", code)).toBe(false);
  });

  it("rejects bad input before touching the chain", async () => {
    const chain = new FakeChain();
    const app = createApp(config, chain, { mailer: mailbox().mailer });
    expect((await post(app, "/v1/auth/start", { email: "not an email" })).status).toBe(400);
    const r = await post(app, "/v1/auth/verify", { email: "a@b.co", code: "123456", public_key: "ed25519:nope" });
    expect(r.status).toBe(400);
    expect(chain.calls).toEqual([]);
  });

  it("limits code requests per email", async () => {
    const app = createApp(config, new FakeChain(), { mailer: mailbox().mailer });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(app, "/v1/auth/start", { email: "spam@b.co" }, `10.0.0.${i}`)).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });

  it("behind Fly, limits by Fly's client IP, not a spoofed x-forwarded-for", async () => {
    const fly = loadConfig({ LEAGUE_ID: "league-v3.near-post.testnet", CLIENT_IP_HEADER: "Fly-Client-IP" });
    const app = createApp(fly, new FakeChain(), { mailer: mailbox().mailer });
    const send = (i: number) =>
      app.request("/v1/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.9.9.${i}`, "fly-client-ip": "203.0.113.7" },
        body: JSON.stringify({ email: `p${i}@b.co` }),
      });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await send(i)).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("returns the code only when the insecure dev flag is on", async () => {
    const dev = loadConfig({ INSECURE_DEV_RETURN_CODE: "true" });
    const r = await post(createApp(dev, new FakeChain(), { mailer: mailbox().mailer }), "/v1/auth/start", { email: "a@b.co" });
    expect(((await r.json()) as { code?: string }).code).toMatch(/^\d{6}$/);
  });
});

describe("gas top-up", () => {
  async function player(chain: FakeChain, balance: bigint) {
    const id = accountIdFor("p@b.co", PARENT);
    chain.accounts.set(id, { balance, keys: [] });
    return id;
  }

  it("tops up a nearly empty player account, a few times a day", async () => {
    const chain = new FakeChain();
    const app = createApp(config, chain, { mailer: mailbox().mailer });
    const id = await player(chain, near("0.01"));
    expect((await post(app, `/v1/accounts/${id}/topup`, {})).status).toBe(200);
    chain.accounts.get(id)!.balance = near("0.01");
    expect((await post(app, `/v1/accounts/${id}/topup`, {})).status).toBe(200);
    chain.accounts.get(id)!.balance = near("0.01");
    expect((await post(app, `/v1/accounts/${id}/topup`, {})).status).toBe(429);
  });

  it("does not top up an account that has enough, or one that is not a player's", async () => {
    const chain = new FakeChain();
    const app = createApp(config, chain, { mailer: mailbox().mailer });
    const id = await player(chain, near("0.2"));
    expect((await post(app, `/v1/accounts/${id}/topup`, {})).status).toBe(409);
    chain.accounts.set("league-v3.near-post.testnet", { balance: 0n, keys: [] });
    expect((await post(app, "/v1/accounts/league-v3.near-post.testnet/topup", {})).status).toBe(400);
    expect(chain.calls.filter((c) => c.startsWith("transfer"))).toEqual([]);
  });
});

describe("match days", () => {
  it("plays the match day only when it is due", async () => {
    const chain = new FakeChain();
    chain.state.schedule = { next_match_at_ms: "1000" };
    expect(await tick(chain, "league", 999)).toBeNull();
    expect(await tick(chain, "league", 1000)).toBe("tx-call");
    expect(chain.calls.at(-1)).toBe("call league.play_match_day");
  });

  it("calls again while divisions are still due, and stops", async () => {
    const chain = new FakeChain();
    // Three calls due (two divisions' first halves, then nothing until half-time).
    let due = 3;
    chain.state.schedule = { next_match_at_ms: "0" };
    const call = chain.call.bind(chain);
    chain.call = async (...args: Parameters<typeof call>) => {
      if (--due <= 0) chain.state.schedule = { next_match_at_ms: "99999" };
      return call(...args);
    };
    expect(await playDue(chain, "league", 24, () => 1000)).toHaveLength(3);
    expect(await playDue(chain, "league", 24, () => 1000)).toHaveLength(0);
  });

  it("records when each half first reached the chain, and serves it with the time", async () => {
    const chain = new FakeChain();
    const kickoffs = new Kickoffs();
    chain.state.schedule = { next_match_at_ms: "0", match_day: 7, first_half_played: false };
    const call = chain.call.bind(chain);
    let calls = 0;
    chain.call = async (...args: Parameters<typeof call>) => {
      calls++;
      // Two divisions: two first halves, then the day waits for half-time.
      if (calls === 2) chain.state.schedule = { next_match_at_ms: "99999", match_day: 7, first_half_played: true };
      return call(...args);
    };
    let t = 1_000;
    await playDue(chain, "league", 24, () => (t += 500), kickoffs);
    expect(kickoffs.get(7)).toEqual({ first: 2_000, second: null }); // after the first call returns
    chain.state.schedule = { next_match_at_ms: "0", match_day: 7, first_half_played: true };
    calls = 10;
    chain.call = async (...args: Parameters<typeof call>) => {
      chain.state.schedule = { next_match_at_ms: "99999999", match_day: 8, first_half_played: false };
      return call(...args);
    };
    await playDue(chain, "league", 24, () => (t += 500), kickoffs);
    expect(kickoffs.get(7).second).toBeGreaterThan(2_000);
    const app = createApp(loadConfig({}), chain, { mailer: mailbox().mailer, kickoffs, now: () => 42 });
    expect(await (await app.request("/v1/time")).json()).toEqual({ now: 42 });
    expect(await (await app.request("/v1/kickoffs/7")).json()).toEqual(kickoffs.get(7));
    expect(await (await app.request("/v1/kickoffs/99")).json()).toEqual({ first: null, second: null });
    expect((await app.request("/v1/kickoffs/x")).status).toBe(400);
  });
});

describe("demo crowd", () => {
  const clubs = parseCrowd("rive-nord:5,port-lune:3", PARENT);

  it("parses the crowd spec into club and fan accounts", () => {
    expect(clubs[0]).toEqual({
      club: "rive-nord.near-post.testnet",
      fans: [1, 2, 3, 4, 5].map((n) => `rive-nord-f${n}.near-post.testnet`),
    });
    expect(() => parseCrowd("evil.club:2", PARENT)).toThrow();
    expect(() => parseCrowd("ok:0", PARENT)).toThrow();
  });

  it("fans arrive through the day, all of them seated by 80%, none on off days", () => {
    const day = 9;
    const early = seatedBy(clubs[0]!, day, 0.1, 3);
    const late = seatedBy(clubs[0]!, day, 0.8, 3);
    expect(late.length).toBeGreaterThanOrEqual(early.length);
    expect(early.every((f) => late.includes(f))).toBe(true);
    expect(seatedBy(clubs[0]!, day, 1, 3)).toEqual(late);
    expect(seatedBy(clubs[0]!, 10, 1, 3)).toEqual([]);
  });

  it("moods differ between clubs and days", () => {
    const sizes = new Set<number>();
    for (let d = 3; d <= 60; d += 3) sizes.add(seatedBy(parseCrowd("x:20", PARENT)[0]!, d, 1, 3).length);
    expect(sizes.size).toBeGreaterThan(3);
  });

  it("seats each fan once per day, signed as that fan", async () => {
    const chain = new FakeChain();
    chain.state.schedule = { match_day: 9, next_match_at_ms: "1000", interval_ms: "1000" };
    const fanChains = new Map<string, FakeChain>();
    const asFan = (f: string) => fanChains.get(f) ?? (fanChains.set(f, new FakeChain()), fanChains.get(f)!);
    const done = new Set<string>();
    const first = await crowdTick(chain, asFan, "league", clubs, 3, done, 1000);
    const again = await crowdTick(chain, asFan, "league", clubs, 3, done, 1000);
    expect(first.length).toBeGreaterThan(0);
    expect(again).toEqual([]);
    for (const f of first) expect(fanChains.get(f)!.calls).toEqual(["call league.check_in"]);
  });

  it("tops up a contract whose free storage balance runs low", async () => {
    const chain = new FakeChain();
    chain.accounts.set("league", { balance: near("1"), keys: [] });
    chain.accounts.set("players", { balance: near("9"), keys: [] });
    expect(await keepFunded(chain, ["league", "players", "missing"], near("2"), near("5"))).toEqual(["league"]);
    expect(chain.calls).toEqual([`transfer league ${near("5")}`]);
  });
});

describe("league reads", () => {
  it("answers health without a league", async () => {
    const app = createApp(loadConfig({}), new FakeChain(), { mailer: mailbox().mailer });
    expect(await (await app.request("/health")).json()).toEqual({ status: "ok", network: "testnet" });
    expect((await app.request("/v1/rules")).status).toBe(503);
  });

  it("reads rules and stands, rejecting malformed ids", async () => {
    const chain = new FakeChain();
    chain.state = { rules: { stadium_target_bps: 6000 }, get_club: { name: "Rive Nord" }, stand: { full_house: true } };
    const app = createApp(config, chain, { mailer: mailbox().mailer });
    expect(await (await app.request("/v1/rules")).json()).toEqual({ stadium_target_bps: 6000 });
    expect((await app.request("/v1/clubs/NOT%20AN%20ID/stand")).status).toBe(400);
    expect(await (await app.request("/v1/clubs/rive-nord.near-post.testnet/stand")).json()).toEqual({ full_house: true });
  });

  it("limiter windows reset", () => {
    let t = 0;
    const l = new Limiter(1, 10, () => t);
    expect([l.allow("k"), l.allow("k")]).toEqual([true, false]);
    t = 10;
    expect(l.allow("k")).toBe(true);
  });
});

describe("passkey backups", () => {
  const b64url = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 7 + n) % 256)).toString("base64url");
  const entry = { credential_id: b64url(32), salt: b64url(32), iv: b64url(12), ciphertext: b64url(120) };

  async function signedUp() {
    const chain = new FakeChain();
    const box = mailbox();
    const vaults = new Vaults(null);
    let t = 1_000_000;
    const app = createApp(config, chain, { mailer: box.mailer, vaults, now: () => t });
    const kp = KeyPair.fromRandom("ed25519");
    await post(app, "/v1/auth/start", { email: "k@example.com" });
    const r = (await (await post(app, "/v1/auth/verify", { email: "k@example.com", code: box.lastCode(), public_key: kp.getPublicKey().toString() })).json()) as { account_id: string };
    const sign = (e: typeof entry, ts = t, key = kp) =>
      Buffer.from(key.sign(new TextEncoder().encode(vaultMessage(r.account_id, ts, e))).signature).toString("base64");
    return { chain, box, app, kp, account: r.account_id, sign, vaults, wait: (ms: number) => (t += ms), now: () => t };
  }

  it("stores a backup signed by a key of the account, and hands it back after the email code", async () => {
    const { app, kp, account, sign, box, now } = await signedUp();
    const r = await post(app, "/v1/vault", { ...entry, account_id: account, public_key: kp.getPublicKey().toString(), ts: now(), signature: sign(entry) });
    expect(r.status).toBe(200);
    expect(await (await app.request(`/v1/vault/${account}`)).json()).toEqual({ passkeys: 1 });
    // A new device: its own key is not on the account, so it gets the backups.
    await post(app, "/v1/auth/start", { email: "k@example.com" });
    const v = (await (await post(app, "/v1/auth/verify", { email: "k@example.com", code: box.lastCode(), public_key: newKey() })).json()) as { vaults: unknown[]; key_on_account: boolean };
    expect(v.key_on_account).toBe(false);
    expect(v.vaults).toEqual([entry]);
    // Without the code, nothing.
    const w = await post(app, "/v1/auth/verify", { email: "k@example.com", code: "000000", public_key: newKey() });
    expect(w.status).toBe(401);
  });

  it("refuses a backup not signed by a key of that account, or stale", async () => {
    const { app, kp, account, sign, now, wait } = await signedUp();
    const stranger = KeyPair.fromRandom("ed25519");
    const forged = await post(app, "/v1/vault", { ...entry, account_id: account, public_key: stranger.getPublicKey().toString(), ts: now(), signature: sign(entry, now(), stranger) });
    expect(forged.status).toBe(401);
    const tampered = await post(app, "/v1/vault", { ...entry, ciphertext: b64url(121), account_id: account, public_key: kp.getPublicKey().toString(), ts: now(), signature: sign(entry) });
    expect(tampered.status).toBe(401);
    const ts = now();
    wait(6 * 60_000);
    const stale = await post(app, "/v1/vault", { ...entry, account_id: account, public_key: kp.getPublicKey().toString(), ts, signature: sign(entry, ts) });
    expect(stale.status).toBe(401);
    const notPlayer = await post(app, "/v1/vault", { ...entry, account_id: "near-post.testnet", public_key: kp.getPublicKey().toString(), ts: now(), signature: sign(entry) });
    expect(notPlayer.status).toBe(400);
  });

  it("survives a restart (the file on the volume)", async () => {
    const dir = await import("node:fs").then((fs) => fs.mkdtempSync(`${(process.env.TMPDIR ?? "/tmp").replace(/\/$/, "")}/np-vault-`));
    const file = `${dir}/data/vaults.json`;
    new Vaults(file).put("u2.near-post.testnet", { ...entry, created_ms: 1 });
    expect(new Vaults(file).get("u2.near-post.testnet")).toHaveLength(1);
  });

  it("keeps five passkeys at most, the newest", async () => {
    const vaults = new Vaults(null);
    for (let i = 0; i < 7; i++) vaults.put("u1.near-post.testnet", { ...entry, credential_id: b64url(20 + i), created_ms: i });
    expect(vaults.get("u1.near-post.testnet").map((e) => e.created_ms)).toEqual([2, 3, 4, 5, 6]);
  });
});

import { KeyPair, KeyPairSigner, actions, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { Chain } from "./chain.js";
import { loadConfig } from "./config.js";
import { decodeSignedDelegate } from "./gasless.js";

const LEAGUE = "league-v4.near-post.testnet";
const PLAYER = "u0123456789abcdef.near-post.testnet";
const key = KeyPair.fromRandom("ed25519");

async function signed(opts: { sender?: string; receiver?: string; method?: string; gas?: bigint; deposit?: bigint; extra?: boolean } = {}) {
  const fc = actions.functionCall(opts.method ?? "check_in", {}, opts.gas ?? 30n * 10n ** 12n, opts.deposit ?? 0n);
  const da = buildDelegateAction({
    senderId: opts.sender ?? PLAYER,
    receiverId: opts.receiver ?? LEAGUE,
    actions: opts.extra ? [fc, actions.transfer(1n)] : [fc],
    nonce: 1n,
    maxBlockHeight: 1000n,
    publicKey: key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(da);
  return Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
}

function setup() {
  const relayed: unknown[] = [];
  const chain = {
    async relay(sd: unknown) {
      relayed.push(sd);
      return { hash: "tx-relayed", value: null, error: null };
    },
  } as unknown as Chain;
  const app = createApp(loadConfig({ LEAGUE_ID: LEAGUE, RELAYED_PER_DAY: "2" }), chain, { mailer: { async send() {} } });
  const post = async (b64: string) =>
    app.request("/v1/relay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed_delegate: b64 }) });
  return { post, relayed };
}

describe("the relay pays the gas", () => {
  it("round-trips a signed delegate action", async () => {
    const sd = decodeSignedDelegate(await signed());
    expect(sd.delegateAction.senderId).toBe(PLAYER);
    expect(sd.delegateAction.actions[0]!.functionCall!.methodName).toBe("check_in");
  });

  it("relays a player's call to our contracts, a few times a day", async () => {
    const { post, relayed } = setup();
    const r = await post(await signed());
    expect(await r.json()).toEqual({ hash: "tx-relayed", value: null, error: null });
    expect((await post(await signed({ receiver: "goalars-v4.near-post.testnet", method: "ft_transfer_call", deposit: 1n }))).status).toBe(200);
    expect((await post(await signed())).status).toBe(429);
    expect(relayed).toHaveLength(2);
  });

  it("refuses other accounts, contracts, methods, big gas or deposits", async () => {
    const { post, relayed } = setup();
    const cases: [Parameters<typeof signed>[0], string][] = [
      [{ sender: "someone.testnet" }, "not_a_player_account"],
      [{ receiver: "evil.testnet" }, "contract_not_allowed"],
      [{ method: "new" }, "method_not_allowed"],
      [{ receiver: "goalars-v4.near-post.testnet", method: "mint" }, "method_not_allowed"],
      [{ gas: 301n * 10n ** 12n }, "too_much_gas"],
      [{ receiver: "players-v4.near-post.testnet", method: "nft_approve", deposit: 10n ** 24n }, "deposit_too_large"],
      [{ extra: true }, "function_calls_only"],
    ];
    for (const [opts, error] of cases) {
      const r = await post(await signed(opts));
      expect([r.status, ((await r.json()) as { error: string }).error]).toEqual([403, error]);
    }
    expect((await post("not base64 borsh")).status).toBe(400);
    expect(relayed).toEqual([]);
  });
});

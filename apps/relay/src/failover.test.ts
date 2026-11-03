import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { failover, rpcChain } from "./chain.js";

/** A fake RPC: answers every call with `reply(method)` and counts the calls. */
function rpc(reply: (method: string) => unknown, status = 200) {
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method } = JSON.parse(body) as { id: number; method: string };
      calls.push(method);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, ...(reply(method) as object) }));
    });
  }).listen(0);
  return { server, calls, url: () => `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

// FastNEAR answers a rate limit with HTTP 429 and this body.
const limited = rpc(() => ({ error: { code: -429, message: "Rate limits exceeded" } }), 429);
const account = { amount: "5000000000000000000000000", locked: "0", code_hash: "11111111111111111111111111111111", storage_usage: 100, storage_paid_at: 0, block_height: 1, block_hash: "11111111111111111111111111111111" };
const healthy = rpc(() => ({ result: account }));
const missing = rpc(() => ({
  error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} }, code: -32000, message: "Server error", data: "account nobody.testnet does not exist while viewing" },
}));
afterAll(() => [limited, healthy, missing].forEach((r) => r.server.close()));

describe("RPC failover", () => {
  it("moves to the next RPC on a rate limit", async () => {
    const p = failover([limited.url(), healthy.url()]);
    const a = await p.viewAccount({ accountId: "someone.testnet" });
    expect(String(a.amount)).toBe(account.amount);
    expect(limited.calls.length).toBeGreaterThan(0);
    expect(healthy.calls).toEqual(["query"]);
  });

  it("takes 'account does not exist' as the answer, without asking elsewhere", async () => {
    const before = healthy.calls.length;
    const chain = rpcChain([missing.url(), healthy.url()]);
    expect(await chain.balance("nobody.testnet")).toBeNull();
    expect(healthy.calls.length).toBe(before);
  });
});

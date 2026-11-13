/**
 * `fetch`, as far as the agents' code uses it (agents/brain.ts), over the
 * host's HTTP. Everything is synchronous here: the answer is there when the
 * promise is made. The host only lets a run reach the hosts its manifest
 * names (`capabilities.network`).
 */

import { handle } from "wasi:http/outgoing-handler@0.2.12";
import { Fields, type IncomingResponse, OutgoingBody, OutgoingRequest } from "wasi:http/types@0.2.12";
import { text, utf8 } from "./bytes.js";

interface Init {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Handles of the host's (streams, bodies, responses) must be let go children first, and the
 * engine lets go when it collects, in no order. A run is short: they are all kept to its end.
 */
const kept: unknown[] = [];
const keep = <T>(x: T): T => (kept.push(x), x);

function request(url: string, init: Init = {}): { status: number; body: string } {
  const m = /^https:\/\/([^/]+)(\/.*)?$/.exec(url);
  if (!m) throw new Error(`fetch: not an https address`);
  const headers = keep(Fields.fromList(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), utf8(v)] as [string, Uint8Array])));
  const req = keep(new OutgoingRequest(headers));
  const method = (init.method ?? "GET").toUpperCase();
  req.setMethod(method === "POST" ? { tag: "post" } : { tag: "get" });
  req.setScheme({ tag: "HTTPS" });
  req.setAuthority(m[1]!);
  req.setPathWithQuery(m[2] ?? "/");
  const out = keep(req.body());
  if (init.body !== undefined) {
    const stream = keep(out.write());
    const bytes = utf8(init.body);
    for (let at = 0; at < bytes.length; at += 4096) stream.blockingWriteAndFlush(bytes.subarray(at, at + 4096));
    stream[Symbol.dispose]?.();
  }
  OutgoingBody.finish(out, undefined);
  const future = keep(handle(req, undefined));
  keep(future.subscribe()).block();
  const got = future.get();
  const response = keep(unwrap<IncomingResponse>(unwrap(got)));
  const status = response.status();
  const incoming = keep(response.consume());
  const input = keep(incoming.stream());
  const parts: number[] = [];
  for (;;) {
    let chunk: Uint8Array;
    try {
      chunk = input.blockingRead(65536n);
    } catch {
      break; // the stream is closed: the body is read
    }
    for (const b of chunk) parts.push(b);
    if (parts.length > 2_000_000) break;
  }
  return { status, body: text(Uint8Array.from(parts)) };
}

/** A `result` as the engine hands it: the value, `{tag: "ok", val}`, or an error to throw. */
function unwrap<T>(r: unknown): T {
  if (r && typeof r === "object" && "tag" in r) {
    const t = r as { tag: string; val: unknown };
    if (t.tag === "ok") return t.val as T;
    if (t.tag === "err") throw new Error(`http: ${JSON.stringify(t.val)}`);
  }
  if (r === undefined || r === null) throw new Error("http: no answer");
  return r as T;
}

export function fetchHere(url: string, init?: Init) {
  try {
    const r = request(url, init);
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: () => Promise.resolve(r.body), json: () => Promise.resolve(JSON.parse(r.body) as unknown) });
  } catch (e) {
    return Promise.reject(e);
  }
}

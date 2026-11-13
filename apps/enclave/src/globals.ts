/** The first thing loaded: promises and timers are ours (jobs.js). */
import { text, utf8 } from "./bytes.js";
import { fetchHere } from "./http.js";
import { Jobs, later } from "./jobs.js";
(globalThis as unknown as { Promise: unknown }).Promise = Jobs;
(globalThis as unknown as { setTimeout: unknown }).setTimeout = later;
const log = (...a: unknown[]) => void (globalThis as unknown as { __log: string[] }).__log.push(a.map(String).join(" "));
(globalThis as unknown as { __log: string[] }).__log = [];
(globalThis as unknown as { console: unknown }).console = { log, error: log, warn: log, info: log };
(globalThis as unknown as { fetch: unknown }).fetch = fetchHere;
// Nothing waits here, so nothing times out: the host cuts a request that hangs.
(globalThis as unknown as { AbortSignal: unknown }).AbortSignal = { timeout: () => undefined };
(globalThis as unknown as { TextEncoder: unknown }).TextEncoder = class {
  encode(s: string) {
    return utf8(s);
  }
};
(globalThis as unknown as { TextDecoder: unknown }).TextDecoder = class {
  decode(b: Uint8Array) {
    return text(b);
  }
};

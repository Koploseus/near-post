import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * A player's NEAR account, derived from his email: the same email always gets
 * the same account, and the email itself is not on chain.
 */
export function accountIdFor(email: string, parent: string): string {
  const h = createHash("sha256").update(`near-post:${normalizeEmail(email)}`).digest("hex");
  return `u${h.slice(0, 16)}.${parent}`;
}

export function isPlayerAccount(accountId: string, parent: string): boolean {
  return new RegExp(`^u[0-9a-f]{16}\\.${parent.replaceAll(".", "\\.")}$`).test(accountId);
}

/** Six-digit email codes, kept hashed in memory, single use, with a few tries. */
export class Codes {
  private readonly secret = randomBytes(32);
  private readonly pending = new Map<string, { hash: Buffer; expires: number; tries: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxTries = 5,
    private readonly now: () => number = Date.now,
  ) {}

  private hash(code: string) {
    return createHmac("sha256", this.secret).update(code).digest();
  }

  issue(email: string): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending.set(normalizeEmail(email), { hash: this.hash(code), expires: this.now() + this.ttlMs, tries: 0 });
    return code;
  }

  verify(email: string, code: string): boolean {
    const key = normalizeEmail(email);
    const p = this.pending.get(key);
    if (!p || p.expires < this.now()) {
      this.pending.delete(key);
      return false;
    }
    p.tries += 1;
    const ok = /^\d{6}$/.test(code) && timingSafeEqual(p.hash, this.hash(code));
    if (ok || p.tries >= this.maxTries) this.pending.delete(key);
    return ok;
  }
}

/** A fixed window counter per key: at most `limit` hits per `windowMs`. */
export class Limiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || h.reset <= t) {
      this.hits.set(key, { count: 1, reset: t + this.windowMs });
      return true;
    }
    if (h.count >= this.limit) return false;
    h.count += 1;
    return true;
  }
}

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async send(to, subject, text) {
    console.log(`[mail] to=${to} subject=${subject}\n${text}`);
  },
};

/** Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(to, subject, text) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!r.ok) throw new Error(`email not sent: ${r.status}`);
    },
  };
}

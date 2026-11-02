import { z } from "zod";

const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.url().default("https://test.rpc.fastnear.com"),
  /** The league contract. Unset until the contracts are deployed. */
  LEAGUE_ID: z.string().min(2).optional(),
  /**
   * The account that creates players' accounts (as its sub-accounts), funds
   * their gas and plays match days. Its key is a secret: environment only.
   */
  PARENT_ACCOUNT_ID: z.string().min(2).default("near-post.testnet"),
  PARENT_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  /**
   * NEAR given to a new account, then per top-up. A transaction needs its
   * whole prepaid gas in the balance (about 0.1 NEAR per 100 Tgas on testnet),
   * though most of it is refunded.
   */
  ACCOUNT_FUNDING_NEAR: z.string().regex(/^\d+(\.\d+)?$/).default("0.3"),
  TOPUP_BELOW_NEAR: z.string().regex(/^\d+(\.\d+)?$/).default("0.15"),
  TOPUPS_PER_DAY: z.coerce.number().int().min(0).default(2),
  EMAIL_MODE: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("NEAR Post <play@near-post.dev>"),
  CODE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  /** Plays match days when they are due (needs PARENT_PRIVATE_KEY). */
  PLAY_MATCH_DAYS: flag.default(true),
  /**
   * Local end-to-end tests only: return the email code in the response.
   * Never set it on a public relay.
   */
  INSECURE_DEV_RETURN_CODE: flag.default(false),
  /**
   * Header that carries the client's IP for rate limits. Behind Fly, use
   * fly-client-ip: Fly's proxy sets it, while the first x-forwarded-for entry
   * can come from the client.
   */
  CLIENT_IP_HEADER: z.string().toLowerCase().default("x-forwarded-for"),
  /** Demo crowd, "club:count,...": fan accounts <club>-f<n>.<parent> sharing CROWD_PRIVATE_KEY. */
  CROWD: z.string().optional(),
  CROWD_PRIVATE_KEY: z.string().startsWith("ed25519:").optional(),
  /** The crowd comes one match day in CROWD_EVERY (each check-in stores about 180 bytes). */
  CROWD_EVERY: z.coerce.number().int().min(1).default(3),
  /** Contracts whose storage balance the parent tops up, comma-separated. */
  KEEP_FUNDED: z.string().optional(),
  KEEP_MIN_FREE_NEAR: z.string().regex(/^\d+(\.\d+)?$/).default("2"),
  KEEP_TOPUP_NEAR: z.string().regex(/^\d+(\.\d+)?$/).default("5"),
  /** Serves the built web app from this folder (one origin for app and API). */
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = Env.parse(env);
  if (config.EMAIL_MODE === "resend" && !config.RESEND_API_KEY) {
    throw new Error("EMAIL_MODE=resend needs RESEND_API_KEY");
  }
  return config;
}

import { z } from "zod";

const flag = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.url().default("https://rpc.testnet.near.org"),
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
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = Env.parse(env);
  if (config.EMAIL_MODE === "resend" && !config.RESEND_API_KEY) {
    throw new Error("EMAIL_MODE=resend needs RESEND_API_KEY");
  }
  return config;
}

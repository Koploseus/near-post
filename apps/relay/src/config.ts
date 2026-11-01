import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.url().default("https://rpc.testnet.near.org"),
  /** The league contract. Unset until the contracts are deployed. */
  LEAGUE_ID: z.string().min(2).optional(),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}

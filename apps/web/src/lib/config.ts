/** Where the game lives. Override with VITE_* variables at build time. */
export const LEAGUE = import.meta.env.VITE_LEAGUE_ID ?? "league-v13.near-post.testnet";
export const GOALARS = import.meta.env.VITE_GOALARS_ID ?? "goalars-v13.near-post.testnet";
export const PLAYERS = import.meta.env.VITE_PLAYERS_ID ?? "players-v13.near-post.testnet";
export const ITEMS = import.meta.env.VITE_ITEMS_ID ?? "items-v13.near-post.testnet";
export const TICKETS = import.meta.env.VITE_TICKETS_ID ?? "tickets-v13.near-post.testnet";
export const RPC = import.meta.env.VITE_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
/** Public testnet RPCs (docs.near.org/api/rpc/providers) that answer browsers: reads move to them when one is rate-limited. */
export const READ_RPCS: string[] = [RPC, "https://near-testnet.drpc.org", "https://testnet-rpc.intea.rs"];
/** The relay; the dev server proxies /v1 to it. */
export const RELAY = import.meta.env.VITE_RELAY_URL ?? "";
export const EXPLORER = "https://testnet.nearblocks.io";

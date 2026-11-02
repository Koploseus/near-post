/** Where the game lives. Override with VITE_* variables at build time. */
export const LEAGUE = import.meta.env.VITE_LEAGUE_ID ?? "league-v3.near-post.testnet";
export const GOALARS = import.meta.env.VITE_GOALARS_ID ?? "goalars-v3.near-post.testnet";
export const PLAYERS = import.meta.env.VITE_PLAYERS_ID ?? "players-v3.near-post.testnet";
export const RPC = import.meta.env.VITE_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
/** The relay; the dev server proxies /v1 to it. */
export const RELAY = import.meta.env.VITE_RELAY_URL ?? "";
export const EXPLORER = "https://testnet.nearblocks.io";

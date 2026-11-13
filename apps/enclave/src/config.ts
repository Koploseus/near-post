/**
 * Where the agents play. It is part of the program, not of its input: whoever
 * wakes the program cannot point the agents at other contracts.
 */
export const VERSION = "v12";
export const PARENT = "near-post.testnet";
export const LEAGUE = `league-${VERSION}.${PARENT}`;
export const GOALARS = `goalars-${VERSION}.${PARENT}`;
export const PLAYERS = `players-${VERSION}.${PARENT}`;
export const TICKETS = `tickets-${VERSION}.${PARENT}`;
/** The model the agents ask, and where: also part of the program. */
export const NEAR_AI_URL = "https://cloud-api.near.ai/v1";
export const NEAR_AI_MODEL = "Qwen/Qwen3.6-35B-A3B-FP8";

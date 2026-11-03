import { deserialize } from "borsh";
import { type SignedDelegate, SCHEMA } from "near-api-js";

/**
 * What the relay pays gas for (NEP-366 meta transactions): a player signs a
 * delegate action in the browser, the relay wraps it in a transaction and
 * pays. Only player accounts, only our contracts, only these methods.
 */
export function allowedMethods(contracts: { league: string; goalars: string; players: string; tickets?: string }): Map<string, Set<string>> {
  return new Map([
    [
      contracts.league,
      new Set([
        "create_footballer",
        "create_club",
        "rename_club",
        "set_rival",
        "recall_player",
        "report_for_match",
        "vote_captain",
        "set_formation",
        "set_takers",
        "fuse",
        "equip",
        "unequip",
        "take_slot",
        "vote_strategy",
        "follow",
        "check_in",
        "claim_stand",
        "claim",
        "claim_player",
        "collect",
        "cancel_offer",
        "finish_training",
        "play_match_day",
      ]),
    ],
    [contracts.goalars, new Set(["ft_transfer_call", "ft_transfer"])],
    [contracts.players, new Set(["nft_transfer", "nft_approve", "nft_revoke"])],
    ...(contracts.tickets ? [[contracts.tickets, new Set(["withdraw", "nft_transfer", "nft_approve", "nft_revoke"])] as [string, Set<string>]] : []),
  ]);
}

export const MAX_GAS = 300n * 10n ** 12n;
/** 0.02 NEAR: an NFT approval's storage. Deposits come from the player's own balance. */
export const MAX_DEPOSIT = 2n * 10n ** 22n;

export function decodeSignedDelegate(base64: string): SignedDelegate {
  return deserialize(SCHEMA.SignedDelegate, Buffer.from(base64, "base64")) as SignedDelegate;
}

/** Why the relay will not pay for this delegate action, or null. */
export function refuse(sd: SignedDelegate, allowed: Map<string, Set<string>>, isPlayer: (id: string) => boolean): string | null {
  const d = sd.delegateAction;
  if (!isPlayer(d.senderId)) return "not_a_player_account";
  const methods = allowed.get(d.receiverId);
  if (!methods) return "contract_not_allowed";
  if (d.actions.length < 1 || d.actions.length > 2) return "one_or_two_actions";
  for (const a of d.actions) {
    const fc = a.functionCall;
    if (!fc) return "function_calls_only";
    if (!methods.has(fc.methodName)) return "method_not_allowed";
    if (BigInt(fc.gas) > MAX_GAS) return "too_much_gas";
    if (BigInt(fc.deposit) > MAX_DEPOSIT) return "deposit_too_large";
  }
  return null;
}

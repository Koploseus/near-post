/** What the agents' code takes from near-api-js, without the library: only `nearToYocto` runs here. */
export function nearToYocto(amount: string): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole || "0") * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
}
const none = () => {
  throw new Error("not available in the enclave");
};
export const Account = none;
export const JsonRpcProvider = none;
export const actions = {};
export const KeyPair = { fromString: none };
export const baseEncode = none;
export type SignedDelegate = never;

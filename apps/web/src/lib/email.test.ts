import { describe, expect, it } from "vitest";
import { accountIdFor } from "../../../relay/src/auth.js";
import { accountOfEmail, isEmailOf } from "./email.js";

describe("the email an account was opened with", () => {
  it("is checked in the browser the way the relay names the account", async () => {
    for (const email of ["alex@example.com", "  Alex@Example.COM ", "someone+tag@mail.test"]) {
      expect(await accountOfEmail(email, "near-post.testnet")).toBe(accountIdFor(email, "near-post.testnet"));
    }
    const account = accountIdFor("alex@example.com", "near-post.testnet");
    expect(await isEmailOf(account, "ALEX@example.com ")).toBe(true);
    expect(await isEmailOf(account, "alexa@example.com")).toBe(false);
    expect(await isEmailOf("0123abcd", "alex@example.com")).toBe(false);
  });
});

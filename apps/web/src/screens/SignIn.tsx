import { useState } from "react";
import { useGame } from "../lib/game.js";
import { type SignInResult, finishSignIn, loadSession, saveSession, startSignIn } from "../lib/near.js";
import { type Backup, passkeysAvailable, saveWithPasskey, unlockWithPasskey } from "../lib/passkey.js";
import { toast } from "../lib/toast.js";

type Step = { k: "email" } | { k: "code" } | { k: "unlock"; accountId: string; backups: Backup[] } | { k: "secure" };

/**
 * Email, code, done. A new player is offered to save his account with a
 * passkey (Face ID, fingerprint) so he can play on any device; on another
 * device, the passkey unlocks it after the code.
 */
export function SignIn() {
  const { session, setSession, refresh } = useGame();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ k: "email" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // Closing the Face ID prompt is not an error worth shouting about.
      setError(/NotAllowed|cancel|abort/i.test(m) ? "Cancelled. Try again when you are ready." : m);
    } finally {
      setBusy(false);
    }
  };
  const after = (r: SignInResult) => {
    if ("unlock" in r) return setStep({ k: "unlock", ...r.unlock });
    if (r.created && passkeysAvailable()) {
      // Signed in already; offer the passkey before entering.
      setStep({ k: "secure" });
      return;
    }
    setSession(r.session);
    refresh();
  };

  return (
    <section className="paper panel signin" aria-labelledby="signin-title">
      <span className="k">NO WALLET · NO SEED PHRASE · NO GAS</span>
      {step.k === "email" && (
        <>
          <h2 id="signin-title">Play with your email</h2>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void go(async () => {
                const started = await startSignIn(email);
                // Demo relay (no email check): the code comes back, sign in at once.
                if (started.code) after(await finishSignIn(email, started.code));
                else setStep({ k: "code" });
              });
            }}
          >
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="cta" type="submit" disabled={busy}>
              {busy ? "…" : "CONTINUE"}
            </button>
          </form>
        </>
      )}

      {step.k === "code" && (
        <>
          <h2 id="signin-title">Check your email</h2>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void go(async () => after(await finishSignIn(email, code)));
            }}
          >
            <label htmlFor="code">Six-digit code sent to {email}</label>
            <input
              id="code"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="cta" type="submit" disabled={busy}>
              {busy ? "…" : "ENTER THE GAME"}
            </button>
            <button type="button" className="link" onClick={() => setStep({ k: "email" })}>
              Use another email
            </button>
          </form>
        </>
      )}

      {step.k === "unlock" && (
        <>
          <h2 id="signin-title">Welcome back</h2>
          <p className="lead">Your account was made on another device. Unlock it here with your passkey: Face ID, your fingerprint or your phone.</p>
          <button
            type="button"
            className="cta passkey-cta"
            disabled={busy}
            onClick={() =>
              void go(async () => {
                const s = await unlockWithPasskey(step.accountId, step.backups);
                saveSession(s);
                setSession(s);
                refresh();
                toast("Unlocked: welcome back");
              })
            }
          >
            <PasskeyIcon /> {busy ? "…" : "UNLOCK WITH A PASSKEY"}
          </button>
          <p className="note">On a computer without your passkey, your browser shows a QR code: scan it with your phone.</p>
        </>
      )}

      {step.k === "secure" && (
        <>
          <h2 id="signin-title">Play on any device</h2>
          <p className="lead">Save your account with a passkey: Face ID or your fingerprint. Then your email and one touch open it on your phone, tablet or another computer.</p>
          <button
            type="button"
            className="cta passkey-cta"
            disabled={busy}
            onClick={() =>
              void go(async () => {
                const s = loadOrThrow(session);
                await saveWithPasskey(s, email || s.accountId);
                toast("Saved: your passkey opens your account anywhere");
                setSession(s);
                refresh();
              })
            }
          >
            <PasskeyIcon /> {busy ? "…" : "SAVE WITH A PASSKEY"}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setSession(loadOrThrow(session));
              refresh();
            }}
          >
            Later (Locker room)
          </button>
        </>
      )}

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <p className="note">
        Your browser makes your key and keeps it; a passkey backup is encrypted by your passkey before it leaves. We never hold
        anything that can sign for you.
      </p>
    </section>
  );
}

/** The session finishSignIn saved (the secure step comes right after it). */
function loadOrThrow(current: ReturnType<typeof useGame>["session"]) {
  const s = current ?? loadSession();
  if (!s) throw new Error("Sign in again.");
  return s;
}

export function PasskeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" className="passkey-icon">
      <circle cx="9" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M2 21c0-4 3-6 7-6 1.6 0 3 .3 4 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="14" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M18 16.5V22m0-2.5h2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

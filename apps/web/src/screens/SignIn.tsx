import { useState } from "react";
import { useGame } from "../lib/game.js";
import { type SignInResult, finishSignIn, loadSession, saveSession, startSignIn } from "../lib/near.js";
import { type Backup, isRecovery, passkeysAvailable, saveWithPasskey, saveWithRecoveryKey, unlockWithPasskey, unlockWithRecoveryKey } from "../lib/passkey.js";
import type { Session } from "../lib/near.js";
import { toast } from "../lib/toast.js";

type Step = { k: "email" } | { k: "code" } | { k: "unlock"; accountId: string; backups: Backup[] } | { k: "secure" };

/**
 * Email, code, done. A new player can add a passkey to sign in on his other
 * devices; there, the passkey opens the account after the code.
 */
export function SignIn() {
  const { session, setSession, refresh } = useGame();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
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
    if (r.created) {
      // Signed in already; offer the passkey before entering.
      setStep({ k: "secure" });
      return;
    }
    setSession(r.session);
    refresh();
  };

  return (
    <section className="paper panel signin" aria-labelledby="signin-title">
      {step.k === "email" && (
        <>
          <span className="k">NO WALLET · NO SEED PHRASE · NO GAS</span>
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
          {step.backups.some((b) => !isRecovery(b)) && (
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
                  toast("Welcome back");
                })
              }
            >
              <PasskeyIcon /> {busy ? "…" : "CONTINUE WITH A PASSKEY"}
            </button>
          )}
          {step.backups.some(isRecovery) && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void go(async () => {
                  const s = await unlockWithRecoveryKey(step.accountId, step.backups, recovery);
                  saveSession(s);
                  setSession(s);
                  refresh();
                  toast("Welcome back");
                });
              }}
            >
              <input type="text" name="username" autoComplete="username" value={email || step.accountId} readOnly hidden />
              <label htmlFor="recovery">{step.backups.some((b) => !isRecovery(b)) ? "Or your recovery key" : "Your recovery key"}</label>
              <input
                id="recovery"
                name="password"
                type="password"
                autoComplete="current-password"
                spellCheck={false}
                placeholder="XXXX-XXXX-…"
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              />
              <button className="cta" type="submit" disabled={busy || !recovery}>
                {busy ? "…" : "UNLOCK"}
              </button>
            </form>
          )}
        </>
      )}

      {step.k === "secure" && (
        <>
          <h2 id="signin-title">Sign in on your other devices</h2>
          <p className="lead">Your key lives in this browser. Back it up with a passkey or a recovery key.</p>
          {passkeysAvailable() && (
            <button
              type="button"
              className="cta passkey-cta"
              disabled={busy}
              onClick={() =>
                void go(async () => {
                  const s = loadOrThrow(session);
                  await saveWithPasskey(s, email || s.accountId);
                  toast("Passkey added");
                  setSession(s);
                  refresh();
                })
              }
            >
              <PasskeyIcon /> {busy ? "…" : "ADD A PASSKEY"}
            </button>
          )}
          <RecoveryKeySetup
            session={loadSession() ?? session}
            username={email}
            onDone={() => {
              setSession(loadOrThrow(session));
              refresh();
            }}
          />
          <button
            type="button"
            className="link"
            onClick={() => {
              setSession(loadOrThrow(session));
              refresh();
            }}
          >
            Not now
          </button>
        </>
      )}

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
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

/**
 * The other backup: a recovery key, shown once, in a form a password manager
 * offers to save (Bitwarden keeps it like a password for this site).
 */
export function RecoveryKeySetup({ session, username, onDone }: { session: Session | null; username: string; onDone?: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;
  if (!key)
    return (
      <div className="recovery">
        <button
          type="button"
          className="link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setKey(await saveWithRecoveryKey(session));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "…" : "Use a recovery key instead (Bitwarden, other password managers)"}
        </button>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <form
      className="form recovery"
      onSubmit={(e) => {
        e.preventDefault();
        toast("Recovery key saved");
        onDone?.();
      }}
    >
      <p className="lead">Your recovery key. Save it in your password manager now: it is shown once, and nobody, not even us, can give it back.</p>
      <input type="text" name="username" autoComplete="username" value={username || session.accountId} readOnly hidden />
      <code className="recovery-key">{key}</code>
      <input type="password" name="password" autoComplete="new-password" value={key} readOnly hidden />
      <button type="button" className="link" onClick={() => void navigator.clipboard?.writeText(key).then(() => toast("Copied"))}>
        Copy
      </button>
      <button className="cta" type="submit">
        I SAVED IT
      </button>
    </form>
  );
}

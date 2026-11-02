import { useState } from "react";
import { useGame } from "../lib/game.js";
import { finishSignIn, startSignIn } from "../lib/near.js";

export function SignIn() {
  const { setSession, refresh } = useGame();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="paper panel" aria-labelledby="signin-title">
      <span className="k">NO WALLET · NO SEED PHRASE · NO GAS</span>
      <h2 id="signin-title">Play with your email</h2>
      {step === "email" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void go(async () => {
              const started = await startSignIn(email);
              if (started.code) {
                // Demo relay (no email check): the code comes back, sign in at once.
                setSession(await finishSignIn(email, started.code));
                refresh();
              } else setStep("code");
            });
          }}
        >
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="cta" type="submit" disabled={busy}>
            {busy ? "…" : "SEND MY CODE"}
          </button>
        </form>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void go(async () => {
              setSession(await finishSignIn(email, code));
              refresh();
            });
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
          <button type="button" className="link" onClick={() => setStep("email")}>
            Use another email
          </button>
        </form>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <p className="note">
        Your browser makes your key and keeps it. We create your NEAR account with it and add a little NEAR for gas.
        We never hold your key.
      </p>
    </section>
  );
}

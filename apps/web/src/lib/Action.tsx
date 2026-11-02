import { type ReactNode, useState } from "react";
import { EXPLORER } from "./config.js";
import { toast } from "./toast.js";

/**
 * A button that runs a transaction. On success it says so in game terms (a
 * toast), with a small link to the transaction; on failure, why.
 */
export function Action({
  label,
  run,
  done,
  className = "cta",
  disabled,
  aria,
  success,
}: {
  /** What the player sees when it worked, e.g. "You start at left midfield". */
  success?: string;
  label: ReactNode;
  aria?: string;
  run: () => Promise<{ hash: string } | unknown>;
  done?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  return (
    <span className="action">
      <button
        type="button"
        className={className}
        disabled={busy || disabled}
        aria-label={aria}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = (await run()) as { hash?: string } | undefined;
            setMsg({ ok: true, text: "", ...(r?.hash ? { hash: r.hash } : {}) });
            toast(success ?? "Done");
            done?.();
          } catch (e) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : label}
      </button>
      {msg && (
        <span className={msg.ok ? "ok" : "err"} role="status">
          {msg.text}
          {msg.hash && (
            <a className="tx" href={`${EXPLORER}/txns/${msg.hash}`} target="_blank" rel="noreferrer">
              on chain ↗
            </a>
          )}
        </span>
      )}
    </span>
  );
}

import { useState } from "react";
import { EXPLORER } from "./config.js";

/** A button that runs a transaction and shows its outcome, with a link to the explorer. */
export function Action({
  label,
  run,
  done,
  className = "cta",
  disabled,
}: {
  label: string;
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
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = (await run()) as { hash?: string } | undefined;
            setMsg({ ok: true, text: "Done", ...(r?.hash ? { hash: r.hash } : {}) });
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
            <>
              {" · "}
              <a href={`${EXPLORER}/txns/${msg.hash}`} target="_blank" rel="noreferrer">
                View on NEAR ↗
              </a>
            </>
          )}
        </span>
      )}
    </span>
  );
}

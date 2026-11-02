import { useEffect, useState } from "react";

interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

let next = 0;

/** Shows a short message at the bottom of the screen for a few seconds. */
export function toast(text: string, ok = true) {
  dispatchEvent(new CustomEvent<Toast>("np-toast", { detail: { id: next++, text, ok } }));
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setList((l) => [...l.slice(-2), t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 3_500);
    };
    addEventListener("np-toast", on);
    return () => removeEventListener("np-toast", on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <span key={t.id} className={`toast${t.ok ? "" : " bad"}`}>
          {t.ok ? "✓ " : ""}
          {t.text}
        </span>
      ))}
    </div>
  );
}

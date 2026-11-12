import { useState } from "react";
import { BEARDS, type Face, HAIRCUTS, HAIR_COLOURS, KINDS, SKINS, bornFace, faceOf, packFace, setFace } from "../lib/face.js";
import { useGame } from "../lib/game.js";
import { saveFace } from "../lib/near.js";
import type { Player } from "../lib/types.js";
import { FaceHead, faceNumber } from "./Look.js";

/**
 * Your footballer's face: one of eight faces, his skin, his haircut and its
 * colour, his beard. Free, and yours to change whenever you like; the haircuts and
 * accessories of the wardrobe (items) go on top of it.
 */
export function FaceEditor({ me, shirt }: { me: Player; shirt?: string }) {
  const { session } = useGame();
  const n = faceNumber(me.token_id);
  const [face, setDraft] = useState<Face>(() => faceOf(n));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = packFace(face) !== packFace(faceOf(n));
  const set = (k: keyof Face, v: number) => {
    setDraft({ ...face, [k]: v });
    setState("idle");
  };
  const save = async () => {
    if (!session) return;
    setState("saving");
    try {
      await saveFace(session, me.token_id, packFace(face));
      setFace(n, packFace(face));
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const swatches = (k: "skin" | "colour", colours: string[], label: string) => (
    <div className="face-row">
      <span className="face-label">{label}</span>
      <div className="face-swatches" role="radiogroup" aria-label={label}>
        {colours.map((c, i) => (
          <button key={c} type="button" role="radio" aria-checked={face[k] === i} aria-label={`${label} ${i + 1}`} className={`face-swatch${face[k] === i ? " on" : ""}`} onClick={() => set(k, i)}>
            <span style={{ background: c }} />
          </button>
        ))}
      </div>
    </div>
  );
  /** A row of small heads to pick from: the same face with one thing changed. */
  const heads = (k: "kind" | "hair" | "beard", names: string[], label: string) => (
    <div className="face-row">
      <span className="face-label">{label}</span>
      <div className="face-heads" role="radiogroup" aria-label={label}>
        {names.map((name, i) => (
          <button key={name} type="button" role="radio" aria-checked={face[k] === i} aria-label={name} title={name} className={`face-head${face[k] === i ? " on" : ""}`} onClick={() => set(k, i)}>
            <FaceHead face={{ ...face, [k]: i }} hair={k === "hair" ? null : me.look?.hair} shirt={shirt} size={46} />
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <section className="paper panel face-editor" aria-labelledby="face-title">
      <span className="k">YOUR FACE</span>
      <h3 id="face-title">Make him look like you</h3>
      <div className="face-body">
        <div className="face-preview">
          <FaceHead face={face} hair={me.look?.hair} shirt={shirt} size={132} title={`${me.name}'s face`} />
          <div className="face-turn" aria-hidden="true">
            <FaceHead face={face} hair={me.look?.hair} shirt={shirt} size={54} view="side" />
            <FaceHead face={face} hair={me.look?.hair} shirt={shirt} size={54} view="back" />
          </div>
          {me.look?.hair && <p className="note">He wears a haircut from his wardrobe: take it off to see the cut you pick here.</p>}
        </div>
        <div className="face-controls">
          {heads("kind", Array.from({ length: KINDS }, (_, i) => `Face ${i + 1}`), "Face")}
          {swatches("skin", SKINS, "Skin")}
          {heads("hair", HAIRCUTS, "Haircut")}
          {swatches("colour", HAIR_COLOURS, "Hair colour")}
          {heads("beard", BEARDS, "Beard")}
          <div className="face-actions">
            <button type="button" className="cta small" onClick={() => setDraft(bornFace(Math.floor(Math.random() * 100_000)))}>
              SURPRISE ME
            </button>
            <button type="button" className="cta small face-save" disabled={!dirty || state === "saving"} onClick={save}>
              {state === "saving" ? "SAVING…" : "SAVE MY FACE"}
            </button>
          </div>
          <p className="note" role="status">
            {state === "saved" ? "Saved: everyone sees him like this, in the menus and on the pitch." : state === "error" ? "Could not save. Try again in a moment." : "Free. Accessories and special haircuts are items you win or buy."}
          </p>
        </div>
      </div>
    </section>
  );
}

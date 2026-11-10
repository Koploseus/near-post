import { useState } from "react";
import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { buyPack, equip, fuse, itemsOf, league, unequip } from "../lib/near.js";
import type { CatalogItem, Player } from "../lib/types.js";
import { Avatar, ItemIcon, KINDS, KIND_LABEL, KIND_NOTE, KIND_SKILL, RARITY_COLOR } from "./Look.js";

const RARITIES: CatalogItem["rarity"][] = ["common", "rare", "epic", "legendary"];
const title = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The wardrobe: packs of three items bought in G (burned), three items of a
 * kind and rarity fused into one rarer, and what your footballer wears.
 */
export function Wardrobe({ me }: { me: Player }) {
  const { session, balance, refresh } = useGame();
  const n = Number(me.token_id.replace(/\D/g, "")) || 0;
  const { data, reload } = useData(async () => {
    if (!session) return null;
    const [catalog, rules, unboxed] = await Promise.all([
      league<CatalogItem[]>("catalog"),
      league<{ pack_price: string; item_bonus?: number[] }>("rules"),
      league<string[]>("last_unboxed", { account_id: session.accountId }),
    ]);
    const held = await itemsOf(session.accountId, catalog.map((c) => c.id));
    return { catalog, price: rules.pack_price, bonus: rules.item_bonus ?? [0, 1, 2, 3], unboxed, held };
  }, [session?.accountId]);
  const [picked, setPicked] = useState<string[]>([]);
  const [reveal, setReveal] = useState(false);
  if (!session || !data) return null;
  const byId = new Map(data.catalog.map((c) => [c.id, c]));
  const later = () =>
    setTimeout(() => {
      reload();
      refresh();
    }, 2500);
  const pick = (id: string) => {
    const already = picked.filter((p) => p === id).length;
    const item = byId.get(id)!;
    const first = picked[0] && byId.get(picked[0]);
    const fits = !first || (first.kind === item.kind && first.rarity === item.rarity);
    if (!fits || already >= (data.held.get(id) ?? 0) || picked.length >= 3) setPicked([id]);
    else setPicked([...picked, id]);
  };
  /** "+2 pace", "+1 defending (in goal)", or "" for hair and common items. */
  const effect = (it: CatalogItem | undefined) => {
    const skill = it && KIND_SKILL[it.kind];
    const points = it ? (data.bonus[RARITIES.indexOf(it.rarity)] ?? 0) : 0;
    if (!skill || points === 0) return "";
    return `+${points} ${skill}${KIND_NOTE[it!.kind] ? ` (${KIND_NOTE[it!.kind]})` : ""}`;
  };
  const one = picked.length === 1 ? byId.get(picked[0]!) : null;
  const three = picked.length === 3 ? byId.get(picked[0]!) : null;
  const next = three ? RARITIES[RARITIES.indexOf(three.rarity) + 1] : undefined;
  const worn = KINDS.map((k) => [k, me.look?.[k] ?? null] as const);
  const owned = [...data.held.entries()];

  return (
    <div className="paper panel wardrobe">
      <h3>Wardrobe</h3>
      <div className="wardrobe-grid">
        <div className="wardrobe-me">
          <Avatar look={me.look} n={n} />
          <ul className="worn">
            {worn.map(([k, id]) => (
              <li key={k}>
                <span className="k">{KIND_LABEL[k].toUpperCase()}</span>
                {id ? (
                  <>
                    <span>
                      {title(byId.get(id)?.style ?? id)}
                      {effect(byId.get(id)) && <b className="effect"> {effect(byId.get(id))}</b>}
                    </span>
                    <Action className="chip" label="TAKE OFF" run={() => unequip(session, me.token_id, k)} done={later} success="Back in your wardrobe" />
                  </>
                ) : (
                  <span className="note">nothing</span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="wardrobe-items">
          <div className="pack-row">
            <Action
              className="cta small"
              label={`BUY A PACK · ${g(data.price)}`}
              disabled={BigInt(balance) < BigInt(data.price)}
              run={() => buyPack(session, data.price)}
              success="Pack opened"
              done={() => {
                setReveal(true);
                later();
              }}
            />
            <span className="note">
              Three items: common 70%, rare 22%, epic 7%, legendary 1%. The G burns.
              {BigInt(balance) < BigInt(data.price) && ` You have ${g(balance)}.`}
            </span>
          </div>
          {reveal && data.unboxed.length > 0 && (
            <span className="k">JUST UNBOXED</span>
          )}
          {reveal && data.unboxed.length > 0 && (
            <div className="unboxed" role="status">
              {data.unboxed.map((id, i) => {
                const it = byId.get(id);
                return it ? (
                  <span key={i} className={`unbox ${it.rarity}`} style={{ animationDelay: `${i * 0.25}s`, borderColor: RARITY_COLOR[it.rarity] }}>
                    <ItemIcon item={it} n={n} />
                    <b>{title(it.style)}</b>
                    <i style={{ color: RARITY_COLOR[it.rarity] }}>{it.rarity}</i>
                    {effect(it) && <em className="effect">{effect(it)}</em>}
                  </span>
                ) : null;
              })}
            </div>
          )}

          <span className="k">YOUR ITEMS</span>
          {owned.length === 0 ? (
            <p className="note">No item yet. Open a pack.</p>
          ) : (
            <div className="items" role="listbox" aria-label="Your items" aria-multiselectable="true">
              {owned.map(([id, count]) => {
                const it = byId.get(id);
                if (!it) return null;
                const sel = picked.filter((p) => p === id).length;
                return (
                  <button
                    type="button"
                    key={id}
                    role="option"
                    aria-selected={sel > 0}
                    className={`item${sel ? " on" : ""}`}
                    style={{ borderColor: RARITY_COLOR[it.rarity] }}
                    onClick={() => pick(id)}
                    title={`${KIND_LABEL[it.kind]}: ${title(it.style)}, ${it.rarity}${effect(it) ? `, ${effect(it)}` : ""}`}
                  >
                    <ItemIcon item={it} n={n} />
                    <b>{title(it.style)}</b>
                    <i style={{ color: RARITY_COLOR[it.rarity] }}>{it.rarity}</i>
                    {effect(it) && <em className="effect">{effect(it)}</em>}
                    {count > 1 && <span className="count">×{count}</span>}
                    {sel > 0 && <span className="sel">{sel}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <div className="wardrobe-actions">
            {one && (
              <Action
                className="cta small"
                label={`WEAR ${title(one.style).toUpperCase()}`}
                run={() => equip(session, me.token_id, one.id)}
                success={`Wearing ${title(one.style).toLowerCase()}`}
                done={() => {
                  setPicked([]);
                  later();
                }}
              />
            )}
            {three && next && (
              <Action
                className="cta small"
                label={`FUSE 3 ${three.rarity.toUpperCase()} → 1 ${next.toUpperCase()}`}
                run={() => fuse(session, picked)}
                done={() => {
                  setPicked([]);
                  setReveal(true);
                  later();
                }}
              />
            )}
            <span className="note">
              {picked.length === 0
                ? "Pick an item to wear it, or three of a kind and rarity to fuse them into a rarer one."
                : three && !next
                  ? "Legendary items do not fuse."
                  : picked.length < 3
                    ? `${picked.length} picked: three ${byId.get(picked[0]!)?.rarity} ${KIND_LABEL[byId.get(picked[0]!)!.kind].toLowerCase()}s fuse.`
                    : ""}
            </span>
          </div>
          <p className="note">
            Items count on the pitch: boots add pace, a headband physical, grip socks dribbling, a wristband passing, ankle tape shooting, shin pads defending
            (outfield) and gloves defending (in goal). Rare +1, epic +2, legendary +3. Haircuts are for show. While he wears an item, the league holds it; it
            comes back when you take it off.
          </p>
        </div>
      </div>
    </div>
  );
}

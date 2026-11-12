import { Action } from "../lib/Action.js";
import { g } from "../lib/format.js";
import { soon, useData, useGame } from "../lib/game.js";
import { buyDiet, league, leagueCall } from "../lib/near.js";
import { serverNow } from "../lib/time.js";
import type { Condition, Diet, Instruction, Player, Rules } from "../lib/types.js";
import { useState } from "react";

const INSTRUCTIONS: { id: Instruction; name: string; up: string; down: string }[] = [
  { id: "balanced", name: "Balanced", up: "", down: "" },
  { id: "shooter", name: "Shooter", up: "shooting", down: "passing" },
  { id: "playmaker", name: "Playmaker", up: "passing", down: "shooting" },
  { id: "dribbler", name: "Dribbler", up: "dribbling", down: "defending" },
  { id: "stopper", name: "Stopper", up: "defending", down: "dribbling" },
];

const DIETS: { id: Diet; name: string; does: (r: Rules) => string }[] = [
  { id: "energy", name: "Pasta night", does: (r) => `+${r.diet_energy} energy back every match day` },
  { id: "power", name: "Steak and eggs", does: (r) => `+${r.diet_skill} physical on the pitch` },
  { id: "speed", name: "Light and fresh", does: (r) => `+${r.diet_skill} pace on the pitch` },
];

/**
 * A footballer's life around the match: how he is told to play, what he
 * eats, his holidays, and the treatment room when he is hurt.
 */
export function Life({ me }: { me: Player }) {
  const { session, schedule, balance, refresh } = useGame();
  const day = schedule?.match_day ?? 0;
  const { data, reload } = useData(
    () => Promise.all([league<Condition>("condition_of", { token_id: me.token_id }), league<Rules>("rules")]),
    [me.token_id, day],
  );
  const [days, setDays] = useState(3);
  if (!session || !data || data[1].diet_price === undefined) return null;
  const [c, rules] = data;
  const after = () => {
    soon(reload);
    soon(refresh);
  };
  const injured = c.injured_until >= day;
  const away = c.holiday_until >= day;
  const diet = c.diet && c.diet_until >= day ? DIETS.find((d) => d.id === c.diet)! : null;
  const sheetOpen = !!schedule && !schedule.first_half_played && serverNow() < Number(schedule.kickoff_at_ms) - 60_000;
  const poor = BigInt(balance) < BigInt(rules.diet_price);
  return (
    <section className="paper panel life" aria-labelledby="life-title">
      <h3 id="life-title">Off the pitch</h3>

      {injured && (
        <div className="life-alert bad" role="status">
          <b>INJURED</b>
          <span>
            He ended a match with nothing left in his legs. Back on match day {c.injured_until + 1}
            {c.injured_until > day ? ` (${c.injured_until - day + 1} match days out)` : " (out today)"}. A physio at the club house shortens it.
          </span>
        </div>
      )}

      <div className="life-block">
        <span className="k">INSTRUCTION</span>
        <p className="note">
          How he plays, from the next half on: {rules.instruction_points} points move from one skill to another. Change it whenever you like.
        </p>
        <div className="life-picks" role="group" aria-label="Instruction">
          {INSTRUCTIONS.map((i) =>
            c.instruction === i.id ? (
              <span key={i.id} className="life-pick on" aria-current="true">
                <b>{i.name}</b>
                <small>{i.up ? `+${rules.instruction_points} ${i.up}, -${rules.instruction_points} ${i.down}` : "as he is"}</small>
              </span>
            ) : (
              <Action
                key={i.id}
                className="life-pick"
                aria={`Play as ${i.name.toLowerCase()}`}
                label={
                  <>
                    <b>{i.name}</b>
                    <small>{i.up ? `+${rules.instruction_points} ${i.up}, -${rules.instruction_points} ${i.down}` : "as he is"}</small>
                  </>
                }
                run={() => leagueCall(session, "set_instruction", { instruction: i.id }, 30)}
                done={after}
                success={`He plays ${i.name.toLowerCase()}`}
              />
            ),
          )}
        </div>
      </div>

      <div className="life-block">
        <span className="k">KITCHEN</span>
        <p className="note">
          A diet lasts {rules.diet_days} match days and costs {g(rules.diet_price)}, burned. A new one replaces the one running.
          {diet ? ` On the table: ${diet.name}, until match day ${c.diet_until}.` : ""}
        </p>
        <div className="life-picks" role="group" aria-label="Diet">
          {DIETS.map((d) => (
            <Action
              key={d.id}
              className={`life-pick${diet?.id === d.id ? " on" : ""}`}
              aria={`${d.name}: ${d.does(rules)}`}
              disabled={poor}
              label={
                <>
                  <b>{d.name}</b>
                  <small>{d.does(rules)}</small>
                </>
              }
              run={() => buyDiet(session, me.token_id, d.id, rules.diet_price)}
              done={after}
              success={`${d.name} for ${rules.diet_days} match days`}
            />
          ))}
        </div>
        {poor && <p className="note">You need {g(rules.diet_price)} for a diet.</p>}
      </div>

      <div className="life-block">
        <span className="k">HOLIDAYS</span>
        {away ? (
          <>
            <p className="note">
              On holiday until match day {c.holiday_until}: nobody picks him, he rests and an academy kid plays. Taking a slot also ends it.
            </p>
            <Action className="cta small" label="Come back now" run={() => leagueCall(session, "end_holiday", {}, 30)} done={after} success="Back in the squad" />
          </>
        ) : (
          <>
            <p className="note">
              Away for a while? Nobody picks him, he rests and an academy kid plays, today included. Up to {rules.holiday_max_days} match days.
            </p>
            <div className="life-row">
              <div className="positions contract-days" role="group" aria-label="Holiday, in match days">
                {[1, 3, 7, rules.holiday_max_days].map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d}
                    <small>{d === 1 ? "day" : "days"}</small>
                  </button>
                ))}
              </div>
              {sheetOpen ? (
                <Action className="chip" label={`Go on holiday, ${days} ${days === 1 ? "day" : "days"}`} run={() => leagueCall(session, "go_on_holiday", { days }, 30)} done={after} success="Enjoy the break" />
              ) : (
                <span className="note">The team sheet is closed: leave after the final whistle.</span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

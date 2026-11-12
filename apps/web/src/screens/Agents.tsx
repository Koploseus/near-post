import { CoachFace } from "../floodlight/art.js";
import { useEffect, useState } from "react";
import { type Act, type AgentEntry, type AgentInfo, agentFeed, roleOf, useAgents } from "../lib/agents.js";
import { EXPLORER } from "../lib/config.js";
import { clubName, g } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import { league } from "../lib/near.js";
import type { Club, Player } from "../lib/types.js";

const ONE_G = 1_000_000n;
const gOf = (whole: number) => g(BigInt(Math.round(whole)) * ONE_G);

/** What the AI coaches and footballers decided, and why. */
export function Agents() {
  const { schedule } = useGame();
  const roster = useAgents();
  const [who, setWho] = useState<"all" | "coach" | "footballer">("all");
  const { data: feed } = useData(() => agentFeed({ limit: 120 }), [schedule?.match_day, schedule?.first_half_played]);
  const { data: table } = useData(() => league<Club[]>("table"), [schedule?.match_day]);
  const clubs = new Map((table ?? []).map((c) => [c.manager, clubName(c.name)]));
  const shown = (feed ?? []).filter((e) => e.kind !== "setup" && (who === "all" || roster.get(e.agent)?.kind === who) && (e.quote || e.acts.length));
  const names = usePlayerNames(shown.flatMap((e) => e.acts.flatMap((a) => ("token_id" in a ? [a.token_id] : []))));

  return (
    <section className="paper panel agents" aria-labelledby="agents-title">
      <span className="k">AI COACHES · AI FOOTBALLERS</span>
      <h2 id="agents-title">The AI dressing room</h2>
      <div className="seg" role="group" aria-label="Show">
        {(["all", "coach", "footballer"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={who === k} onClick={() => setWho(k)}>
            {k === "all" ? "All" : k === "coach" ? "Coaches" : "Footballers"}
          </button>
        ))}
      </div>
      {feed === null && <p className="note">…</p>}
      {feed !== null && shown.length === 0 && <p className="note">Nothing yet today.</p>}
      <ol className="agent-feed">
        {shown.map((e) => (
          <AgentLine key={`${e.agent}-${e.at}-${e.kind}`} e={e} a={roster.get(e.agent)} clubs={clubs} names={names} />
        ))}
      </ol>
    </section>
  );
}

export function AgentLine({ e, a, clubs, names }: { e: AgentEntry; a?: AgentInfo; clubs: Map<string, string>; names: Map<string, string> }) {
  const acts = e.acts.map((x) => actText(x, clubs, names)).filter(Boolean);
  return (
    <li className="agent-line">
      <div className="agent-who">
        {a?.kind === "coach" ? <CoachFace id={e.agent} size={40} /> : <span className="ai-tag">AI</span>}
        <b>{a?.name ?? e.agent.split(".")[0]}</b>
        <span className="note">
          {a ? `${a.kind === "coach" ? "Coach" : "Footballer"} · ${roleOf(a)}` : ""}
          {a?.kind === "coach" && clubs.get(e.agent) ? ` · ${clubs.get(e.agent)}` : ""}
        </span>
        <span className="note when">
          Day {e.day}
          {e.half ? ` · ${e.half === 2 ? "HT" : "before KO"}` : ""}
        </span>
      </div>
      {e.quote && <q>{e.quote}</q>}
      {acts.length > 0 && <p className="agent-acts">{acts.join(" · ")}</p>}
      <p className="note agent-proof">
        {e.source === "model" ? `Model: ${e.evidence?.model ?? "?"}` : "Rules"}
        {e.signature?.matches ? " · signed in a TEE ✓" : ""}
        {e.refused.length > 0 && <span title={e.refused.join("\n")}> · {e.refused.length} refused by the checks</span>}
        {e.txs.slice(0, 3).map((t) => (
          <a key={t} href={`${EXPLORER}/txns/${t}`} target="_blank" rel="noreferrer">
            {" "}
            tx ↗
          </a>
        ))}
      </p>
    </li>
  );
}

function actText(a: Act, clubs: Map<string, string>, names: Map<string, string>): string {
  const p = (t: string) => names.get(t) ?? "a player";
  switch (a.what) {
    case "formation":
      return `plays ${a.formation}`;
    case "strategy":
      return `votes ${a.strategy}`;
    case "captain_vote":
      return `votes ${p(a.token_id)} for captain`;
    case "bid":
      return `bids ${gOf(a.price)} for ${p(a.token_id)}`;
    case "sold":
      return `sells ${p(a.token_id)} for ${gOf(a.price)}`;
    case "pack":
      return "opens a pack";
    case "equipped":
      return `wears ${a.item.split(".")[1] ?? a.item}`;
    case "recalled":
      return `brings ${p(a.token_id)} back in goal`;
    case "joined":
      return `signs for ${clubs.get(a.club) ?? "a club"}${a.price ? ` (${gOf(a.price)})` : ""}`;
    case "signed":
      return `gives his word to ${clubs.get(a.club) ?? "a club"} for ${a.days} match days`;
    case "rested":
      return "rests this match day";
    case "project_vote":
      return a.project === "save" ? "votes to save the treasury" : `votes for the ${a.project}`;
    case "wage":
      return `sets the club's wage at ${gOf(a.wage)} a match`;
    case "season_ticket":
      return `buys a season ticket of ${clubs.get(a.club) ?? "his club"}`;
    default:
      return "";
  }
}

/** Player names for the tokens in the feed (a few views). */
export function usePlayerNames(tokens: string[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const key = [...new Set(tokens)].sort().slice(0, 40).join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split(",").map((t) => league<Player | null>("get_player", { token_id: t }).catch(() => null))).then((ps) => {
      if (!live) return;
      setNames(new Map(ps.filter((p): p is Player => !!p).map((p) => [p.token_id, p.name])));
    });
    return () => {
      live = false;
    };
  }, [key]);
  return names;
}

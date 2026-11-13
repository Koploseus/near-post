import { useEffect, useMemo, useState } from "react";
import { useData, useGame } from "../lib/game.js";
import { league } from "../lib/near.js";
import { SHOUTS, WALL_MAX, type WallPost, ago, postOnWall, usePresence, wallOf } from "../lib/social.js";
import { serverNow } from "../lib/time.js";
import type { Player } from "../lib/types.js";
import { faceNumber, Head } from "./Look.js";

/**
 * The club's dressing room: who of the squad is online now, and the team
 * wall. Anyone can read it; only the club's players can post (signed with
 * their key, checked by the relay).
 */
/** A face number for someone without a footballer (the coach): from his name. */
const nameNumber = (name: string) => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

export function Wall({ clubId, compact = false }: { clubId: string; compact?: boolean }) {
  const { session, me, club } = useGame();
  const { data: squad } = useData(() => league<Player[]>("squad", { account_id: clubId }), [clubId]);
  // A dressing room is private to its squad: only its players load the wall.
  const member = !!session && !!me && me.owner === clubId;
  const { data: loaded, reload } = useData(() => (member && session ? wallOf(session, clubId) : Promise.resolve([])), [clubId, member]);
  const [posts, setPosts] = useState<WallPost[]>([]);
  useEffect(() => setPosts(loaded ?? []), [loaded]);
  // New posts from teammates: look again every 20 s.
  useEffect(() => {
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const byToken = useMemo(() => new Map((squad ?? []).map((p) => [p.token_id, p])), [squad]);
  const people = (squad ?? []).filter((p) => p.controller);
  const online = usePresence(member ? people.map((p) => p.controller) : []);
  const here = people.filter((p) => online.has(p.controller!));
  const mine = member;

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (t: string) => {
    if (!session || !t.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const p = await postOnWall(session, clubId, t.trim());
      setPosts((ps) => [p, ...ps]);
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const now = serverNow();
  const shown = compact ? posts.slice(0, 6) : posts;
  if (!member) return null;

  return (
    <section className="paper panel wall">
      <div className="wall-head">
        <span className="k">DRESSING ROOM{club && club.manager === clubId ? ` · ${club.name.toUpperCase()}` : ""}</span>
        <span className="wall-online">
          <span className="online-dot inline" aria-hidden="true" /> {here.length} of {people.length} online
        </span>
      </div>
      {here.length > 0 && (
        <ul className="here" aria-label="Online now">
          {here.map((p) => (
            <li key={p.token_id} title={p.name} className={p.token_id === me?.token_id ? "is-me" : undefined}>
              <Head look={p.look} n={faceNumber(p.token_id)} size={34} title={p.name} />
              <span>{p.name.split(" ").slice(-1)[0]}</span>
            </li>
          ))}
        </ul>
      )}

      {mine && session ? (
        <form
          className="wall-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <div className="wall-compose">
            <textarea
              value={text}
              maxLength={WALL_MAX}
              rows={2}
              placeholder="Say something to the squad…"
              onChange={(e) => setText(e.target.value)}
              aria-label="Post on the team wall"
            />
            <button className="cta small" type="submit" disabled={busy || !text.trim()}>
              {busy ? "…" : "POST"}
            </button>
          </div>
          <div className="shouts" aria-label="Quick shouts">
            {SHOUTS.map((s) => (
              <button key={s} type="button" className="chip" disabled={busy} onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
          {err && <p className="err">{err}</p>}
        </form>
      ) : (
        <p className="note">{session ? "Sign for this club to post on its wall." : "Sign in and sign for a club to talk to your squad."}</p>
      )}

      {shown.length === 0 ? (
        <p className="note">Nothing yet. Be the first to talk to the squad.</p>
      ) : (
        <ul className="posts">
          {shown.map((p) => {
            const who = byToken.get(p.token_id);
            return (
              <li key={p.id} className={me?.token_id === p.token_id ? "mine" : ""}>
                <Head look={who?.look} n={p.ai === "coach" ? nameNumber(p.name) : faceNumber(p.token_id)} shirt={p.ai === "coach" ? "#1B2340" : undefined} size={36} />
                <div>
                  <span className="post-who">
                    <b>{p.name}</b>
                    {p.ai && (
                      <span className="ai-tag" title={p.ai === "coach" ? "The club's AI coach" : "An AI footballer of the squad"}>
                        {p.ai === "coach" ? "AI COACH" : "AI"}
                      </span>
                    )}
                    {online.has(p.account) && <span className="online-dot inline" title="Online now" />}
                    <em>{ago(p.at, now)}</em>
                  </span>
                  <p>{p.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

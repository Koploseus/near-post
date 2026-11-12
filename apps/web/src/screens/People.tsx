import { type ReactNode, useEffect, useState } from "react";
import { type Click, type Drill as DrillT, drill } from "../../../relay/src/drill.js";
import { SKILLS } from "../lib/format.js";
import { useData, useGame } from "../lib/game.js";
import {
  type ChatLine,
  type Duel,
  type DuelSkill,
  type Inbox,
  type Message,
  type Person,
  acceptFriend,
  askFriend,
  declineFriend,
  inbox,
  newDuel,
  allPeople,
  playDuel,
  removeFriend,
  sayOnTerrace,
  searchPeople,
  sendMessage,
  setFriendsOnly,
  startDuel,
  terrace,
  threadWith,
  wholeG,
} from "../lib/people.js";
import { WALL_MAX, ago } from "../lib/social.js";
import { serverNow } from "../lib/time.js";
import { toast } from "../lib/toast.js";
import { Crest, crestOf } from "./Crest.js";
import { faceNumber, Head } from "./Look.js";
import { drillGame } from "./Training.js";

type Section = "terrace" | "messages" | "friends" | "find" | "duels";
const SECTIONS: [Section, string][] = [
  ["terrace", "Terrace"],
  ["messages", "Messages"],
  ["friends", "Friends"],
  ["find", "Players"],
  ["duels", "Duels"],
];
const DUEL_SKILLS: DuelSkill[] = ["shooting", "passing", "dribbling", "pace", "defending"];
const DUEL_NAME: Record<DuelSkill, string> = { shooting: "Penalties", passing: "Through balls", dribbling: "Dribble", pace: "Sprint", defending: "Tackles" };
const skillName = (k: string) => SKILLS.find(([s]) => s === k)?.[2] ?? k;

/** "#/people/messages/<account>" → ["messages", "<account>"]. */
const where = (): [Section, string | null] => {
  const [, s, arg] = location.hash.replace(/^#\/?/, "").split("/");
  return [SECTIONS.some(([k]) => k === s) ? (s as Section) : "terrace", arg ? decodeURIComponent(arg) : null];
};

function useWhere() {
  const [w, setW] = useState(where);
  useEffect(() => {
    const on = () => setW(where());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return w;
}

/** Runs something signed and says why when it fails. */
function useAct(after?: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, said?: string) => {
    setBusy(true);
    try {
      await f();
      if (said) toast(said);
      after?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** One person: his head, his club, his rating and what you can do with him. */
function PersonRow({ p, children, rank }: { p: Person; children?: ReactNode; rank?: number }) {
  const { session } = useGame();
  const you = session?.accountId === p.account;
  return (
    <li className={`person${you ? " is-me" : ""}`}>
      {rank !== undefined && <span className="person-rank">{rank}</span>}
      <Head n={faceNumber(p.token_id)} shirt={p.club ? crestOf(p.club).main : undefined} size={40} />
      <span className="person-who">
        <b>
          {p.name}
          {you && " · YOU"}
          {p.ai && (
            <span className="ai-tag" title="An AI agent: he answers messages and plays duels by himself">
              AI
            </span>
          )}
          {p.online && <span className="online-dot inline" title="Online now" />}
        </b>
        <span className="note">
          {p.overall > 0 ? `${p.position.toUpperCase()} ${p.overall} · ` : ""}
          {p.club_name ?? "Free agent"}
          {p.value > 0 ? ` · worth ${wholeG(p.value)}` : ""}
        </span>
      </span>
      {!you && <span className="person-acts">{children}</span>}
    </li>
  );
}

/** What you can do with anyone: write, befriend, challenge. */
function Reach({ p, friend, reload }: { p: Person; friend: boolean; reload: () => void }) {
  const { session } = useGame();
  const { busy, run } = useAct(reload);
  const [pick, setPick] = useState(false);
  if (!session) return null;
  return (
    <>
      <a className="chip" href={`#/people/messages/${encodeURIComponent(p.account)}`}>
        Message
      </a>
      {!friend && (
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await askFriend(session, p.account);
              toast(r.state === "friends" ? `${p.name} and you are friends` : r.state === "asked" ? `Asked ${p.name}` : r.state === "full" ? "His list is full" : "Already asked");
            })
          }
        >
          Add friend
        </button>
      )}
      {pick ? (
        <span className="duel-pick" role="group" aria-label={`Duel ${p.name} at`}>
          {DUEL_SKILLS.map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await newDuel(session, p.account, k);
                  setPick(false);
                  location.hash = "#/people/duels";
                }, `Duel sent to ${p.name}`)
              }
            >
              {DUEL_NAME[k]}
            </button>
          ))}
        </span>
      ) : (
        <button type="button" className="chip" onClick={() => setPick(true)}>
          Duel
        </button>
      )}
    </>
  );
}

function Compose({ placeholder, send, label }: { placeholder: string; label: string; send: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="wall-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setErr(null);
        send(text.trim())
          .then(() => setText(""))
          .catch((x: unknown) => setErr(x instanceof Error ? x.message : String(x)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="wall-compose">
        <textarea value={text} maxLength={WALL_MAX} rows={2} placeholder={placeholder} onChange={(e) => setText(e.target.value)} aria-label={label} />
        <button className="cta small" type="submit" disabled={busy || !text.trim()}>
          {busy ? "…" : "SEND"}
        </button>
      </div>
      {err && <p className="err">{err}</p>}
    </form>
  );
}

/** The terrace: one chat for the whole league. */
function Terrace() {
  const { session, me } = useGame();
  const { data, reload } = useData(terrace, []);
  const [lines, setLines] = useState<ChatLine[]>([]);
  useEffect(() => setLines(data ?? []), [data]);
  useEffect(() => {
    const t = setInterval(reload, 6_000);
    return () => clearInterval(t);
  }, [reload]);
  const now = serverNow();
  return (
    <section className="paper panel wall" aria-labelledby="terrace-title">
      <div className="wall-head">
        <span className="k" id="terrace-title">
          THE TERRACE
        </span>
        <span className="note">Everyone in the league reads this.</span>
      </div>
      {session && me ? (
        <Compose
          placeholder="Say something to the whole league…"
          label="Say something on the terrace"
          send={async (t) => {
            const r = await sayOnTerrace(session, t);
            setLines((ls) => [r.line, ...ls]);
          }}
        />
      ) : (
        <p className="note">{session ? "Create your footballer to talk here." : "Sign in to talk here."}</p>
      )}
      {lines.length === 0 ? (
        <p className="note">Quiet tonight. Say the first word.</p>
      ) : (
        <ul className="posts">
          {lines.map((l) => (
            <li key={l.id} className={me?.token_id === l.token_id ? "mine" : ""}>
              <Head n={faceNumber(l.token_id)} size={36} />
              <div>
                <span className="post-who">
                  <b>{l.name}</b>
                  <em>{ago(l.at, now)}</em>
                </span>
                <p>{l.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Thread({ other }: { other: string }) {
  const { session } = useGame();
  const { data, reload } = useData(() => threadWith(session!, other), [other]);
  const [sent, setSent] = useState<Message[]>([]);
  useEffect(() => setSent([]), [data]);
  useEffect(() => {
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [reload]);
  if (!data) return <p className="sub">Opening…</p>;
  const now = serverNow();
  const all = [...data.messages, ...sent.filter((m) => !data.messages.some((x) => x.id === m.id))];
  return (
    <section className="paper panel wall" aria-label={`Messages with ${data.with.name}`}>
      <a className="link" href="#/people/messages">
        ← All messages
      </a>
      <ul className="people">
        <PersonRow p={data.with} />
      </ul>
      {all.length === 0 ? (
        <p className="note">No message yet between you two.</p>
      ) : (
        <ul className="posts thread">
          {all.map((m) => (
            <li key={m.id} className={m.from === session!.accountId ? "mine" : ""}>
              <div>
                <span className="post-who">
                  <b>{m.from === session!.accountId ? "You" : data.with.name}</b>
                  <em>{ago(m.at, now)}</em>
                </span>
                <p>{m.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.may_write ? (
        <Compose
          placeholder={`Write to ${data.with.name}…`}
          label={`Write to ${data.with.name}`}
          send={async (t) => {
            const r = await sendMessage(session!, other, t);
            setSent((s) => [...s, r.message]);
          }}
        />
      ) : (
        <p className="note">{data.with.name} only takes messages from his friends.</p>
      )}
    </section>
  );
}

function Messages({ box, reload }: { box: Inbox; reload: () => void }) {
  const { session } = useGame();
  const { busy, run } = useAct(reload);
  const now = serverNow();
  return (
    <section className="paper panel" aria-labelledby="messages-title">
      <span className="k" id="messages-title">
        MESSAGES
      </span>
      {box.threads.length === 0 ? (
        <p className="note">
          No message yet. <a href="#/people/find">Find a player</a> and write to him.
        </p>
      ) : (
        <ul className="people">
          {box.threads.map((t) => (
            <li key={t.with.account} className="person">
              <Head n={faceNumber(t.with.token_id)} shirt={t.with.club ? crestOf(t.with.club).main : undefined} size={40} />
              <a className="person-who" href={`#/people/messages/${encodeURIComponent(t.with.account)}`}>
                <b>
                  {t.with.name}
                  {t.unread > 0 && <span className="count-badge">{t.unread}</span>}
                </b>
                <span className="note">
                  {t.last.from === session!.accountId ? "You: " : ""}
                  {t.last.text.length > 60 ? `${t.last.text.slice(0, 60)}…` : t.last.text} · {ago(t.last.at, now)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <input type="checkbox" checked={box.friends_only} disabled={busy} onChange={(e) => void run(() => setFriendsOnly(session!, e.target.checked))} />
        Only my friends can write to me
      </label>
    </section>
  );
}

function Friends({ box, reload }: { box: Inbox; reload: () => void }) {
  const { session } = useGame();
  const { busy, run } = useAct(reload);
  // The friends' table: you and them, by what each is worth.
  const table = [box.me, ...box.friends].sort((a, b) => b.value - a.value);
  return (
    <>
      {box.requests.length > 0 && (
        <section className="paper panel" aria-labelledby="requests-title">
          <span className="k" id="requests-title">
            THEY ASKED TO BE YOUR FRIEND
          </span>
          <ul className="people">
            {box.requests.map((p) => (
              <PersonRow key={p.account} p={p}>
                <button type="button" className="cta small" disabled={busy} onClick={() => void run(() => acceptFriend(session!, p.account), `${p.name} and you are friends`)}>
                  Accept
                </button>
                <button type="button" className="chip" disabled={busy} onClick={() => void run(() => declineFriend(session!, p.account))}>
                  Decline
                </button>
              </PersonRow>
            ))}
          </ul>
        </section>
      )}
      <section className="paper panel" aria-labelledby="friends-title">
        <span className="k" id="friends-title">
          YOUR FRIENDS, BY VALUE
        </span>
        {box.friends.length === 0 ? (
          <p className="note">
            No friend yet. <a href="#/people/find">Find a player</a> and add him.
          </p>
        ) : (
          <ul className="people">
            {table.map((p, i) => (
              <PersonRow key={p.account} p={p} rank={i + 1}>
                <Reach p={p} friend reload={reload} />
                <button type="button" className="chip quiet" disabled={busy} onClick={() => void run(() => removeFriend(session!, p.account), `${p.name} is no longer a friend`)}>
                  Remove
                </button>
              </PersonRow>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Find({ box, reload }: { box: Inbox | null; reload: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => void searchPeople(q.trim()).then((p) => live && setFound(p)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  // Everyone, online first; more pages on demand.
  const { data: first } = useData(() => allPeople(0), []);
  const [more, setMore] = useState<Person[]>([]);
  const everyone = [...(first?.people ?? []), ...more];
  const friends = new Set(box?.friends.map((f) => f.account) ?? []);
  const list = (ps: Person[]) => (
    <ul className="people">
      {ps.map((p) => (
        <PersonRow key={p.account} p={p}>
          <Reach p={p} friend={friends.has(p.account)} reload={reload} />
        </PersonRow>
      ))}
    </ul>
  );
  return (
    <>
      <section className="paper panel" aria-labelledby="find-title">
        <span className="k" id="find-title">
          FIND A PLAYER
        </span>
        <div className="form">
          <label htmlFor="find-q">His footballer's name</label>
          <input id="find-q" value={q} maxLength={32} onChange={(e) => setQ(e.target.value)} placeholder="Two letters at least" />
        </div>
        {found && (found.length === 0 ? <p className="note">Nobody by that name.</p> : list(found))}
      </section>
      <section className="paper panel" aria-labelledby="everyone-title">
        <span className="k" id="everyone-title">
          ALL PLAYERS{first ? ` · ${first.total}` : ""}
        </span>
        {first && (
          <p className="note">
            {first.online} online now, listed first. Then the best rated.
          </p>
        )}
        {!first ? <p className="note">Looking…</p> : everyone.length === 0 ? <p className="note">Nobody has a footballer yet.</p> : list(everyone)}
        {first && everyone.length < first.total && (
          <button type="button" className="chip more-people" onClick={() => void allPeople(everyone.length).then((r) => setMore((m) => [...m, ...r.people]))}>
            Show more
          </button>
        )}
      </section>
    </>
  );
}

const duelLine = (d: Duel): string => {
  if (d.result) return `${d.result === "won" ? "You won" : d.result === "lost" ? "You lost" : "A draw"}: ${d.mine} to ${d.theirs} out of ${d.rounds}`;
  if (d.mine !== null) return `You scored ${d.mine} of ${d.rounds}. Waiting for ${d.rival.name}.`;
  return d.their_turn_done ? `${d.rival.name} has played. Your turn.` : "Nobody has played yet.";
};

function Duels({ box, reload }: { box: Inbox; reload: () => void }) {
  const { session, club } = useGame();
  const [run, setRun] = useState<{ id: number; drill: DrillT } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = serverNow();
  if (run) {
    const finish = async (clicks: Click[]) => {
      const id = run.id;
      setRun(null);
      try {
        const r = await playDuel(session!, id, clicks);
        toast(r.duel.result ? duelLine(r.duel) : `You scored ${r.duel.mine} of ${r.duel.rounds}`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      reload();
    };
    return <>{drillGame(run.drill, finish, club ? crestOf(club.manager).main : undefined)}</>;
  }
  return (
    <section className="paper panel" aria-labelledby="duels-title">
      <span className="k" id="duels-title">
        DUELS
      </span>
      <p className="note">Two players, the same drill, the better score. Nothing is staked: it is for the honour. A duel lasts a day.</p>
      {err && <p className="err">{err}</p>}
      {box.duels.length === 0 ? (
        <p className="note">
          No duel yet. <a href="#/people/find">Find a player</a> and challenge him.
        </p>
      ) : (
        <ul className="people">
          {box.duels.map((d) => (
            <li key={d.id} className={`person duel${d.result ? ` ${d.result}` : ""}`}>
              <Head n={faceNumber(d.rival.token_id)} shirt={d.rival.club ? crestOf(d.rival.club).main : undefined} size={40} />
              <span className="person-who">
                <b>
                  {DUEL_NAME[d.skill]} against {d.rival.name}
                </b>
                <span className="note">
                  {duelLine(d)} · {skillName(d.skill)} · {ago(d.at, now)}
                </span>
              </span>
              <span className="person-acts">
                {d.mine === null && !d.result && (
                  <button
                    type="button"
                    className="cta small"
                    onClick={() => {
                      setErr(null);
                      startDuel(session!, d.id)
                        .then((s) => setRun({ id: s.id, drill: drill(s.seed, s.level, s.skill) }))
                        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    PLAY
                  </button>
                )}
                {d.result && <span className={`stamp ${d.result}`}>{d.result.toUpperCase()}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** People: the terrace, your messages, your friends, finding a player and duels. */
export function People() {
  const { session, me, club } = useGame();
  const [section, arg] = useWhere();
  const signed = !!session && !!me;
  const { data: box, reload } = useData(() => (signed ? inbox(session!).catch(() => null) : Promise.resolve(null)), [session?.accountId, me?.token_id, section, arg]);
  const open = box?.duels.filter((d) => d.mine === null && !d.result).length ?? 0;
  const count: Partial<Record<Section, number>> = { messages: box?.unread ?? 0, friends: box?.requests.length ?? 0, duels: open };
  const needs = (
    <section className="paper panel">
      <p className="note">
        {session ? "Create your footballer first: people know you by him." : "Sign in and create your footballer: people know you by him."} <a href="#/locker">To the locker room</a>
      </p>
    </section>
  );
  return (
    <div className="people-page">
      <header className="people-head">
        {club && <Crest clubId={club.manager} name={club.name} size={44} />}
        <div>
          <h2>People</h2>
          <p className="note">Off the pitch: talk, make friends, challenge anyone to a drill.</p>
        </div>
      </header>
      <nav className="people-nav" aria-label="People">
        {SECTIONS.map(([k, label]) => (
          <a key={k} href={`#/people/${k}`} aria-current={k === section ? "page" : undefined}>
            {label}
            {(count[k] ?? 0) > 0 && <span className="count-badge">{count[k]}</span>}
          </a>
        ))}
      </nav>
      {section === "terrace" && <Terrace />}
      {section === "find" && <Find box={box} reload={reload} />}
      {section !== "terrace" && section !== "find" && !signed && needs}
      {section === "messages" && signed && (arg ? <Thread other={arg} /> : box ? <Messages box={box} reload={reload} /> : <p className="sub">Opening…</p>)}
      {section === "friends" && signed && (box ? <Friends box={box} reload={reload} /> : <p className="sub">Opening…</p>)}
      {section === "duels" && signed && (box ? <Duels box={box} reload={reload} /> : <p className="sub">Opening…</p>)}
    </div>
  );
}

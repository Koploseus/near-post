/**
 * The game's sounds, made here with the Web Audio API (no file to load): the
 * ball, the net, the referee's whistle, a short tune when a drill or a match
 * ends. No crowd: the stand stays silent. On unless the player turns them off; his choice is remembered on this
 * device. A browser plays nothing before the first tap, so the first tap anywhere
 * wakes the sound up.
 *
 * Kept quiet on purpose: everything goes through one soft master with a
 * limiter, each sound varies a little (pitch, length) so twenty kicks never
 * sound the same, and the frequent ones (fouls, misses) are spaced out.
 * Sounds only decorate: nothing here changes what a drill or a match records.
 */

const KEY = "near-post.sound";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

const context = (): AudioContext | null => {
  if (typeof window === "undefined" || !soundOn()) return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -18;
    limit.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(limit).connect(ctx.destination);
  }
  if (ctx.state === "suspended" && document.visibilityState === "visible") void ctx.resume().catch(() => {});
  return ctx;
};
const out = () => master!;

/** On or off: turning it on is a tap, so the whistle answers; off goes quiet at once. */
export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: it lasts for this visit.
  }
  if (on) {
    context();
    play("whistle");
  } else if (ctx) void ctx.suspend().catch(() => {});
}

if (typeof window !== "undefined") {
  // The first tap or key wakes the sound up (a browser wants one before it plays anything).
  const wake = () => void context();
  window.addEventListener("pointerdown", wake, { passive: true });
  window.addEventListener("keydown", wake);
  // Nothing plays in a tab you are not looking at.
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "hidden") void ctx.suspend().catch(() => {});
    else if (soundOn()) void ctx.resume().catch(() => {});
  });
}

// ------------------------------------------------------------ building blocks

const vary = (x: number, by = 0.05) => x * (1 + (Math.random() * 2 - 1) * by);

let noiseBuf: AudioBuffer | null = null;
const noise = (a: AudioContext) => {
  if (noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf;
  const n = a.sampleRate * 2;
  noiseBuf = a.createBuffer(1, n, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
};

const tone = (a: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, level: number, slideTo?: number) => {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.012);
  g.gain.setValueAtTime(level, at + Math.max(0.02, dur - 0.05));
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(g).connect(out());
  o.start(at);
  o.stop(at + dur + 0.02);
};

/** Filtered noise with an envelope: the net, a swish, the leather. */
const hiss = (a: AudioContext, at: number, dur: number, level: number, f0: number, f1: number, q = 0.7, attack = 0.18) => {
  const src = a.createBufferSource();
  src.buffer = noise(a);
  src.loop = true;
  src.playbackRate.value = vary(1, 0.08);
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(f0, at);
  band.frequency.linearRampToValueAtTime(f1, at + dur * 0.5);
  band.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + dur * attack);
  g.gain.linearRampToValueAtTime(level * 0.55, at + dur * 0.65);
  g.gain.linearRampToValueAtTime(0, at + dur);
  src.connect(band).connect(g).connect(out());
  src.start(at, Math.random());
  src.stop(at + dur + 0.05);
};

const whistle = (a: AudioContext, at: number, blows: number[]) => {
  let t = at;
  const f = vary(2350, 0.02);
  for (const d of blows) {
    tone(a, f, t, d, "square", 0.035, f - 50);
    tone(a, f + 30, t, d, "sine", 0.05);
    t += d + 0.09;
  }
  return t;
};

/** The ball: a dull thump, harder with more power, and a little leather click. */
const thump = (a: AudioContext, at: number, power: number) => {
  tone(a, vary(150, 0.08), at, 0.11, "sine", 0.22 + 0.2 * power, 50);
  hiss(a, at, 0.03, 0.05, 2600, 2600, 0.8, 0.2);
};

const notes = (a: AudioContext, list: [number, number][], type: OscillatorType, level: number, from: number) => {
  let at = from;
  for (const [f, d] of list) {
    tone(a, f, at, d, type, level);
    at += d * 0.92;
  }
};

// ------------------------------------------------------------ the sounds

export type Sfx =
  | "whistle" | "full_time" | "goal" | "my_goal" | "win" | "lose" | "draw" | "gain"
  | "kick" | "net" | "save" | "post" | "tackle" | "go"
  | "passed" | "failed" | "foul" | "card" | "penalty";

/** The least time (ms) between two of the same: the frequent ones never pile up. */
const GAP: Partial<Record<Sfx, number>> = { foul: 8000, card: 2500, kick: 80, tackle: 400 };
const last = new Map<Sfx, number>();

export function play(what: Sfx, power = 0.6) {
  const a = context();
  if (!a || a.state !== "running") return;
  const now = performance.now();
  const gap = GAP[what];
  if (gap && now - (last.get(what) ?? -1e9) < gap) return;
  // A card comes with its own whistle: no second one for the foul just before it.
  if (what === "foul" && now - (last.get("card") ?? -1e9) < 1500) return;
  last.set(what, now);
  const t = a.currentTime + 0.02;
  switch (what) {
    case "whistle": return void whistle(a, t, [0.22]);
    case "full_time": return void whistle(a, t, [0.18, 0.18, 0.5]);
    case "foul": case "card": return void whistle(a, t, [vary(0.2, 0.15)]);
    case "penalty": return void whistle(a, t, [0.45]);
    case "go": return void whistle(a, t, [0.12]);
    case "goal":
      return notes(a, [[523, 0.1], [659, 0.1], [784, 0.22]], "square", 0.04, t);
    case "my_goal":
      return notes(a, [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.12], [784, 0.09], [1047, 0.34]], "square", 0.05, t);
    case "win":
      return notes(a, [[523, 0.14], [523, 0.14], [659, 0.14], [784, 0.2], [659, 0.12], [784, 0.14], [1047, 0.5]], "square", 0.05, t);
    case "lose":
      return notes(a, [[392, 0.26], [349, 0.26], [311, 0.26], [262, 0.6]], "triangle", 0.07, t + 0.3);
    case "draw": return notes(a, [[440, 0.18], [494, 0.18], [440, 0.4]], "triangle", 0.07, t);
    case "gain": return notes(a, [[1319, 0.07], [1568, 0.07], [2093, 0.16]], "square", 0.03, t);
    case "kick": return thump(a, t, Math.max(0, Math.min(1, power)));
    case "net":
      return hiss(a, t, 0.35, 0.06, 3200, 5000, 0.6, 0.1);
    case "save":
      return tone(a, vary(220), t, 0.06, "sine", 0.12, 120);
    case "post":
      tone(a, vary(880, 0.03), t, 0.5, "triangle", 0.06, 860);
      return tone(a, vary(1320, 0.03), t, 0.35, "sine", 0.03);
    case "tackle":
      return hiss(a, t, 0.18, 0.07, 400, 2000, 0.9, 0.2);
    case "passed": return notes(a, [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.32]], "square", 0.045, t);
    case "failed": return notes(a, [[392, 0.2], [330, 0.4]], "triangle", 0.06, t);
  }
}

// ------------------------------------------------------------ the drills' words

let drills = 0;
/** While a drill is on screen, its big words (OLÉ!, GO!, CLEAN TACKLE!) make their sound. */
export function drillSounds(): () => void {
  drills++;
  done.clear();
  return () => void drills--;
}
const done = new Set<string>();
/** A sound that belongs to one moment of a drill (this kick, this pass): played once, however many frames draw it. */
export function once(key: string, what: Sfx, power?: number) {
  if (drills === 0 || done.has(key)) return;
  done.add(key);
  play(what, power);
}
const WORDS: Record<string, Sfx> = { "CLEAN TACKLE!": "tackle", "GO!": "go", "GOAL!": "net", "SAVED!": "save", "OFF THE POST!": "post" };
const heard = new Map<string, number>();
/** Called with each big word as it is drawn, every frame: those with a sound play it once, as they pop in. */
export function word(text: string, _good: boolean, since: number) {
  if (drills === 0 || since < 0 || since > 150) return;
  const now = performance.now();
  if (now - (heard.get(text) ?? -1e9) < 900) return;
  heard.set(text, now);
  const sfx = WORDS[text];
  if (sfx) play(sfx);
}

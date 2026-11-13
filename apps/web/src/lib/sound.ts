/**
 * The match's sounds, made here with the Web Audio API (no file to load): the
 * referee's whistle, the crowd on a goal, a short tune for a win, a defeat or
 * a draw. Off until the player turns them on; his choice is remembered on
 * this device.
 */

const KEY = "near-post.sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

const context = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
};

/** Turning it on is the tap a browser wants before it plays anything: the whistle answers. */
export function setSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode: it lasts for this visit.
  }
  if (on) play("whistle");
}

// A browser that reloaded the page with the sound on still wants a tap first.
if (typeof window !== "undefined") window.addEventListener("pointerdown", () => soundOn() && context(), { passive: true });

const tone = (a: AudioContext, freq: number, at: number, dur: number, type: OscillatorType, level: number, slideTo?: number) => {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.015);
  g.gain.setValueAtTime(level, at + Math.max(0.02, dur - 0.05));
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
};

/** The crowd: filtered noise that swells and dies. */
const crowd = (a: AudioContext, at: number, dur: number, level: number) => {
  const n = Math.floor(a.sampleRate * dur);
  const buffer = a.createBuffer(1, n, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(700, at);
  band.frequency.linearRampToValueAtTime(1500, at + dur * 0.3);
  band.Q.value = 0.7;
  const g = a.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + dur * 0.18);
  g.gain.linearRampToValueAtTime(level * 0.6, at + dur * 0.6);
  g.gain.linearRampToValueAtTime(0, at + dur);
  src.connect(band).connect(g).connect(a.destination);
  src.start(at);
};

const whistle = (a: AudioContext, at: number, blows: number[]) => {
  let t = at;
  for (const d of blows) {
    tone(a, 2350, t, d, "square", 0.05, 2300);
    tone(a, 2380, t, d, "sine", 0.07);
    t += d + 0.09;
  }
  return t;
};

export type Sfx = "whistle" | "full_time" | "goal" | "my_goal" | "win" | "lose" | "draw" | "gain";

export function play(what: Sfx) {
  if (!soundOn()) return;
  const a = context();
  if (!a) return;
  const t = a.currentTime + 0.02;
  const notes = (list: [number, number][], type: OscillatorType, level: number, from = t) => {
    let at = from;
    for (const [f, d] of list) {
      tone(a, f, at, d, type, level);
      at += d * 0.92;
    }
  };
  if (what === "whistle") whistle(a, t, [0.22]);
  else if (what === "full_time") whistle(a, t, [0.18, 0.18, 0.5]);
  else if (what === "goal") {
    crowd(a, t, 2.4, 0.22);
    notes([[523, 0.1], [659, 0.1], [784, 0.22]], "square", 0.05);
  } else if (what === "my_goal") {
    crowd(a, t, 3.4, 0.3);
    notes([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.12], [784, 0.09], [1047, 0.34]], "square", 0.06);
  } else if (what === "win") {
    crowd(a, t, 3.2, 0.2);
    notes([[523, 0.14], [523, 0.14], [659, 0.14], [784, 0.2], [659, 0.12], [784, 0.14], [1047, 0.5]], "square", 0.06);
  } else if (what === "lose") notes([[392, 0.26], [349, 0.26], [311, 0.26], [262, 0.6]], "triangle", 0.09);
  else if (what === "draw") notes([[440, 0.18], [494, 0.18], [440, 0.4]], "triangle", 0.08);
  else if (what === "gain") notes([[1319, 0.07], [1568, 0.07], [2093, 0.16]], "square", 0.04);
}

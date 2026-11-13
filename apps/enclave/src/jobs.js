// The engine here never runs promise jobs (the component is called once, synchronously, and
// every host call is synchronous). So promises are ours: the same contract as the standard
// one, with a job queue that `drain` empties before the program answers. esbuild lowers
// `async`/`await` to generators over this `Promise` (see build.mjs).
const queue = [];
export function drain() {
  while (queue.length) queue.shift()();
}

export class Jobs {
  constructor(start) {
    this.state = 0; // 0 pending, 1 fulfilled, 2 rejected
    this.value = undefined;
    this.waiting = [];
    const settle = (state, value) => {
      if (this.state) return;
      if (state === 1 && value && typeof value.then === "function") {
        try {
          value.then((v) => settle(1, v), (e) => settle(2, e));
        } catch (e) {
          settle(2, e);
        }
        return;
      }
      this.state = state;
      this.value = value;
      for (const w of this.waiting.splice(0)) queue.push(w);
    };
    try {
      start((v) => settle(1, v), (e) => settle(2, e));
    } catch (e) {
      settle(2, e);
    }
  }
  then(ok, ko) {
    return new Jobs((resolve, reject) => {
      const job = () => {
        try {
          if (this.state === 1) resolve(typeof ok === "function" ? ok(this.value) : this.value);
          else if (typeof ko === "function") resolve(ko(this.value));
          else reject(this.value);
        } catch (e) {
          reject(e);
        }
      };
      if (this.state) queue.push(job);
      else this.waiting.push(job);
    });
  }
  catch(ko) {
    return this.then(undefined, ko);
  }
  finally(f) {
    return this.then(
      (v) => Jobs.resolve(f()).then(() => v),
      (e) => Jobs.resolve(f()).then(() => { throw e; }),
    );
  }
  static resolve(v) {
    return v instanceof Jobs ? v : new Jobs((ok) => ok(v));
  }
  static reject(e) {
    return new Jobs((_, ko) => ko(e));
  }
  static all(list) {
    const items = [...list];
    return new Jobs((ok, ko) => {
      const out = new Array(items.length);
      let left = items.length;
      if (!left) ok(out);
      items.forEach((p, i) => Jobs.resolve(p).then((v) => { out[i] = v; if (!--left) ok(out); }, ko));
    });
  }
  static allSettled(list) {
    return Jobs.all([...list].map((p) => Jobs.resolve(p).then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }))));
  }
  static race(list) {
    return new Jobs((ok, ko) => { for (const p of list) Jobs.resolve(p).then(ok, ko); });
  }
}
// A timer is a job: nothing waits here.
export const later = (f, _ms, ...args) => { queue.push(() => f(...args)); return 0; };

import type { Formation, Role } from "./types.js";

/** Where each slot stands on a vertical pitch (x, y in %), own goal at the bottom. */
export const SPOTS: Record<Formation, [number, number][]> = {
  "4-4-2": [[50, 90], [14, 70], [37, 74], [63, 74], [86, 70], [14, 45], [37, 49], [63, 49], [86, 45], [38, 21], [62, 21]],
  "4-3-3": [[50, 90], [14, 70], [37, 74], [63, 74], [86, 70], [50, 56], [30, 43], [70, 43], [18, 21], [50, 15], [82, 21]],
  "3-5-2": [[50, 90], [27, 73], [50, 76], [73, 73], [11, 46], [50, 57], [31, 42], [69, 42], [89, 46], [38, 19], [62, 19]],
  "4-2-3-1": [[50, 90], [14, 70], [37, 74], [63, 74], [86, 70], [37, 56], [63, 56], [17, 33], [50, 35], [83, 33], [50, 14]],
};

export const FORMATIONS: Formation[] = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1"];

export const ROLE_LABEL: Record<Role, string> = {
  Gk: "GK", Lb: "LB", Cb: "CB", Rb: "RB", Dm: "DM", Cm: "CM", Lm: "LM", Rm: "RM", Am: "AM", Lw: "LW", Rw: "RW", St: "ST",
};

export const ROLE_NAME: Record<Role, string> = {
  Gk: "Goalkeeper", Lb: "Left back", Cb: "Centre back", Rb: "Right back", Dm: "Holding midfielder", Cm: "Central midfielder",
  Lm: "Left midfielder", Rm: "Right midfielder", Am: "Attacking midfielder", Lw: "Left winger", Rw: "Right winger", St: "Striker",
};

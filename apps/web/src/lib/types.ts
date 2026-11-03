export type Position = "Gk" | "Df" | "Mf" | "Fw";

export type Skill = "pace" | "shooting" | "passing" | "dribbling" | "defending" | "physical";
export type Skills = Record<Skill, number>;

export interface Ticket {
  id: number;
  token_id: string;
  skill: Skill;
  match_day: number;
  seed: string;
}

export interface Star {
  player: string;
  name: string;
  /** Rating × 10. */
  rating: number;
}

export type Role = "Gk" | "Lb" | "Cb" | "Rb" | "Dm" | "Cm" | "Lm" | "Rm" | "Am" | "Lw" | "Rw" | "St";
export type Formation = "4-4-2" | "4-3-3" | "3-5-2" | "4-2-3-1";
export type Strategy = "defend" | "balanced" | "attack";
export type EventKind = "goal" | "own_goal" | "saved" | "missed" | "corner" | "foul" | "yellow" | "red" | "free_kick" | "penalty" | "assist" | "tackle";

export interface MatchEvent {
  second: number;
  home: boolean;
  kind: EventKind;
  player: number;
}

export interface Lineup {
  formation: Formation;
  strategy: Strategy;
  roles: Role[];
  players: (Player | null)[];
  chosen: boolean[];
}

export interface MatchStats {
  home_shots: number;
  away_shots: number;
  home_on_target: number;
  away_on_target: number;
  home_possession: number;
  away_possession: number;
  home_corners: number;
  away_corners: number;
  home_fouls: number;
  away_fouls: number;
  home_yellows: number;
  away_yellows: number;
  home_reds: number;
  away_reds: number;
  man_of_the_match: Star | null;
}

export interface Look {
  hair: string | null;
  boots: string | null;
  band: string | null;
}

export interface CatalogItem {
  id: string;
  kind: "hair" | "boots" | "band";
  style: string;
  rarity: "common" | "rare" | "epic" | "legendary";
}

export interface Player {
  look?: Look;
  token_id: string;
  name: string;
  position: Position;
  skills: Skills;
  overall: number;
  attack: number;
  defence: number;
  owner: string;
  goals: number;
  wallet: string;
  controller: string | null;
  salary: string;
  last_trained_day: number;
}

export interface Club {
  name: string;
  manager: string;
  division: number;
  fans: number;
  full_house_streak: number;
  best_streak: number;
  treasury: string;
  rival: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

export interface Goal {
  for_home: boolean;
  minute: number;
  kind: "Normal" | "Late" | "Own";
  player: string;
  name: string;
}

export interface MatchResult {
  home: string;
  away: string;
  home_goals: number;
  away_goals: number;
  derby: boolean;
  goals: Goal[];
  stats: MatchStats;
  events: MatchEvent[];
  /** First half home, first half away, then the second half. "" is an empty slot. */
  elevens: string[][];
  formations: Formation[];
  strategies: Strategy[];
  half_ends: number[];
  possession: number[];
  first_half_events: number;
  /** 1 is the top division. */
  division: number;
  full_time: boolean;
}

export interface StandResult {
  present: number;
  fans: number;
  full_house: boolean;
  multiplier: number;
  burned: string;
}

export interface Stand {
  match_day: number;
  present: number;
  fans: number;
  target: number;
  full_house: boolean;
}

export interface Schedule {
  match_day: number;
  next_match_at_ms: string;
  interval_ms: string;
  kickoff_at_ms: string;
  last_kickoff_at_ms: string;
  first_half_played: boolean;
  half_ms: string;
  half_time_ms: string;
  season: number;
  season_day: number;
  season_days: number;
  divisions: number;
}

export interface Career {
  trained_by: string;
  past_clubs: string[];
  controller: string | null;
}

export interface Offer {
  id: number;
  token_id: string;
  buyer: string;
  price: string;
  state: "Open" | "Accepting" | "Sold" | "Cancelled";
  match_day: number;
}

export interface Captain {
  token_id: string;
  name: string;
  week: number;
  votes: number;
}

/** Set-piece takers a captain named (token ids). */
export interface Takers {
  free_kick: string | null;
  penalty: string | null;
}

/** Stands in for a missing player in a match's elevens. */
export const BOT = "academy";

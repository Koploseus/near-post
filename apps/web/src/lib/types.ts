export type Position = "Gk" | "Df" | "Mf" | "Fw";

export interface Player {
  token_id: string;
  name: string;
  position: Position;
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

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

/** What a footballer can wear. Hair is looks only; every other kind adds to one skill on the pitch. */
export type ItemKind = "hair" | "boots" | "band" | "socks" | "pads" | "gloves" | "wrist" | "tape";

export type Look = Record<ItemKind, string | null>;

export interface CatalogItem {
  id: string;
  kind: ItemKind;
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
  /** Energy today, 0 to 100. Under 50, skills drop. */
  energy: number;
  /** Trainings he can still take without paying. */
  free_trainings: number;
  contract: Contract | null;
}

/** A person's contract with a club. */
export interface Contract {
  club: string;
  /** Paid at each match he starts. */
  wage: string;
  from_day: number;
  /** The last match day of the contract. */
  until_day: number;
  /** What another club pays to take him before the end. */
  clause: string;
  /** Matches in a row he started without being paid. */
  unpaid: number;
}

export type Project = "stadium" | "physio" | "academy" | "save";

/** The league's rules (`rules` view): the ones the app shows. */
export interface Rules {
  full_house_mint_per_fan: string;
  stadium_target_bps: number;
  empty_stand_burn_bps: number;
  goal_mint: string;
  training_cost: string;
  pack_price: string;
  season_ticket_price: string;
  season_ticket_share: string;
  week_length: number;
  item_bonus: number[];
  ola_window_ms: string;
  ola_target_bps: number;
  ola_bonus_bps: number;
  derby_flag_days: number;
  debut_bonus: string;
  energy_match: number;
  energy_training: number;
  energy_per_day: number;
  energy_rest: number;
  tired_below: number;
  tired_malus_pct: number;
  contract_days: number[];
  default_contract_days: number;
  /** Of a sale's price, to the person who plays the footballer (basis points). */
  player_sale_bps: number;
  clause_factor: number;
  unpaid_to_free: number;
  max_wage: string;
  fans_star_prize: string;
  tifo_patterns: number;
  project_cost: string[];
  project_max: number[];
  stadium_bonus_bps: number;
  physio_energy: number;
  academy_bonus: number;
  ticket_revenue_bps: number;
  instruction_points: number;
  diet_price: string;
  diet_days: number;
  diet_energy: number;
  diet_skill: number;
  holiday_max_days: number;
  injury_below: number;
  injury_chance_pct: number;
  injury_days: number;
}

export type Instruction = "balanced" | "shooter" | "playmaker" | "dribbler" | "stopper";
export type Diet = "energy" | "power" | "speed";

/** A footballer's life around the match. Days are match days, the last one included; 0 means never. */
export interface Condition {
  instruction: Instruction;
  diet: Diet | null;
  diet_until: number;
  holiday_until: number;
  injured_until: number;
}

export type Recruitment = "open" | "vote";

/** A person who signed for a club and is not there yet. */
export interface Applicant {
  token_id: string;
  name: string;
  overall: number;
  days: number;
  yes: number;
  no: number;
  approved: boolean;
}

export interface Gift {
  from: string;
  amount: string;
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
  /** The rival that won the last derby, and until which match day its colours fly here. */
  flag: { by: string; until_day: number } | null;
  /** What the club offers a person per match he starts. */
  wage: string;
  stadium: number;
  physio: number;
  academy: number;
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
  /** The fans did the ola: the full-house reward is higher. */
  ola: boolean;
  stadium: number;
  /** The player the stand voted star of the match, and the tifo it chose. */
  star: string | null;
  tifo: number | null;
  burned: string;
}

export interface Stand {
  match_day: number;
  present: number;
  fans: number;
  target: number;
  full_house: boolean;
  /** Fans who came in the ola window, and how many make the ola. */
  ola: number;
  ola_target: number;
  /** The fans' votes so far: [player, votes] and votes by tifo pattern. */
  star_votes: [string, number][];
  tifo_votes: number[];
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

/** A club's line in a division's final table (league `final_table`). */
export interface FinalRow {
  club_id: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
  /** 1 promoted, -1 relegated, 0 stayed. */
  moved: number;
}

/** A division's winner in a past season (league `champions`). */
export interface Champion {
  season: number;
  division: number;
  club_id: string;
  name: string;
  points: number;
  won: number;
  drawn: number;
  lost: number;
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

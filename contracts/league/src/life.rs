//! A footballer's life around the match (v10), and two more decisions a club
//! takes together.
//!
//! - An instruction: the person tells his footballer how to play. It moves
//!   `instruction_points` from one skill to another on the pitch.
//! - A diet: paid in G (burned), it lasts `diet_days` match days and gives
//!   energy back faster, or adds to one skill on the pitch.
//! - A holiday: up to `holiday_max_days` match days nobody picks him. He
//!   rests, an academy kid plays.
//! - An injury: a person who ends a match under `injury_below` energy can be
//!   hurt and miss the next match days. A club's physio shortens it.
//! - A gift: anyone can pay G into a club's treasury.
//! - Recruitment by vote: a club that chose it takes a free agent only once
//!   its people said yes.

use crate::play::ByteStream;
use crate::{
    BURN_GAS, League, LeagueExt, RELEASE_GAS, Skills, derive_seed, ext_goalars, ext_players,
    the_rules,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

/// How a person tells his footballer to play.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Instruction {
    #[default]
    Balanced,
    /// Shoots more, passes less.
    Shooter,
    /// Passes more, shoots less.
    Playmaker,
    /// Takes his man on, defends less.
    Dribbler,
    /// Defends more, dribbles less.
    Stopper,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Diet {
    /// More energy back every match day.
    Energy,
    /// More physical on the pitch.
    Power,
    /// More pace on the pitch.
    Speed,
}

/// What the league knows about a footballer besides his skills. Days are
/// match days, the last one included; 0 means never.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Condition {
    pub instruction: Instruction,
    pub diet: Option<Diet>,
    pub diet_until: u32,
    pub holiday_until: u32,
    pub injured_until: u32,
}

/// `msg` of a diet: `{"diet":{"token_id":"p12","diet":"energy"}}`.
#[near(serializers = [json])]
pub struct DietOrder {
    pub token_id: String,
    pub diet: Diet,
}

/// How a club takes free agents.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Recruitment {
    /// Anyone who signs joins.
    #[default]
    Open,
    /// The club's people vote on each applicant.
    Vote,
}

/// A person who gave his word to a club, and what the club says so far.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Applicant {
    pub token_id: String,
    pub name: String,
    pub overall: u8,
    pub days: u32,
    pub yes: u32,
    pub no: u32,
    pub approved: bool,
}

/// What an account gave to a club's treasury, in all.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Gift {
    pub from: AccountId,
    pub amount: U128,
}

/// Gifts a club keeps on its board (the biggest).
pub const GIFT_BOARD: usize = 20;
/// Applicants a club keeps on its list.
pub const MAX_APPLICANTS: usize = 30;

fn shift(up: &mut u8, down: &mut u8, points: u8) {
    *up = up.saturating_add(points).min(99);
    *down = down.saturating_sub(points).max(1);
}

/// Skills as the instruction bends them: what one skill gains, another loses.
pub fn instructed(mut s: Skills, instruction: Instruction, points: u8) -> Skills {
    match instruction {
        Instruction::Balanced => {}
        Instruction::Shooter => shift(&mut s.shooting, &mut s.passing, points),
        Instruction::Playmaker => shift(&mut s.passing, &mut s.shooting, points),
        Instruction::Dribbler => shift(&mut s.dribbling, &mut s.defending, points),
        Instruction::Stopper => shift(&mut s.defending, &mut s.dribbling, points),
    }
    s
}

/// Skills with a diet running. The energy diet works off the pitch.
pub fn fed(mut s: Skills, diet: Option<Diet>, points: u8) -> Skills {
    match diet {
        Some(Diet::Power) => s.physical = s.physical.saturating_add(points).min(99),
        Some(Diet::Speed) => s.pace = s.pace.saturating_add(points).min(99),
        Some(Diet::Energy) | None => {}
    }
    s
}

#[near]
impl League {
    /// The caller tells his footballer how to play, from the next half on.
    pub fn set_instruction(&mut self, instruction: Instruction) {
        let token = self.my_footballer();
        self.conditions.entry(token).or_default().instruction = instruction;
    }

    /// The caller's footballer goes on holiday for `days` match days, today
    /// included: nobody picks him and he rests. Until a minute before kick-off.
    pub fn go_on_holiday(&mut self, days: u32) {
        let token = self.my_footballer();
        require!(
            (1..=the_rules().holiday_max_days).contains(&days),
            "a holiday lasts 1 to holiday_max_days match days"
        );
        require!(
            env::block_timestamp().saturating_add(60_000_000_000) <= self.kickoff_ns,
            "the team sheet closed a minute before kick-off"
        );
        let day = self.match_day;
        self.conditions
            .entry(token.clone())
            .or_default()
            .holiday_until = day + days - 1;
        let club = self.players.get(&token).map(|p| p.owner.clone()).unwrap();
        if let Some(slots) = self.slots.get_mut(&(club, day)) {
            for s in slots.iter_mut() {
                if s.as_ref() == Some(&token) {
                    *s = None;
                }
            }
        }
    }

    /// The caller's footballer comes back from holiday now.
    pub fn end_holiday(&mut self) {
        let token = self.my_footballer();
        if let Some(c) = self.conditions.get_mut(&token) {
            c.holiday_until = 0;
        }
    }

    pub fn condition_of(&self, token_id: String) -> Condition {
        self.conditions.get(&token_id).cloned().unwrap_or_default()
    }

    /// The same for several players, in order.
    pub fn conditions_of(&self, token_ids: Vec<String>) -> Vec<Condition> {
        token_ids
            .into_iter()
            .map(|t| self.condition_of(t))
            .collect()
    }

    /// Who leads a club chooses how it takes free agents.
    pub fn set_recruitment(&mut self, club_id: AccountId, recruitment: Recruitment) {
        require!(
            self.leads(&club_id, &env::predecessor_account_id()),
            "only the captain (or the manager, without one) sets the recruitment"
        );
        self.recruitment.insert(club_id, recruitment);
    }

    pub fn recruitment_of(&self, club_id: AccountId) -> Recruitment {
        self.recruitment.get(&club_id).copied().unwrap_or_default()
    }

    /// The caller, who plays for the club the applicant signed for (or leads
    /// it), says yes or no to him. One vote each, which he can change.
    pub fn vote_recruit(&mut self, token_id: String, yes: bool) {
        let voter = env::predecessor_account_id();
        let club = self
            .signings
            .get(&token_id)
            .map(|s| s.club.clone())
            .unwrap_or_else(|| env::panic_str("he signed for no club"));
        let plays_there = self
            .footballer_of
            .get(&voter)
            .and_then(|t| self.players.get(t))
            .is_some_and(|p| p.owner == club && p.contract.is_some());
        require!(
            plays_there || self.leads(&club, &voter),
            "only that club's people vote on its applicants"
        );
        let votes = self.recruit_votes.entry((club, token_id)).or_default();
        votes.retain(|(v, _)| v != &voter);
        votes.push((voter, yes));
    }

    /// The people who signed for a club and are not there yet.
    pub fn applicants(&self, club_id: AccountId) -> Vec<Applicant> {
        self.applicant_ids
            .get(&club_id)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|t| {
                let s = self.signings.get(&t).filter(|s| s.club == club_id)?;
                let p = self.players.get(&t)?;
                let (yes, no) = self.recruit_count(&club_id, &t);
                Some(Applicant {
                    token_id: t,
                    name: p.name.clone(),
                    overall: p.overall,
                    days: s.days,
                    yes,
                    no,
                    approved: yes > no,
                })
            })
            .collect()
    }

    /// The biggest gifts a club got, the biggest first.
    pub fn gifts_of(&self, club_id: AccountId) -> Vec<Gift> {
        self.gifts.get(&club_id).cloned().unwrap_or_default()
    }
}

impl League {
    fn my_footballer(&self) -> String {
        self.footballer_of
            .get(&env::predecessor_account_id())
            .cloned()
            .unwrap_or_else(|| env::panic_str("create your footballer first"))
    }

    fn recruit_count(&self, club: &AccountId, token: &str) -> (u32, u32) {
        let votes = self
            .recruit_votes
            .get(&(club.clone(), token.to_owned()))
            .cloned()
            .unwrap_or_default();
        let yes = votes.iter().filter(|(_, y)| *y).count() as u32;
        (yes, votes.len() as u32 - yes)
    }

    /// Whether a free agent may join a club today: always when it recruits
    /// openly, else once more of its people said yes than no.
    pub(crate) fn may_join(&self, club: &AccountId, token: &str) -> bool {
        if self.recruitment_of(club.clone()) == Recruitment::Open {
            return true;
        }
        let (yes, no) = self.recruit_count(club, token);
        yes > no
    }

    /// Keeps a club's list of applicants in step with `sign_for`.
    pub(crate) fn note_applicant(&mut self, club: &AccountId, token: &String) {
        let list = self.applicant_ids.entry(club.clone()).or_default();
        list.retain(|t| t != token);
        if list.len() == MAX_APPLICANTS {
            list.remove(0);
        }
        list.push(token.clone());
    }

    pub(crate) fn drop_applicant(&mut self, club: &AccountId, token: &String) {
        if let Some(list) = self.applicant_ids.get_mut(club) {
            list.retain(|t| t != token);
        }
        self.recruit_votes.remove(&(club.clone(), token.clone()));
    }

    /// Sends a free agent the club did not vote in back to his person.
    pub(crate) fn send_back(&mut self, token: String, person: AccountId) {
        ext_players::ext(self.players_id.clone())
            .with_static_gas(RELEASE_GAS)
            .league_transfer(token, person, U128(0))
            .detach();
    }

    /// Whether a person's footballer is on holiday or injured today.
    pub(crate) fn away(&self, token: &String) -> bool {
        self.conditions
            .get(token)
            .is_some_and(|c| c.holiday_until >= self.match_day || c.injured_until >= self.match_day)
    }

    /// A diet for a footballer, paid `amount` G by the person who plays him:
    /// burned. A new diet replaces the one running.
    pub(crate) fn feed(&mut self, sender: AccountId, amount: U128, order: DietOrder) {
        let rules = the_rules();
        require!(
            amount == rules.diet_price,
            "a diet costs exactly diet_price"
        );
        let player = self
            .players
            .get(&order.token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(
            player.controller.as_ref() == Some(&sender),
            "you do not play that footballer"
        );
        let until = self.match_day + rules.diet_days - 1;
        let c = self.conditions.entry(order.token_id.clone()).or_default();
        c.diet = Some(order.diet);
        c.diet_until = until;
        self.log("diet", Some(sender), amount.0, false);
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(BURN_GAS)
            .burn(amount, Some(format!("diet {}", order.token_id)))
            .detach();
    }

    /// G given to a club: they go to its treasury, and the giver to its board.
    pub(crate) fn give(&mut self, from: AccountId, amount: U128, club: AccountId) {
        require!(amount.0 > 0, "a gift is more than zero");
        let c = self
            .clubs
            .get_mut(&club)
            .unwrap_or_else(|| env::panic_str("no such club"));
        c.treasury = U128(c.treasury.0 + amount.0);
        let board = self.gifts.entry(club).or_default();
        match board.iter_mut().find(|g| g.from == from) {
            Some(g) => g.amount = U128(g.amount.0 + amount.0),
            None => board.push(Gift { from, amount }),
        }
        board.sort_by_key(|g| std::cmp::Reverse(g.amount.0));
        board.truncate(GIFT_BOARD);
    }

    /// The diet of a footballer today, if one is running.
    pub(crate) fn diet_now(&self, c: &Condition) -> Option<Diet> {
        c.diet.filter(|_| c.diet_until >= self.match_day)
    }

    /// After a match he started: a person who ended it under `injury_below`
    /// energy may be hurt, the more so the less he had left (up to
    /// `injury_chance_pct` at zero). He misses `injury_days` match days, one
    /// fewer per physio level, at least one.
    pub(crate) fn maybe_injure(&mut self, club: &AccountId, token: &String) {
        let rules = the_rules();
        let Some(p) = self.players.get(token).filter(|p| p.controller.is_some()) else {
            return;
        };
        let energy = self.energy_now(p);
        if energy >= rules.injury_below {
            return;
        }
        let n: u64 = token.trim_start_matches('p').parse().unwrap_or(0);
        let mut stream = ByteStream::new(derive_seed(
            env::random_seed_array(),
            &[self.match_day as u64, n, 13],
        ));
        let chance = (rules.injury_below - energy) as u32 * rules.injury_chance_pct as u32
            / rules.injury_below as u32;
        if (stream.next() as u32 * 100) / 256 >= chance {
            return;
        }
        let physio = self.clubs.get(club).map_or(0, |c| c.physio) as u32;
        let days = rules.injury_days.saturating_sub(physio).max(1);
        self.conditions
            .entry(token.clone())
            .or_default()
            .injured_until = self.match_day + days;
    }
}

//! League: the rules of NEAR Post. It is the only account that can mint goalars,
//! create players and items. There is no owner and no upgrade method: the rules
//! are fixed at deploy time and readable by anyone with `rules()`.
//!
//! Clubs, fans, stadium check-in, the welcome grant, and match days: anyone can
//! call `play_match_day` once it is due. Each match day plays every fixture,
//! credits goals, settles every stand (full house or 2% treasury burn) and
//! opens the next day.
//!
//! Where the G go: a club's share of goals goes to its treasury, which this
//! contract holds as real G (so penalties can burn it). Personal rewards
//! (goal shares for the manager until squads exist, full-house rewards for
//! fans) are credited and minted when the account calls `claim`; like every
//! mint, they are scaled under the 10B cap at that moment.

mod play;

pub use play::{Goal, GoalKind, fixtures, play_match};

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, PromiseError, env, ext_contract,
    near, require,
};

/// 1 G in the token's smallest unit (goalars has 6 decimals).
pub const ONE_G: u128 = 1_000_000;
/// The fixture list is bounded so a match day always fits in one transaction.
pub const MAX_CLUBS: u32 = 64;

/// The economy, in G and basis points (out of 10_000). Fixed forever.
/// Mints are nominal: the goalars contract scales each one by the room left
/// under the 10B cap.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    pub goal_mint: U128,
    pub goal_scorer_share: U128,
    pub goal_club_share: U128,
    pub late_goal_multiplier: u32,
    pub own_goal_burn: U128,
    pub derby_multiplier: u32,
    pub stadium_target_bps: u32,
    pub full_house_mint_per_fan: U128,
    pub empty_stand_burn_bps: u32,
    pub relegation_burn_bps: u32,
    /// Paid once per account, on its first club or follow.
    pub signup_grant: U128,
    /// Paid on each of an account's first `welcome_visits` stadium check-ins.
    pub welcome_bonus: U128,
    pub welcome_visits: u8,
    pub training_cost: U128,
    pub sale_tax_bps: u32,
    /// Hard cap, enforced by the goalars contract: every mint is scaled by
    /// (cap - supply) / cap.
    pub max_supply: U128,
    pub trainer_bps: u32,
    pub past_club_bps: u32,
    pub points_win: u32,
    pub points_draw: u32,
}

pub fn the_rules() -> Rules {
    Rules {
        goal_mint: U128(6_000_000 * ONE_G),
        goal_scorer_share: U128(4_200_000 * ONE_G),
        goal_club_share: U128(1_800_000 * ONE_G),
        late_goal_multiplier: 2,
        own_goal_burn: U128(6_000_000 * ONE_G),
        derby_multiplier: 2,
        stadium_target_bps: 6_000,
        full_house_mint_per_fan: U128(100_000 * ONE_G),
        empty_stand_burn_bps: 200,
        relegation_burn_bps: 1_000,
        signup_grant: U128(1_000_000 * ONE_G),
        welcome_bonus: U128(1_000_000 * ONE_G),
        welcome_visits: 4,
        training_cost: U128(400_000 * ONE_G),
        sale_tax_bps: 300,
        max_supply: U128(10_000_000_000 * ONE_G),
        trainer_bps: 1_000,
        past_club_bps: 200,
        points_win: 3,
        points_draw: 1,
    }
}

#[ext_contract(ext_goalars)]
pub trait Goalars {
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) -> U128;
    fn burn(&mut self, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_treasury_minted(&mut self, nominal: Vec<(AccountId, U128)>) -> U128;
    fn on_claim_minted(&mut self, account_id: AccountId, amount: U128) -> U128;
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Clubs,
    ClubIds,
    FanOf,
    Present,
    Attendance,
    Welcome,
    Results,
    Stands,
    StandClaims,
    Credits,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Club {
    pub name: String,
    pub manager: AccountId,
    pub division: u8,
    pub fans: u32,
    pub full_house_streak: u32,
    pub best_streak: u32,
    /// G held by the league for this club.
    pub treasury: U128,
    /// A derby is played when two clubs name each other.
    pub rival: Option<AccountId>,
    pub played: u32,
    pub won: u32,
    pub drawn: u32,
    pub lost: u32,
    pub goals_for: u32,
    pub goals_against: u32,
    pub points: u32,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Stand {
    pub match_day: u32,
    pub present: u32,
    pub fans: u32,
    /// Fans needed for a full house (60% of fans, rounded up).
    pub target: u32,
    pub full_house: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct MatchResult {
    pub home: AccountId,
    pub away: AccountId,
    pub home_goals: u8,
    pub away_goals: u8,
    pub derby: bool,
    pub goals: Vec<Goal>,
}

/// How a club's stand ended on a match day.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct StandResult {
    pub present: u32,
    pub fans: u32,
    pub full_house: bool,
    /// 2 in a derby, else 1.
    pub multiplier: u32,
    /// G burned from the treasury when the tifo was not complete.
    pub burned: U128,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Schedule {
    pub match_day: u32,
    /// Unix time in milliseconds after which anyone can play the match day.
    pub next_match_at_ms: U64,
    pub interval_ms: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct League {
    goalars_id: AccountId,
    players_id: AccountId,
    items_id: AccountId,
    match_day: u32,
    interval_ns: u64,
    next_match_at_ns: u64,
    /// Club id is the manager's account.
    clubs: LookupMap<AccountId, Club>,
    club_ids: Vector<AccountId>,
    fan_of: LookupMap<AccountId, AccountId>,
    present: LookupSet<(AccountId, u32, AccountId)>,
    attendance: LookupMap<(AccountId, u32), u32>,
    /// Accounts that got the signup grant, with how many welcome bonuses they got.
    welcome: LookupMap<AccountId, u8>,
    results: LookupMap<u32, Vec<MatchResult>>,
    stands: LookupMap<(AccountId, u32), StandResult>,
    stand_claims: LookupSet<(AccountId, u32, AccountId)>,
    /// Nominal G an account can claim.
    credits: LookupMap<AccountId, u128>,
}

const MINT_GAS: Gas = Gas::from_tgas(10);
const BURN_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const MAX_NAME: usize = 32;
const MS: u64 = 1_000_000;

#[near]
impl League {
    /// `match_interval_ms`: time between match days, fixed for the life of
    /// the league (a day in production, minutes for a demo).
    #[init]
    pub fn new(
        goalars_id: AccountId,
        players_id: AccountId,
        items_id: AccountId,
        match_interval_ms: U64,
    ) -> Self {
        require!(
            match_interval_ms.0 >= 60_000,
            "match interval must be at least a minute"
        );
        let interval_ns = match_interval_ms.0 * MS;
        Self {
            goalars_id,
            players_id,
            items_id,
            match_day: 1,
            interval_ns,
            next_match_at_ns: env::block_timestamp() + interval_ns,
            clubs: LookupMap::new(StorageKey::Clubs),
            club_ids: Vector::new(StorageKey::ClubIds),
            fan_of: LookupMap::new(StorageKey::FanOf),
            present: LookupSet::new(StorageKey::Present),
            attendance: LookupMap::new(StorageKey::Attendance),
            welcome: LookupMap::new(StorageKey::Welcome),
            results: LookupMap::new(StorageKey::Results),
            stands: LookupMap::new(StorageKey::Stands),
            stand_claims: LookupSet::new(StorageKey::StandClaims),
            credits: LookupMap::new(StorageKey::Credits),
        }
    }

    pub fn rules(&self) -> Rules {
        the_rules()
    }

    pub fn contracts(&self) -> (AccountId, AccountId, AccountId) {
        (
            self.goalars_id.clone(),
            self.players_id.clone(),
            self.items_id.clone(),
        )
    }

    pub fn match_day(&self) -> u32 {
        self.match_day
    }

    pub fn schedule(&self) -> Schedule {
        Schedule {
            match_day: self.match_day,
            next_match_at_ms: U64(self.next_match_at_ns / MS),
            interval_ms: U64(self.interval_ns / MS),
        }
    }

    // ---- Clubs and fans ----

    /// Creates the caller's club in Division 3. A new account gets the signup grant.
    pub fn create_club(&mut self, name: String) {
        let manager = env::predecessor_account_id();
        let name = name.trim().to_string();
        require!(
            !name.is_empty() && name.chars().count() <= MAX_NAME,
            "club name must be 1 to 32 characters"
        );
        require!(
            !self.clubs.contains_key(&manager),
            "you already manage a club"
        );
        require!(self.club_ids.len() < MAX_CLUBS, "the league is full");
        self.clubs.insert(
            manager.clone(),
            Club {
                name,
                manager: manager.clone(),
                division: 3,
                fans: 0,
                full_house_streak: 0,
                best_streak: 0,
                treasury: U128(0),
                rival: None,
                played: 0,
                won: 0,
                drawn: 0,
                lost: 0,
                goals_for: 0,
                goals_against: 0,
                points: 0,
            },
        );
        self.club_ids.push(manager.clone());
        self.welcome(&manager);
    }

    /// The caller's club names its rival. When two clubs name each other, their
    /// matches are derbies: what the stands mint or burn is doubled.
    pub fn set_rival(&mut self, rival: Option<AccountId>) {
        let manager = env::predecessor_account_id();
        if let Some(r) = &rival {
            require!(r != &manager, "a club cannot be its own rival");
            require!(self.clubs.contains_key(r), "no such club");
        }
        let club = self
            .clubs
            .get_mut(&manager)
            .unwrap_or_else(|| env::panic_str("you do not manage a club"));
        club.rival = rival;
    }

    pub fn get_club(&self, club_id: AccountId) -> Option<Club> {
        self.clubs.get(&club_id).cloned()
    }

    /// Clubs in standing order: points, goal difference, goals scored, then name.
    pub fn table(&self) -> Vec<Club> {
        let mut clubs: Vec<Club> = self
            .club_ids
            .iter()
            .filter_map(|id| self.clubs.get(id).cloned())
            .collect();
        clubs.sort_by(|a, b| {
            let gd = |c: &Club| c.goals_for as i64 - c.goals_against as i64;
            b.points
                .cmp(&a.points)
                .then(gd(b).cmp(&gd(a)))
                .then(b.goals_for.cmp(&a.goals_for))
                .then(a.name.cmp(&b.name))
        });
        clubs
    }

    /// How many welcome bonuses an account has received, or None before its signup grant.
    pub fn welcome_status(&self, account_id: AccountId) -> Option<u8> {
        self.welcome.get(&account_id).copied()
    }

    /// The caller becomes a fan of `club_id` (one club at a time).
    pub fn follow(&mut self, club_id: AccountId) {
        require!(self.clubs.contains_key(&club_id), "no such club");
        let fan = env::predecessor_account_id();
        self.welcome(&fan);
        if let Some(previous) = self.fan_of.get(&fan).cloned() {
            if previous == club_id {
                return;
            }
            if let Some(c) = self.clubs.get_mut(&previous) {
                c.fans = c.fans.saturating_sub(1);
            }
        }
        self.fan_of.insert(fan, club_id.clone());
        if let Some(c) = self.clubs.get_mut(&club_id) {
            c.fans += 1;
        }
    }

    /// The caller takes their seat for their club's current match day. Free, once
    /// per day. The first `welcome_visits` check-ins of an account each pay the welcome bonus.
    pub fn check_in(&mut self) -> Stand {
        let fan = env::predecessor_account_id();
        let club_id = self
            .fan_of
            .get(&fan)
            .cloned()
            .unwrap_or_else(|| env::panic_str("follow a club first"));
        let day = self.match_day;
        require!(
            self.present.insert((club_id.clone(), day, fan.clone())),
            "already in the stand"
        );
        *self.attendance.entry((club_id.clone(), day)).or_insert(0) += 1;
        let rules = the_rules();
        if let Some(paid) = self.welcome.get_mut(&fan)
            && *paid < rules.welcome_visits
        {
            *paid += 1;
            self.mint(fan, rules.welcome_bonus, "welcome bonus");
        }
        self.stand(club_id)
    }

    pub fn stand(&self, club_id: AccountId) -> Stand {
        let club = self
            .clubs
            .get(&club_id)
            .unwrap_or_else(|| env::panic_str("no such club"));
        let present = self
            .attendance
            .get(&(club_id.clone(), self.match_day))
            .copied()
            .unwrap_or(0);
        let target = full_house_target(club.fans);
        Stand {
            match_day: self.match_day,
            present,
            fans: club.fans,
            target,
            full_house: club.fans > 0 && present >= target,
        }
    }

    // ---- Match days ----

    /// Plays the current match day. Anyone can call it once it is due; the
    /// relay does it on schedule. Plays every fixture, credits goals, settles
    /// every stand, then opens the next match day.
    pub fn play_match_day(&mut self) -> Vec<MatchResult> {
        let now = env::block_timestamp();
        require!(now >= self.next_match_at_ns, "the match day is not due yet");
        let day = self.match_day;
        let rules = the_rules();
        let ids: Vec<AccountId> = self.club_ids.iter().cloned().collect();
        let block_seed = env::random_seed_array();

        let mut results = Vec::new();
        let mut treasury_mints: Vec<(AccountId, u128)> = Vec::new();
        let mut burn_total: u128 = 0;
        let mut derby_clubs: Vec<AccountId> = Vec::new();

        for (index, (h, a)) in fixtures(ids.len(), day - 1).into_iter().enumerate() {
            let (home, away) = (ids[h].clone(), ids[a].clone());
            let goals = play_match(play::match_seed(block_seed, day, index as u32));
            let derby = self.are_rivals(&home, &away);
            if derby {
                derby_clubs.push(home.clone());
                derby_clubs.push(away.clone());
            }
            let (mut hg, mut ag) = (0u8, 0u8);
            for g in &goals {
                let (scorer, at_fault) = if g.for_home {
                    hg += 1;
                    (&home, &away)
                } else {
                    ag += 1;
                    (&away, &home)
                };
                match g.kind {
                    GoalKind::Own => {
                        burn_total += self.take_from_treasury(at_fault, rules.own_goal_burn.0);
                    }
                    GoalKind::Normal | GoalKind::Late => {
                        let k = if g.kind == GoalKind::Late {
                            rules.late_goal_multiplier as u128
                        } else {
                            1
                        };
                        let manager = self.clubs.get(scorer).map(|c| c.manager.clone());
                        if let Some(m) = manager {
                            *self.credits.entry(m).or_insert(0) += k * rules.goal_scorer_share.0;
                        }
                        treasury_mints.push((scorer.clone(), k * rules.goal_club_share.0));
                    }
                }
            }
            self.record_score(&home, hg, ag, &rules);
            self.record_score(&away, ag, hg, &rules);
            results.push(MatchResult {
                home,
                away,
                home_goals: hg,
                away_goals: ag,
                derby,
                goals,
            });
        }

        for id in &ids {
            let k = if derby_clubs.contains(id) {
                rules.derby_multiplier
            } else {
                1
            };
            burn_total += self.settle_stand(id, day, k, &rules);
        }

        self.results.insert(day, results.clone());
        self.match_day += 1;
        self.next_match_at_ns = now + self.interval_ns;

        if burn_total > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(BURN_GAS)
                .burn(U128(burn_total), Some(format!("match day {day}")))
                .detach();
        }
        let nominal: Vec<(AccountId, U128)> = merge(treasury_mints)
            .into_iter()
            .map(|(k, v)| (k, U128(v)))
            .collect();
        let total: u128 = nominal.iter().map(|(_, v)| v.0).sum();
        if total > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(MINT_GAS)
                .mint(
                    env::current_account_id(),
                    U128(total),
                    Some(format!("club shares, match day {day}")),
                )
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_treasury_minted(nominal),
                )
                .detach();
        }
        results
    }

    /// Splits what goalars really minted (after the cap curve) between the
    /// clubs, in proportion to their nominal shares.
    #[private]
    pub fn on_treasury_minted(
        &mut self,
        nominal: Vec<(AccountId, U128)>,
        #[callback_result] minted: Result<U128, PromiseError>,
    ) -> U128 {
        let Ok(minted) = minted else {
            return U128(0);
        };
        credit_treasuries(&mut self.clubs, &nominal, minted.0);
        minted
    }

    pub fn results(&self, match_day: u32) -> Vec<MatchResult> {
        self.results.get(&match_day).cloned().unwrap_or_default()
    }

    pub fn stand_result(&self, club_id: AccountId, match_day: u32) -> Option<StandResult> {
        self.stands.get(&(club_id, match_day)).cloned()
    }

    // ---- Claims ----

    /// A fan who was in a full stand collects their reward for that match day.
    pub fn claim_stand(&mut self, club_id: AccountId, match_day: u32) -> U128 {
        let fan = env::predecessor_account_id();
        let key = (club_id.clone(), match_day, fan.clone());
        require!(self.present.contains(&key), "you were not in that stand");
        let result = self
            .stands
            .get(&(club_id, match_day))
            .cloned()
            .unwrap_or_else(|| env::panic_str("that match day is not played yet"));
        require!(result.full_house, "the tifo was not complete that day");
        require!(self.stand_claims.insert(key), "already claimed");
        let amount = the_rules().full_house_mint_per_fan.0 * result.multiplier as u128;
        *self.credits.entry(fan).or_insert(0) += amount;
        U128(amount)
    }

    pub fn credits_of(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).copied().unwrap_or(0))
    }

    /// Mints the caller's credits (scaled under the cap by goalars).
    pub fn claim(&mut self) {
        let account_id = env::predecessor_account_id();
        let amount = self.credits.remove(&account_id).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(MINT_GAS)
            .mint(account_id.clone(), U128(amount), Some("claim".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_claim_minted(account_id, U128(amount)),
            )
            .detach();
    }

    /// Gives the credits back if the mint failed.
    #[private]
    pub fn on_claim_minted(
        &mut self,
        account_id: AccountId,
        amount: U128,
        #[callback_result] minted: Result<U128, PromiseError>,
    ) -> U128 {
        match minted {
            Ok(m) => m,
            Err(_) => {
                *self.credits.entry(account_id).or_insert(0) += amount.0;
                U128(0)
            }
        }
    }
}

impl League {
    /// Signup grant, once per account.
    fn welcome(&mut self, account_id: &AccountId) {
        if self.welcome.contains_key(account_id) {
            return;
        }
        self.welcome.insert(account_id.clone(), 0);
        self.mint(account_id.clone(), the_rules().signup_grant, "signup grant");
    }

    /// Schedules a mint on the goalars contract. The amount is nominal: goalars
    /// scales it under the 10B cap.
    fn mint(&self, account_id: AccountId, amount: U128, memo: &str) {
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(MINT_GAS)
            .with_attached_deposit(NearToken::from_yoctonear(0))
            .mint(account_id, amount, Some(memo.into()))
            .detach();
    }

    fn are_rivals(&self, a: &AccountId, b: &AccountId) -> bool {
        let rival_of = |x: &AccountId| self.clubs.get(x).and_then(|c| c.rival.clone());
        rival_of(a).as_ref() == Some(b) && rival_of(b).as_ref() == Some(a)
    }

    /// Removes up to `amount` from a club's treasury and returns what was taken.
    fn take_from_treasury(&mut self, club_id: &AccountId, amount: u128) -> u128 {
        let Some(club) = self.clubs.get_mut(club_id) else {
            return 0;
        };
        let taken = amount.min(club.treasury.0);
        club.treasury = U128(club.treasury.0 - taken);
        taken
    }

    fn record_score(&mut self, club_id: &AccountId, scored: u8, conceded: u8, rules: &Rules) {
        if let Some(c) = self.clubs.get_mut(club_id) {
            c.played += 1;
            c.goals_for += scored as u32;
            c.goals_against += conceded as u32;
            match scored.cmp(&conceded) {
                std::cmp::Ordering::Greater => {
                    c.won += 1;
                    c.points += rules.points_win;
                }
                std::cmp::Ordering::Equal => {
                    c.drawn += 1;
                    c.points += rules.points_draw;
                }
                std::cmp::Ordering::Less => c.lost += 1,
            }
        }
    }

    /// Records a club's stand for the day and returns what it burned. A club
    /// with no fans has no tifo: nothing happens.
    fn settle_stand(&mut self, club_id: &AccountId, day: u32, k: u32, rules: &Rules) -> u128 {
        let Some(fans) = self.clubs.get(club_id).map(|c| c.fans) else {
            return 0;
        };
        if fans == 0 {
            return 0;
        }
        let present = self
            .attendance
            .get(&(club_id.clone(), day))
            .copied()
            .unwrap_or(0);
        let full_house = present >= full_house_target(fans);
        let mut burned = 0;
        if full_house {
            if let Some(c) = self.clubs.get_mut(club_id) {
                c.full_house_streak += 1;
                c.best_streak = c.best_streak.max(c.full_house_streak);
            }
        } else {
            let treasury = self.clubs.get(club_id).map(|c| c.treasury.0).unwrap_or(0);
            let bps = (rules.empty_stand_burn_bps * k).min(10_000) as u128;
            burned = self.take_from_treasury(club_id, treasury * bps / 10_000);
            if let Some(c) = self.clubs.get_mut(club_id) {
                c.full_house_streak = 0;
            }
        }
        self.stands.insert(
            (club_id.clone(), day),
            StandResult {
                present,
                fans,
                full_house,
                multiplier: k,
                burned: U128(burned),
            },
        );
        burned
    }
}

/// Splits `minted` between clubs in proportion to their nominal shares; the
/// last one gets the rounding remainder so nothing is lost.
fn credit_treasuries(
    clubs: &mut LookupMap<AccountId, Club>,
    nominal: &[(AccountId, U128)],
    minted: u128,
) {
    let total: u128 = nominal.iter().map(|(_, v)| v.0).sum();
    if total == 0 {
        return;
    }
    let mut given = 0u128;
    for (i, (club, share)) in nominal.iter().enumerate() {
        let part = if i + 1 == nominal.len() {
            minted - given
        } else {
            minted * share.0 / total
        };
        given += part;
        if let Some(c) = clubs.get_mut(club) {
            c.treasury = U128(c.treasury.0 + part);
        }
    }
}

/// Adds up amounts per account, keeping first-seen order.
fn merge(items: Vec<(AccountId, u128)>) -> Vec<(AccountId, u128)> {
    let mut out: Vec<(AccountId, u128)> = Vec::new();
    for (k, v) in items {
        match out.iter_mut().find(|(x, _)| x == &k) {
            Some((_, total)) => *total += v,
            None => out.push((k, v)),
        }
    }
    out
}

/// 60% of fans, rounded up.
pub fn full_house_target(fans: u32) -> u32 {
    let bps = the_rules().stadium_target_bps as u64;
    ((fans as u64 * bps).div_ceil(10_000)) as u32
}

#[cfg(test)]
mod tests;

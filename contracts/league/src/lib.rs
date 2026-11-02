//! League: the rules of NEAR Post. It is the only account that can mint goalars,
//! create players and items. There is no owner and no upgrade method: the rules
//! are fixed at deploy time and readable by anyone with `rules()`.
//!
//! Clubs, fans, stadium check-in, the welcome grant, and match days: anyone can
//! call `play_match_day` once it is due. Each match day plays every fixture,
//! credits goals, settles every stand (full house or 2% treasury burn) and
//! opens the next day.
//!
//! Squads: every new club gets eleven players (a 4-4-2), minted as NFTs in the
//! players contract. The manager picks the starting eleven; the eleven's
//! ratings drive the score (see `play.rs`). The players contract tells the
//! league about every transfer, so a sold player leaves his old club's squad.
//!
//! Where the G go: a goal's scorer share goes to the scorer's own wallet, which
//! follows him when he is sold; his current owner claims it. The club share
//! goes to the club treasury, which this contract holds as real G (so penalties
//! can burn it). Fans' full-house rewards are credits minted on `claim`. Like
//! every mint, claims are scaled under the 10B cap at that moment.

mod play;

use play::{ByteStream, ELEVEN, FORMATION, derive_seed};
pub use play::{GoalKind, OnPitch, Position, fixtures, play_match};

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, PromiseError, PromiseOrValue, env,
    ext_contract, near, require,
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
    /// Paid from the club treasury to each person-played player who starts.
    pub salary: U128,
    /// Share of a sale for the person who plays the player (NEP-199 payout).
    pub player_sale_bps: u32,
    /// Match days per captaincy.
    pub week_length: u32,
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
        salary: U128(200_000 * ONE_G),
        player_sale_bps: 500,
        week_length: 7,
    }
}

#[ext_contract(ext_goalars)]
pub trait Goalars {
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) -> U128;
    fn burn(&mut self, amount: U128, memo: Option<String>);
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_players)]
pub trait PlayersContract {
    fn nft_mint_batch(&mut self, mints: Vec<MintArgs>);
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_treasury_minted(&mut self, nominal: Vec<(AccountId, U128)>) -> U128;
    fn on_claim_minted(&mut self, account_id: AccountId, amount: U128) -> U128;
    fn on_player_claim_minted(&mut self, token_id: String, amount: U128) -> U128;
    fn on_salary_paid(&mut self, token_id: String, amount: U128);
}

/// What the players contract needs to mint one player (NEP-171 metadata).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct MintArgs {
    pub token_id: String,
    pub controller: Option<AccountId>,
    pub owner_id: AccountId,
    pub trained_by: AccountId,
    pub metadata: PlayerMetadata,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PlayerMetadata {
    pub title: String,
    pub description: String,
    pub copies: u64,
    pub extra: String,
}

/// A footballer as the league sees him. The NFT lives in the players contract.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Player {
    pub token_id: String,
    pub name: String,
    pub position: Position,
    pub attack: u8,
    pub defence: u8,
    pub owner: AccountId,
    pub goals: u32,
    /// G earned by his goals (minted on claim, under the cap).
    pub wallet: U128,
    /// The person who plays him. None for academy players, who are played by
    /// the league and claimed by their owner.
    pub controller: Option<AccountId>,
    /// Salaries earned: real G the league holds for him until he claims.
    pub salary: U128,
    pub last_trained_day: u32,
}

/// `msg` of a training payment.
#[near(serializers = [json])]
pub struct TrainOrder {
    pub train: String,
}

/// A club's captain for one week, elected by its person-played players.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Captain {
    pub token_id: String,
    pub name: String,
    pub week: u32,
    pub votes: u32,
}

impl Player {
    /// Who collects his wallet and decides for him.
    fn beneficiary(&self) -> &AccountId {
        self.controller.as_ref().unwrap_or(&self.owner)
    }

    fn on_pitch(&self) -> OnPitch {
        OnPitch {
            position: self.position,
            attack: self.attack,
            defence: self.defence,
        }
    }
}

/// A goal as stored and shown: who touched it last, by token and name.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Goal {
    pub for_home: bool,
    pub minute: u8,
    pub kind: GoalKind,
    pub player: String,
    pub name: String,
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
    Players,
    Squads,
    Lineups,
    FootballerOf,
    Reported,
    Ballots,
    Captains,
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
    players: LookupMap<String, Player>,
    /// Token ids owned by each account, kept in step by the players contract.
    squads: LookupMap<AccountId, Vec<String>>,
    lineups: LookupMap<AccountId, Vec<String>>,
    next_player: u64,
    /// The one player each person plays.
    footballer_of: LookupMap<AccountId, String>,
    /// (player, match day): the person reported fit to play.
    reported: LookupSet<(String, u32)>,
    /// (club, week) -> (voter's player, candidate's player).
    ballots: LookupMap<(AccountId, u32), Vec<(String, String)>>,
    /// (club, week) -> elected captain. Kept as history.
    captains: LookupMap<(AccountId, u32), Captain>,
}

const MINT_GAS: Gas = Gas::from_tgas(10);
const BURN_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const ACADEMY_GAS: Gas = Gas::from_tgas(60);
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
            players: LookupMap::new(StorageKey::Players),
            squads: LookupMap::new(StorageKey::Squads),
            lineups: LookupMap::new(StorageKey::Lineups),
            next_player: 0,
            footballer_of: LookupMap::new(StorageKey::FootballerOf),
            reported: LookupSet::new(StorageKey::Reported),
            ballots: LookupMap::new(StorageKey::Ballots),
            captains: LookupMap::new(StorageKey::Captains),
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

    /// Creates the caller's club in Division 3 with eleven academy players
    /// (a 4-4-2, ratings 40 to 60), minted as NFTs. A new account gets the
    /// signup grant.
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
        self.sign_academy(&manager);
    }

    // ---- Squads ----

    /// The starting eleven of `club_id`: eleven different players of its
    /// squad, one of them a goalkeeper. Set by the club's captain for the week,
    /// or by its manager when it has no captain. Players who do not report for
    /// the match are replaced by the best available academy players.
    pub fn set_lineup(&mut self, club_id: AccountId, token_ids: Vec<String>) {
        let caller = env::predecessor_account_id();
        let club = self
            .clubs
            .get(&club_id)
            .unwrap_or_else(|| env::panic_str("no such club"));
        let allowed = match self.captain(club_id.clone()) {
            Some(c) => self
                .players
                .get(&c.token_id)
                .map(|p| p.beneficiary() == &caller)
                .unwrap_or(false),
            None => club.manager == caller,
        };
        require!(
            allowed,
            "only the captain (or the manager, without one) picks the eleven"
        );
        require!(token_ids.len() == ELEVEN, "a lineup is eleven players");
        let squad = self.squads.get(&club_id).cloned().unwrap_or_default();
        let mut seen = std::collections::HashSet::new();
        let mut keepers = 0;
        for id in &token_ids {
            require!(seen.insert(id.clone()), "a player is listed twice");
            require!(squad.contains(id), "that player is not in the squad");
            if self.players.get(id).map(|p| p.position) == Some(Position::Gk) {
                keepers += 1;
            }
        }
        require!(keepers == 1, "a lineup has exactly one goalkeeper");
        self.lineups.insert(club_id, token_ids);
    }

    // ---- People who play ----

    /// The caller creates the footballer he will play: a free agent whose
    /// registration he holds until he gives it to a club (an NFT transfer).
    /// One per person.
    pub fn create_footballer(&mut self, name: String, position: Position) -> Player {
        let person = env::predecessor_account_id();
        require!(
            !self.footballer_of.contains_key(&person),
            "you already play a footballer"
        );
        let name = name.trim().to_string();
        require!(
            (2..=MAX_NAME).contains(&name.chars().count()),
            "a name is 2 to 32 characters"
        );
        self.welcome(&person);
        let mut stream = ByteStream::new(derive_seed(
            env::random_seed_array(),
            &[self.next_player, 7],
        ));
        let player = self.new_player(
            &mut stream,
            name,
            position,
            person.clone(),
            Some(person.clone()),
        );
        self.footballer_of
            .insert(person.clone(), player.token_id.clone());
        self.squads
            .entry(person.clone())
            .or_default()
            .push(player.token_id.clone());
        ext_players::ext(self.players_id.clone())
            .with_static_gas(ACADEMY_GAS)
            .nft_mint_batch(vec![self.mint_args(&player, &person)])
            .detach();
        player
    }

    pub fn footballer_of(&self, account_id: AccountId) -> Option<Player> {
        self.footballer_of
            .get(&account_id)
            .and_then(|t| self.players.get(t).cloned())
    }

    /// The caller reports fit for his club's current match day. Without it, an
    /// academy player takes his place.
    pub fn report_for_match(&mut self) {
        let person = env::predecessor_account_id();
        let token = self
            .footballer_of
            .get(&person)
            .cloned()
            .unwrap_or_else(|| env::panic_str("create your footballer first"));
        let owner = self.players.get(&token).map(|p| p.owner.clone()).unwrap();
        require!(self.clubs.contains_key(&owner), "join a club first");
        require!(
            self.reported.insert((token, self.match_day)),
            "already reported for this match day"
        );
    }

    pub fn is_reported(&self, token_id: String, match_day: u32) -> bool {
        self.reported.contains(&(token_id, match_day))
    }

    /// The caller votes for a teammate as next week's captain. One vote per
    /// person per week, which he can change until the week ends.
    pub fn vote_captain(&mut self, candidate: String) {
        let person = env::predecessor_account_id();
        let voter = self
            .footballer_of
            .get(&person)
            .cloned()
            .unwrap_or_else(|| env::panic_str("create your footballer first"));
        let club = self.players.get(&voter).map(|p| p.owner.clone()).unwrap();
        require!(self.clubs.contains_key(&club), "join a club first");
        let c = self
            .players
            .get(&candidate)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(c.owner == club, "vote for a teammate");
        require!(
            c.controller.is_some(),
            "a captain is a person, not an academy player"
        );
        let week = self.week_of(self.match_day);
        let ballots = self.ballots.entry((club, week)).or_default();
        ballots.retain(|(v, _)| v != &voter);
        ballots.push((voter, candidate));
    }

    pub fn ballots(&self, club_id: AccountId, week: u32) -> Vec<(String, String)> {
        self.ballots
            .get(&(club_id, week))
            .cloned()
            .unwrap_or_default()
    }

    /// This week's captain of a club, if it elected one.
    pub fn captain(&self, club_id: AccountId) -> Option<Captain> {
        self.captains
            .get(&(club_id, self.week_of(self.match_day)))
            .cloned()
    }

    pub fn captain_of_week(&self, club_id: AccountId, week: u32) -> Option<Captain> {
        self.captains.get(&(club_id, week)).cloned()
    }

    /// Training: send `training_cost` G to the league with
    /// `ft_transfer_call(league, amount, msg: {"train": "<token_id>"})`. The G
    /// burn and the player gains a point (attack for midfielders and forwards,
    /// defence for keepers and defenders). Once per player per match day, by
    /// the person who plays him (or his owner for an academy player).
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.goalars_id,
            "only goalars pays for training"
        );
        let rules = the_rules();
        require!(
            amount == rules.training_cost,
            "training costs exactly training_cost"
        );
        let order: TrainOrder = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("msg must be {\"train\":\"<token_id>\"}"));
        let day = self.match_day;
        let player = self
            .players
            .get_mut(&order.train)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(
            player.beneficiary() == &sender_id,
            "you cannot train that player"
        );
        require!(
            player.last_trained_day < day,
            "already trained this match day"
        );
        player.last_trained_day = day;
        match player.position {
            Position::Mf | Position::Fw => player.attack = (player.attack + 1).min(99),
            Position::Gk | Position::Df => player.defence = (player.defence + 1).min(99),
        }
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(BURN_GAS)
            .burn(amount, Some(format!("training {}", order.train)))
            .detach();
        PromiseOrValue::Value(U128(0))
    }

    pub fn squad(&self, account_id: AccountId) -> Vec<Player> {
        self.squads
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.players.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The eleven that would start now.
    pub fn starting_eleven(&self, club_id: AccountId) -> Vec<Player> {
        self.eleven_of(&club_id)
            .iter()
            .filter_map(|id| self.players.get(id).cloned())
            .collect()
    }

    pub fn get_player(&self, token_id: String) -> Option<Player> {
        self.players.get(&token_id).cloned()
    }

    /// Called by the players contract after every transfer: the player moves
    /// to his new owner's squad, leaves the old lineup, and keeps his wallet.
    pub fn on_player_transferred(
        &mut self,
        token_id: String,
        old_owner: AccountId,
        new_owner: AccountId,
    ) {
        require!(
            env::predecessor_account_id() == self.players_id,
            "only the players contract reports transfers"
        );
        let Some(player) = self.players.get_mut(&token_id) else {
            return;
        };
        player.owner = new_owner.clone();
        if let Some(squad) = self.squads.get_mut(&old_owner) {
            squad.retain(|t| t != &token_id);
        }
        if let Some(lineup) = self.lineups.get_mut(&old_owner) {
            lineup.retain(|t| t != &token_id);
        }
        let squad = self.squads.entry(new_owner).or_default();
        if !squad.contains(&token_id) {
            squad.push(token_id);
        }
    }

    /// The person who plays him (or, for an academy player, his owner)
    /// collects his wallet: goal shares are minted (scaled under the cap),
    /// salaries are paid from the G the league holds.
    pub fn claim_player(&mut self, token_id: String) {
        let caller = env::predecessor_account_id();
        let player = self
            .players
            .get_mut(&token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(
            player.beneficiary() == &caller,
            "that player's wallet is not yours"
        );
        let (minted, salary) = (player.wallet.0, player.salary.0);
        require!(minted + salary > 0, "nothing to claim");
        player.wallet = U128(0);
        player.salary = U128(0);
        if minted > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(MINT_GAS)
                .mint(
                    caller.clone(),
                    U128(minted),
                    Some(format!("wallet of {token_id}")),
                )
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_player_claim_minted(token_id.clone(), U128(minted)),
                )
                .detach();
        }
        if salary > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(MINT_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .ft_transfer(caller, U128(salary), Some(format!("salary of {token_id}")))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_salary_paid(token_id, U128(salary)),
                )
                .detach();
        }
    }

    /// Puts the salary back if the transfer failed.
    #[private]
    pub fn on_salary_paid(
        &mut self,
        token_id: String,
        amount: U128,
        #[callback_result] paid: Result<(), PromiseError>,
    ) {
        if paid.is_err()
            && let Some(p) = self.players.get_mut(&token_id)
        {
            p.salary = U128(p.salary.0 + amount.0);
        }
    }

    /// Puts the G back in the player's wallet if the mint failed.
    #[private]
    pub fn on_player_claim_minted(
        &mut self,
        token_id: String,
        amount: U128,
        #[callback_result] minted: Result<U128, PromiseError>,
    ) -> U128 {
        match minted {
            Ok(m) => m,
            Err(_) => {
                if let Some(p) = self.players.get_mut(&token_id) {
                    p.wallet = U128(p.wallet.0 + amount.0);
                }
                U128(0)
            }
        }
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
            let home_xi = self.eleven_of(&home);
            let away_xi = self.eleven_of(&away);
            let pitch = |ids: &[String]| -> Vec<OnPitch> {
                ids.iter()
                    .filter_map(|id| self.players.get(id).map(|p| p.on_pitch()))
                    .collect()
            };
            let raw = play_match(
                derive_seed(block_seed, &[day as u64, index as u64]),
                &pitch(&home_xi),
                &pitch(&away_xi),
            );
            let derby = self.are_rivals(&home, &away);
            if derby {
                derby_clubs.push(home.clone());
                derby_clubs.push(away.clone());
            }
            let (mut hg, mut ag) = (0u8, 0u8);
            let mut goals = Vec::with_capacity(raw.len());
            for g in &raw {
                let (scorer, at_fault) = if g.for_home {
                    hg += 1;
                    (&home, &away)
                } else {
                    ag += 1;
                    (&away, &home)
                };
                // Who touched it last: a scorer of the scoring side, or for an
                // own goal a player of the side at fault.
                let touched_by = if (g.kind == GoalKind::Own) != g.for_home {
                    &home_xi
                } else {
                    &away_xi
                };
                let token = touched_by.get(g.player).cloned().unwrap_or_default();
                let name = self
                    .players
                    .get(&token)
                    .map(|p| p.name.clone())
                    .unwrap_or_default();
                goals.push(Goal {
                    for_home: g.for_home,
                    minute: g.minute,
                    kind: g.kind,
                    player: token.clone(),
                    name,
                });
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
                        if let Some(p) = self.players.get_mut(&token) {
                            p.wallet = U128(p.wallet.0 + k * rules.goal_scorer_share.0);
                            p.goals += 1;
                            p.attack = (p.attack + 1).min(99);
                        }
                        treasury_mints.push((scorer.clone(), k * rules.goal_club_share.0));
                    }
                }
            }
            for (club, xi) in [(&home, &home_xi), (&away, &away_xi)] {
                self.pay_salaries(club, xi, rules.salary.0);
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

        // The last match day of a week elects next week's captains.
        let next = self.match_day;
        if (next - 1).is_multiple_of(rules.week_length) {
            let week = self.week_of(next);
            for id in &ids {
                self.elect_captain(id, week);
            }
        }

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

const FIRST_NAMES: [&str; 32] = [
    "Matteo", "Lucas", "Noah", "Sami", "Theo", "Yanis", "Enzo", "Liam", "Adam", "Nael", "Ilyes",
    "Hugo", "Malo", "Rayan", "Gabin", "Tiago", "Ismael", "Kenzo", "Elias", "Nolan", "Aaron",
    "Mael", "Sacha", "Jules", "Amir", "Leon", "Owen", "Timeo", "Ethan", "Marius", "Kylian",
    "Oscar",
];
const LAST_NAMES: [&str; 32] = [
    "Duval",
    "Ferrand",
    "Haddad",
    "Lambert",
    "Morel",
    "Petit",
    "Belkacem",
    "Garnier",
    "Roux",
    "Fontaine",
    "Mercier",
    "Benali",
    "Lefevre",
    "Chevalier",
    "Diallo",
    "Moreau",
    "Perrin",
    "Traore",
    "Marchand",
    "Colin",
    "Renaud",
    "Sylla",
    "Barbier",
    "Leroy",
    "Camara",
    "Nicolas",
    "Fabre",
    "Gauthier",
    "Mendy",
    "Boyer",
    "Rolland",
    "Keita",
];

impl League {
    /// Mints the eleven academy players of a new club.
    fn sign_academy(&mut self, club: &AccountId) {
        let mut stream = ByteStream::new(derive_seed(
            env::random_seed_array(),
            &[self.next_player, self.club_ids.len() as u64],
        ));
        let mut mints = Vec::with_capacity(ELEVEN);
        let mut squad = Vec::with_capacity(ELEVEN);
        for (position, count) in FORMATION {
            for _ in 0..count {
                let name = format!(
                    "{} {}",
                    FIRST_NAMES[stream.next() as usize % FIRST_NAMES.len()],
                    LAST_NAMES[stream.next() as usize % LAST_NAMES.len()]
                );
                let player = self.new_player(&mut stream, name, position, club.clone(), None);
                mints.push(self.mint_args(&player, club));
                squad.push(player.token_id);
            }
        }
        self.squads.insert(club.clone(), squad);
        ext_players::ext(self.players_id.clone())
            .with_static_gas(ACADEMY_GAS)
            .nft_mint_batch(mints)
            .detach();
    }

    /// Rolls ratings for a position and stores a new player.
    fn new_player(
        &mut self,
        stream: &mut ByteStream,
        name: String,
        position: Position,
        owner: AccountId,
        controller: Option<AccountId>,
    ) -> Player {
        let (attack, defence) = match position {
            Position::Gk => (stream.range(10, 25), stream.range(45, 60)),
            Position::Df => (stream.range(25, 40), stream.range(45, 60)),
            Position::Mf => (stream.range(40, 55), stream.range(40, 55)),
            Position::Fw => (stream.range(45, 60), stream.range(20, 35)),
        };
        let token_id = format!("p{}", self.next_player);
        self.next_player += 1;
        let player = Player {
            token_id: token_id.clone(),
            name,
            position,
            attack,
            defence,
            owner,
            goals: 0,
            wallet: U128(0),
            controller,
            salary: U128(0),
            last_trained_day: 0,
        };
        self.players.insert(token_id, player.clone());
        player
    }

    fn mint_args(&self, p: &Player, trained_by: &AccountId) -> MintArgs {
        let pos = match p.position {
            Position::Gk => "GK",
            Position::Df => "DF",
            Position::Mf => "MF",
            Position::Fw => "FW",
        };
        MintArgs {
            token_id: p.token_id.clone(),
            controller: p.controller.clone(),
            owner_id: p.owner.clone(),
            trained_by: trained_by.clone(),
            metadata: PlayerMetadata {
                title: format!("{} · {pos}", p.name),
                description: if p.controller.is_some() {
                    "Played by a person. Live ratings: league get_player.".into()
                } else {
                    "Academy player. Live ratings: league get_player.".into()
                },
                copies: 1,
                extra: format!(
                    "{{\"position\":\"{pos}\",\"attack\":{},\"defence\":{}}}",
                    p.attack, p.defence
                ),
            },
        }
    }

    fn week_of(&self, day: u32) -> u32 {
        (day.max(1) - 1) / the_rules().week_length
    }

    /// Counts last week's ballots: most votes wins, ties go to the better
    /// rated player, then the lower token id. Only players still in the club
    /// count, as voters and as candidates.
    fn elect_captain(&mut self, club: &AccountId, week: u32) {
        let Some(ballots) = week
            .checked_sub(1)
            .and_then(|w| self.ballots.get(&(club.clone(), w)).cloned())
        else {
            return;
        };
        let mut tally: Vec<(String, u32)> = Vec::new();
        for (voter, candidate) in ballots {
            let in_club = |t: &String| {
                self.players
                    .get(t)
                    .map(|p| &p.owner == club)
                    .unwrap_or(false)
            };
            if !in_club(&voter) || !in_club(&candidate) {
                continue;
            }
            match tally.iter_mut().find(|(c, _)| c == &candidate) {
                Some((_, n)) => *n += 1,
                None => tally.push((candidate, 1)),
            }
        }
        let rating = |t: &String| {
            self.players
                .get(t)
                .map(|p| p.attack as u32 + p.defence as u32)
                .unwrap_or(0)
        };
        let Some((token, votes)) = tally.into_iter().max_by(|a, b| {
            a.1.cmp(&b.1)
                .then(rating(&a.0).cmp(&rating(&b.0)))
                .then(b.0.cmp(&a.0))
        }) else {
            return;
        };
        let name = self
            .players
            .get(&token)
            .map(|p| p.name.clone())
            .unwrap_or_default();
        self.captains.insert(
            (club.clone(), week),
            Captain {
                token_id: token,
                name,
                week,
                votes,
            },
        );
    }

    /// Pays each person-played starter his salary from the club treasury,
    /// while the treasury lasts. The G stay with the league until he claims.
    fn pay_salaries(&mut self, club: &AccountId, xi: &[String], salary: u128) {
        for token in xi {
            let human = self
                .players
                .get(token)
                .map(|p| p.controller.is_some())
                .unwrap_or(false);
            if !human {
                continue;
            }
            let treasury = self.clubs.get(club).map(|c| c.treasury.0).unwrap_or(0);
            if treasury < salary {
                break; // the treasury is empty: no more salaries today
            }
            self.take_from_treasury(club, salary);
            if let Some(p) = self.players.get_mut(token) {
                p.salary = U128(p.salary.0 + salary);
            }
        }
    }

    /// Whether a player can play today: academy players always, people only
    /// when they reported.
    fn available(&self, token: &String) -> bool {
        match self.players.get(token) {
            Some(p) if p.controller.is_none() => true,
            Some(_) => self.reported.contains(&(token.clone(), self.match_day)),
            None => false,
        }
    }

    /// The eleven that starts for a club: its lineup, minus players it no
    /// longer owns, topped up with the best available players for a 4-4-2.
    fn eleven_of(&self, club: &AccountId) -> Vec<String> {
        let squad = self.squads.get(club).cloned().unwrap_or_default();
        let mut xi: Vec<String> = self
            .lineups
            .get(club)
            .map(|l| {
                l.iter()
                    .filter(|t| squad.contains(t) && self.available(t))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if xi.len() >= ELEVEN {
            xi.truncate(ELEVEN);
            return xi;
        }
        let mut bench: Vec<&Player> = squad
            .iter()
            .filter(|t| !xi.contains(t) && self.available(t))
            .filter_map(|t| self.players.get(t))
            .collect();
        bench.sort_by_key(|p| std::cmp::Reverse(p.attack as u32 + p.defence as u32));
        let has = |xi: &Vec<String>, pos: Position| {
            xi.iter()
                .filter(|t| self.players.get(*t).map(|p| p.position) == Some(pos))
                .count()
        };
        for (pos, need) in FORMATION {
            let mut missing = need.saturating_sub(has(&xi, pos));
            bench.retain(|p| {
                if missing > 0 && p.position == pos && xi.len() < ELEVEN {
                    xi.push(p.token_id.clone());
                    missing -= 1;
                    false
                } else {
                    true
                }
            });
        }
        for p in bench {
            if xi.len() >= ELEVEN {
                break;
            }
            xi.push(p.token_id.clone());
        }
        xi
    }

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

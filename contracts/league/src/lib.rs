//! League: the rules of NEAR Post. It is the only account that can mint goalars,
//! create players and items. There is no owner and no upgrade method: the rules
//! are fixed at deploy time and readable by anyone with `rules()`.
//!
//! Clubs, fans, stadium check-in, the welcome grant, and match days. A match
//! day is played live in two halves (see `live.rs`): at kick-off anyone can
//! call `play_match_day` to play the first half; after the half and the
//! half-time break, the same call plays the second half, credits goals,
//! settles every stand (full house or 2% treasury burn) and opens the next
//! day. Before kick-off and at half-time, people take their slot in their
//! club's formation and vote the strategy.
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
//!
//! Skills (v4): six skills per player give his card rating out of 100 and the
//! attack and defence the match engine uses. Training burns G and opens a
//! ticket for one skill; the player then plays a drill in his browser, and
//! `finish_training` adds 0 to 3 points when the drill's attester (an ed25519
//! key fixed at init, held by the relay) has signed the score. That attester
//! is the one trusted party: it can grant at most `training_max_points` per
//! paid ticket, and nothing else.

mod live;
mod play;
mod wardrobe;
pub use wardrobe::Look;

pub use live::{Event, EventKind, FORMATIONS, Formation, Role, Strategy};
use play::{ByteStream, ELEVEN, FORMATION, derive_seed, training_gain};
pub use play::{GoalKind, Position, Skill, Skills, fixtures};

use near_sdk::json_types::Base64VecU8;
use near_sdk::json_types::{U64, U128};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, CurveType, Gas, NearToken, PanicOnDefault, PromiseError,
    PromiseOrValue, PublicKey, env, ext_contract, near, require,
};

/// 1 G in the token's smallest unit (goalars has 6 decimals).
pub const ONE_G: u128 = 1_000_000;
/// The fixture list is bounded so a match day always fits in one transaction.
/// Clubs in a division, and how many go up and down each season.
pub const DIVISION_SIZE: usize = 20;
pub const MOVERS: usize = 3;
/// Match days in a season: a full round of a 20-club division.
pub const SEASON_DAYS: u32 = 19;
/// Clubs in the whole league (ten divisions).
pub const MAX_CLUBS: u32 = 200;
/// Match sheets are kept this many match days, then deleted to free their
/// storage (two days of match days every 30 minutes).
pub const KEEP_RESULTS: u32 = 96;

/// The economy, in G and basis points (out of 10_000). Fixed forever.
/// Mints are nominal: the goalars contract scales each one by the room left
/// under the 10B cap.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    /// What a goal mints with a full stand behind the scoring club; less in
    /// proportion to its fans present (up to the full-house target), nothing
    /// with an empty stand: the money breathes with the fans.
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
    /// A pack of three wardrobe items, burned.
    pub pack_price: U128,
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
    /// Formations a captain can choose.
    pub formations: Vec<Formation>,
    /// Most skill points one training can add (fewer from 80, see play.rs).
    pub training_max_points: u8,
    /// A season ticket's price, paid into the club's treasury.
    pub season_ticket_price: U128,
    /// Season tickets a club sells per season.
    pub season_tickets_per_club: u32,
    /// What each season ticket of a club earns at each of its full houses
    /// (times the derby multiplier), minted into the ticket.
    pub season_ticket_share: U128,
}

pub fn the_rules() -> Rules {
    Rules {
        goal_mint: U128(600_000 * ONE_G),
        goal_scorer_share: U128(420_000 * ONE_G),
        goal_club_share: U128(180_000 * ONE_G),
        late_goal_multiplier: 2,
        own_goal_burn: U128(600_000 * ONE_G),
        derby_multiplier: 2,
        stadium_target_bps: 6_000,
        full_house_mint_per_fan: U128(100_000 * ONE_G),
        empty_stand_burn_bps: 200,
        relegation_burn_bps: 1_000,
        signup_grant: U128(1_000_000 * ONE_G),
        welcome_bonus: U128(1_000_000 * ONE_G),
        welcome_visits: 4,
        training_cost: U128(400_000 * ONE_G),
        pack_price: U128(500_000 * ONE_G),
        sale_tax_bps: 300,
        max_supply: U128(10_000_000_000 * ONE_G),
        trainer_bps: 1_000,
        past_club_bps: 200,
        points_win: 3,
        points_draw: 1,
        salary: U128(200_000 * ONE_G),
        player_sale_bps: 500,
        week_length: 7,
        formations: FORMATIONS.to_vec(),
        training_max_points: 3,
        season_ticket_price: U128(300_000 * ONE_G),
        season_tickets_per_club: 50,
        season_ticket_share: U128(50_000 * ONE_G),
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
    #[allow(clippy::too_many_arguments)]
    fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout;
}

#[ext_contract(ext_tickets)]
pub trait SeasonTicketsContract {
    fn mint(
        &mut self,
        token_id: String,
        owner_id: AccountId,
        club: AccountId,
        season: u32,
        number: u32,
        metadata: PlayerMetadata,
    );
    fn credit(&mut self, season: u32, shares: Vec<(AccountId, U128)>);
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_season_tickets_minted(&mut self, season: u32, nominal: Vec<(AccountId, U128)>);
    fn on_treasury_minted(&mut self, nominal: Vec<(AccountId, U128)>) -> U128;
    fn on_claim_minted(&mut self, account_id: AccountId, amount: U128) -> U128;
    fn on_player_claim_minted(&mut self, token_id: String, amount: U128) -> U128;
    fn on_salary_paid(&mut self, token_id: String, amount: U128);
    fn on_sale(&mut self, offer_id: u64) -> String;
    fn on_collected(&mut self, account_id: AccountId, amount: U128);
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
    pub skills: Skills,
    /// Card rating out of 100, from the skills and the position.
    pub overall: u8,
    /// What the match engine uses, from the skills.
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
    /// What he wears (items held by the league while he does).
    pub look: Look,
}

/// `msg` of a payment to the league.
#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
pub enum Order {
    Train(TrainOrder),
    Bid(String),
    /// A pack of three items: `{"pack":{}}`.
    Pack(PackOrder),
    /// A season ticket of a club: `{"season_ticket":"<club id>"}`.
    SeasonTicket(AccountId),
}

#[near(serializers = [json])]
pub struct PackOrder {}

#[near(serializers = [json])]
pub struct TrainOrder {
    pub token_id: String,
    pub skill: Skill,
}

/// A paid training session, open until the drill's score comes back or the
/// match day is played. `seed` (hex) generates the drill.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Ticket {
    pub id: u64,
    pub token_id: String,
    pub skill: Skill,
    pub match_day: u32,
    pub seed: String,
}

/// What the attester signs for a drill: `near-post:train:<league>:<token>:<ticket id>:<points>`.
pub fn training_message(league: &AccountId, token_id: &str, ticket: u64, points: u8) -> String {
    format!("near-post:train:{league}:{token_id}:{ticket}:{points}")
}

/// The best player of a match, as the sheet shows him.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Star {
    pub player: String,
    pub name: String,
    /// Rating × 10.
    pub rating: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MatchStats {
    pub home_shots: u8,
    pub away_shots: u8,
    pub home_on_target: u8,
    pub away_on_target: u8,
    /// Share of the ball, in percent.
    pub home_possession: u8,
    pub away_possession: u8,
    pub home_corners: u8,
    pub away_corners: u8,
    pub home_fouls: u8,
    pub away_fouls: u8,
    pub home_yellows: u8,
    pub away_yellows: u8,
    pub home_reds: u8,
    pub away_reds: u8,
    pub man_of_the_match: Option<Star>,
}

/// What a side's first half leaves for its second: who was booked, who was
/// sent off and the slots they left.
#[derive(Default)]
struct FirstHalf {
    booked: Vec<String>,
    off: Vec<String>,
    off_slots: Vec<usize>,
}

impl FirstHalf {
    fn of(m: &MatchResult, home: bool) -> Self {
        let xi = &m.elevens[usize::from(!home)];
        let mut out = Self::default();
        for e in m.events.iter().take(m.first_half_events as usize) {
            if e.home != home {
                continue;
            }
            let token = xi.get(e.player as usize).cloned().unwrap_or_default();
            match e.kind {
                EventKind::Yellow => out.booked.push(token),
                EventKind::Red => {
                    out.off.push(token);
                    out.off_slots.push(e.player as usize);
                }
                _ => {}
            }
        }
        out
    }
}

/// The set-piece takers a club's captain named (token ids).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Takers {
    pub free_kick: Option<String>,
    pub penalty: Option<String>,
}

/// `msg` of an approval that accepts an offer.
#[near(serializers = [json])]
pub struct Accept {
    pub accept: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OfferState {
    Open,
    /// The owner accepted; the transfer is in flight.
    Accepting,
    Sold,
    Cancelled,
}

/// A club's offer for a player's registration. The price is held by the league.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Offer {
    pub id: u64,
    pub token_id: String,
    pub buyer: AccountId,
    pub price: U128,
    pub state: OfferState,
    pub match_day: u32,
}

/// NEP-199 payout, as the players contract returns it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    pub payout: std::collections::HashMap<AccountId, U128>,
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

    /// Recomputes the rating, attack and defence from the skills.
    fn refresh(&mut self) {
        self.overall = self.skills.overall(self.position);
        self.attack = self.skills.attack();
        self.defence = self.skills.defence();
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
    Offers,
    OffersByToken,
    Owed,
    Tickets,
    Formations,
    Slots,
    StrategyVotes,
    Takers,
    Suspended,
    Divisions,
    DayResults,
    FinalTables,
    Unboxed,
    SeasonTicketsSold,
    Ledger,
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
    /// The goals, by token and name (filled at full time).
    pub goals: Vec<Goal>,
    pub stats: MatchStats,
    /// Every moment of the match sheet, in order. `player` is a slot in the
    /// eleven of that half (see `elevens`).
    pub events: Vec<Event>,
    /// Elevens by slot: first half home, first half away, then the second
    /// half (empty until it is played). "" is an empty slot.
    pub elevens: Vec<Vec<String>>,
    pub formations: Vec<Formation>,
    pub strategies: Vec<Strategy>,
    /// Last second of each half played (stoppage time included).
    pub half_ends: Vec<u16>,
    /// Seconds with the ball: home and away, first half then second.
    pub possession: Vec<u32>,
    /// How many of `events` belong to the first half.
    pub first_half_events: u32,
    pub full_time: bool,
    /// 1 is the top division.
    pub division: u8,
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
    /// Unix time in milliseconds after which anyone can call
    /// `play_match_day`: the kick-off, then the second half.
    pub next_match_at_ms: U64,
    pub interval_ms: U64,
    /// Kick-off of the current match day (or the next one, before it starts).
    pub kickoff_at_ms: U64,
    /// Kick-off of the match day before, so its second half can be replayed.
    pub last_kickoff_at_ms: U64,
    /// True once the first half is played, until the second half is.
    pub first_half_played: bool,
    pub half_ms: U64,
    pub half_time_ms: U64,
    pub season: u32,
    /// Match day of the season, 1 to `season_days`.
    pub season_day: u32,
    pub season_days: u32,
    pub divisions: u32,
}

/// A club's eleven for the next half: formation, strategy and, slot by slot,
/// the role, the player (if any) and whether a person chose that slot.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Lineup {
    pub formation: Formation,
    pub strategy: Strategy,
    pub roles: Vec<Role>,
    pub players: Vec<Option<Player>>,
    pub chosen: Vec<bool>,
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
    half_ns: u64,
    half_time_ns: u64,
    kickoff_ns: u64,
    last_kickoff_ns: u64,
    /// Halves played today, by division (0, 1 or 2).
    halves: Vec<u8>,
    season: u32,
    /// Clubs by division, the top one first.
    divisions: Vector<Vec<AccountId>>,
    /// (match day, division index) -> its results.
    day_results: LookupMap<(u32, u8), Vec<MatchResult>>,
    /// (season, division) -> final standings, champion first.
    final_tables: LookupMap<(u32, u8), Vec<AccountId>>,
    formations: LookupMap<AccountId, Formation>,
    /// (club, match day) -> the slots people took, by slot.
    slots: LookupMap<(AccountId, u32), Vec<Option<String>>>,
    /// (club, match day, half) -> (voter's player, strategy).
    strategy_votes: LookupMap<(AccountId, u32, u8), Vec<(String, Strategy)>>,
    /// Club id is the manager's account.
    clubs: LookupMap<AccountId, Club>,
    club_ids: Vector<AccountId>,
    fan_of: LookupMap<AccountId, AccountId>,
    present: LookupSet<(AccountId, u32, AccountId)>,
    attendance: LookupMap<(AccountId, u32), u32>,
    /// Accounts that got the signup grant, with how many welcome bonuses they got.
    welcome: LookupMap<AccountId, u8>,
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
    offers: LookupMap<u64, Offer>,
    offers_by_token: LookupMap<String, Vec<u64>>,
    next_offer: u64,
    /// Real G the league holds for an account: sale shares, cancelled offers.
    owed: LookupMap<AccountId, u128>,
    /// The drill attester's ed25519 public key. Fixed at init.
    attester: [u8; 32],
    tickets: LookupMap<String, Ticket>,
    next_ticket: u64,
    /// Set-piece takers by club.
    takers: LookupMap<AccountId, Takers>,
    /// (player, match day): suspended after a red card the day before.
    suspended: LookupSet<(String, u32)>,
    /// What each account got from its last pack or fusion.
    unboxed: LookupMap<AccountId, Vec<String>>,
    next_unbox: u64,
    /// The season tickets contract (NEP-171 tokens that hold their G).
    season_tickets_id: AccountId,
    /// (club, season) -> season tickets sold.
    season_tickets_sold: LookupMap<(AccountId, u32), u32>,
    /// Every mint and burn of G the league causes, the last `LEDGER_SIZE`.
    ledger: LookupMap<u64, LedgerEntry>,
    ledger_next: u64,
}

/// How many ledger entries the league keeps (the oldest are overwritten).
pub const LEDGER_SIZE: u64 = 600;

/// One mint or burn of G. Mints are nominal (the goalars contract scales
/// them under the cap); burns are exact.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct LedgerEntry {
    pub id: u64,
    pub match_day: u32,
    /// full_house, empty_stand, goals, own_goal, season_tickets, sale_tax,
    /// pack, training, relegation, signup, welcome.
    pub kind: String,
    /// The club or account concerned.
    pub who: Option<AccountId>,
    pub amount: U128,
    /// A mint (true) or a burn (false).
    pub mint: bool,
}

/// A squad holds at most this many players: eleven and one more.
pub const MAX_SQUAD: usize = 12;
/// Stands in for a missing player when a squad runs short (not a token).
pub const BOT: &str = "academy";
pub const BOT_SKILLS: Skills = Skills {
    pace: 35,
    shooting: 35,
    passing: 35,
    dribbling: 35,
    defending: 35,
    physical: 35,
};

const MINT_GAS: Gas = Gas::from_tgas(10);
const BURN_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const ACADEMY_GAS: Gas = Gas::from_tgas(60);
const SALE_GAS: Gas = Gas::from_tgas(60);
const TICKETS_GAS: Gas = Gas::from_tgas(20);
const MAX_NAME: usize = 32;
const MS: u64 = 1_000_000;
const MINUTE_NS: u64 = 60_000 * MS;

#[near]
impl League {
    /// `match_interval_ms`: time between match days, fixed for the life of
    /// the league (a day in production, minutes for a demo).
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        goalars_id: AccountId,
        players_id: AccountId,
        items_id: AccountId,
        match_interval_ms: U64,
        attester: PublicKey,
        half_ms: U64,
        half_time_ms: U64,
        season_tickets_id: AccountId,
    ) -> Self {
        require!(
            match_interval_ms.0 >= 2 * half_ms.0 + half_time_ms.0 + 60_000,
            "a match day must fit two halves, half-time and a minute"
        );
        require!(
            attester.curve_type() == CurveType::ED25519,
            "the attester key must be ed25519"
        );
        let attester: [u8; 32] = attester.as_bytes()[1..]
            .try_into()
            .unwrap_or_else(|_| env::panic_str("bad attester key"));
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
            half_ns: half_ms.0 * MS,
            half_time_ns: half_time_ms.0 * MS,
            kickoff_ns: env::block_timestamp() + interval_ns,
            last_kickoff_ns: 0,
            halves: Vec::new(),
            season: 1,
            divisions: Vector::new(StorageKey::Divisions),
            day_results: LookupMap::new(StorageKey::DayResults),
            final_tables: LookupMap::new(StorageKey::FinalTables),
            formations: LookupMap::new(StorageKey::Formations),
            slots: LookupMap::new(StorageKey::Slots),
            strategy_votes: LookupMap::new(StorageKey::StrategyVotes),
            clubs: LookupMap::new(StorageKey::Clubs),
            club_ids: Vector::new(StorageKey::ClubIds),
            fan_of: LookupMap::new(StorageKey::FanOf),
            present: LookupSet::new(StorageKey::Present),
            attendance: LookupMap::new(StorageKey::Attendance),
            welcome: LookupMap::new(StorageKey::Welcome),
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
            offers: LookupMap::new(StorageKey::Offers),
            offers_by_token: LookupMap::new(StorageKey::OffersByToken),
            next_offer: 0,
            owed: LookupMap::new(StorageKey::Owed),
            attester,
            tickets: LookupMap::new(StorageKey::Tickets),
            next_ticket: 0,
            takers: LookupMap::new(StorageKey::Takers),
            suspended: LookupSet::new(StorageKey::Suspended),
            unboxed: LookupMap::new(StorageKey::Unboxed),
            next_unbox: 0,
            season_tickets_id,
            season_tickets_sold: LookupMap::new(StorageKey::SeasonTicketsSold),
            ledger: LookupMap::new(StorageKey::Ledger),
            ledger_next: 0,
        }
    }

    /// The drill attester's public key.
    pub fn attester(&self) -> PublicKey {
        let mut bytes = vec![0u8];
        bytes.extend_from_slice(&self.attester);
        PublicKey::try_from(bytes).unwrap_or_else(|_| env::panic_str("bad attester key"))
    }

    /// The open training ticket of a player, if any.
    pub fn training_ticket(&self, token_id: String) -> Option<Ticket> {
        self.tickets.get(&token_id).cloned()
    }

    /// Ends a training: adds `points` (0 to 3, fewer from 80) to the ticket's
    /// skill when `signature` is the attester's ed25519 signature of
    /// `training_message`. Anyone may submit it; the points go to the player
    /// the ticket was paid for. The ticket closes when its match day is played.
    pub fn finish_training(
        &mut self,
        token_id: String,
        points: u8,
        signature: Base64VecU8,
    ) -> Player {
        let rules = the_rules();
        require!(points <= rules.training_max_points, "too many points");
        let ticket = self
            .tickets
            .get(&token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no open training for that player"));
        require!(
            ticket.match_day == self.match_day,
            "that training ended with its match day"
        );
        let sig: [u8; 64] = signature
            .0
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("a signature is 64 bytes"));
        let message = training_message(&env::current_account_id(), &token_id, ticket.id, points);
        require!(
            env::ed25519_verify(&sig, message.as_bytes(), &self.attester),
            "the drill score is not signed by the attester"
        );
        self.tickets.remove(&token_id);
        let player = self
            .players
            .get_mut(&token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        let gain = training_gain(
            player.skills.get(ticket.skill),
            points,
            rules.training_max_points,
        );
        player.skills.raise(ticket.skill, gain);
        player.refresh();
        player.clone()
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
            kickoff_at_ms: U64(self.kickoff_ns / MS),
            last_kickoff_at_ms: U64(self.last_kickoff_ns / MS),
            first_half_played: self.first_half_played(),
            half_ms: U64(self.half_ns / MS),
            half_time_ms: U64(self.half_time_ns / MS),
            season: self.season,
            season_day: (self.match_day - 1) % SEASON_DAYS + 1,
            season_days: SEASON_DAYS,
            divisions: self.divisions.len(),
        }
    }

    // ---- Clubs and fans ----

    /// Creates the caller's club in the lowest division with room (a new
    /// division when all are full) with eleven academy players (a 4-4-2),
    /// minted as NFTs. A new account gets the signup grant.
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
        let division = self.join_division(&manager);
        self.clubs.insert(
            manager.clone(),
            Club {
                name,
                manager: manager.clone(),
                division,
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

    /// The manager renames his club (1 to 32 characters).
    pub fn rename_club(&mut self, name: String) {
        let manager = env::predecessor_account_id();
        let name = name.trim().to_string();
        require!(
            !name.is_empty() && name.chars().count() <= MAX_NAME,
            "club name must be 1 to 32 characters"
        );
        let club = self
            .clubs
            .get_mut(&manager)
            .unwrap_or_else(|| env::panic_str("you manage no club"));
        club.name = name;
    }

    // ---- Squads ----

    /// The captain (or the manager, without one) picks the formation for
    /// the next half: before kick-off or at half-time.
    pub fn set_formation(&mut self, club_id: AccountId, formation: Formation) {
        require!(
            self.leads(&club_id, &env::predecessor_account_id()),
            "only the captain (or the manager, without one) picks the formation"
        );
        self.formations.insert(club_id, formation);
    }

    /// The captain (or the manager, without one) names who takes free kicks
    /// and penalties. `None` leaves it to the best shooter on the pitch; a
    /// taker who is not in the eleven is skipped the same way.
    pub fn set_takers(
        &mut self,
        club_id: AccountId,
        free_kick: Option<String>,
        penalty: Option<String>,
    ) {
        require!(
            self.leads(&club_id, &env::predecessor_account_id()),
            "only the captain (or the manager, without one) names the takers"
        );
        let squad = self.squads.get(&club_id).cloned().unwrap_or_default();
        for t in [&free_kick, &penalty].into_iter().flatten() {
            require!(squad.contains(t), "a taker must be in the squad");
        }
        self.takers.insert(club_id, Takers { free_kick, penalty });
    }

    pub fn takers(&self, club_id: AccountId) -> Takers {
        self.takers.get(&club_id).cloned().unwrap_or_default()
    }

    /// Whether a player is suspended for a match day (a red card the day before).
    pub fn is_suspended(&self, token_id: String, match_day: u32) -> bool {
        self.suspended.contains(&(token_id, match_day))
    }

    /// The caller takes a slot (0 to 10) of his club's formation for the next
    /// match day, which also reports him fit. Until a minute before kick-off:
    /// then the free slots go to the best of the squad for the role.
    /// A slot another person took is not free; his own slot he can leave.
    pub fn take_slot(&mut self, slot: u8) {
        let (token, club) = self.my_player_and_club();
        require!((slot as usize) < ELEVEN, "a slot is 0 to 10");
        require!(
            env::block_timestamp().saturating_add(MINUTE_NS) <= self.kickoff_ns,
            "the team sheet closed a minute before kick-off"
        );
        let day = self.match_day;
        self.reported.insert((token.clone(), day));
        let mut slots = self
            .slots
            .get(&(club.clone(), day))
            .cloned()
            .unwrap_or_else(|| vec![None; ELEVEN]);
        if let Some(other) = &slots[slot as usize] {
            require!(other == &token, "another player took that slot");
        }
        for s in slots.iter_mut() {
            if s.as_ref() == Some(&token) {
                *s = None;
            }
        }
        slots[slot as usize] = Some(token);
        self.slots.insert((club, day), slots);
    }

    /// The caller's vote for his club's strategy in the next half. Most votes
    /// wins; a tie or no vote plays balanced.
    pub fn vote_strategy(&mut self, strategy: Strategy) {
        let (token, club) = self.my_player_and_club();
        let half = self.next_half(&club);
        let votes = self
            .strategy_votes
            .entry((club, self.match_day, half))
            .or_default();
        votes.retain(|(t, _)| t != &token);
        votes.push((token, strategy));
    }

    /// The eleven for the next half: formation, strategy and every slot.
    pub fn lineup(&self, club_id: AccountId) -> Lineup {
        let formation = self.formation_of(&club_id);
        let chosen_slots = self
            .slots
            .get(&(club_id.clone(), self.match_day))
            .cloned()
            .unwrap_or_else(|| vec![None; ELEVEN]);
        let xi = self.eleven_of(&club_id);
        Lineup {
            formation,
            strategy: self.strategy_of(&club_id, self.next_half(&club_id)),
            roles: formation.roles().to_vec(),
            players: xi
                .iter()
                .map(|t| t.as_ref().and_then(|t| self.players.get(t).cloned()))
                .collect(),
            chosen: (0..ELEVEN)
                .map(|k| chosen_slots[k].is_some() && chosen_slots[k] == xi[k])
                .collect(),
        }
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

    /// Goalars sent to the league with `ft_transfer_call`. Two orders:
    /// - `{"train": {"token_id": "<id>", "skill": "pace"}}`: exactly
    ///   `training_cost`, burned. Opens a training ticket for that skill; the
    ///   drill's signed score then adds 0 to 3 points (`finish_training`).
    ///   Once per player per match day, by the person who plays him (or his
    ///   owner for an academy player).
    /// - `{"bid": "<token_id>"}`: a club offers this amount for a player's
    ///   registration. The G stay with the league until the owner accepts
    ///   (see `nft_on_approve`) or the club cancels.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.goalars_id,
            "only goalars is accepted"
        );
        let order: Order = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| {
            env::panic_str(
                "msg must be {\"train\":{\"token_id\":\"<id>\",\"skill\":\"pace\"}}, {\"bid\":\"<token_id>\"}, {\"pack\":{}} or {\"season_ticket\":\"<club>\"}",
            )
        });
        match order {
            Order::Train(order) => self.train(sender_id, amount, order),
            Order::Bid(token) => {
                self.bid(sender_id, amount, token);
            }
            Order::Pack(_) => self.open_pack_for(sender_id, amount),
            Order::SeasonTicket(club) => self.sell_season_ticket(sender_id, amount, club),
        }
        PromiseOrValue::Value(U128(0))
    }

    // ---- Transfer market ----

    /// The owner of a player sells his registration to an open offer by
    /// approving the league on the players contract:
    /// `nft_approve(token_id, league, msg: {"accept": <offer id>})`. The league
    /// then transfers the NFT with its NEP-199 payout and shares the price:
    /// 10% to the training club, 2% to each of his last 3 clubs, 5% to the
    /// person who plays him, 3% burned, the rest to the seller.
    pub fn nft_on_approve(
        &mut self,
        token_id: String,
        owner_id: AccountId,
        approval_id: u64,
        msg: String,
    ) -> PromiseOrValue<String> {
        require!(
            env::predecessor_account_id() == self.players_id,
            "only the players contract approves sales"
        );
        let accept: Accept = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("msg must be {\"accept\":<offer id>}"));
        let owner_now = self.players.get(&token_id).map(|p| p.owner.clone());
        require!(
            owner_now.as_ref() == Some(&owner_id),
            "the league does not see you as the owner yet"
        );
        let offer = self
            .offers
            .get_mut(&accept.accept)
            .unwrap_or_else(|| env::panic_str("no such offer"));
        require!(
            offer.token_id == token_id,
            "that offer is for another player"
        );
        require!(offer.state == OfferState::Open, "that offer is not open");
        require!(offer.buyer != owner_id, "you cannot sell to yourself");
        offer.state = OfferState::Accepting;
        let (buyer, price, id) = (offer.buyer.clone(), offer.price, offer.id);
        PromiseOrValue::Promise(
            ext_players::ext(self.players_id.clone())
                .with_static_gas(SALE_GAS)
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .nft_transfer_payout(
                    buyer,
                    token_id,
                    Some(approval_id),
                    Some(format!("sale, offer {id}")),
                    price,
                    Some(10),
                )
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_sale(id),
                ),
        )
    }

    /// Shares the price as the players contract's payout says, or reopens the
    /// offer if the transfer failed.
    #[private]
    pub fn on_sale(
        &mut self,
        offer_id: u64,
        #[callback_result] payout: Result<Payout, PromiseError>,
    ) -> String {
        let Some(offer) = self.offers.get_mut(&offer_id) else {
            return "no such offer".into();
        };
        let Ok(payout) = payout else {
            offer.state = OfferState::Open;
            return "transfer failed: offer reopened".into();
        };
        offer.state = OfferState::Sold;
        let price = offer.price.0;
        let shares = settle_payout(&payout, price, &env::current_account_id());
        let mut burn = 0u128;
        for (account, amount) in shares {
            if account == env::current_account_id() {
                burn += amount;
            } else {
                *self.owed.entry(account).or_insert(0) += amount;
            }
        }
        if burn > 0 {
            self.log("sale_tax", None, burn, false);
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(BURN_GAS)
                .burn(U128(burn), Some(format!("sale tax, offer {offer_id}")))
                .detach();
        }
        "sold".into()
    }

    /// The buyer withdraws an open offer; its G become collectable again.
    pub fn cancel_offer(&mut self, offer_id: u64) {
        let caller = env::predecessor_account_id();
        let offer = self
            .offers
            .get_mut(&offer_id)
            .unwrap_or_else(|| env::panic_str("no such offer"));
        require!(offer.buyer == caller, "only the bidder cancels");
        require!(offer.state == OfferState::Open, "that offer is not open");
        offer.state = OfferState::Cancelled;
        *self.owed.entry(caller).or_insert(0) += offer.price.0;
    }

    pub fn get_offer(&self, offer_id: u64) -> Option<Offer> {
        self.offers.get(&offer_id).cloned()
    }

    /// Open offers for a player.
    pub fn offers_for(&self, token_id: String) -> Vec<Offer> {
        self.offers_by_token
            .get(&token_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.offers.get(id))
                    .filter(|o| o.state == OfferState::Open)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// G the league holds for an account: sale shares and cancelled offers.
    pub fn owed_of(&self, account_id: AccountId) -> U128 {
        U128(self.owed.get(&account_id).copied().unwrap_or(0))
    }

    /// Withdraws what the league holds for the caller.
    pub fn collect(&mut self) {
        let caller = env::predecessor_account_id();
        let amount = self.owed.remove(&caller).unwrap_or(0);
        require!(amount > 0, "nothing to collect");
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(MINT_GAS)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(caller.clone(), U128(amount), Some("collect".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_collected(caller, U128(amount)),
            )
            .detach();
    }

    /// Puts the G back if the transfer failed (an unregistered account).
    #[private]
    pub fn on_collected(
        &mut self,
        account_id: AccountId,
        amount: U128,
        #[callback_result] paid: Result<(), PromiseError>,
    ) {
        if paid.is_err() {
            *self.owed.entry(account_id).or_insert(0) += amount.0;
        }
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
            .flatten()
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
        let squad = self.squads.get(&new_owner).cloned().unwrap_or_default();
        let mut squad = squad;
        if !squad.contains(&token_id) {
            squad.push(token_id);
        }
        self.trim(&mut squad);
        self.squads.insert(new_owner, squad);
    }

    /// The manager brings back a player his club owns but who left the squad
    /// (when it went past twelve). The squad is trimmed again the same way.
    pub fn recall_player(&mut self, token_id: String) {
        let club = env::predecessor_account_id();
        require!(self.clubs.contains_key(&club), "you manage no club");
        let p = self
            .players
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(p.owner == club, "your club does not own that player");
        let mut squad = self.squads.get(&club).cloned().unwrap_or_default();
        require!(!squad.contains(&token_id), "he is in the squad already");
        squad.push(token_id.clone());
        self.trim(&mut squad);
        require!(squad.contains(&token_id), "the squad has no room for him");
        self.squads.insert(club, squad);
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
    /// Every club, division by division, each in table order.
    pub fn table(&self) -> Vec<Club> {
        (0..self.divisions.len())
            .flat_map(|d| self.division_table(d as u8 + 1))
            .collect()
    }

    /// One division's table this season: points, goal difference, goals.
    pub fn division_table(&self, division: u8) -> Vec<Club> {
        let ids = self
            .divisions
            .get(u32::from(division.max(1)) - 1)
            .cloned()
            .unwrap_or_default();
        let mut clubs: Vec<Club> = ids
            .iter()
            .filter_map(|id| self.clubs.get(id).cloned())
            .collect();
        clubs.sort_by(standing);
        clubs
    }

    /// How a division finished a past season, champion first.
    pub fn final_table(&self, season: u32, division: u8) -> Vec<AccountId> {
        self.final_tables
            .get(&(season, division))
            .cloned()
            .unwrap_or_default()
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

    /// Every club's stand for the current match day: fans in, the target.
    pub fn stands_today(&self) -> Vec<(AccountId, Stand)> {
        self.club_ids
            .iter()
            .map(|id| (id.clone(), self.stand(id.clone())))
            .collect()
    }

    // ---- Season tickets ----

    /// Season tickets a club sold for a season (at most `season_tickets_per_club`).
    pub fn season_tickets_sold(&self, club_id: AccountId, season: u32) -> u32 {
        self.season_tickets_sold
            .get(&(club_id, season))
            .copied()
            .unwrap_or(0)
    }

    pub fn season_tickets_contract(&self) -> AccountId {
        self.season_tickets_id.clone()
    }

    /// Splits what goalars really minted for season tickets between the clubs
    /// (in proportion to their nominal shares) and credits their tickets.
    #[private]
    pub fn on_season_tickets_minted(
        &mut self,
        season: u32,
        nominal: Vec<(AccountId, U128)>,
        #[callback_result] minted: Result<U128, PromiseError>,
    ) {
        let Ok(minted) = minted else {
            return;
        };
        let total: u128 = nominal.iter().map(|(_, v)| v.0).sum();
        if total == 0 || minted.0 == 0 {
            return;
        }
        let shares: Vec<(AccountId, U128)> = nominal
            .into_iter()
            .map(|(club, v)| (club, U128(minted.0 * v.0 / total)))
            .collect();
        ext_tickets::ext(self.season_tickets_id.clone())
            .with_static_gas(TICKETS_GAS)
            .credit(season, shares)
            .detach();
    }

    // ---- The ledger ----

    /// The last mints and burns of G, newest first.
    pub fn ledger(&self, limit: Option<u32>) -> Vec<LedgerEntry> {
        let n = (limit.unwrap_or(100) as u64).min(LEDGER_SIZE);
        let mut out = Vec::new();
        let mut id = self.ledger_next;
        while id > 0 && (out.len() as u64) < n {
            id -= 1;
            if let Some(e) = self.ledger.get(&(id % LEDGER_SIZE))
                && e.id == id
            {
                out.push(e.clone());
            }
        }
        out
    }

    // ---- Match days ----

    /// Plays the current match day. Anyone can call it once it is due; the
    /// relay does it on schedule. Plays every fixture, credits goals, settles
    /// every stand, then opens the next match day.
    /// Plays what is due, one division per call (the top one first): its
    /// first half from kick-off, its second half after half-time. The last
    /// second half of the day settles it; the last day of a season moves
    /// clubs up and down. Call again while it is due.
    pub fn play_match_day(&mut self) -> Vec<MatchResult> {
        let now = env::block_timestamp();
        require!(now >= self.next_match_at_ns, "the match day is not due yet");
        self.halves.resize(self.divisions.len() as usize, 0);
        if let Some(d) = self.halves.iter().position(|h| *h == 0) {
            let results = self.first_half(d as u8, now);
            self.halves[d] = 1;
            if self.first_half_played() {
                self.next_match_at_ns =
                    (self.kickoff_ns + self.half_ns + self.half_time_ns).max(now);
            }
            results
        } else if let Some(d) = self.halves.iter().position(|h| *h == 1) {
            let results = self.second_half(d as u8);
            self.halves[d] = 2;
            if self.halves.iter().all(|h| *h == 2) {
                self.close_day(now);
            }
            results
        } else {
            // No club yet: the day passes.
            self.close_day(now);
            Vec::new()
        }
    }

    pub fn season(&self) -> u32 {
        self.season
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

    /// The pairings of a match day (home, away), known in advance.
    /// The fixtures of a match day, division by division (as the divisions
    /// stand now).
    pub fn fixtures_of(&self, match_day: u32) -> Vec<(AccountId, AccountId)> {
        (0..self.divisions.len() as u8)
            .flat_map(|d| self.division_fixtures(d, match_day))
            .collect()
    }

    /// A match day's results, division by division.
    pub fn results(&self, match_day: u32) -> Vec<MatchResult> {
        (0..self.divisions.len().max(1) as u8)
            .flat_map(|d| {
                self.day_results
                    .get(&(match_day, d))
                    .cloned()
                    .unwrap_or_default()
            })
            .collect()
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
    fn train(&mut self, sender_id: AccountId, amount: U128, order: TrainOrder) {
        require!(
            amount == the_rules().training_cost,
            "training costs exactly training_cost"
        );
        let day = self.match_day;
        let token = order.token_id;
        let player = self
            .players
            .get_mut(&token)
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
        let id = self.next_ticket;
        self.next_ticket += 1;
        let seed = derive_seed(env::random_seed_array(), &[id, day as u64]);
        let hex: String = seed.iter().map(|b| format!("{b:02x}")).collect();
        self.tickets.insert(
            token.clone(),
            Ticket {
                id,
                token_id: token.clone(),
                skill: order.skill,
                match_day: day,
                seed: hex,
            },
        );
        self.log("training", Some(sender_id.clone()), amount.0, false);
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(BURN_GAS)
            .burn(amount, Some(format!("training {token}")))
            .detach();
    }

    /// A season ticket of `club`, paid `amount` G by `buyer`: the price goes
    /// to the club's treasury and the ticket is minted to the buyer.
    fn sell_season_ticket(&mut self, buyer: AccountId, amount: U128, club: AccountId) {
        let rules = the_rules();
        require!(
            amount == rules.season_ticket_price,
            "a season ticket costs exactly season_ticket_price"
        );
        let season = self.season;
        let key = (club.clone(), season);
        let sold = self.season_tickets_sold.get(&key).copied().unwrap_or(0);
        require!(
            sold < rules.season_tickets_per_club,
            "this club sold all its season tickets"
        );
        let name = self
            .clubs
            .get(&club)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| env::panic_str("no such club"));
        let number = sold + 1;
        self.season_tickets_sold.insert(key, number);
        if let Some(c) = self.clubs.get_mut(&club) {
            c.treasury = U128(c.treasury.0 + amount.0);
        }
        let token_id = format!("{club}:{season}:{number}");
        ext_tickets::ext(self.season_tickets_id.clone())
            .with_static_gas(TICKETS_GAS)
            .mint(
                token_id,
                buyer,
                club.clone(),
                season,
                number,
                PlayerMetadata {
                    title: format!("{name} · Season {season} · #{number}"),
                    description: "Season ticket: earns G at every full house of its club this season, held in the ticket. Read it: season tickets contract, ticket.".into(),
                    copies: 1,
                    extra: format!("{{\"club\":\"{club}\",\"season\":{season},\"number\":{number}}}"),
                },
            )
            .detach();
    }

    /// Writes a mint or a burn in the ledger (a ring of `LEDGER_SIZE`).
    fn log(&mut self, kind: &str, who: Option<AccountId>, amount: u128, mint: bool) {
        if amount == 0 {
            return;
        }
        let id = self.ledger_next;
        self.ledger.insert(
            id % LEDGER_SIZE,
            LedgerEntry {
                id,
                match_day: self.match_day,
                kind: kind.to_string(),
                who,
                amount: U128(amount),
                mint,
            },
        );
        self.ledger_next += 1;
    }

    fn bid(&mut self, buyer: AccountId, price: U128, token: String) -> u64 {
        require!(self.clubs.contains_key(&buyer), "only a club bids");
        require!(price.0 > 0, "an offer is more than zero");
        let owner = self
            .players
            .get(&token)
            .map(|p| p.owner.clone())
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(owner != buyer, "you already own that player");
        let id = self.next_offer;
        self.next_offer += 1;
        self.offers.insert(
            id,
            Offer {
                id,
                token_id: token.clone(),
                buyer,
                price,
                state: OfferState::Open,
                match_day: self.match_day,
            },
        );
        self.offers_by_token.entry(token).or_default().push(id);
        id
    }

    /// Kick-off: plays the first half of every fixture of a division.
    fn first_half(&mut self, div: u8, now: u64) -> Vec<MatchResult> {
        let _ = now;
        let day = self.match_day;
        let block_seed = env::random_seed_array();
        let mut results = Vec::new();
        for (index, (home, away)) in self.division_fixtures(div, day).into_iter().enumerate() {
            let (hs, hxi, hf) = self.side_of(&home, 1, None);
            let (aws, axi, af) = self.side_of(&away, 1, None);
            let seed = derive_seed(block_seed, &[day as u64, div as u64, index as u64, 1]);
            let half = live::play_half(seed, 1, &hs, &aws, true);
            let (hg, ag) = live::score(&half.events);
            let mut m = MatchResult {
                derby: self.are_rivals(&home, &away),
                home,
                away,
                home_goals: hg,
                away_goals: ag,
                goals: Vec::new(),
                stats: MatchStats::default(),
                first_half_events: half.events.len() as u32,
                events: half.events,
                elevens: vec![hxi, axi],
                formations: vec![hf, af],
                strategies: vec![hs.strategy, aws.strategy],
                half_ends: vec![half.end],
                possession: half.possession.to_vec(),
                full_time: false,
                division: div + 1,
            };
            m.stats = sheet(&m, None);
            results.push(m);
        }
        self.day_results.insert((day, div), results.clone());
        results
    }

    /// After half-time: plays the second halves of a division and settles
    /// its clubs' day.
    fn second_half(&mut self, div: u8) -> Vec<MatchResult> {
        let day = self.match_day;
        let rules = the_rules();
        let ids: Vec<AccountId> = self.divisions.get(div as u32).cloned().unwrap_or_default();
        let block_seed = env::random_seed_array();
        let mut results = self
            .day_results
            .get(&(day, div))
            .cloned()
            .unwrap_or_default();
        let mut treasury_mints: Vec<(AccountId, u128)> = Vec::new();
        let mut burn_total: u128 = 0;
        let mut derby_clubs: Vec<AccountId> = Vec::new();
        // How full each club's stand is today, in basis points of its target.
        let fill: std::collections::HashMap<AccountId, u128> = ids
            .iter()
            .map(|id| (id.clone(), self.stand_fill_bps(id, day)))
            .collect();

        for (index, m) in results.iter_mut().enumerate() {
            let (hs, hxi, hf) = self.side_of(&m.home, 2, Some(FirstHalf::of(m, true)));
            let (aws, axi, af) = self.side_of(&m.away, 2, Some(FirstHalf::of(m, false)));
            let seed = derive_seed(block_seed, &[day as u64, div as u64, index as u64, 2]);
            let half = live::play_half(seed, 2, &hs, &aws, false);
            m.events.extend(half.events);
            m.elevens.push(hxi);
            m.elevens.push(axi);
            m.formations.push(hf);
            m.formations.push(af);
            m.strategies.push(hs.strategy);
            m.strategies.push(aws.strategy);
            m.half_ends.push(half.end);
            m.possession.extend(half.possession);
            m.full_time = true;
            let (hg, ag) = live::score(&m.events);
            m.home_goals = hg;
            m.away_goals = ag;
            if m.derby {
                derby_clubs.push(m.home.clone());
                derby_clubs.push(m.away.clone());
            }

            let mut goals = Vec::new();
            for (n, e) in m.events.iter().enumerate() {
                if !matches!(e.kind, EventKind::Goal | EventKind::OwnGoal) {
                    continue;
                }
                let h = usize::from(n as u32 >= m.first_half_events);
                // Who touched it last: the scorer, or for an own goal a player
                // of the other side.
                let side = usize::from(!e.home) ^ usize::from(e.kind == EventKind::OwnGoal);
                let token = m.elevens[2 * h + side]
                    .get(e.player as usize)
                    .cloned()
                    .unwrap_or_default();
                let name = self
                    .players
                    .get(&token)
                    .map(|p| p.name.clone())
                    .unwrap_or_else(|| "Academy kid".to_string());
                let kind = match e.kind {
                    EventKind::OwnGoal => GoalKind::Own,
                    _ if e.second as u32 > 2 * live::HALF_SECONDS => GoalKind::Late,
                    _ => GoalKind::Normal,
                };
                let (scorer, at_fault) = if e.home {
                    (&m.home, &m.away)
                } else {
                    (&m.away, &m.home)
                };
                match kind {
                    GoalKind::Own => {
                        let b = self.take_from_treasury(at_fault, rules.own_goal_burn.0);
                        self.log("own_goal", Some(at_fault.clone()), b, false);
                        burn_total += b;
                    }
                    GoalKind::Normal | GoalKind::Late => {
                        let k = if kind == GoalKind::Late {
                            rules.late_goal_multiplier as u128
                        } else {
                            1
                        };
                        let f = fill.get(scorer).copied().unwrap_or(0);
                        if let Some(p) = self.players.get_mut(&token) {
                            p.wallet =
                                U128(p.wallet.0 + k * rules.goal_scorer_share.0 * f / 10_000);
                            p.goals += 1;
                            p.skills.raise(Skill::Shooting, 1);
                            p.refresh();
                        }
                        treasury_mints
                            .push((scorer.clone(), k * rules.goal_club_share.0 * f / 10_000));
                        self.log(
                            "goals",
                            Some(scorer.clone()),
                            k * rules.goal_mint.0 * f / 10_000,
                            true,
                        );
                    }
                }
                goals.push(Goal {
                    for_home: e.home,
                    minute: minute_of(e.second, h),
                    kind,
                    player: token,
                    name,
                });
            }
            m.goals = goals;
            m.stats = sheet(m, Some(&self.players));
            // A red card: suspended for the next match day.
            for (n, e) in m.events.iter().enumerate() {
                if e.kind != EventKind::Red {
                    continue;
                }
                let h = usize::from(n as u32 >= m.first_half_events);
                if let Some(t) = m.elevens[2 * h + usize::from(!e.home)].get(e.player as usize)
                    && self.players.contains_key(t)
                {
                    self.suspended.insert((t.clone(), day + 1));
                }
            }
            for (club, side) in [(m.home.clone(), 0usize), (m.away.clone(), 1usize)] {
                let mut xi: Vec<String> = m.elevens[side]
                    .iter()
                    .chain(&m.elevens[2 + side])
                    .filter(|t| !t.is_empty())
                    .cloned()
                    .collect();
                xi.sort();
                xi.dedup();
                self.pay_salaries(&club, &xi, rules.salary.0);
            }
            self.record_score(&m.home, hg, ag, &rules);
            self.record_score(&m.away, ag, hg, &rules);
        }

        for id in &ids {
            let k = if derby_clubs.contains(id) {
                rules.derby_multiplier
            } else {
                1
            };
            burn_total += self.settle_stand(id, day, k, &rules);
        }

        // A full house pays the club's season tickets of this season.
        let mut ticket_mints: Vec<(AccountId, U128)> = Vec::new();
        for id in &ids {
            let Some(st) = self.stands.get(&(id.clone(), day)) else {
                continue;
            };
            let sold = self
                .season_tickets_sold
                .get(&(id.clone(), self.season))
                .copied()
                .unwrap_or(0);
            if st.full_house && sold > 0 {
                let amount = rules.season_ticket_share.0 * st.multiplier as u128 * sold as u128;
                self.log("season_tickets", Some(id.clone()), amount, true);
                ticket_mints.push((id.clone(), U128(amount)));
            }
        }
        let ticket_total: u128 = ticket_mints.iter().map(|(_, v)| v.0).sum();
        if ticket_total > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(MINT_GAS)
                .mint(
                    self.season_tickets_id.clone(),
                    U128(ticket_total),
                    Some(format!("season tickets, match day {day}")),
                )
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(TICKETS_GAS.saturating_add(CALLBACK_GAS))
                        .on_season_tickets_minted(self.season, ticket_mints),
                )
                .detach();
        }

        self.day_results.insert((day, div), results.clone());

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

    /// Every division has played: the next match day opens. The last match
    /// day of a week elects next week's captains; the last of a season moves
    /// clubs up and down and starts a new season.
    fn close_day(&mut self, now: u64) {
        let rules = the_rules();
        let closing = self.match_day;
        self.match_day += 1;
        if closing > KEEP_RESULTS {
            for d in 0..self.divisions.len() as u8 {
                self.day_results.remove(&(closing - KEEP_RESULTS, d));
            }
        }
        self.halves = vec![0; self.divisions.len() as usize];
        self.last_kickoff_ns = self.kickoff_ns;
        self.kickoff_ns = (self.kickoff_ns + self.interval_ns).max(now + MINUTE_NS);
        self.next_match_at_ns = self.kickoff_ns;
        let next = self.match_day;
        if (next - 1).is_multiple_of(rules.week_length) {
            let week = self.week_of(next);
            let ids: Vec<AccountId> = self.club_ids.iter().cloned().collect();
            for id in &ids {
                self.elect_captain(id, week);
            }
        }
        if closing.is_multiple_of(SEASON_DAYS) {
            self.end_season();
        }
    }

    /// Final tables are kept; the bottom three of a division swap with the
    /// top three of the one below (fewer when a division is small), and a
    /// relegated club burns a tenth of its treasury; every club starts the
    /// new season on zero.
    fn end_season(&mut self) {
        let n = self.divisions.len();
        let mut burned: u128 = 0;
        let mut tables: Vec<Vec<AccountId>> = (0..n)
            .map(|d| {
                self.division_table(d as u8 + 1)
                    .into_iter()
                    .map(|c| c.manager)
                    .collect()
            })
            .collect();
        for (d, t) in tables.iter().enumerate() {
            self.final_tables
                .insert((self.season, d as u8 + 1), t.clone());
        }
        for d in 0..n.saturating_sub(1) as usize {
            let k = MOVERS.min(tables[d].len() / 2).min(tables[d + 1].len() / 2);
            let keep = tables[d].len() - k;
            let down: Vec<AccountId> = tables[d].split_off(keep);
            let up: Vec<AccountId> = tables[d + 1].drain(..k).collect();
            // Going down costs a tenth of the treasury, burned.
            for id in &down {
                let t = self.clubs.get(id).map_or(0, |c| c.treasury.0);
                let b = self
                    .take_from_treasury(id, t * the_rules().relegation_burn_bps as u128 / 10_000);
                self.log("relegation", Some(id.clone()), b, false);
                burned += b;
            }
            tables[d].extend(up);
            tables[d + 1].splice(0..0, down);
        }
        for (d, t) in tables.into_iter().enumerate() {
            for id in &t {
                if let Some(c) = self.clubs.get_mut(id) {
                    c.division = d as u8 + 1;
                    c.played = 0;
                    c.won = 0;
                    c.drawn = 0;
                    c.lost = 0;
                    c.goals_for = 0;
                    c.goals_against = 0;
                    c.points = 0;
                }
            }
            self.divisions.replace(d as u32, t);
        }
        self.season += 1;
        if burned > 0 {
            ext_goalars::ext(self.goalars_id.clone())
                .with_static_gas(BURN_GAS)
                .burn(
                    U128(burned),
                    Some(format!("relegation, season {}", self.season - 1)),
                )
                .detach();
        }
    }

    /// A new club goes to the lowest division with room, or opens one below.
    fn join_division(&mut self, club: &AccountId) -> u8 {
        let n = self.divisions.len();
        if n > 0
            && let Some(last) = self.divisions.get_mut(n - 1)
            && last.len() < DIVISION_SIZE
        {
            last.push(club.clone());
            return n as u8;
        }
        self.divisions.push(vec![club.clone()]);
        // A division born after kick-off waits for the next match day.
        let started = self.halves.iter().any(|h| *h > 0);
        self.halves.resize(n as usize, 0);
        self.halves.push(if started { 2 } else { 0 });
        n as u8 + 1
    }

    fn division_fixtures(&self, div: u8, match_day: u32) -> Vec<(AccountId, AccountId)> {
        let ids = self.divisions.get(div as u32).cloned().unwrap_or_default();
        fixtures(ids.len(), (match_day.max(1) - 1) % SEASON_DAYS)
            .into_iter()
            .map(|(h, a)| (ids[h].clone(), ids[a].clone()))
            .collect()
    }

    fn first_half_played(&self) -> bool {
        !self.halves.is_empty() && self.halves.iter().all(|h| *h >= 1)
    }

    /// The half a club's next lineup and votes are for.
    fn next_half(&self, club: &AccountId) -> u8 {
        let div = self.clubs.get(club).map_or(1, |c| c.division.max(1)) as usize - 1;
        if self.halves.get(div).copied().unwrap_or(0) >= 1 {
            2
        } else {
            1
        }
    }

    /// Whether `who` leads `club` on the pitch: its captain, or its manager
    /// while it has none.
    fn leads(&self, club_id: &AccountId, who: &AccountId) -> bool {
        let Some(club) = self.clubs.get(club_id) else {
            env::panic_str("no such club")
        };
        match self.captain(club_id.clone()) {
            Some(c) => self
                .players
                .get(&c.token_id)
                .map(|p| p.beneficiary() == who)
                .unwrap_or(false),
            None => &club.manager == who,
        }
    }

    fn formation_of(&self, club: &AccountId) -> Formation {
        self.formations
            .get(club)
            .copied()
            .unwrap_or(Formation::F442)
    }

    /// Most votes wins; a tie or no vote plays balanced.
    fn strategy_of(&self, club: &AccountId, half: u8) -> Strategy {
        let votes = self
            .strategy_votes
            .get(&(club.clone(), self.match_day, half))
            .cloned()
            .unwrap_or_default();
        let count = |s: Strategy| votes.iter().filter(|(_, v)| *v == s).count();
        let (d, b, a) = (
            count(Strategy::Defend),
            count(Strategy::Balanced),
            count(Strategy::Attack),
        );
        if a > d && a > b {
            Strategy::Attack
        } else if d > a && d > b {
            Strategy::Defend
        } else {
            Strategy::Balanced
        }
    }

    /// A club on the pitch for a half, with its eleven by slot and formation.
    /// For the second half, `first` is that club's first half: who was
    /// booked, and who was sent off (his slot stays empty, nobody comes on).
    /// Other empty slots get an academy kid (`BOT`).
    fn side_of(
        &self,
        club: &AccountId,
        half: u8,
        first: Option<FirstHalf>,
    ) -> (live::Side, Vec<String>, Formation) {
        let formation = self.formation_of(club);
        let first = first.unwrap_or_default();
        let mut xi = self.eleven_of_without(club, &first.off);
        for &k in &first.off_slots {
            if let Some(slot) = xi.get_mut(k) {
                *slot = None;
            }
        }
        let mut skills = [None; ELEVEN];
        let mut booked = [false; ELEVEN];
        let mut names: Vec<String> = Vec::with_capacity(ELEVEN);
        for (k, t) in xi.iter().enumerate() {
            match t.as_ref().and_then(|t| self.players.get(t)) {
                Some(p) => {
                    skills[k] = Some(p.skills);
                    booked[k] = first.booked.contains(&p.token_id);
                    names.push(p.token_id.clone());
                }
                None if first.off_slots.contains(&k) => names.push(String::new()),
                None => {
                    skills[k] = Some(BOT_SKILLS);
                    names.push(BOT.to_string());
                }
            }
        }
        let named = self.takers.get(club).cloned().unwrap_or_default();
        let slot_of =
            |t: &Option<String>| t.as_ref().and_then(|t| names.iter().position(|n| n == t));
        let mut side = live::Side::new(formation.roles(), skills, self.strategy_of(club, half));
        side.booked = booked;
        side.takers = [slot_of(&named.free_kick), slot_of(&named.penalty)];
        (side, names, formation)
    }

    /// The caller's footballer and the club he plays for.
    fn my_player_and_club(&self) -> (String, AccountId) {
        let person = env::predecessor_account_id();
        let token = self
            .footballer_of
            .get(&person)
            .cloned()
            .unwrap_or_else(|| env::panic_str("create your footballer first"));
        let club = self.players.get(&token).map(|p| p.owner.clone()).unwrap();
        require!(self.clubs.contains_key(&club), "join a club first");
        (token, club)
    }

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
        let skills = Skills::roll(stream, position);
        let token_id = format!("p{}", self.next_player);
        self.next_player += 1;
        let player = Player {
            token_id: token_id.clone(),
            name,
            position,
            skills,
            overall: skills.overall(position),
            attack: skills.attack(),
            defence: skills.defence(),
            owner,
            goals: 0,
            wallet: U128(0),
            controller,
            salary: U128(0),
            last_trained_day: 0,
            look: Look::default(),
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
                    "{{\"position\":\"{pos}\",\"overall\":{},\"skills\":{}}}",
                    p.overall,
                    near_sdk::serde_json::to_string(&p.skills).unwrap_or_default()
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

    /// Whether a player can play today: everyone in the squad does, unless
    /// suspended after a red card.
    /// Eleven and one more: past twelve, the weakest academy player leaves
    /// the squad (his NFT stays with the club), but never the last keeper.
    /// Twelve people and no academy player left: the newcomer sits on the bench.
    fn trim(&self, squad: &mut Vec<String>) {
        while squad.len() > MAX_SQUAD {
            let keepers = squad
                .iter()
                .filter_map(|t| self.players.get(t))
                .filter(|p| p.position == Position::Gk)
                .count();
            let weakest = squad
                .iter()
                .filter_map(|t| self.players.get(t))
                .filter(|p| p.controller.is_none())
                .filter(|p| p.position != Position::Gk || keepers > 1)
                .min_by_key(|p| (p.overall, std::cmp::Reverse(p.token_id.clone())))
                .map(|p| p.token_id.clone());
            match weakest {
                Some(w) => squad.retain(|t| t != &w),
                None => break,
            }
        }
    }

    fn available(&self, token: &String) -> bool {
        self.players.contains_key(token)
            && !self.suspended.contains(&(token.clone(), self.match_day))
    }

    /// The eleven of a club for the next half, by slot of its formation:
    /// people in the slots they took (if they still play here and reported),
    /// then, slot by slot from the keeper up, the best available player of
    /// the squad for that role. `None` when the squad runs short.
    fn eleven_of(&self, club: &AccountId) -> Vec<Option<String>> {
        self.eleven_of_without(club, &[])
    }

    /// The same, never picking the players in `out` (sent off). Who is
    /// available is read once per player: those reads are most of the gas.
    fn eleven_of_without(&self, club: &AccountId, out: &[String]) -> Vec<Option<String>> {
        let squad: Vec<String> = self
            .squads
            .get(club)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|t| !out.contains(t) && self.available(t))
            .collect();
        let roles = self.formation_of(club).roles();
        let mut xi: Vec<Option<String>> = self
            .slots
            .get(&(club.clone(), self.match_day))
            .cloned()
            .unwrap_or_else(|| vec![None; ELEVEN])
            .into_iter()
            .map(|t| t.filter(|t| squad.contains(t)))
            .collect();
        xi.resize(ELEVEN, None);
        for k in 0..ELEVEN {
            if xi[k].is_some() {
                continue;
            }
            let best = squad
                .iter()
                .filter(|t| !xi.contains(&Some((*t).clone())))
                .filter_map(|t| self.players.get(t))
                .max_by_key(|p| {
                    // Keepers keep goal, outfield players stay outfield.
                    let fits = (roles[k] == Role::Gk) == (p.position == Position::Gk);
                    (
                        fits,
                        live::role_value(&p.skills, roles[k]),
                        std::cmp::Reverse(p.token_id.clone()),
                    )
                })
                .map(|p| p.token_id.clone());
            xi[k] = best;
        }
        xi
    }

    fn welcome(&mut self, account_id: &AccountId) {
        if self.welcome.contains_key(account_id) {
            return;
        }
        self.welcome.insert(account_id.clone(), 0);
        self.mint(account_id.clone(), the_rules().signup_grant, "signup grant");
    }

    /// Schedules a mint on the goalars contract. The amount is nominal: goalars
    /// scales it under the 10B cap.
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: &str) {
        let kind = if memo.starts_with("signup") {
            "signup"
        } else {
            "welcome"
        };
        self.log(kind, Some(account_id.clone()), amount.0, true);
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
    /// A club's stand on `day`, in basis points of its full-house target
    /// (10_000 when full, 0 with no fan or nobody in).
    fn stand_fill_bps(&self, club_id: &AccountId, day: u32) -> u128 {
        let fans = self.clubs.get(club_id).map(|c| c.fans).unwrap_or(0);
        let target = full_house_target(fans) as u128;
        if target == 0 {
            return 0;
        }
        let present = self
            .attendance
            .get(&(club_id.clone(), day))
            .copied()
            .unwrap_or(0) as u128;
        (present * 10_000 / target).min(10_000)
    }

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
            self.log(
                "full_house",
                Some(club_id.clone()),
                rules.full_house_mint_per_fan.0 * k as u128 * present as u128,
                true,
            );
            if let Some(c) = self.clubs.get_mut(club_id) {
                c.full_house_streak += 1;
                c.best_streak = c.best_streak.max(c.full_house_streak);
            }
        } else {
            let treasury = self.clubs.get(club_id).map(|c| c.treasury.0).unwrap_or(0);
            let bps = (rules.empty_stand_burn_bps * k).min(10_000) as u128;
            burned = self.take_from_treasury(club_id, treasury * bps / 10_000);
            self.log("empty_stand", Some(club_id.clone()), burned, false);
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

/// What each account gets from a sale: the payout, never more than the price
/// in total. Amounts are added in a fixed order (sorted by account) so the
/// result does not depend on map order.
fn settle_payout(payout: &Payout, price: u128, _league: &AccountId) -> Vec<(AccountId, u128)> {
    let mut shares: Vec<(AccountId, u128)> = payout
        .payout
        .iter()
        .map(|(k, v)| (k.clone(), v.0))
        .collect();
    shares.sort_by(|a, b| a.0.cmp(&b.0));
    let mut left = price;
    for (_, amount) in shares.iter_mut() {
        *amount = (*amount).min(left);
        left -= *amount;
    }
    shares.retain(|(_, a)| *a > 0);
    shares
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
/// A goal's minute on the sheet: 1 to 45, 46 to 90, stoppage time as 45+ or 90+.
/// Table order: points, goal difference, goals scored, name.
fn standing(a: &Club, b: &Club) -> std::cmp::Ordering {
    let gd = |c: &Club| c.goals_for as i64 - c.goals_against as i64;
    b.points
        .cmp(&a.points)
        .then(gd(b).cmp(&gd(a)))
        .then(b.goals_for.cmp(&a.goals_for))
        .then(a.name.cmp(&b.name))
}

pub fn minute_of(second: u16, half: usize) -> u8 {
    let m = second as u32 / 60 + 1;
    let cap = if half == 0 { 45 } else { 90 };
    let m = if half == 0 { m } else { m.max(46) };
    (if m > cap { cap + (m - cap).min(9) } else { m }) as u8
}

/// Shots, corners, fouls, possession and (at full time) the man of the match.
fn sheet(m: &MatchResult, players: Option<&LookupMap<String, Player>>) -> MatchStats {
    let count = |home: bool, kinds: &[EventKind]| -> u8 {
        m.events
            .iter()
            .filter(|e| e.home == home && kinds.contains(&e.kind))
            .count()
            .min(255) as u8
    };
    let shots = [EventKind::Goal, EventKind::Saved, EventKind::Missed];
    let on_target = [EventKind::Goal, EventKind::Saved];
    let (mut ph, mut pa) = (0u64, 0u64);
    for (i, p) in m.possession.iter().enumerate() {
        if i % 2 == 0 {
            ph += *p as u64;
        } else {
            pa += *p as u64;
        }
    }
    let home_possession = (ph * 100).checked_div(ph + pa).map_or(50, |v| v as u8);
    MatchStats {
        home_shots: count(true, &shots),
        away_shots: count(false, &shots),
        home_on_target: count(true, &on_target),
        away_on_target: count(false, &on_target),
        home_possession,
        away_possession: 100 - home_possession,
        home_corners: count(true, &[EventKind::Corner]),
        away_corners: count(false, &[EventKind::Corner]),
        home_fouls: count(true, &[EventKind::Foul]),
        away_fouls: count(false, &[EventKind::Foul]),
        home_yellows: count(true, &[EventKind::Yellow]),
        away_yellows: count(false, &[EventKind::Yellow]),
        home_reds: count(true, &[EventKind::Red]),
        away_reds: count(false, &[EventKind::Red]),
        man_of_the_match: players.and_then(|ps| star(m, ps)),
    }
}

/// Ratings × 10 from the match sheet; the best is the man of the match.
fn star(m: &MatchResult, players: &LookupMap<String, Player>) -> Option<Star> {
    let mut rating: std::collections::BTreeMap<String, (i32, bool)> = Default::default();
    for (i, xi) in m.elevens.iter().enumerate() {
        for (k, t) in xi.iter().enumerate() {
            if t.is_empty() || t == BOT {
                continue;
            }
            let base = players
                .get(t)
                .map(|p| 60 + (p.overall as i32 - 50) / 4)
                .unwrap_or(60);
            let e = rating.entry(t.clone()).or_insert((base, i % 2 == 0));
            if k <= 4 {
                let conceded = if i % 2 == 0 {
                    m.away_goals
                } else {
                    m.home_goals
                } as i32;
                e.0 += if conceded == 0 {
                    6
                } else {
                    -3 * conceded.min(3)
                } / (m.elevens.len() as i32 / 2);
            }
        }
    }
    for (n, e) in m.events.iter().enumerate() {
        let h = usize::from(n as u32 >= m.first_half_events);
        let side = usize::from(!e.home);
        let at = |side: usize, k: usize| {
            m.elevens
                .get(2 * h + side)
                .and_then(|xi| xi.get(k))
                .cloned()
                .unwrap_or_default()
        };
        let mut add = |t: String, v: i32| {
            if let Some(r) = rating.get_mut(&t) {
                r.0 += v;
            }
        };
        let k = e.player as usize;
        match e.kind {
            EventKind::Goal => add(at(side, k), 12),
            EventKind::OwnGoal => add(at(1 - side, k), -10),
            EventKind::Saved => {
                add(at(side, k), 2);
                add(at(1 - side, 0), 5);
            }
            EventKind::Missed => add(at(side, k), -2),
            EventKind::Foul => add(at(side, k), -2),
            EventKind::Yellow => add(at(side, k), -4),
            EventKind::Red => add(at(side, k), -15),
            EventKind::Assist => add(at(side, k), 6),
            EventKind::Tackle => add(at(side, k), 1),
            EventKind::Corner | EventKind::FreeKick | EventKind::Penalty => {}
        }
    }
    let won = |home: bool| match m.home_goals.cmp(&m.away_goals) {
        std::cmp::Ordering::Greater => {
            if home {
                4
            } else {
                -4
            }
        }
        std::cmp::Ordering::Less => {
            if home {
                -4
            } else {
                4
            }
        }
        std::cmp::Ordering::Equal => 0,
    };
    rating
        .into_iter()
        .map(|(t, (r, home))| (t, (r + won(home)).clamp(30, 99) as u8))
        .max_by_key(|(t, r)| (*r, std::cmp::Reverse(t.clone())))
        .and_then(|(t, r)| {
            players.get(&t).map(|p| Star {
                player: t.clone(),
                name: p.name.clone(),
                rating: r,
            })
        })
}

pub fn full_house_target(fans: u32) -> u32 {
    let bps = the_rules().stadium_target_bps as u64;
    ((fans as u64 * bps).div_ceil(10_000)) as u32
}

#[cfg(test)]
mod tests;

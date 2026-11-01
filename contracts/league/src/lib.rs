//! League: the rules of NEAR Post. It is the only account that can mint goalars,
//! create players and items. There is no owner and no upgrade method: the rules
//! below are fixed at deploy time and readable by anyone with `rules()`.
//!
//! This scaffold covers clubs, the starter grant, fans and stadium check-in.
//! Match days (goals, full-house mint, empty-stand burn) come next.

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, env, ext_contract, near,
    require,
};

/// 1 G in the token's smallest unit (goalars has 6 decimals).
pub const ONE_G: u128 = 1_000_000;

/// The economy, in G and basis points (out of 10_000). Fixed forever.
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
    pub starter_grant: U128,
    pub training_cost: U128,
    pub sale_tax_bps: u32,
    pub trainer_bps: u32,
    pub past_club_bps: u32,
}

pub fn the_rules() -> Rules {
    Rules {
        goal_mint: U128(60 * ONE_G),
        goal_scorer_share: U128(42 * ONE_G),
        goal_club_share: U128(18 * ONE_G),
        late_goal_multiplier: 2,
        own_goal_burn: U128(60 * ONE_G),
        derby_multiplier: 2,
        stadium_target_bps: 6_000,
        full_house_mint_per_fan: U128(ONE_G),
        empty_stand_burn_bps: 200,
        relegation_burn_bps: 1_000,
        starter_grant: U128(50 * ONE_G),
        training_cost: U128(4 * ONE_G),
        sale_tax_bps: 300,
        trainer_bps: 1_000,
        past_club_bps: 200,
    }
}

#[ext_contract(ext_goalars)]
pub trait Goalars {
    fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Clubs,
    FanOf,
    Present,
    Attendance,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Club {
    pub name: String,
    pub manager: AccountId,
    pub division: u8,
    pub fans: u32,
    pub full_house_streak: u32,
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

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct League {
    goalars_id: AccountId,
    players_id: AccountId,
    items_id: AccountId,
    match_day: u32,
    /// Club id is the manager's account.
    clubs: LookupMap<AccountId, Club>,
    fan_of: LookupMap<AccountId, AccountId>,
    present: LookupSet<(AccountId, u32, AccountId)>,
    attendance: LookupMap<(AccountId, u32), u32>,
}

const MINT_GAS: Gas = Gas::from_tgas(10);
const MAX_NAME: usize = 32;

#[near]
impl League {
    #[init]
    pub fn new(goalars_id: AccountId, players_id: AccountId, items_id: AccountId) -> Self {
        Self {
            goalars_id,
            players_id,
            items_id,
            match_day: 1,
            clubs: LookupMap::new(StorageKey::Clubs),
            fan_of: LookupMap::new(StorageKey::FanOf),
            present: LookupSet::new(StorageKey::Present),
            attendance: LookupMap::new(StorageKey::Attendance),
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

    /// Creates the caller's club in Division 3 and pays the starter grant.
    pub fn create_club(&mut self, name: String) -> Promise {
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
        self.clubs.insert(
            manager.clone(),
            Club {
                name,
                manager: manager.clone(),
                division: 3,
                fans: 0,
                full_house_streak: 0,
            },
        );
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(MINT_GAS)
            .with_attached_deposit(NearToken::from_yoctonear(0))
            .mint(
                manager,
                the_rules().starter_grant,
                Some("starter grant".into()),
            )
    }

    pub fn get_club(&self, club_id: AccountId) -> Option<Club> {
        self.clubs.get(&club_id).cloned()
    }

    /// The caller becomes a fan of `club_id` (one club at a time).
    pub fn follow(&mut self, club_id: AccountId) {
        require!(self.clubs.contains_key(&club_id), "no such club");
        let fan = env::predecessor_account_id();
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

    /// The caller takes their seat for their club's current match day. Free, once per day.
    pub fn check_in(&mut self) -> Stand {
        let fan = env::predecessor_account_id();
        let club_id = self
            .fan_of
            .get(&fan)
            .cloned()
            .unwrap_or_else(|| env::panic_str("follow a club first"));
        let day = self.match_day;
        require!(
            self.present.insert((club_id.clone(), day, fan)),
            "already in the stand"
        );
        *self.attendance.entry((club_id.clone(), day)).or_insert(0) += 1;
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
}

/// 60% of fans, rounded up.
pub fn full_house_target(fans: u32) -> u32 {
    let bps = the_rules().stadium_target_bps as u64;
    ((fans as u64 * bps).div_ceil(10_000)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(caller: &str) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(acc(caller))
                .build()
        );
    }

    fn league() -> League {
        as_caller("deployer.testnet");
        League::new(
            acc("goalars.testnet"),
            acc("players.testnet"),
            acc("items.testnet"),
        )
    }

    #[test]
    fn rules_match_the_design() {
        let r = league().rules();
        assert_eq!(r.goal_scorer_share.0 + r.goal_club_share.0, r.goal_mint.0);
        assert_eq!(r.starter_grant, U128(50 * ONE_G));
        assert_eq!(r.stadium_target_bps, 6_000);
    }

    #[test]
    fn full_house_target_rounds_up() {
        assert_eq!(full_house_target(340), 204);
        assert_eq!(full_house_target(5), 3);
        assert_eq!(full_house_target(0), 0);
    }

    #[test]
    fn a_manager_has_one_club() {
        let mut l = league();
        as_caller("koplo.testnet");
        let _ = l.create_club("Olympique Rive Nord".into());
        assert_eq!(l.get_club(acc("koplo.testnet")).unwrap().division, 3);
    }

    #[test]
    #[should_panic(expected = "you already manage a club")]
    fn no_second_club() {
        let mut l = league();
        as_caller("koplo.testnet");
        let _ = l.create_club("A".into());
        let _ = l.create_club("B".into());
    }

    #[test]
    fn fans_fill_the_stand_to_a_full_house() {
        let mut l = league();
        as_caller("koplo.testnet");
        let _ = l.create_club("Rive Nord".into());
        for f in ["a", "b", "c", "d", "e"] {
            as_caller(&format!("{f}.testnet"));
            l.follow(acc("koplo.testnet"));
        }
        for f in ["a", "b"] {
            as_caller(&format!("{f}.testnet"));
            assert!(!l.check_in().full_house);
        }
        as_caller("c.testnet");
        let stand = l.check_in();
        assert_eq!((stand.present, stand.target), (3, 3));
        assert!(stand.full_house);
    }

    #[test]
    #[should_panic(expected = "already in the stand")]
    fn one_seat_per_fan_per_day() {
        let mut l = league();
        as_caller("koplo.testnet");
        let _ = l.create_club("Rive Nord".into());
        as_caller("a.testnet");
        l.follow(acc("koplo.testnet"));
        l.check_in();
        l.check_in();
    }

    #[test]
    fn switching_club_moves_the_fan() {
        let mut l = league();
        as_caller("x.testnet");
        let _ = l.create_club("X".into());
        as_caller("y.testnet");
        let _ = l.create_club("Y".into());
        as_caller("fan.testnet");
        l.follow(acc("x.testnet"));
        l.follow(acc("y.testnet"));
        assert_eq!(l.get_club(acc("x.testnet")).unwrap().fans, 0);
        assert_eq!(l.get_club(acc("y.testnet")).unwrap().fans, 1);
    }
}

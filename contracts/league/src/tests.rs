use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

const MINUTE_MS: u64 = 60_000;
const START_NS: u64 = 1_000_000_000_000;

fn at(caller: &str, now_ns: u64, seed: u8) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(acc(caller))
            .current_account_id(acc("league.testnet"))
            .block_timestamp(now_ns)
            .random_seed([seed; 32])
            .build()
    );
}

fn as_caller(caller: &str) {
    at(caller, START_NS, 1);
}

fn league() -> League {
    as_caller("deployer.testnet");
    League::new(
        acc("goalars.testnet"),
        acc("players.testnet"),
        acc("items.testnet"),
        U64(10 * MINUTE_MS),
    )
}

/// A league with `n` clubs named c0..cn and `fans` fans each.
fn league_with(n: usize, fans: usize) -> League {
    let mut l = league();
    for c in 0..n {
        as_caller(&format!("c{c}.testnet"));
        l.create_club(format!("Club {c}"));
        for f in 0..fans {
            as_caller(&format!("f{c}-{f}.testnet"));
            l.follow(acc(&format!("c{c}.testnet")));
        }
    }
    l
}

fn due(l: &League) -> u64 {
    l.next_match_at_ns
}

#[test]
fn rules_match_the_design() {
    let r = league().rules();
    assert_eq!(r.goal_scorer_share.0 + r.goal_club_share.0, r.goal_mint.0);
    assert_eq!(
        r.signup_grant.0 + r.welcome_visits as u128 * r.welcome_bonus.0,
        5_000_000 * ONE_G
    );
    assert_eq!(r.max_supply, U128(10_000_000_000 * ONE_G));
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
    l.create_club("Olympique Rive Nord".into());
    assert_eq!(l.get_club(acc("koplo.testnet")).unwrap().division, 3);
}

#[test]
#[should_panic(expected = "you already manage a club")]
fn no_second_club() {
    let mut l = league();
    as_caller("koplo.testnet");
    l.create_club("A".into());
    l.create_club("B".into());
}

#[test]
fn fans_fill_the_stand_to_a_full_house() {
    let mut l = league();
    as_caller("koplo.testnet");
    l.create_club("Rive Nord".into());
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
    l.create_club("Rive Nord".into());
    as_caller("a.testnet");
    l.follow(acc("koplo.testnet"));
    l.check_in();
    l.check_in();
}

#[test]
fn switching_club_moves_the_fan() {
    let mut l = league();
    as_caller("x.testnet");
    l.create_club("X".into());
    as_caller("y.testnet");
    l.create_club("Y".into());
    as_caller("fan.testnet");
    l.follow(acc("x.testnet"));
    l.follow(acc("y.testnet"));
    assert_eq!(l.get_club(acc("x.testnet")).unwrap().fans, 0);
    assert_eq!(l.get_club(acc("y.testnet")).unwrap().fans, 1);
}

#[test]
fn welcome_bonus_is_paid_on_the_first_four_visits_only() {
    let mut l = league();
    as_caller("koplo.testnet");
    l.create_club("Rive Nord".into());
    as_caller("fan.testnet");
    assert_eq!(l.welcome_status(acc("fan.testnet")), None);
    l.follow(acc("koplo.testnet"));
    assert_eq!(l.welcome_status(acc("fan.testnet")), Some(0));
    for day in 1..=6 {
        l.match_day = day;
        l.check_in();
    }
    assert_eq!(l.welcome_status(acc("fan.testnet")), Some(4));
}

#[test]
fn signup_grant_once_even_after_switching_clubs() {
    let mut l = league();
    as_caller("x.testnet");
    l.create_club("X".into());
    as_caller("y.testnet");
    l.create_club("Y".into());
    as_caller("fan.testnet");
    l.follow(acc("x.testnet"));
    l.follow(acc("y.testnet"));
    l.follow(acc("x.testnet"));
    assert_eq!(l.welcome_status(acc("fan.testnet")), Some(0));
}

#[test]
#[should_panic(expected = "not due yet")]
fn a_match_day_cannot_be_played_early() {
    let mut l = league_with(2, 0);
    at("anyone.testnet", due(&l) - 1, 1);
    l.play_match_day();
}

#[test]
fn anyone_plays_a_due_match_day_and_the_next_one_opens() {
    let mut l = league_with(4, 0);
    let first_due = due(&l);
    at("anyone.testnet", first_due, 1);
    let results = l.play_match_day();
    assert_eq!(results.len(), 2);
    assert_eq!(l.match_day(), 2);
    assert_eq!(l.results(1), results);
    assert_eq!(due(&l), first_due + 10 * MINUTE_MS * 1_000_000);
}

#[test]
fn table_points_and_goals_add_up() {
    let mut l = league_with(6, 0);
    for d in 0..5u64 {
        at("anyone.testnet", due(&l), d as u8 + 1);
        l.play_match_day();
    }
    let table = l.table();
    assert_eq!(table.len(), 6);
    let gf: u32 = table.iter().map(|c| c.goals_for).sum();
    let ga: u32 = table.iter().map(|c| c.goals_against).sum();
    assert_eq!(gf, ga);
    let played: u32 = table.iter().map(|c| c.played).sum();
    assert_eq!(played, 6 * 5);
    let draws: u32 = table.iter().map(|c| c.drawn).sum();
    let points: u32 = table.iter().map(|c| c.points).sum();
    // 15 matches: 3 points for a decisive one, 2 for a draw.
    assert_eq!(points, (15 - draws / 2) * 3 + draws / 2 * 2);
    assert!(table.windows(2).all(|w| w[0].points >= w[1].points));
}

#[test]
fn goals_credit_the_manager_and_queue_the_club_share() {
    let mut l = league_with(2, 0);
    at("anyone.testnet", due(&l), 3);
    let results = l.play_match_day();
    let r = the_rules();
    let m = &results[0];
    for (club, home) in [(&m.home, true), (&m.away, false)] {
        let expected: u128 = m
            .goals
            .iter()
            .filter(|g| g.for_home == home)
            .map(|g| match g.kind {
                GoalKind::Normal => r.goal_scorer_share.0,
                GoalKind::Late => 2 * r.goal_scorer_share.0,
                GoalKind::Own => 0,
            })
            .sum();
        assert_eq!(l.credits_of(club.clone()).0, expected);
    }
}

#[test]
fn treasury_split_follows_nominal_shares_and_loses_nothing() {
    let mut l = league_with(3, 0);
    let nominal = vec![
        (acc("c0.testnet"), U128(300)),
        (acc("c1.testnet"), U128(100)),
        (acc("c2.testnet"), U128(100)),
    ];
    // The cap curve minted only 50 of 500 nominal.
    credit_treasuries(&mut l.clubs, &nominal, 51);
    let t = |c: &str| l.get_club(acc(c)).unwrap().treasury.0;
    assert_eq!((t("c0.testnet"), t("c1.testnet")), (30, 10));
    assert_eq!(t("c0.testnet") + t("c1.testnet") + t("c2.testnet"), 51);
}

#[test]
fn an_incomplete_tifo_burns_two_percent_and_resets_the_streak() {
    let mut l = league_with(2, 5);
    l.clubs.get_mut(&acc("c0.testnet")).unwrap().treasury = U128(1_000 * ONE_G);
    l.clubs
        .get_mut(&acc("c0.testnet"))
        .unwrap()
        .full_house_streak = 7;
    for f in 0..2 {
        as_caller(&format!("f0-{f}.testnet"));
        l.check_in();
    }
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    let s = l.stand_result(acc("c0.testnet"), 1).unwrap();
    assert!(!s.full_house);
    assert_eq!(s.burned, U128(20 * ONE_G));
    let c = l.get_club(acc("c0.testnet")).unwrap();
    assert_eq!(c.full_house_streak, 0);
    assert_eq!(c.best_streak, 0);
}

#[test]
fn a_full_house_pays_every_fan_present_once() {
    let mut l = league_with(2, 5);
    for f in 0..3 {
        as_caller(&format!("f0-{f}.testnet"));
        l.check_in();
    }
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    assert!(l.stand_result(acc("c0.testnet"), 1).unwrap().full_house);
    assert_eq!(l.get_club(acc("c0.testnet")).unwrap().full_house_streak, 1);
    at("f0-0.testnet", due(&l), 1);
    let paid = l.claim_stand(acc("c0.testnet"), 1);
    assert_eq!(paid, the_rules().full_house_mint_per_fan);
    assert_eq!(l.credits_of(acc("f0-0.testnet")), paid);
}

#[test]
#[should_panic(expected = "already claimed")]
fn a_stand_reward_is_claimed_once() {
    let mut l = league_with(2, 1);
    as_caller("f0-0.testnet");
    l.check_in();
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    at("f0-0.testnet", due(&l), 1);
    l.claim_stand(acc("c0.testnet"), 1);
    l.claim_stand(acc("c0.testnet"), 1);
}

#[test]
#[should_panic(expected = "you were not in that stand")]
fn only_fans_who_came_can_claim() {
    let mut l = league_with(2, 2);
    as_caller("f0-0.testnet");
    l.check_in();
    as_caller("f0-1.testnet");
    l.check_in();
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    at("stranger.testnet", due(&l), 1);
    l.claim_stand(acc("c0.testnet"), 1);
}

#[test]
fn a_derby_doubles_the_stand_burn() {
    let mut l = league_with(2, 5);
    for c in ["c0", "c1"] {
        l.clubs
            .get_mut(&acc(&format!("{c}.testnet")))
            .unwrap()
            .treasury = U128(1_000 * ONE_G);
    }
    as_caller("c0.testnet");
    l.set_rival(Some(acc("c1.testnet")));
    as_caller("c1.testnet");
    l.set_rival(Some(acc("c0.testnet")));
    at("anyone.testnet", due(&l), 1);
    let results = l.play_match_day();
    assert!(results[0].derby);
    let s = l.stand_result(acc("c1.testnet"), 1).unwrap();
    assert_eq!((s.multiplier, s.burned), (2, U128(40 * ONE_G)));
}

#[test]
fn a_one_sided_rivalry_is_not_a_derby() {
    let mut l = league_with(2, 0);
    as_caller("c0.testnet");
    l.set_rival(Some(acc("c1.testnet")));
    at("anyone.testnet", due(&l), 1);
    assert!(!l.play_match_day()[0].derby);
}

#[test]
fn own_goals_burn_from_the_club_at_fault() {
    // Find a seed whose first match has an own goal, then play it.
    let seed = (1..=255u8)
        .find(|&s| {
            play_match(play::match_seed([s; 32], 1, 0))
                .iter()
                .any(|g| g.kind == GoalKind::Own)
        })
        .expect("a seed with an own goal");
    {
        let mut l = league_with(2, 0);
        for c in ["c0", "c1"] {
            l.clubs
                .get_mut(&acc(&format!("{c}.testnet")))
                .unwrap()
                .treasury = U128(100_000_000 * ONE_G);
        }
        at("anyone.testnet", due(&l), seed);
        let m = l.play_match_day().remove(0);
        let own_against = |home_at_fault: bool| {
            m.goals
                .iter()
                .filter(|g| g.kind == GoalKind::Own && g.for_home != home_at_fault)
                .count() as u128
        };
        let (h, a) = (own_against(true), own_against(false));
        assert!(h + a > 0);
        let burn = the_rules().own_goal_burn.0;
        let t = |id: &AccountId| l.get_club(id.clone()).unwrap().treasury.0;
        assert_eq!(t(&m.home), 100_000_000 * ONE_G - h * burn);
        assert_eq!(t(&m.away), 100_000_000 * ONE_G - a * burn);
    }
}

#[test]
#[should_panic(expected = "the league is full")]
fn the_league_is_bounded() {
    let mut l = league();
    for c in 0..=MAX_CLUBS {
        as_caller(&format!("c{c}.testnet"));
        l.create_club(format!("Club {c}"));
    }
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn claiming_nothing_fails() {
    let mut l = league();
    as_caller("nobody.testnet");
    l.claim();
}

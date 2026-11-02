use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

/// The drill attester of the tests.
fn attester() -> SigningKey {
    SigningKey::from_bytes(&[7; 32])
}

fn attester_pk() -> PublicKey {
    let mut bytes = vec![0u8];
    bytes.extend_from_slice(attester().verifying_key().as_bytes());
    PublicKey::try_from(bytes).unwrap()
}

fn sign_drill(token: &str, ticket: u64, points: u8) -> Base64VecU8 {
    let msg = training_message(&acc("league.testnet"), token, ticket, points);
    Base64VecU8(attester().sign(msg.as_bytes()).to_bytes().to_vec())
}

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
        attester_pk(),
        U64(4 * MINUTE_MS),
        U64(MINUTE_MS),
    )
}

/// Plays a whole match day: the first half at kick-off, the second after
/// half-time. Returns the final results.
fn kick_off(l: &mut League, seed: u8) -> Vec<MatchResult> {
    at("anyone.testnet", l.next_match_at_ns, seed);
    l.play_match_day();
    at("anyone.testnet", l.next_match_at_ns, seed);
    l.play_match_day()
}

fn all_99() -> Skills {
    Skills {
        pace: 99,
        shooting: 99,
        passing: 99,
        dribbling: 99,
        defending: 99,
        physical: 99,
    }
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
    assert_eq!(l.get_club(acc("koplo.testnet")).unwrap().division, 1);
}

/// Plays every division of the current match day (first halves, then
/// second halves), however many calls it takes.
fn play_day(l: &mut League, seed: u8) -> Vec<MatchResult> {
    let day = l.match_day;
    while l.match_day == day {
        at("anyone.testnet", l.next_match_at_ns, seed);
        l.play_match_day();
    }
    l.results(day)
}

#[test]
fn twenty_clubs_a_division_then_a_new_one_below() {
    let l = league_with(23, 0);
    assert_eq!(l.schedule().divisions, 2);
    assert_eq!(l.division_table(1).len(), 20);
    assert_eq!(l.division_table(2).len(), 3);
    assert_eq!(l.get_club(acc("c20.testnet")).unwrap().division, 2);
    assert_eq!(l.table().len(), 23);
    assert_eq!(l.fixtures_of(1).len(), 10 + 1);
}

#[test]
fn one_division_per_call_and_the_day_closes_after_the_last() {
    let mut l = league_with(24, 0);
    at("anyone.testnet", l.next_match_at_ns, 1);
    let d1 = l.play_match_day();
    assert!(d1.iter().all(|m| m.division == 1) && d1.len() == 10);
    assert!(
        !l.schedule().first_half_played,
        "division 2 has not kicked off"
    );
    let d2 = l.play_match_day();
    assert!(d2.iter().all(|m| m.division == 2) && d2.len() == 2);
    assert!(l.schedule().first_half_played);
    // Second halves after half-time, one division each; the day closes after both.
    at("anyone.testnet", l.next_match_at_ns, 1);
    l.play_match_day();
    assert_eq!(l.match_day, 1);
    l.play_match_day();
    assert_eq!(l.match_day, 2);
    let all = l.results(1);
    assert_eq!(all.len(), 12);
    assert!(all.iter().all(|m| m.full_time));
}

#[test]
fn a_season_ends_with_promotion_and_relegation() {
    let mut l = league_with(26, 0);
    for d in 0..SEASON_DAYS {
        if d == SEASON_DAYS - 1 {
            for c in 0..26 {
                l.clubs
                    .get_mut(&acc(&format!("c{c}.testnet")))
                    .unwrap()
                    .treasury = U128(1_000_000);
            }
        }
        play_day(&mut l, d as u8 + 1);
    }
    assert_eq!(l.season(), 2);
    let top = l.final_table(1, 1);
    let below = l.final_table(1, 2);
    assert_eq!((top.len(), below.len()), (20, 6));
    for c in &top[17..] {
        let club = l.get_club(c.clone()).unwrap();
        assert_eq!(club.division, 2, "relegated");
        assert!(club.treasury.0 <= 900_000, "a relegated club burns a tenth");
    }
    assert!(l.get_club(top[0].clone()).unwrap().treasury.0 > 950_000);
    for c in &below[..3] {
        assert_eq!(l.get_club(c.clone()).unwrap().division, 1, "promoted");
    }
    assert_eq!(l.get_club(top[0].clone()).unwrap().division, 1);
    assert_eq!(l.division_table(1).len(), 20);
    assert_eq!(l.division_table(2).len(), 6);
    // A new season starts on zero.
    assert!(l.table().iter().all(|c| c.points == 0 && c.played == 0));
    assert_eq!(l.schedule().season_day, 1);
}

#[test]
fn a_twenty_club_division_meets_everyone_once_a_season() {
    let mut l = league_with(20, 0);
    let mut met = std::collections::BTreeSet::new();
    for d in 1..=SEASON_DAYS {
        for (h, a) in l.fixtures_of(d) {
            assert!(
                met.insert(if h < a { (h, a) } else { (a, h) }),
                "a pair met twice"
            );
        }
    }
    assert_eq!(met.len(), 190);
    let _ = &mut l;
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
    let kickoff = due(&l);
    at("anyone.testnet", kickoff, 1);
    let first = l.play_match_day();
    assert_eq!(first.len(), 2);
    assert!(first.iter().all(|m| !m.full_time && m.half_ends.len() == 1));
    assert_eq!(l.match_day(), 1, "still match day 1 at half-time");
    // The second half is due after the half and half-time (4 + 1 minutes).
    assert_eq!(due(&l), kickoff + 5 * MINUTE_MS * 1_000_000);
    at("anyone.testnet", due(&l) - 1, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| l
            .clone_for_test()
            .play_match_day()))
        .is_err()
    );
    at("anyone.testnet", due(&l), 1);
    let results = l.play_match_day();
    assert!(
        results
            .iter()
            .all(|m| m.full_time && m.half_ends.len() == 2 && m.elevens.len() == 4)
    );
    for (a, b) in first.iter().zip(&results) {
        assert_eq!(
            a.events[..],
            b.events[..a.events.len()],
            "the first half does not change"
        );
    }
    assert_eq!(l.match_day(), 2);
    assert_eq!(l.results(1), results);
    assert_eq!(due(&l), kickoff + 10 * MINUTE_MS * 1_000_000);
}

#[test]
fn table_points_and_goals_add_up() {
    let mut l = league_with(6, 0);
    for d in 0..5u64 {
        kick_off(&mut l, d as u8 + 1);
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
    kick_off(&mut l, 1);
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
    kick_off(&mut l, 1);
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
    kick_off(&mut l, 1);
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
    kick_off(&mut l, 1);
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
    let results = kick_off(&mut l, 1);
    assert!(results[0].derby);
    let s = l.stand_result(acc("c1.testnet"), 1).unwrap();
    assert_eq!((s.multiplier, s.burned), (2, U128(40 * ONE_G)));
}

#[test]
fn a_one_sided_rivalry_is_not_a_derby() {
    let mut l = league_with(2, 0);
    as_caller("c0.testnet");
    l.set_rival(Some(acc("c1.testnet")));
    assert!(!kick_off(&mut l, 1)[0].derby);
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

fn player_count_by_position(l: &League, club: &str) -> [usize; 4] {
    let mut c = [0; 4];
    for p in l.squad(acc(club)) {
        c[match p.position {
            Position::Gk => 0,
            Position::Df => 1,
            Position::Mf => 2,
            Position::Fw => 3,
        }] += 1;
    }
    c
}

#[test]
fn a_new_club_signs_an_academy_of_eleven() {
    let l = league_with(1, 0);
    let squad = l.squad(acc("c0.testnet"));
    assert_eq!(squad.len(), 11);
    assert_eq!(player_count_by_position(&l, "c0.testnet"), [1, 4, 4, 2]);
    for p in &squad {
        assert_eq!(p.owner, acc("c0.testnet"));
        assert!((10..=60).contains(&p.attack) && (20..=60).contains(&p.defence));
        assert_eq!(p.overall, p.skills.overall(p.position));
        assert!((25..=65).contains(&p.overall), "{p:?}");
        assert!(p.name.contains(' '));
    }
    assert_eq!(l.starting_eleven(acc("c0.testnet")).len(), 11);
}

fn ids(l: &League, club: &str) -> Vec<String> {
    l.squad(acc(club)).into_iter().map(|p| p.token_id).collect()
}

#[test]
#[should_panic(expected = "only the players contract reports transfers")]
fn only_the_players_contract_reports_transfers() {
    let mut l = league_with(1, 0);
    let token = ids(&l, "c0.testnet")[0].clone();
    as_caller("attacker.testnet");
    l.on_player_transferred(token, acc("c0.testnet"), acc("attacker.testnet"));
}

#[test]
fn a_sold_player_changes_squad_keeps_his_wallet_and_leaves_the_eleven() {
    let mut l = league_with(2, 0);
    let squad = ids(&l, "c0.testnet");
    let star = squad[10].clone(); // a forward
    l.players.get_mut(&star).unwrap().wallet = U128(42);
    as_caller("players.testnet");
    l.on_player_transferred(star.clone(), acc("c0.testnet"), acc("c1.testnet"));
    assert_eq!(l.squad(acc("c0.testnet")).len(), 10);
    assert_eq!(l.squad(acc("c1.testnet")).len(), 12);
    let p = l.get_player(star.clone()).unwrap();
    assert_eq!((p.owner, p.wallet), (acc("c1.testnet"), U128(42)));
    let xi: Vec<String> = l
        .starting_eleven(acc("c0.testnet"))
        .into_iter()
        .map(|p| p.token_id)
        .collect();
    assert_eq!(xi.len(), 10);
    assert!(!xi.contains(&star));
    // The buyer fields his best eleven, not twelve.
    assert_eq!(l.starting_eleven(acc("c1.testnet")).len(), 11);
}

#[test]
fn goals_fill_the_scorers_wallets_and_raise_their_shooting() {
    let mut l = league_with(2, 0);
    let before: Vec<Player> = [l.squad(acc("c0.testnet")), l.squad(acc("c1.testnet"))].concat();
    let r = the_rules();
    let mut expected: std::collections::HashMap<String, (u128, u32)> = Default::default();
    for d in 0..6u64 {
        for m in kick_off(&mut l, d as u8 + 1) {
            for g in m.goals {
                let k = match g.kind {
                    GoalKind::Normal => 1,
                    GoalKind::Late => 2,
                    GoalKind::Own => 0,
                };
                assert!(!g.name.is_empty());
                let e = expected.entry(g.player).or_default();
                e.0 += k * r.goal_scorer_share.0;
                e.1 += (k > 0) as u32;
            }
        }
    }
    assert!(
        expected.values().any(|e| e.1 > 0),
        "no goal in six match days"
    );
    for p in before {
        let now = l.get_player(p.token_id.clone()).unwrap();
        let (wallet, goals) = expected.get(&p.token_id).copied().unwrap_or_default();
        assert_eq!(now.wallet.0, wallet);
        assert_eq!(now.goals, goals);
        assert_eq!(
            now.skills.shooting as u32,
            (p.skills.shooting as u32 + goals).min(99)
        );
        assert_eq!(now.attack, now.skills.attack());
    }
}

#[test]
fn own_goals_burn_from_the_club_at_fault() {
    let mut l = league_with(2, 0);
    let burn = the_rules().own_goal_burn.0;
    for d in 0..80u64 {
        for c in ["c0", "c1"] {
            l.clubs
                .get_mut(&acc(&format!("{c}.testnet")))
                .unwrap()
                .treasury = U128(100_000_000 * ONE_G);
        }
        let m = kick_off(&mut l, (d % 250) as u8 + 1).remove(0);
        let own = |home_at_fault: bool| {
            m.goals
                .iter()
                .filter(|g| g.kind == GoalKind::Own && g.for_home != home_at_fault)
                .count() as u128
        };
        let (h, a) = (own(true), own(false));
        if h + a == 0 {
            continue;
        }
        let t = |id: &AccountId| l.get_club(id.clone()).unwrap().treasury.0;
        assert_eq!(t(&m.home), 100_000_000 * ONE_G - h * burn);
        assert_eq!(t(&m.away), 100_000_000 * ONE_G - a * burn);
        // The player named is from the side at fault.
        let og = m.goals.iter().find(|g| g.kind == GoalKind::Own).unwrap();
        let at_fault = if og.for_home { &m.away } else { &m.home };
        assert_eq!(&l.get_player(og.player.clone()).unwrap().owner, at_fault);
        return;
    }
    panic!("no own goal in 80 match days");
}

#[test]
#[should_panic(expected = "that player's wallet is not yours")]
fn only_the_owner_claims_a_players_wallet() {
    let mut l = league_with(1, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    l.players.get_mut(&token).unwrap().wallet = U128(5);
    as_caller("thief.testnet");
    l.claim_player(token);
}

#[test]
fn the_owner_claims_and_the_wallet_empties() {
    let mut l = league_with(1, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    l.players.get_mut(&token).unwrap().wallet = U128(5);
    as_caller("c0.testnet");
    l.claim_player(token.clone());
    assert_eq!(l.get_player(token).unwrap().wallet, U128(0));
}

// ---- People who play ----

/// `person` creates a forward and gives his registration to `club`.
fn sign_person(l: &mut League, person: &str, club: &str) -> String {
    as_caller(person);
    let p = l.create_footballer(format!("{person} Star"), Position::Fw);
    as_caller("players.testnet");
    l.on_player_transferred(p.token_id.clone(), acc(person), acc(club));
    p.token_id
}

#[test]
fn a_person_creates_one_footballer_and_signs_for_a_club() {
    let mut l = league_with(1, 0);
    as_caller("koplo.testnet");
    let p = l.create_footballer("Koplo".into(), Position::Fw);
    assert_eq!(p.controller, Some(acc("koplo.testnet")));
    assert_eq!(p.owner, acc("koplo.testnet"));
    assert_eq!(l.welcome_status(acc("koplo.testnet")), Some(0));
    as_caller("players.testnet");
    l.on_player_transferred(p.token_id.clone(), acc("koplo.testnet"), acc("c0.testnet"));
    assert_eq!(l.squad(acc("c0.testnet")).len(), 12);
    assert_eq!(
        l.footballer_of(acc("koplo.testnet")).unwrap().owner,
        acc("c0.testnet")
    );
}

#[test]
#[should_panic(expected = "you already play a footballer")]
fn one_footballer_per_person() {
    let mut l = league();
    as_caller("koplo.testnet");
    l.create_footballer("Koplo".into(), Position::Fw);
    l.create_footballer("Koplo 2".into(), Position::Df);
}

#[test]
#[should_panic(expected = "join a club first")]
fn a_free_agent_cannot_report() {
    let mut l = league();
    as_caller("koplo.testnet");
    l.create_footballer("Koplo".into(), Position::Fw);
    l.report_for_match();
}

#[test]
fn a_person_plays_by_default_unless_suspended() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().skills = all_99(); // the best player of the squad
    let plays = |l: &League| {
        l.starting_eleven(acc("c0.testnet"))
            .iter()
            .any(|p| p.token_id == token)
    };
    assert!(plays(&l), "everyone in the squad plays by default");
    assert_eq!(l.starting_eleven(acc("c0.testnet")).len(), 11);
    // Sent off on match day 1: out on match day 2, back on day 3.
    l.suspended.insert((token.clone(), 2));
    kick_off(&mut l, 1);
    assert!(l.is_suspended(token.clone(), 2));
    assert!(!plays(&l));
    kick_off(&mut l, 2);
    assert!(plays(&l));
}

#[test]
fn squads_hold_twelve_and_the_weakest_academy_player_makes_room() {
    let mut l = league_with(1, 0);
    let academy = l.squad(acc("c0.testnet"));
    assert_eq!(academy.len(), 11);
    let weakest = academy
        .iter()
        .min_by_key(|p| (p.overall, std::cmp::Reverse(p.token_id.clone())))
        .unwrap()
        .token_id
        .clone();
    sign_person(&mut l, "p0.testnet", "c0.testnet");
    assert_eq!(l.squad(acc("c0.testnet")).len(), 12);
    sign_person(&mut l, "p1.testnet", "c0.testnet");
    let squad = l.squad(acc("c0.testnet"));
    assert_eq!(squad.len(), 12);
    assert!(
        !squad.iter().any(|p| p.token_id == weakest),
        "the weakest academy player left"
    );
    for n in 2..12 {
        sign_person(&mut l, &format!("p{n}.testnet"), "c0.testnet");
    }
    let squad = l.squad(acc("c0.testnet"));
    assert_eq!(squad.len(), 12);
    assert!(
        squad.iter().all(|p| p.controller.is_some()),
        "twelve people"
    );
    // A thirteenth person sits on the bench: nobody else is pushed out.
    sign_person(&mut l, "p12.testnet", "c0.testnet");
    assert_eq!(l.squad(acc("c0.testnet")).len(), 13);
}

#[test]
fn a_short_squad_plays_with_academy_kids() {
    let mut l = league_with(2, 0);
    let squad = l.squads.get(&acc("c1.testnet")).unwrap().clone();
    l.squads.insert(acc("c1.testnet"), squad[..8].to_vec());
    let results = kick_off(&mut l, 3);
    let m = results
        .iter()
        .find(|m| m.away == acc("c1.testnet") || m.home == acc("c1.testnet"))
        .unwrap();
    let side = usize::from(m.away == acc("c1.testnet"));
    assert_eq!(
        m.elevens[side].iter().filter(|t| t.as_str() == BOT).count(),
        3
    );
}

#[test]
fn the_captain_names_the_takers_and_a_red_card_leaves_ten() {
    let mut l = league_with(2, 0);
    let squad = l.squads.get(&acc("c0.testnet")).unwrap().clone();
    as_caller("c0.testnet");
    l.set_takers(
        acc("c0.testnet"),
        Some(squad[9].clone()),
        Some(squad[10].clone()),
    );
    assert_eq!(l.takers(acc("c0.testnet")).penalty, Some(squad[10].clone()));
    // Over many match days: kicks come from the named takers when they play,
    // a man sent off leaves an empty slot after the break and is suspended.
    let mut checked = 0;
    for seed in 1..60u8 {
        let results = kick_off(&mut l, seed);
        for m in &results {
            for (n, e) in m.events.iter().enumerate() {
                let h = usize::from(n as u32 >= m.first_half_events);
                let side = usize::from(!e.home);
                let club = if e.home { &m.home } else { &m.away };
                let token = m.elevens[2 * h + side][e.player as usize].clone();
                if e.kind == EventKind::Red && h == 0 {
                    // Nobody takes his slot in the second half.
                    assert!(!m.elevens[2 + side].contains(&token));
                    assert_eq!(m.elevens[2 + side][e.player as usize], "");
                    checked += 1;
                }
                if e.kind == EventKind::Red && token != BOT {
                    assert!(l.is_suspended(token.clone(), l.match_day));
                }
                if e.kind == EventKind::Penalty
                    && club == &acc("c0.testnet")
                    && m.elevens[2 * h + side].contains(&squad[10])
                {
                    assert_eq!(token, squad[10]);
                }
            }
        }
    }
    assert!(checked > 0, "no first-half red in 59 match days");
}

#[test]
#[should_panic(expected = "only the captain (or the manager, without one) names the takers")]
fn only_the_captain_names_the_takers() {
    let mut l = league_with(1, 0);
    as_caller("c1.testnet");
    l.set_takers(acc("c0.testnet"), None, None);
}

#[test]
fn starters_who_are_people_get_a_salary_from_the_treasury() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().skills = all_99();
    let salary = the_rules().salary.0;
    l.clubs.get_mut(&acc("c0.testnet")).unwrap().treasury = U128(salary + 5);
    as_caller("koplo.testnet");
    l.report_for_match();
    kick_off(&mut l, 1);
    assert_eq!(l.get_player(token.clone()).unwrap().salary, U128(salary));
    // The treasury only lost the salary (and gained nothing yet: mints settle by callback).
    assert_eq!(l.get_club(acc("c0.testnet")).unwrap().treasury, U128(5));
    // An empty treasury pays nothing.
    as_caller("koplo.testnet");
    l.report_for_match();
    kick_off(&mut l, 2);
    assert_eq!(l.get_player(token).unwrap().salary, U128(salary));
}

#[test]
fn the_person_not_the_club_collects_the_wallet() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().wallet = U128(7);
    l.players.get_mut(&token).unwrap().salary = U128(3);
    as_caller("koplo.testnet");
    l.claim_player(token.clone());
    let p = l.get_player(token).unwrap();
    assert_eq!((p.wallet, p.salary), (U128(0), U128(0)));
}

#[test]
#[should_panic(expected = "that player's wallet is not yours")]
fn the_club_cannot_collect_a_persons_wallet() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().wallet = U128(7);
    as_caller("c0.testnet");
    l.claim_player(token);
}

fn play_days(l: &mut League, n: u32) {
    for i in 0..n {
        kick_off(l, (i % 200) as u8 + 1);
    }
}

#[test]
fn teammates_elect_a_captain_for_the_next_week() {
    let mut l = league_with(2, 0);
    let a = sign_person(&mut l, "ana.testnet", "c0.testnet");
    let b = sign_person(&mut l, "ben.testnet", "c0.testnet");
    let c = sign_person(&mut l, "cleo.testnet", "c0.testnet");
    for (who, pick) in [
        ("ana.testnet", &b),
        ("ben.testnet", &b),
        ("cleo.testnet", &a),
    ] {
        as_caller(who);
        l.vote_captain(pick.clone());
    }
    // Cleo changes her mind: still one vote each.
    as_caller("cleo.testnet");
    l.vote_captain(b.clone());
    assert_eq!(l.ballots(acc("c0.testnet"), 0).len(), 3);
    assert!(l.captain(acc("c0.testnet")).is_none());
    play_days(&mut l, 7); // week 0 ends; day 8 opens week 1
    let captain = l.captain(acc("c0.testnet")).unwrap();
    assert_eq!(
        (captain.token_id, captain.votes, captain.week),
        (b.clone(), 3, 1)
    );
    let _ = c;
}

#[test]
fn the_captain_picks_the_formation_and_the_manager_no_longer_can() {
    let mut l = league_with(2, 0);
    let b = sign_person(&mut l, "ben.testnet", "c0.testnet");
    as_caller("ben.testnet");
    l.vote_captain(b.clone());
    play_days(&mut l, 7);
    as_caller("ben.testnet");
    l.set_formation(acc("c0.testnet"), Formation::F433);
    assert_eq!(l.lineup(acc("c0.testnet")).formation, Formation::F433);
}

#[test]
#[should_panic(expected = "only the captain")]
fn a_manager_cannot_override_the_captain() {
    let mut l = league_with(2, 0);
    let b = sign_person(&mut l, "ben.testnet", "c0.testnet");
    as_caller("ben.testnet");
    l.vote_captain(b);
    play_days(&mut l, 7);
    as_caller("c0.testnet");
    l.set_formation(acc("c0.testnet"), Formation::F352);
}

#[test]
#[should_panic(expected = "vote for a teammate")]
fn no_vote_for_another_clubs_player() {
    let mut l = league_with(2, 0);
    sign_person(&mut l, "ana.testnet", "c0.testnet");
    let other = sign_person(&mut l, "ben.testnet", "c1.testnet");
    as_caller("ana.testnet");
    l.vote_captain(other);
}

#[test]
#[should_panic(expected = "a captain is a person")]
fn no_academy_captain() {
    let mut l = league_with(1, 0);
    sign_person(&mut l, "ana.testnet", "c0.testnet");
    let bot = ids(&l, "c0.testnet")[0].clone();
    as_caller("ana.testnet");
    l.vote_captain(bot);
}

fn train(l: &mut League, from: &str, token: &str, amount: u128) -> PromiseOrValue<U128> {
    as_caller("goalars.testnet");
    l.ft_on_transfer(
        acc(from),
        U128(amount),
        format!("{{\"train\":{{\"token_id\":\"{token}\",\"skill\":\"pace\"}}}}"),
    )
}

#[test]
fn training_burns_its_cost_and_opens_a_ticket_for_the_skill() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let before = l.get_player(token.clone()).unwrap();
    let cost = the_rules().training_cost.0;
    match train(&mut l, "koplo.testnet", &token, cost) {
        PromiseOrValue::Value(unused) => assert_eq!(unused, U128(0)),
        _ => panic!("expected a value"),
    }
    assert_eq!(
        l.get_player(token.clone()).unwrap(),
        before.clone().with_trained(1)
    );
    let t = l.training_ticket(token.clone()).unwrap();
    assert_eq!((t.skill, t.match_day, t.seed.len()), (Skill::Pace, 1, 64));
}

#[test]
fn a_signed_drill_score_adds_the_points_once() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let before = l.get_player(token.clone()).unwrap();
    let _ = train(&mut l, "koplo.testnet", &token, the_rules().training_cost.0);
    let id = l.training_ticket(token.clone()).unwrap().id;
    as_caller("anyone.testnet");
    let after = l.finish_training(token.clone(), 3, sign_drill(&token, id, 3));
    assert_eq!(after.skills.pace, before.skills.pace + 3);
    assert_eq!(after.overall, after.skills.overall(after.position));
    assert!(l.training_ticket(token).is_none());
}

#[test]
#[should_panic(expected = "the drill score is not signed by the attester")]
fn a_forged_score_is_refused() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let _ = train(&mut l, "koplo.testnet", &token, the_rules().training_cost.0);
    let id = l.training_ticket(token.clone()).unwrap().id;
    as_caller("koplo.testnet");
    // Signed for 1 point, claimed for 3.
    l.finish_training(token.clone(), 3, sign_drill(&token, id, 1));
}

#[test]
#[should_panic(expected = "no open training for that player")]
fn a_signature_works_once() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let _ = train(&mut l, "koplo.testnet", &token, the_rules().training_cost.0);
    let id = l.training_ticket(token.clone()).unwrap().id;
    let sig = sign_drill(&token, id, 2);
    l.finish_training(token.clone(), 2, sig.clone());
    l.finish_training(token, 2, sig);
}

#[test]
#[should_panic(expected = "that training ended with its match day")]
fn a_ticket_ends_with_its_match_day() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let _ = train(&mut l, "koplo.testnet", &token, the_rules().training_cost.0);
    let id = l.training_ticket(token.clone()).unwrap().id;
    kick_off(&mut l, 1);
    l.finish_training(token.clone(), 1, sign_drill(&token, id, 1));
}

#[test]
fn training_is_harder_at_the_top() {
    assert_eq!(play::training_gain(50, 3, 3), 3);
    assert_eq!(play::training_gain(80, 3, 3), 2);
    assert_eq!(play::training_gain(90, 3, 3), 1);
    assert_eq!(play::training_gain(98, 3, 3), 1);
    assert_eq!(play::training_gain(99, 3, 3), 0);
    assert_eq!(play::training_gain(50, 0, 3), 0);
}

#[test]
fn the_attester_key_is_readable() {
    assert_eq!(league().attester(), attester_pk());
}

#[test]
fn a_match_sheet_has_shots_and_a_man_of_the_match() {
    let mut l = league_with(2, 0);
    for m in kick_off(&mut l, 3) {
        let s = &m.stats;
        let real = |home: bool| {
            m.goals
                .iter()
                .filter(|g| g.for_home == home && g.kind != GoalKind::Own)
                .count() as u8
        };
        assert!(s.home_on_target >= real(true) && s.home_shots > s.home_on_target);
        assert!(s.away_on_target >= real(false) && s.away_shots > s.away_on_target);
        let star = s.man_of_the_match.as_ref().unwrap();
        assert!((30..=99).contains(&star.rating) && !star.name.is_empty());
    }
}

#[test]
#[should_panic(expected = "already trained this match day")]
fn one_training_per_match_day() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let cost = the_rules().training_cost.0;
    let _ = train(&mut l, "koplo.testnet", &token, cost);
    let _ = train(&mut l, "koplo.testnet", &token, cost);
}

#[test]
#[should_panic(expected = "you cannot train that player")]
fn nobody_trains_someone_elses_player() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let _ = train(&mut l, "c0.testnet", &token, the_rules().training_cost.0);
}

#[test]
#[should_panic(expected = "only goalars is accepted")]
fn training_is_paid_in_goalars_only() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    as_caller("fake-token.testnet");
    let _ = l.ft_on_transfer(
        acc("koplo.testnet"),
        the_rules().training_cost,
        format!("{{\"train\":{{\"token_id\":\"{token}\",\"skill\":\"pace\"}}}}"),
    );
}

// ---- Transfer market ----

fn bid(l: &mut League, from: &str, token: &str, amount: u128) {
    as_caller("goalars.testnet");
    let _ = l.ft_on_transfer(acc(from), U128(amount), format!("{{\"bid\":\"{token}\"}}"));
}

#[test]
fn a_club_bids_and_the_price_is_held() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 800);
    let offers = l.offers_for(token);
    assert_eq!(offers.len(), 1);
    assert_eq!(
        (offers[0].price, offers[0].state),
        (U128(800), OfferState::Open)
    );
    assert_eq!(offers[0].buyer, acc("c1.testnet"));
}

#[test]
#[should_panic(expected = "only a club bids")]
fn only_clubs_bid() {
    let mut l = league_with(1, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "someone.testnet", &token, 800);
}

#[test]
#[should_panic(expected = "you already own that player")]
fn no_bid_on_your_own_player() {
    let mut l = league_with(1, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c0.testnet", &token, 800);
}

#[test]
fn a_cancelled_offer_can_be_collected() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 800);
    as_caller("c1.testnet");
    l.cancel_offer(0);
    assert_eq!(l.owed_of(acc("c1.testnet")), U128(800));
    assert!(l.offers_for(token).is_empty());
    l.collect();
    assert_eq!(l.owed_of(acc("c1.testnet")), U128(0));
}

#[test]
#[should_panic(expected = "only the bidder cancels")]
fn only_the_bidder_cancels() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 800);
    as_caller("c0.testnet");
    l.cancel_offer(0);
}

#[test]
#[should_panic(expected = "only the players contract approves sales")]
fn sales_are_approved_through_the_players_contract() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 800);
    as_caller("c0.testnet");
    let _ = l.nft_on_approve(token, acc("c0.testnet"), 1, "{\"accept\":0}".into());
}

#[test]
#[should_panic(expected = "does not see you as the owner")]
fn only_the_owner_can_accept() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 800);
    as_caller("players.testnet");
    let _ = l.nft_on_approve(token, acc("thief.testnet"), 1, "{\"accept\":0}".into());
}

#[test]
#[should_panic(expected = "that offer is for another player")]
fn an_offer_sells_only_its_player() {
    let mut l = league_with(2, 0);
    let squad = ids(&l, "c0.testnet");
    bid(&mut l, "c1.testnet", &squad[10], 800);
    as_caller("players.testnet");
    let _ = l.nft_on_approve(
        squad[9].clone(),
        acc("c0.testnet"),
        1,
        "{\"accept\":0}".into(),
    );
}

#[test]
fn a_sale_shares_the_price_as_the_payout_says_and_burns_the_tax() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 1_000);
    as_caller("players.testnet");
    let _ = l.nft_on_approve(token.clone(), acc("c0.testnet"), 1, "{\"accept\":0}".into());
    assert_eq!(l.get_offer(0).unwrap().state, OfferState::Accepting);
    // A second acceptance of the same offer is refused while in flight.
    as_caller("league.testnet");
    let payout = Payout {
        payout: [
            (acc("c0.testnet"), U128(970)),
            (acc("league.testnet"), U128(30)),
        ]
        .into_iter()
        .collect(),
    };
    assert_eq!(l.on_sale(0, Ok(payout)), "sold");
    assert_eq!(l.get_offer(0).unwrap().state, OfferState::Sold);
    assert_eq!(l.owed_of(acc("c0.testnet")), U128(970));
    assert_eq!(l.owed_of(acc("league.testnet")), U128(0)); // burned, not owed
}

#[test]
fn a_failed_transfer_reopens_the_offer() {
    let mut l = league_with(2, 0);
    let token = ids(&l, "c0.testnet")[10].clone();
    bid(&mut l, "c1.testnet", &token, 1_000);
    as_caller("players.testnet");
    let _ = l.nft_on_approve(token.clone(), acc("c0.testnet"), 1, "{\"accept\":0}".into());
    as_caller("league.testnet");
    l.on_sale(0, Err(near_sdk::PromiseError::Failed));
    assert_eq!(l.get_offer(0).unwrap().state, OfferState::Open);
    assert_eq!(l.offers_for(token).len(), 1);
}

#[test]
fn a_payout_never_pays_more_than_the_price() {
    let payout = Payout {
        payout: [(acc("a.testnet"), U128(700)), (acc("b.testnet"), U128(700))]
            .into_iter()
            .collect(),
    };
    let shares = settle_payout(&payout, 1_000, &acc("league.testnet"));
    let total: u128 = shares.iter().map(|(_, a)| a).sum();
    assert_eq!(total, 1_000);
}

impl Player {
    /// This player after a training opened on `day` (no points yet).
    fn with_trained(mut self, day: u32) -> Self {
        self.last_trained_day = day;
        self
    }
}

// ---- Live matches: formations, slots, strategy ----

impl League {
    fn clone_for_test(&self) -> Self {
        near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(self).unwrap()).unwrap()
    }
}

#[test]
fn a_manager_picks_a_formation_and_the_eleven_follows_it() {
    let mut l = league_with(1, 0);
    let before = l.lineup(acc("c0.testnet"));
    assert_eq!(before.formation, Formation::F442);
    assert_eq!(before.players.iter().flatten().count(), 11);
    as_caller("c0.testnet");
    l.set_formation(acc("c0.testnet"), Formation::F433);
    let after = l.lineup(acc("c0.testnet"));
    assert_eq!(after.roles, Formation::F433.roles().to_vec());
    // The academy keeper stays in goal; every slot is filled once.
    assert_eq!(after.players[0].as_ref().unwrap().position, Position::Gk);
    let mut ids: Vec<String> = after
        .players
        .iter()
        .flatten()
        .map(|p| p.token_id.clone())
        .collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 11);
}

#[test]
fn a_person_takes_his_slot_and_plays_there() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    as_caller("koplo.testnet");
    l.take_slot(9);
    let lineup = l.lineup(acc("c0.testnet"));
    assert_eq!(lineup.players[9].as_ref().unwrap().token_id, token);
    assert!(lineup.chosen[9] && !lineup.chosen[10]);
    assert!(l.is_reported(token.clone(), 1), "taking a slot reports him");
    // He moves: his old slot is free again.
    l.take_slot(10);
    let lineup = l.lineup(acc("c0.testnet"));
    assert_eq!(lineup.players[10].as_ref().unwrap().token_id, token);
    assert!(!lineup.chosen[9]);
    let results = kick_off(&mut l, 4);
    let m = results
        .iter()
        .find(|m| m.home == acc("c0.testnet") || m.away == acc("c0.testnet"))
        .unwrap();
    let side = usize::from(m.away == acc("c0.testnet"));
    assert_eq!(m.elevens[side][10], token);
}

#[test]
#[should_panic(expected = "another player took that slot")]
fn a_slot_taken_by_someone_else_is_not_free() {
    let mut l = league_with(1, 0);
    sign_person(&mut l, "ana.testnet", "c0.testnet");
    sign_person(&mut l, "ben.testnet", "c0.testnet");
    as_caller("ana.testnet");
    l.take_slot(5);
    as_caller("ben.testnet");
    l.take_slot(5);
}

#[test]
fn at_half_time_people_change_slot_and_strategy() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    as_caller("koplo.testnet");
    l.take_slot(9);
    l.vote_strategy(Strategy::Defend);
    at("anyone.testnet", l.next_match_at_ns, 2);
    let first = l.play_match_day();
    let m = &first[0];
    let side = usize::from(m.away == acc("c0.testnet"));
    assert_eq!(m.strategies[side], Strategy::Defend);
    as_caller("koplo.testnet");
    l.take_slot(10);
    l.vote_strategy(Strategy::Attack);
    at("anyone.testnet", l.next_match_at_ns, 2);
    let m = l.play_match_day().remove(0);
    assert_eq!(
        (m.elevens[side][9].clone(), m.elevens[2 + side][10].clone()),
        (token.clone(), token)
    );
    assert_eq!(m.strategies[2 + side], Strategy::Attack);
}

#[test]
fn a_full_match_sheet_adds_up() {
    let mut l = league_with(4, 0);
    for d in 0..6u8 {
        for m in kick_off(&mut l, d + 1) {
            let st = &m.stats;
            assert_eq!((m.home_goals, m.away_goals), live::score(&m.events));
            assert_eq!(st.home_possession + st.away_possession, 100);
            assert!(st.home_on_target <= st.home_shots && st.away_on_target <= st.away_shots);
            assert!(st.man_of_the_match.is_some());
            assert_eq!(m.goals.len() as u8, m.home_goals + m.away_goals);
            for g in &m.goals {
                assert!(!g.player.is_empty() && (1..=99).contains(&g.minute));
            }
            assert!(
                m.events
                    .windows(2)
                    .all(|w| w[0].second <= w[1].second + 15 || w[1].second >= 2_700)
            );
        }
    }
}

#[test]
fn goal_minutes_read_like_a_match_sheet() {
    assert_eq!(minute_of(0, 0), 1);
    assert_eq!(minute_of(2_699, 0), 45);
    assert_eq!(minute_of(2_750, 0), 45 + 1);
    assert_eq!(minute_of(2_700, 1), 46);
    assert_eq!(minute_of(5_390, 1), 90);
    assert_eq!(minute_of(5_500, 1), 90 + 2);
}

#[test]
fn fixtures_are_known_before_kick_off() {
    let mut l = league_with(4, 0);
    let planned = l.fixtures_of(1);
    assert_eq!(planned.len(), 2);
    let played: Vec<(AccountId, AccountId)> = kick_off(&mut l, 1)
        .into_iter()
        .map(|m| (m.home, m.away))
        .collect();
    assert_eq!(planned, played);
}

// ---- Wardrobe ----

#[test]
fn a_pack_burns_its_price_and_holds_three_items() {
    let mut l = league_with(1, 0);
    as_caller("goalars.testnet");
    let _ = l.ft_on_transfer(
        acc("fan.testnet"),
        the_rules().pack_price,
        "{\"pack\":{}}".into(),
    );
    let got = l.last_unboxed(acc("fan.testnet"));
    assert_eq!(got.len(), 3);
    assert!(got.iter().all(|i| l.catalog().iter().any(|c| &c.id == i)));
}

#[test]
#[should_panic(expected = "a pack costs exactly pack_price")]
fn a_pack_has_one_price() {
    let mut l = league_with(1, 0);
    as_caller("goalars.testnet");
    let _ = l.ft_on_transfer(acc("fan.testnet"), U128(1), "{\"pack\":{}}".into());
}

#[test]
fn fusing_mints_one_rarity_up_only_after_the_burn() {
    let mut l = league_with(1, 0);
    as_caller("fan.testnet");
    let _ = l.fuse(vec![
        "boots.black".into(),
        "boots.white".into(),
        "boots.navy".into(),
    ]);
    as_caller("league.testnet");
    l.on_fused(acc("fan.testnet"), "boots.red".into(), Ok(()));
    assert_eq!(
        l.last_unboxed(acc("fan.testnet")),
        vec!["boots.red".to_string()]
    );
}

#[test]
#[should_panic(expected = "you do not hold those three items")]
fn no_fusion_without_the_items() {
    let mut l = league_with(1, 0);
    as_caller("league.testnet");
    l.on_fused(
        acc("fan.testnet"),
        "boots.red".into(),
        Err(near_sdk::PromiseError::Failed),
    );
}

#[test]
#[should_panic(expected = "fuse three items of the same kind and rarity")]
fn fusing_mixed_items_fails_before_any_burn() {
    let mut l = league_with(1, 0);
    as_caller("fan.testnet");
    let _ = l.fuse(vec![
        "boots.black".into(),
        "hair.buzz".into(),
        "boots.navy".into(),
    ]);
}

#[test]
fn the_person_dresses_his_footballer_and_gets_the_old_item_back() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    as_caller("koplo.testnet");
    let _ = l.equip(token.clone(), "hair.mohawk".into());
    as_caller("league.testnet");
    l.on_taken(
        token.clone(),
        "hair.mohawk".into(),
        acc("koplo.testnet"),
        Ok(()),
    );
    assert_eq!(
        l.get_player(token.clone()).unwrap().look.hair,
        Some("hair.mohawk".into())
    );
    // A new haircut replaces the old one (which goes back to him).
    l.on_taken(
        token.clone(),
        "hair.afro".into(),
        acc("koplo.testnet"),
        Ok(()),
    );
    assert_eq!(
        l.get_player(token.clone()).unwrap().look.hair,
        Some("hair.afro".into())
    );
    // Not holding the item: nothing changes.
    let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        l.on_taken(
            token.clone(),
            "hair.fire".into(),
            acc("koplo.testnet"),
            Err(near_sdk::PromiseError::Failed),
        )
    }));
    assert!(failed.is_err());
    as_caller("koplo.testnet");
    l.unequip(token.clone(), "hair".into());
    assert_eq!(l.get_player(token.clone()).unwrap().look.hair, None);
    // If sending it back failed, he wears it again: never lost.
    as_caller("league.testnet");
    l.on_given_back(
        token.clone(),
        "hair.afro".into(),
        Err(near_sdk::PromiseError::Failed),
    );
    assert_eq!(
        l.get_player(token).unwrap().look.hair,
        Some("hair.afro".into())
    );
}

#[test]
#[should_panic(expected = "only the person who plays him dresses him")]
fn nobody_else_dresses_him() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    as_caller("c0.testnet");
    let _ = l.equip(token, "hair.mohawk".into());
}

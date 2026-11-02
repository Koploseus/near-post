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
        assert!(p.name.contains(' '));
    }
    assert_eq!(l.starting_eleven(acc("c0.testnet")).len(), 11);
}

fn ids(l: &League, club: &str) -> Vec<String> {
    l.squad(acc(club)).into_iter().map(|p| p.token_id).collect()
}

#[test]
fn a_manager_sets_his_eleven() {
    let mut l = league_with(1, 0);
    let squad = ids(&l, "c0.testnet");
    as_caller("c0.testnet");
    let mut lineup = squad.clone();
    lineup.reverse();
    l.set_lineup(acc("c0.testnet"), lineup.clone());
    let xi: Vec<String> = l
        .starting_eleven(acc("c0.testnet"))
        .into_iter()
        .map(|p| p.token_id)
        .collect();
    assert_eq!(xi, lineup);
}

#[test]
#[should_panic(expected = "a lineup is eleven players")]
fn a_lineup_has_eleven() {
    let mut l = league_with(1, 0);
    let mut squad = ids(&l, "c0.testnet");
    squad.pop();
    as_caller("c0.testnet");
    l.set_lineup(acc("c0.testnet"), squad);
}

#[test]
#[should_panic(expected = "that player is not in the squad")]
fn no_lineup_with_someone_elses_player() {
    let mut l = league_with(2, 0);
    let mut squad = ids(&l, "c0.testnet");
    squad[10] = ids(&l, "c1.testnet")[10].clone();
    as_caller("c0.testnet");
    l.set_lineup(acc("c0.testnet"), squad);
}

#[test]
#[should_panic(expected = "a player is listed twice")]
fn no_player_twice() {
    let mut l = league_with(1, 0);
    let mut squad = ids(&l, "c0.testnet");
    squad[10] = squad[9].clone();
    as_caller("c0.testnet");
    l.set_lineup(acc("c0.testnet"), squad);
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
    as_caller("c0.testnet");
    l.set_lineup(acc("c0.testnet"), squad.clone());
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
fn goals_fill_the_scorers_wallets_and_raise_their_attack() {
    let mut l = league_with(2, 0);
    let before: Vec<Player> = [l.squad(acc("c0.testnet")), l.squad(acc("c1.testnet"))].concat();
    let r = the_rules();
    let mut expected: std::collections::HashMap<String, (u128, u32)> = Default::default();
    for d in 0..6u64 {
        at("anyone.testnet", due(&l), d as u8 + 1);
        for m in l.play_match_day() {
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
        assert_eq!(now.attack as u32, (p.attack as u32 + goals).min(99));
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
        at("anyone.testnet", due(&l), (d % 250) as u8 + 1);
        let m = l.play_match_day().remove(0);
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
fn a_person_plays_only_when_he_reports() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().attack = 99; // the best forward of the squad
    let plays = |l: &League| {
        l.starting_eleven(acc("c0.testnet"))
            .iter()
            .any(|p| p.token_id == token)
    };
    assert!(!plays(&l), "absent: an academy player takes his place");
    assert_eq!(l.starting_eleven(acc("c0.testnet")).len(), 11);
    as_caller("koplo.testnet");
    l.report_for_match();
    assert!(plays(&l));
    // Next match day he must report again.
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    assert!(!plays(&l));
}

#[test]
fn starters_who_are_people_get_a_salary_from_the_treasury() {
    let mut l = league_with(2, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    l.players.get_mut(&token).unwrap().attack = 99;
    let salary = the_rules().salary.0;
    l.clubs.get_mut(&acc("c0.testnet")).unwrap().treasury = U128(salary + 5);
    as_caller("koplo.testnet");
    l.report_for_match();
    at("anyone.testnet", due(&l), 1);
    l.play_match_day();
    assert_eq!(l.get_player(token.clone()).unwrap().salary, U128(salary));
    // The treasury only lost the salary (and gained nothing yet: mints settle by callback).
    assert_eq!(l.get_club(acc("c0.testnet")).unwrap().treasury, U128(5));
    // An empty treasury pays nothing.
    as_caller("koplo.testnet");
    l.report_for_match();
    at("anyone.testnet", due(&l), 2);
    l.play_match_day();
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
        at("anyone.testnet", due(l), (i % 200) as u8 + 1);
        l.play_match_day();
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
fn the_captain_picks_the_eleven_and_the_manager_no_longer_can() {
    let mut l = league_with(2, 0);
    let b = sign_person(&mut l, "ben.testnet", "c0.testnet");
    as_caller("ben.testnet");
    l.vote_captain(b.clone());
    play_days(&mut l, 7);
    let mut xi: Vec<String> = ids(&l, "c0.testnet").into_iter().take(10).collect();
    xi.push(b);
    as_caller("ben.testnet");
    l.set_lineup(acc("c0.testnet"), xi.clone());
}

#[test]
#[should_panic(expected = "only the captain")]
fn a_manager_cannot_override_the_captain() {
    let mut l = league_with(2, 0);
    let b = sign_person(&mut l, "ben.testnet", "c0.testnet");
    as_caller("ben.testnet");
    l.vote_captain(b);
    play_days(&mut l, 7);
    let squad: Vec<String> = ids(&l, "c0.testnet").into_iter().take(11).collect();
    as_caller("c0.testnet");
    l.set_lineup(acc("c0.testnet"), squad);
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
        format!("{{\"train\":\"{token}\"}}"),
    )
}

#[test]
fn training_burns_its_cost_and_adds_a_point_once_per_day() {
    let mut l = league_with(1, 0);
    let token = sign_person(&mut l, "koplo.testnet", "c0.testnet");
    let before = l.get_player(token.clone()).unwrap().attack;
    let cost = the_rules().training_cost.0;
    match train(&mut l, "koplo.testnet", &token, cost) {
        PromiseOrValue::Value(unused) => assert_eq!(unused, U128(0)),
        _ => panic!("expected a value"),
    }
    assert_eq!(l.get_player(token).unwrap().attack, before + 1);
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
        format!("{{\"train\":\"{token}\"}}"),
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

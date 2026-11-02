//! Pure match logic: fixtures, team strength, scores and scorers. No storage,
//! no promises, so it is tested on its own.
//!
//! A match is six chances per side. Each chance becomes a goal with a
//! probability set by the side's attack against the other side's defence, so a
//! stronger eleven scores more often but an upset stays possible. With two
//! average elevens a side scores 1.35 goals on average (1.49 at home).

use near_sdk::{env, near};

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Position {
    Gk,
    Df,
    Mf,
    Fw,
}

/// The 4-4-2 every club starts with, and fills gaps from.
pub const FORMATION: [(Position, usize); 4] = [
    (Position::Gk, 1),
    (Position::Df, 4),
    (Position::Mf, 4),
    (Position::Fw, 2),
];
pub const ELEVEN: usize = 11;
pub const CHANCES: u32 = 6;

/// How much a position counts in attack and in defence.
pub fn attack_weight(p: Position) -> u32 {
    match p {
        Position::Gk => 0,
        Position::Df => 1,
        Position::Mf => 2,
        Position::Fw => 3,
    }
}

pub fn defence_weight(p: Position) -> u32 {
    match p {
        Position::Gk => 3,
        Position::Df => 2,
        Position::Mf => 1,
        Position::Fw => 0,
    }
}

/// A player on the pitch: position, attack, defence (each 1 to 99).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OnPitch {
    pub position: Position,
    pub attack: u8,
    pub defence: u8,
}

/// Team attack and defence, 0 to 99, weighted by position over a full 4-4-2.
/// Missing players count as zero, so a short eleven is weaker.
pub fn strength(xi: &[OnPitch]) -> (u32, u32) {
    let full =
        |w: fn(Position) -> u32| -> u32 { FORMATION.iter().map(|(p, n)| w(*p) * *n as u32).sum() };
    let att: u32 = xi
        .iter()
        .take(ELEVEN)
        .map(|p| p.attack as u32 * attack_weight(p.position))
        .sum();
    let def: u32 = xi
        .iter()
        .take(ELEVEN)
        .map(|p| p.defence as u32 * defence_weight(p.position))
        .sum();
    (att / full(attack_weight), def / full(defence_weight))
}

/// Probability, in basis points, that one chance becomes a goal.
/// Expected goals = 1.35 × attack / defence (× 1.1 at home), spread over six
/// chances, kept between 2% and 60% per chance.
pub fn chance_bps(attack: u32, defence: u32, home: bool) -> u32 {
    let ratio_bps = attack.max(1) as u64 * 10_000 / defence.max(1) as u64;
    let mut expected_bps = 13_500 * ratio_bps / 10_000;
    if home {
        expected_bps = expected_bps * 11 / 10;
    }
    ((expected_bps / CHANCES as u64) as u32).clamp(200, 6_000)
}

/// How a goal counts for the economy.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GoalKind {
    /// Mints the goal amount.
    Normal,
    /// Scored after the 90th minute: mints double.
    Late,
    /// Put in his own net by a player of the other side: mints nothing, burns
    /// from the treasury of the club at fault.
    Own,
}

/// One goal, credited to `for_home` or the away side. `minute` is 1 to 90, or
/// 91 to 95 for 90+1 to 90+5. `player` is the index in the eleven of the side
/// whose player touched it last: the scorer, or for an own goal the
/// unlucky player of the other side.
#[derive(Clone, Debug, PartialEq)]
pub struct Goal {
    pub for_home: bool,
    pub minute: u8,
    pub kind: GoalKind,
    pub player: usize,
}

/// Kind of a goal from one random byte: about 4% own goals, 12% late goals.
pub fn goal_kind(b: u8) -> GoalKind {
    match b {
        0..=9 => GoalKind::Own,
        10..=40 => GoalKind::Late,
        _ => GoalKind::Normal,
    }
}

/// Picks an index in `weights` with probability proportional to its weight.
/// Every weight gets +1 so nobody is impossible. `r` is a random u32.
pub fn weighted_pick(weights: &[u32], r: u32) -> usize {
    let total: u64 = weights.iter().map(|w| *w as u64 + 1).sum();
    let mut target = r as u64 % total;
    for (i, w) in weights.iter().enumerate() {
        let w = *w as u64 + 1;
        if target < w {
            return i;
        }
        target -= w;
    }
    weights.len() - 1
}

/// Plays one match between two elevens from a 32-byte seed. Goals come back
/// in minute order. An empty eleven cannot score and has no one to blame.
pub fn play_match(seed: [u8; 32], home: &[OnPitch], away: &[OnPitch]) -> Vec<Goal> {
    let mut s = ByteStream::new(seed);
    let (home_att, home_def) = strength(home);
    let (away_att, away_def) = strength(away);
    let mut goals = Vec::new();
    for (for_home, attackers, defenders, p) in [
        (true, home, away, chance_bps(home_att, away_def, true)),
        (false, away, home, chance_bps(away_att, home_def, false)),
    ] {
        if attackers.is_empty() {
            continue;
        }
        for chance in 0..CHANCES {
            let roll = s.next_u16() as u64 * 10_000;
            if roll >= p as u64 * 65_536 {
                continue;
            }
            let kind = if defenders.is_empty() {
                GoalKind::Normal
            } else {
                goal_kind(s.next())
            };
            let minute = match kind {
                GoalKind::Late => 91 + s.next() % 5,
                _ => 15 * chance as u8 + 1 + s.next() % 15,
            };
            let player = if kind == GoalKind::Own {
                let w: Vec<u32> = defenders
                    .iter()
                    .map(|d| (100 - d.defence.min(99) as u32) * defence_weight(d.position))
                    .collect();
                weighted_pick(&w, s.next_u32())
            } else {
                let w: Vec<u32> = attackers
                    .iter()
                    .map(|a| a.attack as u32 * attack_weight(a.position))
                    .collect();
                weighted_pick(&w, s.next_u32())
            };
            goals.push(Goal {
                for_home,
                minute,
                kind,
                player,
            });
        }
    }
    goals.sort_by_key(|g| g.minute);
    goals
}

/// Round-robin pairings for `round` (0-based) between `n` clubs, by index.
/// Circle method: every club meets every other once per `n - 1` rounds (`n` if
/// odd, one club resting each round). Home and away alternate.
pub fn fixtures(n: usize, round: u32) -> Vec<(usize, usize)> {
    if n < 2 {
        return Vec::new();
    }
    let slots = n + n % 2; // a ghost slot when odd
    let rounds = slots - 1;
    let r = round as usize % rounds;
    // Slot 0 stays, the others rotate.
    let at = |i: usize| -> usize { if i == 0 { 0 } else { 1 + (i - 1 + r) % rounds } };
    let mut out = Vec::with_capacity(slots / 2);
    for i in 0..slots / 2 {
        let (a, b) = (at(i), at(slots - 1 - i));
        if a >= n || b >= n {
            continue; // the club facing the ghost rests
        }
        out.push(if (r + i).is_multiple_of(2) {
            (a, b)
        } else {
            (b, a)
        });
    }
    out
}

/// A seed from the block's random seed and a few numbers (match day, index...).
pub fn derive_seed(block_seed: [u8; 32], parts: &[u64]) -> [u8; 32] {
    let mut input = Vec::with_capacity(32 + 8 * parts.len());
    input.extend_from_slice(&block_seed);
    for p in parts {
        input.extend_from_slice(&p.to_le_bytes());
    }
    env::sha256_array(&input)
}

/// An endless stream of bytes from a seed (sha256 in counter mode).
pub struct ByteStream {
    seed: [u8; 32],
    block: [u8; 32],
    counter: u32,
    pos: usize,
}

impl ByteStream {
    pub fn new(seed: [u8; 32]) -> Self {
        Self {
            seed,
            block: [0; 32],
            counter: 0,
            pos: 32,
        }
    }

    pub fn next(&mut self) -> u8 {
        if self.pos == 32 {
            let mut input = self.seed.to_vec();
            input.extend_from_slice(&self.counter.to_le_bytes());
            self.block = env::sha256_array(&input);
            self.counter += 1;
            self.pos = 0;
        }
        let b = self.block[self.pos];
        self.pos += 1;
        b
    }

    pub fn next_u16(&mut self) -> u16 {
        u16::from_le_bytes([self.next(), self.next()])
    }

    pub fn next_u32(&mut self) -> u32 {
        u32::from_le_bytes([self.next(), self.next(), self.next(), self.next()])
    }

    /// A value in `lo..=hi`.
    pub fn range(&mut self, lo: u8, hi: u8) -> u8 {
        lo + self.next() % (hi - lo + 1)
    }
}

// ---- Skills (v4) ----

/// The six skills of a footballer, 1 to 99 each.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Skills {
    pub pace: u8,
    pub shooting: u8,
    pub passing: u8,
    pub dribbling: u8,
    pub defending: u8,
    pub physical: u8,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skill {
    Pace,
    Shooting,
    Passing,
    Dribbling,
    Defending,
    Physical,
}

impl Skills {
    pub fn get(&self, s: Skill) -> u8 {
        match s {
            Skill::Pace => self.pace,
            Skill::Shooting => self.shooting,
            Skill::Passing => self.passing,
            Skill::Dribbling => self.dribbling,
            Skill::Defending => self.defending,
            Skill::Physical => self.physical,
        }
    }

    /// Adds `points` to a skill, up to 99.
    pub fn raise(&mut self, s: Skill, points: u8) {
        let v = match s {
            Skill::Pace => &mut self.pace,
            Skill::Shooting => &mut self.shooting,
            Skill::Passing => &mut self.passing,
            Skill::Dribbling => &mut self.dribbling,
            Skill::Defending => &mut self.defending,
            Skill::Physical => &mut self.physical,
        };
        *v = v.saturating_add(points).min(99);
    }

    fn weighted(&self, w: [u32; 6]) -> u32 {
        let v = [
            self.pace,
            self.shooting,
            self.passing,
            self.dribbling,
            self.defending,
            self.physical,
        ];
        v.iter().zip(w).map(|(v, w)| *v as u32 * w).sum::<u32>()
    }

    /// What the match engine uses: attack and defence, 1 to 99.
    pub fn attack(&self) -> u8 {
        (self.weighted([2, 3, 2, 2, 0, 1]) / 10).clamp(1, 99) as u8
    }

    pub fn defence(&self) -> u8 {
        (self.weighted([2, 0, 1, 0, 4, 3]) / 10).clamp(1, 99) as u8
    }

    /// The rating on the card, out of 100, weighted by position.
    pub fn overall(&self, p: Position) -> u8 {
        let w = match p {
            //            pac sho pas dri def phy
            Position::Gk => [15, 0, 15, 0, 50, 20],
            Position::Df => [15, 0, 10, 5, 45, 25],
            Position::Mf => [10, 15, 30, 20, 15, 10],
            Position::Fw => [25, 35, 10, 20, 0, 10],
        };
        (self.weighted(w) / 100).clamp(1, 99) as u8
    }

    /// A new player's skills for his position.
    pub fn roll(s: &mut ByteStream, p: Position) -> Self {
        // (lo, hi) per skill: pace, shooting, passing, dribbling, defending, physical
        let r: [(u8, u8); 6] = match p {
            Position::Gk => [(25, 40), (5, 20), (30, 45), (10, 25), (50, 65), (45, 60)],
            Position::Df => [(40, 55), (20, 35), (35, 50), (25, 40), (50, 65), (50, 65)],
            Position::Mf => [(40, 55), (35, 50), (45, 60), (40, 55), (35, 50), (40, 55)],
            Position::Fw => [(50, 65), (50, 65), (35, 50), (45, 60), (15, 30), (40, 55)],
        };
        Self {
            pace: s.range(r[0].0, r[0].1),
            shooting: s.range(r[1].0, r[1].1),
            passing: s.range(r[2].0, r[2].1),
            dribbling: s.range(r[3].0, r[3].1),
            defending: s.range(r[4].0, r[4].1),
            physical: s.range(r[5].0, r[5].1),
        }
    }
}

/// Training is harder at the top: at most 2 points from 80, 1 from 90.
pub fn training_gain(current: u8, points: u8, max_points: u8) -> u8 {
    let cap = match current {
        90.. => 1,
        80..=89 => 2,
        _ => max_points,
    };
    points.min(cap).min(max_points).min(99 - current.min(99))
}

// ---- Match report (v4) ----

/// What the match sheet shows beyond the goals. Drawn from its own stream so
/// the score of a seed never depends on it.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub shots: [u8; 2],
    pub on_target: [u8; 2],
    /// Rating × 10 (30 to 99) of each player, home eleven then away eleven.
    pub ratings: [Vec<u8>; 2],
    /// (home side?, index in that eleven, rating × 10).
    pub man_of_the_match: Option<(bool, usize, u8)>,
}

pub fn report(
    seed: [u8; 32],
    home: &[OnPitch],
    away: &[OnPitch],
    overall: [&[u8]; 2],
    goals: &[Goal],
) -> Report {
    let mut input = seed.to_vec();
    input.extend_from_slice(b"report");
    let mut s = ByteStream::new(env::sha256_array(&input));
    let sides = [home, away];
    let scored = |home_side: bool| goals.iter().filter(|g| g.for_home == home_side).count() as u8;
    let (hg, ag) = (scored(true), scored(false));
    let mut shots = [0u8; 2];
    let mut on_target = [0u8; 2];
    for (i, home_side) in [true, false].into_iter().enumerate() {
        let own_for = goals
            .iter()
            .filter(|g| g.for_home == home_side && g.kind == GoalKind::Own)
            .count() as u8;
        let (att, _) = strength(sides[i]);
        let (_, def) = strength(sides[1 - i]);
        let bonus = u8::from(att > def + 10);
        on_target[i] = if sides[i].is_empty() {
            0
        } else {
            scored(home_side) - own_for + s.range(0, 3) + bonus
        };
        shots[i] = if sides[i].is_empty() {
            0
        } else {
            on_target[i] + s.range(1, 6)
        };
    }
    let mut ratings: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
    let mut best: Option<(bool, usize, u8)> = None;
    for (i, home_side) in [true, false].into_iter().enumerate() {
        let (mine, theirs) = if home_side { (hg, ag) } else { (ag, hg) };
        for (k, p) in sides[i].iter().enumerate() {
            let ovr = overall[i].get(k).copied().unwrap_or(50) as i32;
            let mut r: i32 = 60 + (ovr - 50) / 4 + s.range(0, 12) as i32 - 6;
            for g in goals {
                // Index `player` is in the eleven of the side that touched it last.
                let touched_home = (g.kind == GoalKind::Own) != g.for_home;
                if touched_home == home_side && g.player == k {
                    r += if g.kind == GoalKind::Own { -8 } else { 10 };
                }
            }
            r += match mine.cmp(&theirs) {
                core::cmp::Ordering::Greater => 4,
                core::cmp::Ordering::Less => -4,
                core::cmp::Ordering::Equal => 0,
            };
            if matches!(p.position, Position::Gk | Position::Df) {
                r += if theirs == 0 {
                    6
                } else {
                    -3 * (theirs.min(3) as i32)
                };
            }
            let r = r.clamp(30, 99) as u8;
            ratings[i].push(r);
            let better = match best {
                None => true,
                Some((bh, _, br)) => {
                    r > br || (r == br && home_side == (hg >= ag) && bh != home_side)
                }
            };
            if better {
                best = Some((home_side, k, r));
            }
        }
    }
    Report {
        shots,
        on_target,
        ratings,
        man_of_the_match: best,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn eleven(attack: u8, defence: u8) -> Vec<OnPitch> {
        FORMATION
            .iter()
            .flat_map(|(p, n)| {
                std::iter::repeat_n(
                    OnPitch {
                        position: *p,
                        attack,
                        defence,
                    },
                    *n,
                )
            })
            .collect()
    }

    fn seed(i: u64) -> [u8; 32] {
        derive_seed([9; 32], &[i])
    }

    #[test]
    fn every_pair_meets_once_per_cycle() {
        for n in 2..=9usize {
            let rounds = n + n % 2 - 1;
            let mut seen = HashSet::new();
            for r in 0..rounds as u32 {
                let round = fixtures(n, r);
                let mut busy = HashSet::new();
                for &(a, b) in &round {
                    assert!(a != b && a < n && b < n);
                    assert!(
                        busy.insert(a) && busy.insert(b),
                        "a club plays twice in a round"
                    );
                    assert!(seen.insert((a.min(b), a.max(b))), "a pair met twice");
                }
                assert_eq!(round.len(), n / 2);
            }
            assert_eq!(seen.len(), n * (n - 1) / 2);
        }
    }

    #[test]
    fn fewer_than_two_clubs_play_nothing() {
        assert!(fixtures(0, 0).is_empty());
        assert!(fixtures(1, 3).is_empty());
    }

    #[test]
    fn strength_follows_ratings_and_missing_players_weaken() {
        assert_eq!(strength(&eleven(50, 50)), (50, 50));
        assert_eq!(strength(&eleven(80, 30)), (80, 30));
        let mut ten = eleven(50, 50);
        ten.pop(); // a forward missing
        let (att, def) = strength(&ten);
        assert!(att < 50 && def == 50);
        assert_eq!(strength(&[]), (0, 0));
    }

    #[test]
    fn even_teams_score_about_one_and_a_third() {
        assert_eq!(chance_bps(50, 50, false), 2_250);
        assert_eq!(chance_bps(50, 50, true), 2_475);
        assert_eq!(chance_bps(99, 1, true), 6_000);
        assert_eq!(chance_bps(1, 99, false), 200);
        let (a, b) = (eleven(50, 50), eleven(50, 50));
        let goals: usize = (0..2_000).map(|i| play_match(seed(i), &a, &b).len()).sum();
        let per_match = goals as f64 / 2_000.0;
        assert!(
            (2.6..3.1).contains(&per_match),
            "{per_match} goals per match"
        );
    }

    #[test]
    fn the_stronger_eleven_usually_wins_but_not_always() {
        let (strong, weak) = (eleven(75, 75), eleven(45, 45));
        let (mut wins, mut losses) = (0, 0);
        for i in 0..2_000 {
            let goals = play_match(seed(i), &weak, &strong);
            let home = goals.iter().filter(|g| g.for_home).count();
            let away = goals.len() - home;
            if away > home {
                wins += 1;
            } else if home > away {
                losses += 1;
            }
        }
        assert!(wins > 1_200, "strong away side won {wins} of 2000");
        assert!(losses > 40, "upsets must stay possible: {losses}");
    }

    #[test]
    fn forwards_score_more_than_defenders_and_keepers_rarely() {
        let xi = eleven(50, 50);
        let mut by_pos = std::collections::HashMap::new();
        for i in 0..3_000 {
            for g in play_match(seed(i), &xi, &xi) {
                if g.kind != GoalKind::Own {
                    let side = &xi; // same eleven on both sides
                    *by_pos.entry(side[g.player].position).or_insert(0u32) += 1;
                }
            }
        }
        let per_player = |p: Position, n: u32| by_pos.get(&p).copied().unwrap_or(0) / n;
        assert!(per_player(Position::Fw, 2) > per_player(Position::Mf, 4));
        assert!(per_player(Position::Mf, 4) > per_player(Position::Df, 4));
        assert!(per_player(Position::Gk, 1) < per_player(Position::Df, 4));
    }

    #[test]
    fn goals_are_well_formed_and_reproducible() {
        let (a, b) = (eleven(60, 40), eleven(40, 60));
        for i in 0..500 {
            let goals = play_match(seed(i), &a, &b);
            assert_eq!(goals, play_match(seed(i), &a, &b));
            assert!(goals.windows(2).all(|w| w[0].minute <= w[1].minute));
            for g in &goals {
                assert!(g.player < ELEVEN);
                match g.kind {
                    GoalKind::Late => assert!((91..=95).contains(&g.minute)),
                    _ => assert!((1..=90).contains(&g.minute)),
                }
            }
        }
    }

    #[test]
    fn an_empty_eleven_does_not_score() {
        let goals: usize = (0..200)
            .map(|i| {
                play_match(seed(i), &[], &eleven(50, 50))
                    .iter()
                    .filter(|g| g.for_home)
                    .count()
            })
            .sum();
        assert_eq!(goals, 0);
    }

    #[test]
    fn weighted_pick_respects_weights() {
        let mut hits = [0u32; 3];
        for r in 0..30_000u32 {
            hits[weighted_pick(&[0, 9, 19], r.wrapping_mul(2_654_435_761))] += 1;
        }
        assert!(hits[2] > hits[1] && hits[1] > hits[0] && hits[0] > 0);
    }
    #[test]
    fn rolled_skills_fit_the_old_ratings_and_cards_start_below_gold() {
        for (i, pos) in [Position::Gk, Position::Df, Position::Mf, Position::Fw]
            .into_iter()
            .enumerate()
        {
            for k in 0..300u64 {
                let mut s = ByteStream::new(seed(k * 4 + i as u64));
                let sk = Skills::roll(&mut s, pos);
                let ovr = sk.overall(pos);
                assert!((25..=65).contains(&ovr), "{pos:?} {ovr}");
                let (att, def) = (sk.attack(), sk.defence());
                match pos {
                    Position::Fw => assert!(att > def),
                    Position::Gk | Position::Df => assert!(def > att),
                    Position::Mf => assert!(att.abs_diff(def) < 20),
                }
            }
        }
    }

    #[test]
    fn a_skill_stops_at_99() {
        let mut sk = Skills {
            pace: 98,
            shooting: 50,
            passing: 50,
            dribbling: 50,
            defending: 50,
            physical: 50,
        };
        sk.raise(Skill::Pace, 3);
        assert_eq!(sk.pace, 99);
        assert_eq!(sk.overall(Position::Mf) as u32, (10 * 99 + 90 * 50) / 100);
    }

    #[test]
    fn reports_agree_with_the_goals() {
        let (a, b) = (eleven(60, 40), eleven(40, 60));
        let ovr = [vec![55u8; 11], vec![50u8; 11]];
        for i in 0..500 {
            let goals = play_match(seed(i), &a, &b);
            let r = report(seed(i), &a, &b, [&ovr[0], &ovr[1]], &goals);
            assert_eq!(r, report(seed(i), &a, &b, [&ovr[0], &ovr[1]], &goals));
            for (k, home) in [true, false].into_iter().enumerate() {
                let real = goals
                    .iter()
                    .filter(|g| g.for_home == home && g.kind != GoalKind::Own)
                    .count() as u8;
                assert!(r.on_target[k] >= real && r.shots[k] > r.on_target[k]);
                assert_eq!(r.ratings[k].len(), 11);
                assert!(r.ratings[k].iter().all(|x| (30..=99).contains(x)));
            }
            let (home, k, best) = r.man_of_the_match.unwrap();
            assert_eq!(r.ratings[usize::from(!home)][k], best);
            assert!(r.ratings.iter().flatten().all(|x| *x <= best));
        }
    }
}

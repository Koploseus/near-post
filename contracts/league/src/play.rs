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
}

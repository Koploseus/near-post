//! Pure game logic: positions, skills, fixtures and seeds. No storage, no
//! promises, so it is tested on its own. The match engine is in `live.rs`.

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

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
}

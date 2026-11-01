//! Pure match logic: fixtures and scores. No storage, no promises, so it is
//! tested on its own.

use near_sdk::{env, near};

/// How a goal counts for the economy.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GoalKind {
    /// Mints the goal amount.
    Normal,
    /// Scored after the 90th minute: mints double.
    Late,
    /// Put in his own net by the other side: mints nothing, burns from the
    /// treasury of the club at fault.
    Own,
}

/// One goal, credited to `for_home` or the away side. `minute` is 1 to 90, or
/// 91 to 95 for 90+1 to 90+5.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Goal {
    pub for_home: bool,
    pub minute: u8,
    pub kind: GoalKind,
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

/// A team's goals from one random byte. Close to a Poisson law with mean 1.35:
/// 0: 26%, 1: 35%, 2: 24%, 3: 11%, 4: 3%, 5: 1%.
pub fn goals_from_byte(b: u8) -> u8 {
    match b {
        0..=66 => 0,
        67..=156 => 1,
        157..=217 => 2,
        218..=245 => 3,
        246..=253 => 4,
        _ => 5,
    }
}

/// Kind and minute of a goal from two random bytes: about 4% own goals and
/// 12% late goals.
pub fn goal_from_bytes(kind_byte: u8, minute_byte: u8) -> (GoalKind, u8) {
    match kind_byte {
        0..=9 => (GoalKind::Own, 1 + minute_byte % 90),
        10..=40 => (GoalKind::Late, 91 + minute_byte % 5),
        _ => (GoalKind::Normal, 1 + minute_byte % 89),
    }
}

/// Plays one match from a 32-byte seed. Goals come back in minute order.
pub fn play_match(seed: [u8; 32]) -> Vec<Goal> {
    let mut stream = ByteStream::new(seed);
    let home = goals_from_byte(stream.next());
    let away = goals_from_byte(stream.next());
    let mut goals = Vec::with_capacity((home + away) as usize);
    for for_home in
        std::iter::repeat_n(true, home as usize).chain(std::iter::repeat_n(false, away as usize))
    {
        let (kind, minute) = goal_from_bytes(stream.next(), stream.next());
        goals.push(Goal {
            for_home,
            minute,
            kind,
        });
    }
    goals.sort_by_key(|g| g.minute);
    goals
}

/// The seed for match `index` of match day `day`, from the block's random seed.
pub fn match_seed(block_seed: [u8; 32], day: u32, index: u32) -> [u8; 32] {
    let mut input = Vec::with_capacity(40);
    input.extend_from_slice(&block_seed);
    input.extend_from_slice(&day.to_le_bytes());
    input.extend_from_slice(&index.to_le_bytes());
    env::sha256_array(&input)
}

/// An endless stream of bytes from a seed (sha256 in counter mode).
struct ByteStream {
    seed: [u8; 32],
    block: [u8; 32],
    counter: u32,
    pos: usize,
}

impl ByteStream {
    fn new(seed: [u8; 32]) -> Self {
        Self {
            seed,
            block: [0; 32],
            counter: 0,
            pos: 32,
        }
    }

    fn next(&mut self) -> u8 {
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

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
    fn goal_distribution_is_as_documented() {
        let counts = (0..=255u8).fold([0u32; 6], |mut c, b| {
            c[goals_from_byte(b) as usize] += 1;
            c
        });
        assert_eq!(counts, [67, 90, 61, 28, 8, 2]);
        let own = (0..=255u8)
            .filter(|&b| goal_from_bytes(b, 0).0 == GoalKind::Own)
            .count();
        let late = (0..=255u8)
            .filter(|&b| goal_from_bytes(b, 0).0 == GoalKind::Late)
            .count();
        assert_eq!((own, late), (10, 31));
    }

    #[test]
    fn minutes_fit_their_kind() {
        for m in 0..=255u8 {
            assert!((91..=95).contains(&goal_from_bytes(20, m).1));
            assert!((1..=89).contains(&goal_from_bytes(200, m).1));
            assert!((1..=90).contains(&goal_from_bytes(0, m).1));
        }
    }

    #[test]
    fn same_seed_same_match_and_goals_are_sorted() {
        let a = play_match([7; 32]);
        assert_eq!(a, play_match([7; 32]));
        assert!(a.windows(2).all(|w| w[0].minute <= w[1].minute));
        let distinct: HashSet<_> = (0..40u32)
            .map(|i| format!("{:?}", play_match(match_seed([1; 32], 1, i))))
            .collect();
        assert!(distinct.len() > 10, "seeds should give different matches");
    }
}

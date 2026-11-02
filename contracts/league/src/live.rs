//! The live match engine (v5), after the one of the original Star du Foot.
//!
//! A match is two halves. The ball is always at one player's feet, in one of
//! three zones of the pitch (own third, middle, attacking third). Step by
//! step the player with the ball passes, takes a man on, is fouled or shoots,
//! with odds set by his role, his skills, the opponent marking him and the
//! team's strategy. Each step takes a few seconds of match time; possession is
//! counted as it goes. Only what a match sheet shows is kept: shots, saves,
//! goals, corners, fouls and cards, each with its second.
//!
//! A half is played in one transaction, so its events are known when it is
//! played; the app reveals them over ten real minutes, like the old site did.

use crate::play::Skills;
use near_sdk::near;

pub const HALF_SECONDS: u32 = 45 * 60;

/// Where a player stands in a formation.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Gk,
    Lb,
    Cb,
    Rb,
    Dm,
    Cm,
    Lm,
    Rm,
    Am,
    Lw,
    Rw,
    St,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Formation {
    #[serde(rename = "4-4-2")]
    F442,
    #[serde(rename = "4-3-3")]
    F433,
    #[serde(rename = "3-5-2")]
    F352,
    #[serde(rename = "4-2-3-1")]
    F4231,
}

pub const FORMATIONS: [Formation; 4] = [
    Formation::F442,
    Formation::F433,
    Formation::F352,
    Formation::F4231,
];

impl Formation {
    /// The eleven roles, keeper first, then from the back to the front.
    pub fn roles(self) -> [Role; 11] {
        use Role::*;
        match self {
            Formation::F442 => [Gk, Lb, Cb, Cb, Rb, Lm, Cm, Cm, Rm, St, St],
            Formation::F433 => [Gk, Lb, Cb, Cb, Rb, Dm, Cm, Cm, Lw, St, Rw],
            Formation::F352 => [Gk, Cb, Cb, Cb, Lm, Dm, Cm, Cm, Rm, St, St],
            Formation::F4231 => [Gk, Lb, Cb, Cb, Rb, Dm, Dm, Lw, Am, Rw, St],
        }
    }
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    Defend,
    Balanced,
    Attack,
}

/// How good a player is in a role, 1 to 99: the skills that role uses.
pub fn role_value(s: &Skills, r: Role) -> u8 {
    //            pac sho pas dri def phy
    let w: [u32; 6] = match r {
        Role::Gk => [5, 0, 15, 0, 60, 20],
        Role::Cb => [10, 0, 10, 0, 50, 30],
        Role::Lb | Role::Rb => [25, 0, 15, 10, 35, 15],
        Role::Dm => [10, 5, 25, 5, 35, 20],
        Role::Cm => [10, 10, 35, 20, 15, 10],
        Role::Lm | Role::Rm => [25, 10, 25, 25, 5, 10],
        Role::Am => [10, 25, 30, 30, 0, 5],
        Role::Lw | Role::Rw => [30, 25, 10, 30, 0, 5],
        Role::St => [20, 45, 5, 15, 0, 15],
    };
    let v = [
        s.pace,
        s.shooting,
        s.passing,
        s.dribbling,
        s.defending,
        s.physical,
    ];
    let sum: u32 = v.iter().zip(w).map(|(v, w)| *v as u32 * w).sum();
    (sum / 100).clamp(1, 99) as u8
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    Goal,
    /// Scored for `home`'s side by a player of the other side (`player` is
    /// his slot in that other eleven).
    OwnGoal,
    Saved,
    Missed,
    Corner,
    Foul,
    Yellow,
}

/// One moment of a match. `second` runs from 0 (kick-off) to the end of the
/// second half, stoppage time included (the second half starts at 2700).
/// `home` is the side the event is for (the shooter's, the fouler's...).
/// `player` is a slot (0 to 10) in that side's eleven, except for own goals.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Event {
    pub second: u16,
    pub home: bool,
    pub kind: EventKind,
    pub player: u8,
}

/// One side on the pitch: roles and skills by slot, and its strategy.
#[derive(Clone, Debug)]
pub struct Side {
    pub roles: [Role; 11],
    /// One entry per slot; `None` is an empty slot (a short squad).
    pub skills: [Option<Skills>; 11],
    pub strategy: Strategy,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Half {
    pub events: Vec<Event>,
    /// Seconds with the ball: home, away.
    pub possession: [u32; 2],
    /// Last second of the half (stoppage time included).
    pub end: u16,
}

const BACK: &[Role] = &[Role::Lb, Role::Cb, Role::Rb, Role::Dm];
const MIDDLE: &[Role] = &[Role::Dm, Role::Cm, Role::Lm, Role::Rm, Role::Am];
const FRONT: &[Role] = &[Role::Am, Role::Lw, Role::Rw, Role::St, Role::Cm];

fn group(zone: u8) -> &'static [Role] {
    match zone {
        0 => BACK,
        1 => MIDDLE,
        _ => FRONT,
    }
}

/// xoshiro256**, seeded from the half's 32-byte seed: cheap enough to draw
/// thousands of numbers in a transaction without a host call each.
struct Rng([u64; 4]);

impl Rng {
    fn new(seed: [u8; 32]) -> Self {
        let mut s = [0u64; 4];
        for (i, w) in s.iter_mut().enumerate() {
            *w = u64::from_le_bytes(seed[i * 8..i * 8 + 8].try_into().unwrap_or([0; 8]));
        }
        if s == [0; 4] {
            s[0] = 1;
        }
        Self(s)
    }

    fn next_u32(&mut self) -> u32 {
        let s = &mut self.0;
        let out = s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = s[1] << 17;
        s[2] ^= s[0];
        s[3] ^= s[1];
        s[1] ^= s[2];
        s[0] ^= s[3];
        s[2] ^= t;
        s[3] = s[3].rotate_left(45);
        (out >> 32) as u32
    }
}

struct Pitch<'a> {
    sides: [&'a Side; 2],
    s: Rng,
}

impl Pitch<'_> {
    fn roll(&mut self, n: u32) -> u32 {
        self.s.next_u32() % n.max(1)
    }

    fn chance(&mut self, percent: i32) -> bool {
        (self.roll(100) as i32) < percent
    }

    fn between(&mut self, lo: u32, hi: u32) -> u32 {
        lo + self.roll(hi - lo + 1)
    }

    fn skills(&self, side: usize, slot: usize) -> Skills {
        self.sides[side].skills[slot].unwrap_or(Skills {
            pace: 1,
            shooting: 1,
            passing: 1,
            dribbling: 1,
            defending: 1,
            physical: 1,
        })
    }

    /// A random filled slot of `side` whose role is in `roles` (any outfield
    /// player if none), never `not`.
    fn pick(&mut self, side: usize, roles: &[Role], not: Option<usize>) -> Option<usize> {
        let pool = |strict: bool| -> Vec<usize> {
            (1..11)
                .filter(|&k| Some(k) != not && self.sides[side].skills[k].is_some())
                .filter(|&k| !strict || roles.contains(&self.sides[side].roles[k]))
                .collect()
        };
        let mut found = pool(true);
        if found.is_empty() {
            found = pool(false);
        }
        if found.is_empty() {
            return None;
        }
        let i = self.roll(found.len() as u32) as usize;
        Some(found[i])
    }

    fn keeper(&self, side: usize) -> Option<usize> {
        self.sides[side].skills[0].map(|_| 0)
    }

    fn strategy_factor(&self, side: usize, attack: bool) -> i32 {
        match (self.sides[side].strategy, attack) {
            (Strategy::Attack, true) => 150,
            (Strategy::Defend, false) => 130,
            (Strategy::Defend, true) => 70,
            (Strategy::Attack, false) => 85,
            (Strategy::Balanced, _) => 100,
        }
    }
}

fn shot_weight(role: Role, zone: u8) -> i32 {
    match (zone, role) {
        (2, Role::St) => 28,
        (2, Role::Lw | Role::Rw | Role::Am) => 18,
        (2, Role::Cm | Role::Lm | Role::Rm) => 10,
        (2, _) => 5,
        (1, Role::St | Role::Am | Role::Cm) => 3,
        (1, _) => 1,
        _ => 0,
    }
}

/// Plays one half. `half` is 1 or 2; `kick_off_home` says who starts.
pub fn play_half(seed: [u8; 32], half: u8, home: &Side, away: &Side, kick_off_home: bool) -> Half {
    let mut p = Pitch {
        sides: [home, away],
        s: Rng::new(seed),
    };
    let base = if half == 1 { 0 } else { HALF_SECONDS };
    let mut out = Half::default();
    let mut side: usize = if kick_off_home { 0 } else { 1 };
    let mut zone: u8 = 1;
    let Some(mut holder) =
        p.pick(side, &[Role::St, Role::Cm], None)
            .or(p.pick(1 - side, &[], None))
    else {
        out.end = (base + HALF_SECONDS) as u16;
        return out;
    };
    if p.sides[side].skills[holder].is_none() {
        side = 1 - side;
    }
    let mut t: u32 = 0;
    let mut fouls: u32 = 0;
    let mut end: Option<u32> = None;
    let push = |out: &mut Half, t: u32, home: bool, kind: EventKind, player: usize| {
        out.events.push(Event {
            second: (base + t) as u16,
            home,
            kind,
            player: player as u8,
        });
    };

    loop {
        if end.is_none() && t >= HALF_SECONDS {
            end = Some(HALF_SECONDS + (30 + 15 * fouls).min(300));
        }
        if let Some(e) = end
            && t >= e
        {
            break;
        }
        let other = 1 - side;
        let me = p.skills(side, holder);
        let role = p.sides[side].roles[holder];
        let marker = p.pick(other, group(2 - zone), None);
        let mk = marker.map(|m| p.skills(other, m));
        let mk_def = mk.map(|m| m.defending as i32).unwrap_or(0);
        let mk_phy = mk.map(|m| m.physical as i32).unwrap_or(0);

        let w_shot = shot_weight(role, zone) * p.strategy_factor(side, true) / 100;
        let w_pass = 100;
        let w_dribble = if role == Role::Gk {
            0
        } else {
            25 + me.dribbling as i32 / 5
        };
        let w_foul = if marker.is_some() {
            5 * p.strategy_factor(other, false) / 100
        } else {
            0
        };
        let total = (w_shot + w_pass + w_dribble + w_foul) as u32;
        let r = p.roll(total) as i32;

        let elapsed;
        if r < w_shot {
            // A shot: on target, then past the keeper?
            let long = zone < 2;
            let gk = p.keeper(other);
            let gk_def = gk.map(|g| p.skills(other, g).defending as i32).unwrap_or(1);
            let on_target =
                p.chance((22 + me.shooting as i32 / 3 - if long { 12 } else { 0 }).clamp(12, 70));
            let mut next_side = other;
            if !on_target {
                push(&mut out, t, side == 0, EventKind::Missed, holder);
                if p.chance(15) {
                    push(&mut out, t + 5, side == 0, EventKind::Corner, holder);
                }
                holder = gk.unwrap_or(0);
                zone = 0;
                elapsed = p.between(20, 35);
            } else if p.chance(
                (27 + (me.shooting as i32 - gk_def) / 3 - if long { 10 } else { 0 }).clamp(8, 60),
            ) {
                push(&mut out, t, side == 0, EventKind::Goal, holder);
                holder = p.pick(other, &[Role::St, Role::Cm], None).unwrap_or(0);
                zone = 1;
                elapsed = p.between(50, 80);
            } else {
                push(&mut out, t, side == 0, EventKind::Saved, holder);
                if p.chance(60) {
                    push(&mut out, t + 5, side == 0, EventKind::Corner, holder);
                    // The corner: a header, a clearance, or worse.
                    let header = p.pick(side, &[Role::Cb, Role::St], None);
                    if p.chance(4) {
                        let unlucky = p
                            .pick(other, &[Role::Cb, Role::Lb, Role::Rb], None)
                            .unwrap_or(1);
                        push(&mut out, t + 10, side == 0, EventKind::OwnGoal, unlucky);
                        holder = p.pick(other, &[Role::St, Role::Cm], None).unwrap_or(0);
                        zone = 1;
                    } else if let Some(h) = header.filter(|_| p.chance(30)) {
                        let hs = p.skills(side, h);
                        if p.chance(35 + hs.physical as i32 / 5)
                            && p.chance((20 + (hs.physical as i32 - gk_def) / 3).clamp(8, 45))
                        {
                            push(&mut out, t + 10, side == 0, EventKind::Goal, h);
                            holder = p.pick(other, &[Role::St, Role::Cm], None).unwrap_or(0);
                            zone = 1;
                        } else {
                            push(&mut out, t + 10, side == 0, EventKind::Missed, h);
                            holder = gk.unwrap_or(0);
                            zone = 0;
                        }
                    } else {
                        holder = p.pick(other, BACK, None).unwrap_or(0);
                        zone = 0;
                    }
                    elapsed = p.between(35, 55);
                } else {
                    holder = gk.unwrap_or(0);
                    zone = 0;
                    elapsed = p.between(20, 35);
                }
            }
            if p.sides[next_side].skills[holder].is_none() {
                next_side = side;
            }
            out.possession[side] += elapsed;
            side = next_side;
        } else if r < w_shot + w_pass {
            // A pass, forward half the time.
            let forward = zone < 2 && p.chance(40 + p.strategy_factor(side, true) / 5);
            let to_zone = if forward { zone + 1 } else { zone };
            let target = p.pick(side, group(to_zone), Some(holder));
            let ok = target.is_some()
                && (marker.is_none()
                    || p.chance(
                        (70 + (me.passing as i32 - mk_def) / 3
                            - (p.strategy_factor(other, false) - 100) / 6)
                            .clamp(35, 92),
                    ));
            elapsed = if ok {
                p.between(8, 16)
            } else {
                p.between(4, 8)
            };
            out.possession[side] += elapsed;
            if ok {
                holder = target.unwrap_or(holder);
                zone = to_zone;
            } else if let Some(m) = marker {
                side = other;
                holder = m;
                zone = 2 - zone;
            }
        } else if r < w_shot + w_pass + w_dribble {
            // Taking a man on.
            let ok = marker.is_none()
                || p.chance(
                    (45 + (me.dribbling as i32 + me.pace as i32 / 2 - mk_def - mk_phy / 2) / 3)
                        .clamp(20, 80),
                );
            elapsed = p.between(6, 12);
            out.possession[side] += elapsed;
            if ok {
                zone = (zone + 1).min(2);
            } else if let Some(m) = marker {
                side = other;
                holder = m;
                zone = 2 - zone;
            }
        } else {
            // Fouled: maybe a card, maybe a free kick on goal.
            let m = marker.unwrap_or(0);
            push(&mut out, t, other == 0, EventKind::Foul, m);
            if p.chance(20) {
                push(&mut out, t + 1, other == 0, EventKind::Yellow, m);
            }
            fouls += 1;
            elapsed = p.between(25, 45);
            out.possession[side] += elapsed / 2;
        }
        t += elapsed;
    }
    out.end = (base + end.unwrap_or(HALF_SECONDS)) as u16;
    out
}

/// Goals of a list of events: (home, away), own goals included.
pub fn score(events: &[Event]) -> (u8, u8) {
    let mut s = (0u8, 0u8);
    for e in events {
        if matches!(e.kind, EventKind::Goal | EventKind::OwnGoal) {
            if e.home {
                s.0 += 1;
            } else {
                s.1 += 1;
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::derive_seed;

    fn skills(v: u8) -> Skills {
        Skills {
            pace: v,
            shooting: v,
            passing: v,
            dribbling: v,
            defending: v,
            physical: v,
        }
    }

    fn side(v: u8, f: Formation, strategy: Strategy) -> Side {
        Side {
            roles: f.roles(),
            skills: [Some(skills(v)); 11],
            strategy,
        }
    }

    fn matches(n: u64, home: &Side, away: &Side) -> Vec<(Half, Half)> {
        (0..n)
            .map(|i| {
                let a = play_half(derive_seed([3; 32], &[i, 1]), 1, home, away, true);
                let b = play_half(derive_seed([3; 32], &[i, 2]), 2, home, away, false);
                (a, b)
            })
            .collect()
    }

    fn stat(ms: &[(Half, Half)], f: impl Fn(&Event) -> bool) -> f64 {
        let n: usize = ms
            .iter()
            .map(|(a, b)| a.events.iter().chain(&b.events).filter(|e| f(e)).count())
            .sum();
        n as f64 / ms.len() as f64
    }

    #[test]
    fn a_match_costs_little_gas() {
        let s = side(55, Formation::F442, Strategy::Balanced);
        let before = near_sdk::env::used_gas();
        let ms = matches(4, &s, &s);
        let per = (near_sdk::env::used_gas().as_gas() - before.as_gas()) / 4;
        println!(
            "one match, both halves: {} Ggas, {} events",
            per / 1_000_000_000,
            ms[0].0.events.len() + ms[0].1.events.len()
        );
    }

    #[test]
    fn print_tuning() {
        let even = side(50, Formation::F442, Strategy::Balanced);
        let ms = matches(1_000, &even, &even);
        let shot = |e: &Event| {
            matches!(
                e.kind,
                EventKind::Goal | EventKind::Saved | EventKind::Missed
            )
        };
        println!(
            "even: goals {:.2} shots {:.1} on target {:.1} corners {:.1} fouls {:.1} yellows {:.1}",
            stat(&ms, |e| matches!(
                e.kind,
                EventKind::Goal | EventKind::OwnGoal
            )),
            stat(&ms, shot),
            stat(&ms, |e| matches!(
                e.kind,
                EventKind::Goal | EventKind::Saved
            )),
            stat(&ms, |e| e.kind == EventKind::Corner),
            stat(&ms, |e| e.kind == EventKind::Foul),
            stat(&ms, |e| e.kind == EventKind::Yellow),
        );
        let (strong, weak) = (
            side(75, Formation::F433, Strategy::Balanced),
            side(45, Formation::F442, Strategy::Balanced),
        );
        let (mut w, mut d, mut l) = (0, 0, 0);
        for (a, b) in matches(1_000, &weak, &strong) {
            let ev: Vec<Event> = a.events.iter().chain(&b.events).copied().collect();
            let (h, x) = score(&ev);
            if x > h {
                w += 1
            } else if x == h {
                d += 1
            } else {
                l += 1
            }
        }
        println!("75 v 45: wins {w} draws {d} losses {l}");
        let (s60, s50) = (
            side(60, Formation::F442, Strategy::Balanced),
            side(50, Formation::F442, Strategy::Balanced),
        );
        let (mut w, mut d, mut l) = (0, 0, 0);
        for (a, b) in matches(1_000, &s50, &s60) {
            let ev: Vec<Event> = a.events.iter().chain(&b.events).copied().collect();
            let (h, x) = score(&ev);
            if x > h {
                w += 1
            } else if x == h {
                d += 1
            } else {
                l += 1
            }
        }
        println!("60 v 50: wins {w} draws {d} losses {l}");
        let att = side(50, Formation::F442, Strategy::Attack);
        let msa = matches(1_000, &att, &even);
        println!(
            "attack v balanced: shots {:.1} v {:.1}, goals {:.2} v {:.2}",
            stat(&msa, |e| e.home && shot(e)),
            stat(&msa, |e| !e.home && shot(e)),
            stat(&msa, |e| e.home
                && matches!(e.kind, EventKind::Goal | EventKind::OwnGoal)),
            stat(&msa, |e| !e.home
                && matches!(e.kind, EventKind::Goal | EventKind::OwnGoal))
        );
    }

    #[test]
    fn even_sides_play_a_believable_match() {
        let (h, a) = (
            side(50, Formation::F442, Strategy::Balanced),
            side(50, Formation::F442, Strategy::Balanced),
        );
        let ms = matches(1_000, &h, &a);
        let goals = stat(&ms, |e| {
            matches!(e.kind, EventKind::Goal | EventKind::OwnGoal)
        });
        let shots = stat(&ms, |e| {
            matches!(
                e.kind,
                EventKind::Goal | EventKind::Saved | EventKind::Missed
            )
        });
        let corners = stat(&ms, |e| e.kind == EventKind::Corner);
        let fouls = stat(&ms, |e| e.kind == EventKind::Foul);
        assert!((2.0..3.6).contains(&goals), "{goals} goals a match");
        assert!((14.0..32.0).contains(&shots), "{shots} shots a match");
        assert!((4.0..14.0).contains(&corners), "{corners} corners");
        assert!((6.0..30.0).contains(&fouls), "{fouls} fouls");
        for (a, b) in &ms {
            assert!(a.events.windows(2).all(|w| w[0].second <= w[1].second + 10));
            assert!((2_700..=3_000).contains(&a.end) && (5_400..=5_700).contains(&b.end));
            assert!(
                a.events
                    .iter()
                    .all(|e| e.second <= a.end + 15 && e.player <= 10)
            );
            assert!(b.events.iter().all(|e| e.second >= 2_700));
            let total: u32 = a.possession.iter().sum();
            assert!(total > 2_000, "{total} seconds of possession");
        }
    }

    #[test]
    fn the_better_side_usually_wins_and_upsets_happen() {
        let (strong, weak) = (
            side(65, Formation::F433, Strategy::Balanced),
            side(50, Formation::F442, Strategy::Balanced),
        );
        let (mut wins, mut losses) = (0, 0);
        for (a, b) in matches(1_000, &weak, &strong) {
            let events: Vec<Event> = a.events.iter().chain(&b.events).copied().collect();
            let (h, w) = score(&events);
            if w > h {
                wins += 1;
            } else if h > w {
                losses += 1;
            }
        }
        assert!(wins > 550, "strong side won {wins} of 1000");
        assert!(losses > 40, "upsets must stay possible: {losses}");
    }

    #[test]
    fn strategy_changes_the_game() {
        let base = side(55, Formation::F442, Strategy::Balanced);
        let attack = side(55, Formation::F442, Strategy::Attack);
        let shots = |h: &Side| {
            stat(&matches(600, h, &base), |e| {
                e.home
                    && matches!(
                        e.kind,
                        EventKind::Goal | EventKind::Saved | EventKind::Missed
                    )
            })
        };
        assert!(shots(&attack) > shots(&base) * 1.1);
    }

    #[test]
    fn strikers_score_most_and_keepers_never() {
        let s = side(55, Formation::F442, Strategy::Balanced);
        let mut by_role = std::collections::HashMap::new();
        for (a, b) in matches(1_000, &s, &s) {
            for e in a
                .events
                .iter()
                .chain(&b.events)
                .filter(|e| e.kind == EventKind::Goal)
            {
                *by_role.entry(s.roles[e.player as usize]).or_insert(0u32) += 1;
            }
        }
        let st = by_role.get(&Role::St).copied().unwrap_or(0);
        assert!(st > by_role.get(&Role::Cm).copied().unwrap_or(0));
        assert!(st > by_role.get(&Role::Lb).copied().unwrap_or(0) * 3);
        assert_eq!(by_role.get(&Role::Gk).copied().unwrap_or(0), 0);
    }

    #[test]
    fn a_half_is_reproducible_and_an_empty_side_concedes() {
        let s = side(50, Formation::F4231, Strategy::Balanced);
        let seed = derive_seed([1; 32], &[7]);
        assert_eq!(
            play_half(seed, 1, &s, &s, true),
            play_half(seed, 1, &s, &s, true)
        );
        let empty = Side {
            roles: Formation::F442.roles(),
            skills: [None; 11],
            strategy: Strategy::Balanced,
        };
        let h = play_half(seed, 1, &s, &empty, true);
        assert!(h.events.iter().all(|e| e.home));
        let (_, conceded) = score(&play_half(seed, 2, &empty, &s, true).events);
        assert!(conceded > 0);
    }

    #[test]
    fn roles_value_the_right_skills() {
        let striker = Skills {
            pace: 70,
            shooting: 80,
            passing: 40,
            dribbling: 60,
            defending: 20,
            physical: 50,
        };
        assert!(role_value(&striker, Role::St) > role_value(&striker, Role::Cb) + 25);
        for f in FORMATIONS {
            let r = f.roles();
            assert_eq!(r[0], Role::Gk);
            assert_eq!(r.iter().filter(|x| **x == Role::Gk).count(), 1);
        }
    }
}

//! The wardrobe (v6): haircuts, boots and headbands as NEP-245 items.
//!
//! A pack costs 500k G, burned, and holds three items. Three items of the
//! same kind and rarity fuse into one of the next rarity. The person who
//! plays a footballer dresses him: equipping an item hands it to the league,
//! which keeps it while he wears it and gives it back when it comes off. Only
//! the league mints items; it burns or takes them only when their holder
//! asks it to (fuse, equip).

use crate::{BURN_GAS, CALLBACK_GAS, League, LeagueExt, Skill, Skills, derive_seed, ext_goalars};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, NearToken, PromiseError, env, ext_contract, near, require};

/// What a footballer can wear.
pub const KINDS: [&str; 3] = ["hair", "boots", "band"];
pub const RARITIES: [&str; 4] = ["common", "rare", "epic", "legendary"];
/// Styles by kind, then rarity: three of each.
pub const CATALOG: [[[&str; 3]; 4]; 3] = [
    [
        ["short", "buzz", "side-part"],
        ["curls", "ponytail", "bun"],
        ["mohawk", "afro", "dreads"],
        ["bleached", "flat-top", "fire"],
    ],
    [
        ["black", "white", "navy"],
        ["red", "blue", "yellow"],
        ["neon", "two-tone", "camo"],
        ["gold", "chrome", "galaxy"],
    ],
    [
        ["white", "black", "navy"],
        ["red", "blue", "yellow"],
        ["striped", "checked", "tifo"],
        ["gold", "laurel", "flame"],
    ],
];
/// Out of 100: common, rare, epic, legendary.
pub const PACK_ODDS: [u32; 4] = [70, 22, 7, 1];
pub const PACK_ITEMS: usize = 3;
/// Skill points a worn item adds in a match, by rarity.
pub const ITEM_BONUS: [u8; 4] = [0, 1, 2, 3];
pub const FUSE: usize = 3;

const ITEMS_GAS: Gas = Gas::from_tgas(15);

// The macros generate `ext_items` and `ext_wardrobe`; the traits themselves are not called.
#[allow(dead_code)]
#[ext_contract(ext_items)]
pub trait ItemsContract {
    fn mt_batch_mint(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>);
    fn league_burn(&mut self, owner_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>);
    fn league_take(&mut self, owner_id: AccountId, token_id: String);
    fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    );
}

#[allow(dead_code)]
#[ext_contract(ext_wardrobe)]
pub trait WardrobeCallbacks {
    fn on_fused(&mut self, owner: AccountId, made: String);
    fn on_taken(&mut self, token_id: String, item: String, owner: AccountId);
    fn on_given_back(&mut self, token_id: String, item: String);
}

/// What a footballer wears: an item id per kind.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Look {
    pub hair: Option<String>,
    pub boots: Option<String>,
    pub band: Option<String>,
}

impl Look {
    fn slot(&mut self, kind: usize) -> &mut Option<String> {
        match kind {
            0 => &mut self.hair,
            1 => &mut self.boots,
            _ => &mut self.band,
        }
    }
}

/// A player's skills on the pitch with what he wears: boots add to pace, a
/// headband to physical, by rarity (`ITEM_BONUS`). Hair is looks only.
pub fn dressed(mut skills: Skills, look: &Look) -> Skills {
    let bonus = |item: &Option<String>| {
        item.as_deref()
            .and_then(describe)
            .map_or(0, |(_, rarity)| ITEM_BONUS[rarity])
    };
    skills.raise(Skill::Pace, bonus(&look.boots));
    skills.raise(Skill::Physical, bonus(&look.band));
    skills
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogItem {
    pub id: String,
    pub kind: String,
    pub style: String,
    pub rarity: String,
}

/// `kind.style`, e.g. `hair.mohawk`.
pub fn item_id(kind: usize, rarity: usize, style: usize) -> String {
    format!("{}.{}", KINDS[kind], CATALOG[kind][rarity][style])
}

/// Kind and rarity of an item id, if it is one.
pub fn describe(id: &str) -> Option<(usize, usize)> {
    let (kind, style) = id.split_once('.')?;
    let k = KINDS.iter().position(|x| *x == kind)?;
    let r = CATALOG[k].iter().position(|row| row.contains(&style))?;
    Some((k, r))
}

/// A rarity from a roll of 0 to 99.
pub fn rarity_of(roll: u32) -> usize {
    let mut acc = 0;
    for (r, odds) in PACK_ODDS.iter().enumerate() {
        acc += odds;
        if roll < acc {
            return r;
        }
    }
    RARITIES.len() - 1
}

/// The items of a pack from a seed: a random kind and style each, rarity by the odds.
pub fn open_pack(seed: [u8; 32]) -> Vec<String> {
    (0..PACK_ITEMS)
        .map(|i| {
            let b = |j: usize| seed[(i * 8 + j) % 32] as u32;
            let roll = (b(0) << 8 | b(1)) % 100;
            item_id(
                b(2) as usize % KINDS.len(),
                rarity_of(roll),
                b(3) as usize % 3,
            )
        })
        .collect()
}

/// What three items of a kind and rarity fuse into: that kind, one rarity
/// up, a style from the seed.
pub fn fusion(items: &[String], seed: [u8; 32]) -> Result<String, &'static str> {
    if items.len() != FUSE {
        return Err("fuse exactly three items");
    }
    let mut kinds = items.iter().map(|i| describe(i));
    let Some(Some(first)) = kinds.next() else {
        return Err("not an item");
    };
    if !kinds.all(|k| k == Some(first)) {
        return Err("fuse three items of the same kind and rarity");
    }
    let (kind, rarity) = first;
    if rarity + 1 >= RARITIES.len() {
        return Err("legendary items do not fuse");
    }
    Ok(item_id(kind, rarity + 1, seed[0] as usize % 3))
}

#[near]
impl League {
    /// Every item that exists, by kind and rarity.
    pub fn catalog(&self) -> Vec<CatalogItem> {
        let mut out = Vec::new();
        for (k, kind) in KINDS.iter().enumerate() {
            for (r, rarity) in RARITIES.iter().enumerate() {
                for style in CATALOG[k][r] {
                    out.push(CatalogItem {
                        id: format!("{kind}.{style}"),
                        kind: kind.to_string(),
                        style: style.to_string(),
                        rarity: rarity.to_string(),
                    });
                }
            }
        }
        out
    }

    /// The items of the last pack an account opened or the last fusion it made.
    pub fn last_unboxed(&self, account_id: AccountId) -> Vec<String> {
        self.unboxed.get(&account_id).cloned().unwrap_or_default()
    }

    /// Fuses three of the caller's items of one kind and rarity into one of
    /// the next rarity. The items burn first; the new one is minted after.
    pub fn fuse(&mut self, items: Vec<String>) -> near_sdk::Promise {
        let owner = env::predecessor_account_id();
        self.next_unbox += 1;
        let seed = derive_seed(env::random_seed_array(), &[self.next_unbox, 3]);
        let made = fusion(&items, seed).unwrap_or_else(|e| env::panic_str(e));
        ext_items::ext(self.items_id.clone())
            .with_static_gas(ITEMS_GAS)
            .league_burn(owner.clone(), items, vec![U128(1); FUSE])
            .then(
                ext_wardrobe::ext(env::current_account_id())
                    .with_static_gas(ITEMS_GAS.saturating_add(CALLBACK_GAS))
                    .on_fused(owner, made),
            )
    }

    #[private]
    pub fn on_fused(
        &mut self,
        owner: AccountId,
        made: String,
        #[callback_result] burned: Result<(), PromiseError>,
    ) {
        require!(burned.is_ok(), "you do not hold those three items");
        self.unboxed.insert(owner.clone(), vec![made.clone()]);
        ext_items::ext(self.items_id.clone())
            .with_static_gas(ITEMS_GAS)
            .mt_batch_mint(owner, vec![made], vec![U128(1)])
            .detach();
    }

    /// The person who plays a footballer dresses him: the item goes to the
    /// league while he wears it; what he wore in that slot goes back.
    pub fn equip(&mut self, token_id: String, item: String) -> near_sdk::Promise {
        let owner = env::predecessor_account_id();
        self.require_plays(&token_id, &owner);
        require!(describe(&item).is_some(), "not an item");
        ext_items::ext(self.items_id.clone())
            .with_static_gas(ITEMS_GAS)
            .league_take(owner.clone(), item.clone())
            .then(
                ext_wardrobe::ext(env::current_account_id())
                    .with_static_gas(ITEMS_GAS.saturating_add(CALLBACK_GAS))
                    .on_taken(token_id, item, owner),
            )
    }

    #[private]
    pub fn on_taken(
        &mut self,
        token_id: String,
        item: String,
        owner: AccountId,
        #[callback_result] taken: Result<(), PromiseError>,
    ) {
        require!(taken.is_ok(), "you do not hold that item");
        let (kind, _) = describe(&item).unwrap_or_else(|| env::panic_str("not an item"));
        let Some(p) = self.players.get_mut(&token_id) else {
            self.give_back(&token_id, owner, item);
            return;
        };
        let before = p.look.slot(kind).replace(item);
        if let Some(old) = before {
            self.give_back(&token_id, owner, old);
        }
    }

    /// Takes off what a footballer wears in a slot (`hair`, `boots` or
    /// `band`); the item goes back to the caller.
    pub fn unequip(&mut self, token_id: String, kind: String) {
        let owner = env::predecessor_account_id();
        self.require_plays(&token_id, &owner);
        let k = KINDS
            .iter()
            .position(|x| *x == kind)
            .unwrap_or_else(|| env::panic_str("kind is hair, boots or band"));
        let p = self
            .players
            .get_mut(&token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        let item = p
            .look
            .slot(k)
            .take()
            .unwrap_or_else(|| env::panic_str("he wears nothing there"));
        self.give_back(&token_id, owner, item);
    }

    /// If the item could not be sent back, he wears it again (if that slot
    /// is still free), so it is never lost.
    #[private]
    pub fn on_given_back(
        &mut self,
        token_id: String,
        item: String,
        #[callback_result] sent: Result<(), PromiseError>,
    ) {
        if sent.is_err()
            && let (Some((kind, _)), Some(p)) = (describe(&item), self.players.get_mut(&token_id))
            && p.look.slot(kind).is_none()
        {
            *p.look.slot(kind) = Some(item);
        }
    }

    pub(crate) fn open_pack_for(&mut self, buyer: AccountId, amount: U128) {
        require!(
            amount == crate::the_rules().pack_price,
            "a pack costs exactly pack_price"
        );
        self.next_unbox += 1;
        let items = open_pack(derive_seed(env::random_seed_array(), &[self.next_unbox, 7]));
        self.unboxed.insert(buyer.clone(), items.clone());
        self.log("pack", Some(buyer.clone()), amount.0, false);
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(BURN_GAS)
            .burn(amount, Some("pack".to_string()))
            .detach();
        let n = items.len();
        ext_items::ext(self.items_id.clone())
            .with_static_gas(ITEMS_GAS)
            .mt_batch_mint(buyer, items, vec![U128(1); n])
            .detach();
    }

    fn give_back(&mut self, token_id: &str, owner: AccountId, item: String) {
        ext_items::ext(self.items_id.clone())
            .with_static_gas(ITEMS_GAS)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .mt_transfer(
                owner,
                item.clone(),
                U128(1),
                None,
                Some("taken off".to_string()),
            )
            .then(
                ext_wardrobe::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_given_back(token_id.to_string(), item),
            )
            .detach();
    }

    fn require_plays(&self, token_id: &str, who: &AccountId) {
        let p = self
            .players
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("no such player"));
        require!(
            p.controller.as_ref() == Some(who),
            "only the person who plays him dresses him"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_has_unique_ids_and_describes_them() {
        let mut ids = std::collections::BTreeSet::new();
        for k in 0..3 {
            for r in 0..4 {
                for s in 0..3 {
                    let id = item_id(k, r, s);
                    assert_eq!(describe(&id), Some((k, r)));
                    assert!(ids.insert(id));
                }
            }
        }
        assert_eq!(describe("hair.nope"), None);
        assert_eq!(describe("cape.red"), None);
        assert_eq!(PACK_ODDS.iter().sum::<u32>(), 100);
    }

    #[test]
    fn packs_follow_the_odds() {
        let mut by = [0u32; 4];
        for i in 0..4_000u64 {
            for item in open_pack(derive_seed([9; 32], &[i])) {
                by[describe(&item).unwrap().1] += 1;
            }
        }
        let total: u32 = by.iter().sum();
        assert_eq!(total, 12_000);
        assert!((by[0] * 100 / total).abs_diff(70) <= 3, "{by:?}");
        assert!((by[1] * 100 / total).abs_diff(22) <= 3, "{by:?}");
        assert!(by[3] > 0 && by[3] < by[2], "{by:?}");
    }

    #[test]
    fn three_of_a_kind_fuse_one_rarity_up() {
        let seed = [4; 32];
        let three = |a: &str, b: &str, c: &str| vec![a.to_string(), b.to_string(), c.to_string()];
        let made = fusion(&three("hair.short", "hair.buzz", "hair.short"), seed).unwrap();
        assert_eq!(describe(&made), Some((0, 1)));
        assert!(fusion(&three("hair.short", "boots.black", "hair.buzz"), seed).is_err());
        assert!(fusion(&three("hair.short", "hair.curls", "hair.buzz"), seed).is_err());
        assert!(fusion(&three("hair.fire", "hair.fire", "hair.fire"), seed).is_err());
        assert!(fusion(&three("hair.short", "hair.short", "nope"), seed).is_err());
        assert!(fusion(&["hair.short".to_string()], seed).is_err());
    }
}

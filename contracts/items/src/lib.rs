//! Items (boots, kits, training passes) as NEP-245 multi-tokens.
//!
//! This scaffold covers the core of NEP-245: balances, supply, transfer and
//! batch transfer, with `mt_mint` events. `mt_transfer_call` and the approval
//! extension are not implemented yet. Only the league mints; holders burn
//! their own items when they use them.
//!
//! The league also burns or takes a holder's items, only when that holder
//! asks it to: three items fused into one (`league_burn`), an item worn by
//! his footballer, which the league keeps while he wears it and sends back
//! after (`league_take`). The league has no other power here.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, require, serde_json};

pub type TokenId = String;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Balances,
    Supply,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Items {
    balances: LookupMap<(TokenId, AccountId), u128>,
    supply: LookupMap<TokenId, u128>,
    league_id: AccountId,
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({ "standard": "nep245", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[near]
impl Items {
    #[init]
    pub fn new(league_id: AccountId) -> Self {
        Self {
            balances: LookupMap::new(StorageKey::Balances),
            supply: LookupMap::new(StorageKey::Supply),
            league_id,
        }
    }

    pub fn league_id(&self) -> AccountId {
        self.league_id.clone()
    }

    /// League only: gives `amount` of `token_id` to `owner_id`.
    pub fn mt_mint(&mut self, owner_id: AccountId, token_id: TokenId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league mints items"
        );
        require!(amount.0 > 0, "amount must be positive");
        self.add(&token_id, &owner_id, amount.0);
        *self.supply.entry(token_id.clone()).or_insert(0) += amount.0;
        emit(
            "mt_mint",
            serde_json::json!({ "owner_id": owner_id, "token_ids": [token_id], "amounts": [amount] }),
        );
    }

    /// League only: several items at once (a pack).
    pub fn mt_batch_mint(
        &mut self,
        owner_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
    ) {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league mints items"
        );
        require!(
            token_ids.len() == amounts.len(),
            "token_ids and amounts differ in length"
        );
        for (t, a) in token_ids.iter().zip(&amounts) {
            require!(a.0 > 0, "amount must be positive");
            self.add(t, &owner_id, a.0);
            *self.supply.entry(t.clone()).or_insert(0) += a.0;
        }
        emit(
            "mt_mint",
            serde_json::json!({ "owner_id": owner_id, "token_ids": token_ids, "amounts": amounts }),
        );
    }

    /// League only, when the holder fuses items: burns them.
    pub fn league_burn(
        &mut self,
        owner_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
    ) {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league burns for a holder"
        );
        require!(
            token_ids.len() == amounts.len(),
            "token_ids and amounts differ in length"
        );
        for (t, a) in token_ids.iter().zip(&amounts) {
            self.sub(t, &owner_id, a.0);
            if let Some(s) = self.supply.get_mut(t) {
                *s -= a.0;
            }
        }
        emit(
            "mt_burn",
            serde_json::json!({ "owner_id": owner_id, "token_ids": token_ids, "amounts": amounts, "memo": "fused" }),
        );
    }

    /// League only, when the holder dresses his footballer: the league keeps
    /// the item while he wears it.
    pub fn league_take(&mut self, owner_id: AccountId, token_id: TokenId) {
        let league = env::predecessor_account_id();
        require!(
            league == self.league_id,
            "only the league takes for a holder"
        );
        self.sub(&token_id, &owner_id, 1);
        self.add(&token_id, &league, 1);
        emit(
            "mt_transfer",
            serde_json::json!({
                "old_owner_id": owner_id, "new_owner_id": league,
                "token_ids": [token_id], "amounts": ["1"], "memo": "worn"
            }),
        );
    }

    /// Uses up the caller's own items.
    pub fn mt_burn(&mut self, token_id: TokenId, amount: U128) {
        let owner_id = env::predecessor_account_id();
        self.sub(&token_id, &owner_id, amount.0);
        if let Some(s) = self.supply.get_mut(&token_id) {
            *s -= amount.0;
        }
        emit(
            "mt_burn",
            serde_json::json!({ "owner_id": owner_id, "token_ids": [token_id], "amounts": [amount] }),
        );
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        self.mt_batch_transfer(
            receiver_id,
            vec![token_id],
            vec![amount],
            approval.map(|a| vec![Some(a)]),
            memo,
        );
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        near_sdk::assert_one_yocto();
        require!(approvals.is_none(), "approvals are not supported yet");
        require!(
            token_ids.len() == amounts.len(),
            "token_ids and amounts differ in length"
        );
        let sender_id = env::predecessor_account_id();
        require!(sender_id != receiver_id, "sender and receiver are the same");
        for (token_id, amount) in token_ids.iter().zip(amounts.iter()) {
            require!(amount.0 > 0, "amount must be positive");
            self.sub(token_id, &sender_id, amount.0);
            self.add(token_id, &receiver_id, amount.0);
        }
        emit(
            "mt_transfer",
            serde_json::json!({
                "old_owner_id": sender_id, "new_owner_id": receiver_id,
                "token_ids": token_ids, "amounts": amounts, "memo": memo
            }),
        );
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance(&token_id, &account_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids
            .iter()
            .map(|t| U128(self.balance(t, &account_id)))
            .collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.supply.get(&token_id).map(|s| U128(*s))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    fn balance(&self, token_id: &TokenId, account_id: &AccountId) -> u128 {
        self.balances
            .get(&(token_id.clone(), account_id.clone()))
            .copied()
            .unwrap_or(0)
    }

    fn add(&mut self, token_id: &TokenId, account_id: &AccountId, amount: u128) {
        *self
            .balances
            .entry((token_id.clone(), account_id.clone()))
            .or_insert(0) += amount;
    }

    fn sub(&mut self, token_id: &TokenId, account_id: &AccountId, amount: u128) {
        let key = (token_id.clone(), account_id.clone());
        let have = self.balances.get(&key).copied().unwrap_or(0);
        require!(have >= amount, "not enough items");
        if have == amount {
            self.balances.remove(&key);
        } else {
            self.balances.insert(key, have - amount);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{NearToken, testing_env};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(caller: &str) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(acc(caller))
                .attached_deposit(NearToken::from_yoctonear(1))
                .build()
        );
    }

    #[test]
    fn mint_transfer_burn() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        i.mt_mint(acc("fan.testnet"), "boots".into(), U128(2));
        as_caller("fan.testnet");
        i.mt_transfer(acc("friend.testnet"), "boots".into(), U128(1), None, None);
        i.mt_burn("boots".into(), U128(1));
        assert_eq!(i.mt_balance_of(acc("fan.testnet"), "boots".into()), U128(0));
        assert_eq!(
            i.mt_balance_of(acc("friend.testnet"), "boots".into()),
            U128(1)
        );
        assert_eq!(i.mt_supply("boots".into()), Some(U128(1)));
    }

    #[test]
    fn the_league_mints_packs_burns_fusions_and_keeps_what_is_worn() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        i.mt_batch_mint(
            acc("fan.testnet"),
            vec!["hair.buzz".into(), "boots.red".into()],
            vec![U128(3), U128(1)],
        );
        i.league_burn(
            acc("fan.testnet"),
            vec!["hair.buzz".into(); 3],
            vec![U128(1); 3],
        );
        assert_eq!(i.mt_supply("hair.buzz".into()), Some(U128(0)));
        i.league_take(acc("fan.testnet"), "boots.red".into());
        assert_eq!(
            i.mt_balance_of(acc("fan.testnet"), "boots.red".into()),
            U128(0)
        );
        assert_eq!(
            i.mt_balance_of(acc("league.testnet"), "boots.red".into()),
            U128(1)
        );
        assert_eq!(i.mt_supply("boots.red".into()), Some(U128(1)));
    }

    #[test]
    #[should_panic(expected = "only the league burns for a holder")]
    fn nobody_else_burns_for_a_holder() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        i.mt_mint(acc("fan.testnet"), "boots".into(), U128(1));
        as_caller("attacker.testnet");
        i.league_burn(acc("fan.testnet"), vec!["boots".into()], vec![U128(1)]);
    }

    #[test]
    #[should_panic(expected = "only the league takes for a holder")]
    fn nobody_else_takes() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        i.mt_mint(acc("fan.testnet"), "boots".into(), U128(1));
        as_caller("attacker.testnet");
        i.league_take(acc("fan.testnet"), "boots".into());
    }

    #[test]
    #[should_panic(expected = "only the league mints items")]
    fn nobody_else_mints() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        as_caller("attacker.testnet");
        i.mt_mint(acc("attacker.testnet"), "boots".into(), U128(1));
    }

    #[test]
    #[should_panic(expected = "not enough items")]
    fn cannot_send_what_you_do_not_have() {
        as_caller("league.testnet");
        let mut i = Items::new(acc("league.testnet"));
        as_caller("fan.testnet");
        i.mt_transfer(acc("friend.testnet"), "boots".into(), U128(1), None, None);
    }
}

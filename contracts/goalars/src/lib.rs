//! Goalars (G): the only currency of NEAR Post, a NEP-141 token.
//!
//! Supply rules live in the league contract. This contract only enforces who may
//! create tokens: the league account fixed at init. There is no owner and no
//! upgrade method, so nobody can mint outside the league's rules.
//! Anyone can burn their own tokens; nobody can burn someone else's.
//!
//! Supply is capped at 10 billion G, and the cap is a curve, not a wall: every
//! mint is scaled by the room left, `amount × (cap − supply) / cap`. At 5B a goal
//! mints half as much; burns free room for new mints.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, near, require,
};

/// 1 G in the token's smallest unit (6 decimals).
pub const ONE_G: u128 = 1_000_000;
/// Hard cap: 10 billion G.
pub const MAX_SUPPLY: u128 = 10_000_000_000 * ONE_G;

/// What a mint of `amount` really creates when `supply` already exists.
pub fn scaled_mint(amount: u128, supply: u128) -> u128 {
    let room = MAX_SUPPLY.saturating_sub(supply);
    // amount and room are both <= 1e16, so the product (<= 1e32) fits in u128.
    amount.min(MAX_SUPPLY) * room / MAX_SUPPLY
}

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Goalars {
    token: FungibleToken,
    league_id: AccountId,
}

#[near]
impl Goalars {
    #[init]
    pub fn new(league_id: AccountId) -> Self {
        Self {
            token: FungibleToken::new(StorageKey::Token),
            league_id,
        }
    }

    /// The only account allowed to mint.
    pub fn league_id(&self) -> AccountId {
        self.league_id.clone()
    }

    /// Creates up to `amount` for `account_id`, scaled by the room left under
    /// the cap (see `scaled_mint`), and returns what was really minted. Only the
    /// league calls this: goals, full houses and starter grants. Storage for a
    /// new holder is paid by this contract.
    pub fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) -> U128 {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league mints goalars"
        );
        require!(amount.0 > 0, "amount must be positive");
        let minted = scaled_mint(amount.0, self.token.total_supply);
        if minted == 0 {
            return U128(0);
        }
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, minted);
        FtMint {
            owner_id: &account_id,
            amount: U128(minted),
            memo: memo.as_deref(),
        }
        .emit();
        U128(minted)
    }

    /// The cap, for anyone to read.
    pub fn max_supply(&self) -> U128 {
        U128(MAX_SUPPLY)
    }

    /// Destroys `amount` of the caller's own goalars. The league uses it to burn
    /// training fees, packs, sale taxes and club treasury penalties it holds.
    pub fn burn(&mut self, amount: U128, memo: Option<String>) {
        require!(amount.0 > 0, "amount must be positive");
        let owner_id = env::predecessor_account_id();
        self.token.internal_withdraw(&owner_id, amount.0);
        FtBurn {
            owner_id: &owner_id,
            amount,
            memo: memo.as_deref(),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Goalars {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Goalars {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            FtBurn {
                owner_id: &sender_id,
                amount: U128(burned),
                memo: Some("refund for an unregistered sender"),
            }
            .emit();
        }
        used.into()
    }
}

#[near]
impl FungibleTokenMetadataProvider for Goalars {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Goalars".to_string(),
            symbol: "GOAL".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[near]
impl StorageManagement for Goalars {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(caller: &str) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(acc(caller))
                .build()
        );
    }

    #[test]
    fn the_league_mints_and_supply_follows() {
        as_caller("league.testnet");
        let mut g = Goalars::new(acc("league.testnet"));
        g.mint(acc("fan.testnet"), U128(60 * ONE_G), Some("goal".into()));
        assert_eq!(g.ft_balance_of(acc("fan.testnet")), U128(60 * ONE_G));
        assert_eq!(g.ft_total_supply(), U128(60 * ONE_G));
    }

    #[test]
    fn mints_shrink_as_supply_nears_the_cap() {
        assert_eq!(scaled_mint(6_000_000 * ONE_G, 0), 6_000_000 * ONE_G);
        assert_eq!(
            scaled_mint(6_000_000 * ONE_G, MAX_SUPPLY / 2),
            3_000_000 * ONE_G
        );
        assert_eq!(
            scaled_mint(6_000_000 * ONE_G, MAX_SUPPLY / 10 * 9),
            600_000 * ONE_G
        );
        assert_eq!(scaled_mint(6_000_000 * ONE_G, MAX_SUPPLY), 0);
    }

    #[test]
    fn supply_never_passes_the_cap_and_burns_free_room() {
        as_caller("league.testnet");
        let mut g = Goalars::new(acc("league.testnet"));
        for _ in 0..20 {
            g.mint(acc("whale.testnet"), U128(MAX_SUPPLY / 4), None);
        }
        let supply = g.ft_total_supply().0;
        assert!(supply < MAX_SUPPLY);
        assert!(supply > MAX_SUPPLY / 100 * 99);
        // Asking for more than the cap still never passes it.
        g.mint(acc("whale.testnet"), U128(u128::MAX), None);
        assert!(g.ft_total_supply().0 <= MAX_SUPPLY);
        let supply = g.ft_total_supply().0;
        as_caller("whale.testnet");
        g.burn(U128(supply / 2), None);
        as_caller("league.testnet");
        let room_back = g.mint(acc("fan.testnet"), U128(1_000 * ONE_G), None).0;
        assert!(room_back > 400 * ONE_G && room_back < 600 * ONE_G);
    }

    #[test]
    #[should_panic(expected = "only the league mints goalars")]
    fn nobody_else_can_mint() {
        as_caller("league.testnet");
        let mut g = Goalars::new(acc("league.testnet"));
        as_caller("attacker.testnet");
        g.mint(acc("attacker.testnet"), U128(ONE_G), None);
    }

    #[test]
    fn a_holder_burns_only_their_own_tokens() {
        as_caller("league.testnet");
        let mut g = Goalars::new(acc("league.testnet"));
        g.mint(acc("fan.testnet"), U128(10 * ONE_G), None);
        as_caller("fan.testnet");
        g.burn(U128(4 * ONE_G), Some("training".into()));
        assert_eq!(g.ft_balance_of(acc("fan.testnet")), U128(6 * ONE_G));
        assert_eq!(g.ft_total_supply(), U128(6 * ONE_G));
    }

    #[test]
    #[should_panic]
    fn burning_more_than_you_hold_fails() {
        as_caller("league.testnet");
        let mut g = Goalars::new(acc("league.testnet"));
        g.mint(acc("fan.testnet"), U128(ONE_G), None);
        as_caller("fan.testnet");
        g.burn(U128(2 * ONE_G), None);
    }
}

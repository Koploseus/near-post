//! Players: each footballer is a NEP-171 token (a sticker in the album).
//!
//! The NFT is a player's registration: whoever owns it fields him. A player can
//! also have a controller, the person who plays him; the controller keeps him
//! when his registration is sold.
//!
//! The sell-on clause is written here as a NEP-199 payout, so any market that
//! honours NEP-199 pays it: on every sale, 10% goes to the club that trained the
//! player, 2% to each of his last 3 clubs, 5% to the person who plays him,
//! 3% to the league (which burns it), and the rest to the seller. Only the
//! league mints; there is no owner key.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, PanicOnDefault, Promise, PromiseOrValue, env, ext_contract,
    near, require,
};

#[ext_contract(ext_league)]
pub trait League {
    fn on_player_transferred(
        &mut self,
        token_id: String,
        old_owner: AccountId,
        new_owner: AccountId,
    );
}

const NOTIFY_GAS: Gas = Gas::from_tgas(10);

/// One player to mint, for `nft_mint_batch`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MintArgs {
    pub token_id: TokenId,
    /// The person who plays him, if any (academy players have none).
    pub controller: Option<AccountId>,
    pub owner_id: AccountId,
    pub trained_by: AccountId,
    pub metadata: TokenMetadata,
}

/// Basis points out of 10_000.
pub const TRAINER_BPS: u128 = 1_000;
pub const PAST_CLUB_BPS: u128 = 200;
pub const SALE_TAX_BPS: u128 = 300;
pub const PLAYER_BPS: u128 = 500;
pub const PAST_CLUBS_PAID: usize = 3;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    OwnerById,
    Metadata,
    Enumeration,
    Approvals,
    Career,
}

/// What the sell-on clause needs to know about a player.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Career {
    /// The club that created him (youth pack or academy).
    pub trained_by: AccountId,
    /// Previous owners, most recent last, at most `PAST_CLUBS_PAID`.
    pub past_clubs: Vec<AccountId>,
    /// The person who plays him; gets a share of every sale.
    pub controller: Option<AccountId>,
}

/// NEP-199 payout.
#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Players {
    tokens: NonFungibleToken,
    careers: LookupMap<TokenId, Career>,
    league_id: AccountId,
}

#[near]
impl Players {
    #[init]
    pub fn new(league_id: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                league_id.clone(),
                Some(StorageKey::Metadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approvals),
            ),
            careers: LookupMap::new(StorageKey::Career),
            league_id,
        }
    }

    pub fn league_id(&self) -> AccountId {
        self.league_id.clone()
    }

    /// Creates a player for `owner_id`, trained by `trained_by`. League only.
    /// Storage is paid by this contract.
    pub fn nft_mint(
        &mut self,
        token_id: TokenId,
        owner_id: AccountId,
        trained_by: AccountId,
        metadata: TokenMetadata,
    ) -> Token {
        self.assert_league();
        self.mint_one(token_id, owner_id, trained_by, None, metadata)
    }

    /// Creates several players at once (a new club's academy). League only.
    pub fn nft_mint_batch(&mut self, mints: Vec<MintArgs>) {
        self.assert_league();
        for m in mints {
            self.mint_one(
                m.token_id,
                m.owner_id,
                m.trained_by,
                m.controller,
                m.metadata,
            );
        }
    }

    pub fn career(&self, token_id: TokenId) -> Option<Career> {
        self.careers.get(&token_id).cloned()
    }
}

impl Players {
    fn assert_league(&self) {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league creates players"
        );
    }

    fn mint_one(
        &mut self,
        token_id: TokenId,
        owner_id: AccountId,
        trained_by: AccountId,
        controller: Option<AccountId>,
        metadata: TokenMetadata,
    ) -> Token {
        let token =
            self.tokens
                .internal_mint_with_refund(token_id.clone(), owner_id, Some(metadata), None);
        self.careers.insert(
            token_id,
            Career {
                trained_by,
                past_clubs: Vec::new(),
                controller,
            },
        );
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();
        token
    }

    /// Records the previous owner as a past club and tells the league, which
    /// moves the player between squads.
    fn after_transfer(&mut self, token_id: &TokenId, previous: AccountId, new_owner: AccountId) {
        self.record_past_club(token_id, previous.clone());
        self.notify_league(token_id, previous, new_owner);
    }

    fn notify_league(&self, token_id: &TokenId, old_owner: AccountId, new_owner: AccountId) {
        ext_league::ext(self.league_id.clone())
            .with_static_gas(NOTIFY_GAS)
            .on_player_transferred(token_id.clone(), old_owner, new_owner)
            .detach();
    }
}

#[near]
impl Players {
    /// NEP-199: how `balance` from a sale would be split today.
    pub fn nft_payout(
        &self,
        token_id: TokenId,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let owner_id = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        let career = self
            .careers
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Career not found"));
        let payout = split_sale(balance.0, &owner_id, career, &self.league_id);
        if let Some(max) = max_len_payout {
            require!(
                payout.len() <= max as usize,
                "payout has more receivers than max_len_payout"
            );
        }
        Payout {
            payout: payout.into_iter().map(|(k, v)| (k, U128(v))).collect(),
        }
    }

    /// NEP-199: transfer, then return the split the market must pay.
    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        near_sdk::assert_one_yocto();
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        let previous = self.owner_of(&token_id);
        self.tokens
            .nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.after_transfer(&token_id, previous, receiver_id);
        payout
    }
}

impl Players {
    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"))
    }

    fn record_past_club(&mut self, token_id: &TokenId, club: AccountId) {
        if let Some(career) = self.careers.get_mut(token_id) {
            career.past_clubs.push(club);
            if career.past_clubs.len() > PAST_CLUBS_PAID {
                career.past_clubs.remove(0);
            }
        }
    }
}

/// The sell-on clause. Amounts to the same account add up. The seller gets the rest.
pub fn split_sale(
    balance: u128,
    seller: &AccountId,
    career: &Career,
    league_id: &AccountId,
) -> HashMap<AccountId, u128> {
    let mut out: HashMap<AccountId, u128> = HashMap::new();
    let mut paid = 0u128;
    let mut pay = |to: &AccountId, bps: u128, out: &mut HashMap<AccountId, u128>| {
        let amount = balance * bps / 10_000;
        if amount > 0 && to != seller {
            *out.entry(to.clone()).or_default() += amount;
            paid += amount;
        }
    };
    pay(&career.trained_by, TRAINER_BPS, &mut out);
    for club in career.past_clubs.iter().rev().take(PAST_CLUBS_PAID) {
        pay(club, PAST_CLUB_BPS, &mut out);
    }
    if let Some(controller) = &career.controller {
        pay(controller, PLAYER_BPS, &mut out);
    }
    pay(league_id, SALE_TAX_BPS, &mut out);
    *out.entry(seller.clone()).or_default() += balance - paid;
    out
}

#[near]
impl NonFungibleTokenCore for Players {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        let previous = self.owner_of(&token_id);
        self.tokens
            .nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.after_transfer(&token_id, previous, receiver_id);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let previous = self.owner_of(&token_id);
        self.after_transfer(&token_id, previous, receiver_id.clone());
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Players {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id.clone(),
            receiver_id.clone(),
            token_id.clone(),
            approved_account_ids,
        );
        if !kept {
            self.notify_league(&token_id, receiver_id, previous_owner_id.clone());
        }
        // The receiver gave it back: the previous owner is the owner again,
        // so he is not a past club.
        if !kept
            && let Some(career) = self.careers.get_mut(&token_id)
            && career.past_clubs.last() == Some(&previous_owner_id)
        {
            career.past_clubs.pop();
        }
        kept
    }
}

/// NEP-178: an owner can approve an account (a market, the league) to
/// transfer a player. Approving the league with `{"accept": <offer id>}` as
/// `msg` sells to that offer.
#[near]
impl NonFungibleTokenApproval for Players {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Players {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Players {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "NEAR Post Players".to_string(),
            symbol: "PLAYER".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
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

    fn meta(title: &str) -> TokenMetadata {
        TokenMetadata {
            title: Some(title.into()),
            description: None,
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: None,
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        }
    }

    fn setup() -> Players {
        as_caller("league.testnet");
        let mut p = Players::new(acc("league.testnet"));
        p.nft_mint(
            "duval".into(),
            acc("rive-nord.testnet"),
            acc("rive-nord.testnet"),
            meta("Matteo Duval"),
        );
        p
    }

    #[test]
    fn first_sale_pays_trainer_nothing_when_trainer_sells() {
        let p = setup();
        let out = p.nft_payout("duval".into(), U128(800), None).payout;
        // Seller is the trainer: no 10% to himself, 3% tax, rest to him.
        assert_eq!(out[&acc("league.testnet")], U128(24));
        assert_eq!(out[&acc("rive-nord.testnet")], U128(776));
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn later_sale_pays_trainer_past_clubs_and_tax() {
        let mut p = setup();
        as_caller("rive-nord.testnet");
        p.nft_transfer(acc("cite-phare.testnet"), "duval".into(), None, None);
        as_caller("cite-phare.testnet");
        p.nft_transfer(acc("port-lune.testnet"), "duval".into(), None, None);
        let out = p.nft_payout("duval".into(), U128(1_000), None).payout;
        assert_eq!(out[&acc("rive-nord.testnet")], U128(100 + 20)); // trainer + past club
        assert_eq!(out[&acc("cite-phare.testnet")], U128(20));
        assert_eq!(out[&acc("league.testnet")], U128(30));
        assert_eq!(out[&acc("port-lune.testnet")], U128(830));
        let total: u128 = out.values().map(|v| v.0).sum();
        assert_eq!(total, 1_000);
    }

    #[test]
    fn only_the_last_three_clubs_are_paid() {
        let mut p = setup();
        let clubs = [
            "a.testnet",
            "b.testnet",
            "c.testnet",
            "d.testnet",
            "e.testnet",
        ];
        let mut owner = "rive-nord.testnet".to_string();
        for c in clubs {
            as_caller(&owner);
            p.nft_transfer(acc(c), "duval".into(), None, None);
            owner = c.to_string();
        }
        let career = p.career("duval".into()).unwrap();
        assert_eq!(
            career.past_clubs,
            vec![acc("b.testnet"), acc("c.testnet"), acc("d.testnet")]
        );
    }

    #[test]
    #[should_panic(expected = "only the league creates players")]
    fn nobody_else_can_create_players() {
        let mut p = setup();
        as_caller("attacker.testnet");
        p.nft_mint(
            "fake".into(),
            acc("attacker.testnet"),
            acc("attacker.testnet"),
            meta("Fake"),
        );
    }

    #[test]
    #[should_panic(expected = "max_len_payout")]
    fn payout_respects_max_len() {
        let mut p = setup();
        as_caller("rive-nord.testnet");
        p.nft_transfer(acc("cite-phare.testnet"), "duval".into(), None, None);
        p.nft_payout("duval".into(), U128(1_000), Some(1));
    }

    #[test]
    fn the_league_mints_a_batch() {
        let mut p = setup();
        let mints = (0..11)
            .map(|i| MintArgs {
                token_id: format!("p{i}"),
                controller: None,
                owner_id: acc("club.testnet"),
                trained_by: acc("club.testnet"),
                metadata: meta(&format!("Player {i}")),
            })
            .collect();
        p.nft_mint_batch(mints);
        assert_eq!(p.nft_supply_for_owner(acc("club.testnet")), U128(11));
        assert_eq!(p.nft_total_supply(), U128(12));
        assert_eq!(
            p.career("p3".into()).unwrap().trained_by,
            acc("club.testnet")
        );
    }

    #[test]
    #[should_panic(expected = "only the league creates players")]
    fn nobody_else_mints_a_batch() {
        let mut p = setup();
        as_caller("attacker.testnet");
        p.nft_mint_batch(vec![]);
    }

    #[test]
    fn the_person_who_plays_him_gets_five_percent_of_a_sale() {
        let mut p = setup();
        p.nft_mint_batch(vec![MintArgs {
            token_id: "kop".into(),
            controller: Some(acc("koplo.testnet")),
            owner_id: acc("rive-nord.testnet"),
            trained_by: acc("koplo.testnet"),
            metadata: meta("Koplo"),
        }]);
        let out = p.nft_payout("kop".into(), U128(1_000), None).payout;
        // Trainer and controller are the same person: 10% + 5%.
        assert_eq!(out[&acc("koplo.testnet")], U128(150));
        assert_eq!(out[&acc("league.testnet")], U128(30));
        assert_eq!(out[&acc("rive-nord.testnet")], U128(820));
    }

    #[test]
    fn an_approved_market_sells_with_the_payout() {
        let mut p = setup();
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(acc("rive-nord.testnet"))
                .attached_deposit(NearToken::from_millinear(10))
                .build()
        );
        p.nft_approve("duval".into(), acc("league.testnet"), None);
        assert!(p.nft_is_approved("duval".into(), acc("league.testnet"), None));
        as_caller("league.testnet");
        let out = p
            .nft_transfer_payout(
                acc("cite-phare.testnet"),
                "duval".into(),
                Some(1),
                None,
                U128(1_000),
                Some(10),
            )
            .payout;
        assert_eq!(
            p.nft_token("duval".into()).unwrap().owner_id,
            acc("cite-phare.testnet")
        );
        let total: u128 = out.values().map(|v| v.0).sum();
        assert_eq!(total, 1_000);
        // The approval is consumed by the transfer.
        assert!(!p.nft_is_approved("duval".into(), acc("league.testnet"), None));
    }

    #[test]
    #[should_panic(expected = "Sender not approved")]
    fn an_unapproved_market_cannot_sell() {
        let mut p = setup();
        as_caller("league.testnet");
        p.nft_transfer_payout(acc("x.testnet"), "duval".into(), None, None, U128(1), None);
    }
}

//! Players: each footballer is a NEP-171 token (a sticker in the album).
//!
//! The sell-on clause is written here as a NEP-199 payout, so any market that
//! honours NEP-199 pays it: on every sale, 10% goes to the club that trained the
//! player, 2% to each of his last 3 clubs, 3% to the league (which burns it),
//! and the rest to the seller. Only the league mints; there is no owner key.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue, env, near, require};

/// Basis points out of 10_000.
pub const TRAINER_BPS: u128 = 1_000;
pub const PAST_CLUB_BPS: u128 = 200;
pub const SALE_TAX_BPS: u128 = 300;
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
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league creates players"
        );
        let token =
            self.tokens
                .internal_mint_with_refund(token_id.clone(), owner_id, Some(metadata), None);
        self.careers.insert(
            token_id,
            Career {
                trained_by,
                past_clubs: Vec::new(),
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

    pub fn career(&self, token_id: TokenId) -> Option<Career> {
        self.careers.get(&token_id).cloned()
    }

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
            .nft_transfer(receiver_id, token_id.clone(), approval_id, memo);
        self.record_past_club(&token_id, previous);
        payout
    }

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
            .nft_transfer(receiver_id, token_id.clone(), approval_id, memo);
        self.record_past_club(&token_id, previous);
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
        self.record_past_club(&token_id, previous);
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
            receiver_id,
            token_id.clone(),
            approved_account_ids,
        );
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
}

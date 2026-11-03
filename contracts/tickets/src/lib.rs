//! Season tickets: each one is a NEP-171 token that holds its own G.
//!
//! A club sells at most 50 season tickets a season, through the league (the
//! price goes to the club's treasury). Every time the club's stand is full,
//! the league mints G to this contract and credits the club's tickets of that
//! season: each ticket's share is written in an index, so a credit costs the
//! same however many tickets there are, and a ticket bought later does not
//! get what was paid before it.
//!
//! The G belong to the token, not to an account: `withdraw` pays them to
//! whoever owns the ticket at that moment, and only him. Sell the ticket and
//! its balance, its earnings to come and its access (the fan zone) go to the
//! buyer; the transfer clears the old owner's approvals, so he keeps nothing.
//! Only the league mints and credits; there is no owner key.

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
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, env, ext_contract, near, require,
};

#[ext_contract(ext_goalars)]
pub trait Goalars {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_self)]
pub trait SelfCallbacks {
    fn on_withdrawn(&mut self, token_id: TokenId, amount: U128);
}

const TRANSFER_GAS: Gas = Gas::from_tgas(10);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    OwnerById,
    Metadata,
    Enumeration,
    Approvals,
    Info,
    Index,
    Count,
}

/// What makes a token a season ticket.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct TicketInfo {
    pub club: AccountId,
    pub season: u32,
    /// 1 to 50 for its club and season.
    pub number: u32,
    /// The club's index (G per ticket, cumulative) when it was minted.
    start: u128,
    /// G paid out of it so far.
    withdrawn: u128,
}

/// A season ticket as anyone can read it.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SeasonTicket {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub club: AccountId,
    pub season: u32,
    pub number: u32,
    /// G it holds now (withdrawable by its owner).
    pub balance: U128,
    /// G it has earned since it was minted.
    pub earned: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Tickets {
    tokens: NonFungibleToken,
    league_id: AccountId,
    goalars_id: AccountId,
    info: LookupMap<TokenId, TicketInfo>,
    /// (club, season) -> G credited per ticket, cumulative.
    index: LookupMap<(AccountId, u32), u128>,
    /// (club, season) -> tickets minted.
    count: LookupMap<(AccountId, u32), u32>,
}

#[near]
impl Tickets {
    #[init]
    pub fn new(league_id: AccountId, goalars_id: AccountId) -> Self {
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                league_id.clone(),
                Some(StorageKey::Metadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approvals),
            ),
            league_id,
            goalars_id,
            info: LookupMap::new(StorageKey::Info),
            index: LookupMap::new(StorageKey::Index),
            count: LookupMap::new(StorageKey::Count),
        }
    }

    pub fn league_id(&self) -> AccountId {
        self.league_id.clone()
    }

    /// A ticket sold by the league. Storage is paid by this contract.
    pub fn mint(
        &mut self,
        token_id: TokenId,
        owner_id: AccountId,
        club: AccountId,
        season: u32,
        number: u32,
        metadata: TokenMetadata,
    ) -> Token {
        self.assert_league();
        let key = (club.clone(), season);
        let start = self.index.get(&key).copied().unwrap_or(0);
        *self.count.entry(key).or_insert(0) += 1;
        self.info.insert(
            token_id.clone(),
            TicketInfo {
                club,
                season,
                number,
                start,
                withdrawn: 0,
            },
        );
        let token = self
            .tokens
            .internal_mint_with_refund(token_id, owner_id, Some(metadata), None);
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();
        token
    }

    /// The league minted `amount` G to this contract for a club's tickets of
    /// `season` (a full house): each ticket of that club and season gets an
    /// equal share. The rounding dust stays here.
    pub fn credit(&mut self, season: u32, shares: Vec<(AccountId, U128)>) {
        self.assert_league();
        for (club, amount) in shares {
            let key = (club, season);
            let n = self.count.get(&key).copied().unwrap_or(0) as u128;
            if n == 0 {
                continue;
            }
            *self.index.entry(key).or_insert(0) += amount.0 / n;
        }
    }

    /// Pays the ticket's balance to its owner (the caller). One yoctoNEAR.
    #[payable]
    pub fn withdraw(&mut self, token_id: TokenId) -> Promise {
        near_sdk::assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(
            env::predecessor_account_id() == owner,
            "only the ticket's owner withdraws"
        );
        let amount = self.balance_of(&token_id);
        require!(amount > 0, "nothing to withdraw");
        if let Some(i) = self.info.get_mut(&token_id) {
            i.withdrawn += amount;
        }
        ext_goalars::ext(self.goalars_id.clone())
            .with_static_gas(TRANSFER_GAS)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .ft_transfer(
                owner,
                U128(amount),
                Some(format!("season ticket {token_id}")),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_withdrawn(token_id, U128(amount)),
            )
    }

    /// Puts the G back in the ticket if the transfer failed (an owner not
    /// registered with goalars).
    #[private]
    pub fn on_withdrawn(
        &mut self,
        token_id: TokenId,
        amount: U128,
        #[callback_result] paid: Result<(), PromiseError>,
    ) {
        if paid.is_err()
            && let Some(i) = self.info.get_mut(&token_id)
        {
            i.withdrawn -= amount.0;
        }
    }

    pub fn ticket(&self, token_id: TokenId) -> Option<SeasonTicket> {
        let i = self.info.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        let index = self
            .index
            .get(&(i.club.clone(), i.season))
            .copied()
            .unwrap_or(0);
        Some(SeasonTicket {
            token_id: token_id.clone(),
            owner_id,
            club: i.club.clone(),
            season: i.season,
            number: i.number,
            balance: U128(index - i.start - i.withdrawn),
            earned: U128(index - i.start),
        })
    }

    /// The tickets an account holds, with their balances.
    pub fn tickets_of(&self, account_id: AccountId) -> Vec<SeasonTicket> {
        self.tokens
            .nft_tokens_for_owner(account_id, None, Some(100))
            .into_iter()
            .filter_map(|t| self.ticket(t.token_id))
            .collect()
    }

    /// How many tickets a club sold for a season.
    pub fn sold(&self, club: AccountId, season: u32) -> u32 {
        self.count.get(&(club, season)).copied().unwrap_or(0)
    }
}

impl Tickets {
    fn assert_league(&self) {
        require!(
            env::predecessor_account_id() == self.league_id,
            "only the league mints and credits season tickets"
        );
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"))
    }

    fn balance_of(&self, token_id: &TokenId) -> u128 {
        let Some(i) = self.info.get(token_id) else {
            return 0;
        };
        let index = self
            .index
            .get(&(i.club.clone(), i.season))
            .copied()
            .unwrap_or(0);
        index - i.start - i.withdrawn
    }
}

#[near]
impl NonFungibleTokenCore for Tickets {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
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
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Tickets {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenApproval for Tickets {
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
impl NonFungibleTokenEnumeration for Tickets {
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
impl NonFungibleTokenMetadataProvider for Tickets {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "NEAR Post Season Tickets".to_string(),
            symbol: "SEASON".to_string(),
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
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(caller: &str) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc("tickets.testnet"))
                .predecessor_account_id(acc(caller))
                .attached_deposit(NearToken::from_yoctonear(1))
                .account_balance(NearToken::from_near(100))
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

    fn contract() -> Tickets {
        as_caller("league.testnet");
        Tickets::new(acc("league.testnet"), acc("goalars.testnet"))
    }

    fn sell(t: &mut Tickets, id: &str, owner: &str, club: &str, n: u32) {
        as_caller("league.testnet");
        t.mint(
            id.into(),
            acc(owner),
            acc(club),
            1,
            n,
            meta("Season ticket"),
        );
    }

    #[test]
    fn a_credit_is_shared_equally_and_later_tickets_start_from_now() {
        let mut t = contract();
        sell(&mut t, "a", "ada.testnet", "club.testnet", 1);
        sell(&mut t, "b", "bob.testnet", "club.testnet", 2);
        as_caller("league.testnet");
        t.credit(1, vec![(acc("club.testnet"), U128(1_000))]);
        assert_eq!(t.ticket("a".into()).unwrap().balance, U128(500));
        sell(&mut t, "c", "cid.testnet", "club.testnet", 3);
        assert_eq!(t.ticket("c".into()).unwrap().balance, U128(0));
        as_caller("league.testnet");
        t.credit(1, vec![(acc("club.testnet"), U128(300))]);
        assert_eq!(t.ticket("a".into()).unwrap().balance, U128(600));
        assert_eq!(t.ticket("c".into()).unwrap().balance, U128(100));
        assert_eq!(t.sold(acc("club.testnet"), 1), 3);
        // Another club or season is not credited.
        as_caller("league.testnet");
        t.credit(2, vec![(acc("club.testnet"), U128(900))]);
        assert_eq!(t.ticket("a".into()).unwrap().balance, U128(600));
    }

    #[test]
    fn the_balance_moves_with_the_ticket_and_only_its_owner_withdraws() {
        let mut t = contract();
        sell(&mut t, "a", "ada.testnet", "club.testnet", 1);
        as_caller("league.testnet");
        t.credit(1, vec![(acc("club.testnet"), U128(800))]);
        as_caller("ada.testnet");
        t.nft_transfer(acc("bob.testnet"), "a".into(), None, None);
        let ticket = t.ticket("a".into()).unwrap();
        assert_eq!(ticket.owner_id, acc("bob.testnet"));
        assert_eq!(ticket.balance, U128(800));
        as_caller("ada.testnet");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = t.withdraw("a".into());
        }));
        assert!(r.is_err(), "the old owner cannot withdraw");
        as_caller("bob.testnet");
        let _ = t.withdraw("a".into());
        assert_eq!(t.ticket("a".into()).unwrap().balance, U128(0));
        assert_eq!(t.ticket("a".into()).unwrap().earned, U128(800));
        // A failed transfer puts the G back.
        as_caller("tickets.testnet");
        t.on_withdrawn("a".into(), U128(800), Err(PromiseError::Failed));
        assert_eq!(t.ticket("a".into()).unwrap().balance, U128(800));
    }

    #[test]
    fn only_the_league_mints_and_credits() {
        let mut t = contract();
        as_caller("ada.testnet");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.credit(1, vec![(acc("club.testnet"), U128(1))]);
        }));
        assert!(r.is_err());
        as_caller("ada.testnet");
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            t.mint(
                "x".into(),
                acc("ada.testnet"),
                acc("club.testnet"),
                1,
                1,
                meta("x"),
            );
        }));
        assert!(r.is_err());
    }
}

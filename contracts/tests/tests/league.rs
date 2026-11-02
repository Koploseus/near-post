//! Sandbox tests: the four contracts deployed together on a local nearcore,
//! from the checked-in wasm in contracts/res.

use anyhow::Result;
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};

const MATCH_INTERVAL_MS: u64 = 240_000;
const HALF_MS: u64 = 60_000;
const ONE_G: u128 = 1_000_000;

/// The drill attester of these tests (the relay holds the real one).
fn attester() -> SigningKey {
    SigningKey::from_bytes(&[7; 32])
}

fn attester_public_key() -> String {
    format!(
        "ed25519:{}",
        bs58::encode(attester().verifying_key().as_bytes()).into_string()
    )
}

struct Game {
    worker: Worker<Sandbox>,
    league: Contract,
    goalars: Contract,
    players: Contract,
}

async fn deploy() -> Result<Game> {
    let worker = near_workspaces::sandbox().await?;
    let wasm =
        |name: &str| std::fs::read(format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR")));
    let league = worker.dev_deploy(&wasm("league")?).await?;
    let goalars = worker.dev_deploy(&wasm("goalars")?).await?;
    let players = worker.dev_deploy(&wasm("players")?).await?;
    let items = worker.dev_deploy(&wasm("items")?).await?;
    for c in [&goalars, &players, &items] {
        c.call("new")
            .args_json(json!({ "league_id": league.id() }))
            .transact()
            .await?
            .into_result()?;
    }
    league
        .call("new")
        .args_json(json!({
            "goalars_id": goalars.id(),
            "players_id": players.id(),
            "items_id": items.id(),
            "match_interval_ms": MATCH_INTERVAL_MS.to_string(),
            "half_ms": HALF_MS.to_string(),
            "half_time_ms": HALF_MS.to_string(),
            "attester": attester_public_key(),
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(Game {
        worker,
        league,
        goalars,
        players,
    })
}

impl Game {
    async fn account(&self) -> Result<Account> {
        Ok(self.worker.dev_create_account().await?)
    }

    async fn call(
        &self,
        who: &Account,
        method: &str,
        args: Value,
    ) -> Result<near_workspaces::result::ExecutionFinalResult> {
        Ok(who
            .call(self.league.id(), method)
            .args_json(args)
            .gas(Gas::from_tgas(300))
            .transact()
            .await?)
    }

    async fn view(&self, method: &str, args: Value) -> Result<Value> {
        Ok(self.league.view(method).args_json(args).await?.json()?)
    }

    async fn balance(&self, who: &str) -> Result<u128> {
        let v: String = self
            .goalars
            .view("ft_balance_of")
            .args_json(json!({ "account_id": who }))
            .await?
            .json()?;
        Ok(v.parse()?)
    }

    async fn supply(&self) -> Result<u128> {
        let v: String = self.goalars.view("ft_total_supply").await?.json()?;
        Ok(v.parse()?)
    }

    /// Moves the chain past the next match time.
    async fn wait_for_match_day(&self) -> Result<()> {
        let due: u64 = self.view("schedule", json!({})).await?["next_match_at_ms"]
            .as_str()
            .unwrap()
            .parse()?;
        loop {
            let now_ms = self.worker.view_block().await?.timestamp() / 1_000_000;
            if now_ms >= due {
                return Ok(());
            }
            self.worker.fast_forward(200).await?;
        }
    }
}

impl Game {
    /// Plays a whole match day: the first half at kick-off, the second after
    /// half-time. Returns both calls (the second one settles the day).
    async fn play_day(
        &self,
        caller: &Account,
    ) -> Result<(
        near_workspaces::result::ExecutionFinalResult,
        near_workspaces::result::ExecutionFinalResult,
    )> {
        self.wait_for_match_day().await?;
        let first = self.call(caller, "play_match_day", json!({})).await?;
        self.wait_for_match_day().await?;
        let second = self.call(caller, "play_match_day", json!({})).await?;
        Ok((first, second))
    }
}

/// Gas burnt by the league itself in a call, in Tgas.
fn league_gas(
    r: &near_workspaces::result::ExecutionFinalResult,
    league: &near_workspaces::AccountId,
) -> u64 {
    r.receipt_outcomes()
        .iter()
        .filter(|o| o.executor_id == *league)
        .map(|o| o.gas_burnt.as_tgas())
        .max()
        .unwrap_or(0)
}

fn g(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn a_match_day_end_to_end() -> Result<()> {
    let game = deploy().await?;
    let (home, away) = (game.account().await?, game.account().await?);
    let created = game
        .call(&home, "create_club", json!({ "name": "Rive Nord" }))
        .await?;
    println!(
        "create_club with its academy: {} Tgas",
        created.total_gas_burnt.as_tgas()
    );
    created.into_result()?;
    game.call(&away, "create_club", json!({ "name": "Port-Lune" }))
        .await?
        .into_result()?;

    // Each club got eleven player NFTs, and the league knows them.
    for club in [&home, &away] {
        let nfts: String = game
            .players
            .view("nft_supply_for_owner")
            .args_json(json!({ "account_id": club.id() }))
            .await?
            .json()?;
        assert_eq!(nfts, "11");
        let squad = game
            .view("squad", json!({ "account_id": club.id() }))
            .await?;
        assert_eq!(squad.as_array().unwrap().len(), 11);
    }

    // Three fans for Rive Nord, two come: a full house (target 2 of 3).
    let mut fans = Vec::new();
    for _ in 0..3 {
        let f = game.account().await?;
        game.call(&f, "follow", json!({ "club_id": home.id() }))
            .await?
            .into_result()?;
        fans.push(f);
    }
    for f in &fans[..2] {
        game.call(f, "check_in", json!({})).await?.into_result()?;
    }
    // Signup 1M + one welcome bonus 1M, already minted, each scaled by the cap
    // curve (supply is a few million out of 10B, so a hair under nominal).
    let near = |got: u128, nominal: u128| got <= nominal && got > nominal / 1_000 * 999;
    assert!(near(
        game.balance(fans[0].id().as_str()).await?,
        2_000_000 * ONE_G
    ));
    assert!(near(
        game.balance(fans[2].id().as_str()).await?,
        1_000_000 * ONE_G
    ));

    // Too early: refused.
    let early = game.call(&home, "play_match_day", json!({})).await?;
    assert!(early.is_failure());

    let supply_before = game.supply().await?;
    let (first, played) = game.play_day(&fans[2]).await?;
    first.into_result()?;
    println!(
        "2-club match day: {} Tgas",
        played.total_gas_burnt.as_tgas()
    );
    let results: Value = played.clone().into_result()?.json()?;
    let m = &results[0];
    println!(
        "result: {} {}-{} {}",
        m["home"], m["home_goals"], m["away_goals"], m["away"]
    );

    // Club shares reached the treasuries through the callback, and the league
    // holds exactly what the treasuries say.
    let mut treasuries = 0u128;
    for id in [home.id(), away.id()] {
        treasuries += g(&game.view("get_club", json!({ "club_id": id })).await?["treasury"]);
    }
    assert_eq!(game.balance(game.league.id().as_str()).await?, treasuries);
    assert_eq!(game.supply().await? - supply_before, treasuries);

    let stand = game
        .view(
            "stand_result",
            json!({ "club_id": home.id(), "match_day": 1 }),
        )
        .await?;
    assert_eq!(stand["full_house"], true);

    // A fan who came claims; one who stayed home cannot.
    game.call(
        &fans[0],
        "claim_stand",
        json!({ "club_id": home.id(), "match_day": 1 }),
    )
    .await?
    .into_result()?;
    assert!(
        game.call(
            &fans[2],
            "claim_stand",
            json!({ "club_id": home.id(), "match_day": 1 })
        )
        .await?
        .is_failure()
    );
    // The claim mints exactly the 10B curve's share of 100k at today's supply.
    let before = game.balance(fans[0].id().as_str()).await?;
    let supply = game.supply().await?;
    game.call(&fans[0], "claim", json!({}))
        .await?
        .into_result()?;
    let cap = 10_000_000_000 * ONE_G;
    assert_eq!(
        game.balance(fans[0].id().as_str()).await? - before,
        100_000 * ONE_G * (cap - supply) / cap
    );

    // Every goal is in a named player's wallet; his owner claims it.
    for goal in m["goals"].as_array().unwrap() {
        assert!(!goal["name"].as_str().unwrap().is_empty());
    }
    let scorer = m["goals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["kind"] != "Own")
        .map(|g| g["player"].as_str().unwrap().to_string());
    if let Some(token) = scorer {
        let player = game
            .view("get_player", json!({ "token_id": token }))
            .await?;
        let owner = player["owner"].as_str().unwrap().to_string();
        let wallet = g(&player["wallet"]);
        assert!(wallet > 0);
        let manager = if owner == home.id().as_str() {
            &home
        } else {
            &away
        };
        let before = game.balance(&owner).await?;
        game.call(manager, "claim_player", json!({ "token_id": token }))
            .await?
            .into_result()?;
        let got = game.balance(&owner).await? - before;
        assert!(got > 0 && got <= wallet);
        // A stranger cannot.
        assert!(
            game.call(&fans[2], "claim_player", json!({ "token_id": token }))
                .await?
                .is_failure()
        );
    }

    // A transfer in the players contract moves the player between squads.
    let token = game
        .view("squad", json!({ "account_id": home.id() }))
        .await?[10]["token_id"]
        .as_str()
        .unwrap()
        .to_string();
    home.call(game.players.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": away.id(), "token_id": token }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let squad_len = |v: Value| v.as_array().unwrap().len();
    assert_eq!(
        squad_len(
            game.view("squad", json!({ "account_id": home.id() }))
                .await?
        ),
        10
    );
    assert_eq!(
        squad_len(
            game.view("squad", json!({ "account_id": away.id() }))
                .await?
        ),
        12
    );
    assert_eq!(
        game.view("get_player", json!({ "token_id": token }))
            .await?["owner"],
        json!(away.id())
    );
    Ok(())
}

#[tokio::test]
async fn a_full_league_match_day_fits_in_one_transaction() -> Result<()> {
    let game = deploy().await?;
    let mut managers = Vec::new();
    for i in 0..32 {
        let m = game.account().await?;
        game.call(&m, "create_club", json!({ "name": format!("Club {i}") }))
            .await?
            .into_result()?;
        // One fan per club; the even clubs' fans come.
        let f = game.account().await?;
        game.call(&f, "follow", json!({ "club_id": m.id() }))
            .await?
            .into_result()?;
        if i % 2 == 0 {
            game.call(&f, "check_in", json!({})).await?.into_result()?;
        }
        // One club in four also has a person in its squad, who votes for himself.
        if i % 4 == 0 {
            let person = game.account().await?;
            let player = game
                .call(
                    &person,
                    "create_footballer",
                    json!({ "name": format!("Person {i}"), "position": "Fw" }),
                )
                .await?
                .into_result()?
                .json::<Value>()?;
            person
                .call(game.players.id(), "nft_transfer")
                .args_json(json!({ "receiver_id": m.id(), "token_id": player["token_id"] }))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(100))
                .transact()
                .await?
                .into_result()?;
            game.call(
                &person,
                "vote_captain",
                json!({ "candidate": player["token_id"] }),
            )
            .await?
            .into_result()?;
            game.call(&person, "report_for_match", json!({}))
                .await?
                .into_result()?;
        }
        managers.push(m);
    }
    // A full week: the last day also elects 32 captains.
    let mut worst = 0;
    for day in 1..=7 {
        let (first, played) = game.play_day(&managers[0]).await?;
        let (h1, h2) = (
            league_gas(&first, game.league.id()),
            league_gas(&played, game.league.id()),
        );
        println!(
            "32-club match day {day}: first half {h1} Tgas, second half and settlement {h2} Tgas ({} in total)",
            played.total_gas_burnt.as_tgas()
        );
        first.into_result()?;
        played.into_result()?;
        worst = worst.max(h1).max(h2);
    }
    println!("worst 32-club match day: {worst} Tgas in the league call");
    assert!(worst < 250, "match day too close to the 300 Tgas limit");
    let captain = game
        .view("captain", json!({ "club_id": managers[0].id() }))
        .await?;
    assert_eq!(captain["votes"], 1);
    let table = game.view("table", json!({})).await?;
    assert_eq!(table.as_array().unwrap().len(), 32);
    let total: String = game.players.view("nft_total_supply").await?.json()?;
    assert_eq!(total, "360");
    Ok(())
}

#[tokio::test]
async fn a_person_signs_trains_and_plays() -> Result<()> {
    let game = deploy().await?;
    let club = game.account().await?;
    let rival = game.account().await?;
    for (c, name) in [(&club, "Rive Nord"), (&rival, "Port-Lune")] {
        game.call(c, "create_club", json!({ "name": name }))
            .await?
            .into_result()?;
    }
    // Koplo creates his footballer: a free agent, NFT in his own name.
    let koplo = game.account().await?;
    let me = game
        .call(
            &koplo,
            "create_footballer",
            json!({ "name": "Koplo", "position": "Fw" }),
        )
        .await?
        .into_result()?
        .json::<Value>()?;
    let token = me["token_id"].as_str().unwrap().to_string();
    let owner: Value = game
        .players
        .view("nft_token")
        .args_json(json!({ "token_id": token }))
        .await?
        .json()?;
    assert_eq!(owner["owner_id"], json!(koplo.id()));

    // He signs for Rive Nord by giving it his registration.
    koplo
        .call(game.players.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": club.id(), "token_id": token }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let squad = game
        .view("squad", json!({ "account_id": club.id() }))
        .await?;
    assert_eq!(squad.as_array().unwrap().len(), 12);

    // He trains his pace: 400k G sent to the league and burned, a ticket
    // opens; the attester signs his drill score (3) and the points land.
    let before = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    let supply = game.supply().await?;
    koplo
        .call(game.goalars.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": game.league.id(),
            "amount": (400_000 * ONE_G).to_string(),
            "msg": json!({ "train": { "token_id": token, "skill": "pace" } }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    let ticket = game
        .view("training_ticket", json!({ "token_id": token }))
        .await?;
    assert_eq!(ticket["skill"], json!("pace"));
    let message = format!(
        "near-post:train:{}:{}:{}:3",
        game.league.id(),
        token,
        ticket["id"]
    );
    let signature = attester().sign(message.as_bytes()).to_bytes();
    let anyone = game.account().await?;
    game.call(
        &anyone,
        "finish_training",
        json!({
            "token_id": token,
            "points": 3,
            "signature": base64_encode(&signature),
        }),
    )
    .await?
    .into_result()?;
    let after = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    assert_eq!(
        after["skills"]["pace"].as_u64().unwrap(),
        before["skills"]["pace"].as_u64().unwrap() + 3
    );
    assert!(after["overall"].as_u64().unwrap() >= before["overall"].as_u64().unwrap());
    assert_eq!(supply - game.supply().await?, 400_000 * ONE_G);

    // He takes a striker's slot (which reports him) and plays there.
    game.call(&koplo, "take_slot", json!({ "slot": 9 }))
        .await?
        .into_result()?;
    let _ = squad;
    let eleven = game
        .view("starting_eleven", json!({ "club_id": club.id() }))
        .await?;
    assert!(
        eleven
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["token_id"] == json!(token))
    );
    let (first, second) = game.play_day(&koplo).await?;
    first.into_result()?;
    let results: Value = second.into_result()?.json()?;
    let m = &results[0];
    let side = if m["home"] == json!(club.id()) { 0 } else { 1 };
    assert_eq!(m["elevens"][side][9], json!(token));
    assert!(m["full_time"].as_bool().unwrap());
    Ok(())
}

#[tokio::test]
async fn a_club_buys_a_player_and_the_price_is_shared() -> Result<()> {
    let game = deploy().await?;
    let (seller, buyer) = (game.account().await?, game.account().await?);
    for (c, name) in [(&seller, "Rive Nord"), (&buyer, "Cite-Phare")] {
        game.call(c, "create_club", json!({ "name": name }))
            .await?
            .into_result()?;
    }
    let token = game
        .view("squad", json!({ "account_id": seller.id() }))
        .await?[10]["token_id"]
        .as_str()
        .unwrap()
        .to_string();
    let price = 500_000 * ONE_G;

    // The buyer bids 500k G: the league holds them.
    buyer
        .call(game.goalars.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": game.league.id(),
            "amount": price.to_string(),
            "msg": json!({ "bid": token }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    let offers = game
        .view("offers_for", json!({ "token_id": token }))
        .await?;
    assert_eq!(offers.as_array().unwrap().len(), 1);
    let offer_id = offers[0]["id"].as_u64().unwrap();

    // The seller accepts by approving the league with the offer id.
    let supply = game.supply().await?;
    let sale = seller
        .call(game.players.id(), "nft_approve")
        .args_json(json!({
            "token_id": token,
            "account_id": game.league.id(),
            "msg": json!({ "accept": offer_id }).to_string(),
        }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(250))
        .transact()
        .await?;
    println!("sale: {} Tgas", sale.total_gas_burnt.as_tgas());
    sale.into_result()?;

    // The registration moved, the squads followed, the offer is sold.
    let nft: Value = game
        .players
        .view("nft_token")
        .args_json(json!({ "token_id": token }))
        .await?
        .json()?;
    assert_eq!(nft["owner_id"], json!(buyer.id()));
    assert_eq!(
        game.view("get_player", json!({ "token_id": token }))
            .await?["owner"],
        json!(buyer.id())
    );
    assert_eq!(
        game.view("get_offer", json!({ "offer_id": offer_id }))
            .await?["state"],
        "Sold"
    );
    // The seller trained him, so no 10% to himself: 3% burned, 97% to him.
    let tax = price * 3 / 100;
    assert_eq!(supply - game.supply().await?, tax);
    assert_eq!(
        g(&game
            .view("owed_of", json!({ "account_id": seller.id() }))
            .await?),
        price - tax
    );
    let before = game.balance(seller.id().as_str()).await?;
    game.call(&seller, "collect", json!({}))
        .await?
        .into_result()?;
    assert_eq!(
        game.balance(seller.id().as_str()).await? - before,
        price - tax
    );
    // The career now lists the seller as a past club for the next sale.
    let career: Value = game
        .players
        .view("career")
        .args_json(json!({ "token_id": token }))
        .await?
        .json()?;
    assert_eq!(career["past_clubs"], json!([seller.id()]));
    Ok(())
}

/// Standard base64 with padding, for `Base64VecU8` arguments.
fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

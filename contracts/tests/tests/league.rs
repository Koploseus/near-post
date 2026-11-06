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
    items: Contract,
    tickets: Contract,
}

async fn deploy() -> Result<Game> {
    let worker = near_workspaces::sandbox().await?;
    let wasm =
        |name: &str| std::fs::read(format!("{}/../res/{name}.wasm", env!("CARGO_MANIFEST_DIR")));
    let league = worker.dev_deploy(&wasm("league")?).await?;
    let goalars = worker.dev_deploy(&wasm("goalars")?).await?;
    let players = worker.dev_deploy(&wasm("players")?).await?;
    let items = worker.dev_deploy(&wasm("items")?).await?;
    let tickets = worker.dev_deploy(&wasm("tickets")?).await?;
    for c in [&goalars, &players, &items] {
        c.call("new")
            .args_json(json!({ "league_id": league.id() }))
            .transact()
            .await?
            .into_result()?;
    }
    tickets
        .call("new")
        .args_json(json!({ "league_id": league.id(), "goalars_id": goalars.id() }))
        .transact()
        .await?
        .into_result()?;
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
            "season_tickets_id": tickets.id(),
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(Game {
        worker,
        league,
        goalars,
        players,
        items,
        tickets,
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

    /// Plays a match day however many divisions it has: one call per
    /// division and half, until the next match day opens.
    async fn play_full_day(
        &self,
        caller: &Account,
    ) -> Result<Vec<near_workspaces::result::ExecutionFinalResult>> {
        let day = self.view("match_day", json!({})).await?;
        let mut calls = Vec::new();
        while self.view("match_day", json!({})).await? == day {
            self.wait_for_match_day().await?;
            calls.push(self.call(caller, "play_match_day", json!({})).await?);
        }
        Ok(calls)
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

    // Every goal is in a named player's wallet; his owner claims it. Only
    // Rive Nord had fans in: Port-Lune's goals, if any, paid nothing.
    for goal in m["goals"].as_array().unwrap() {
        assert!(!goal["name"].as_str().unwrap().is_empty());
    }
    let scorer = m["goals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|g| g["kind"] != "Own" && g["for_home"] == true)
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
async fn two_divisions_play_one_call_per_division_and_half() -> Result<()> {
    let game = deploy().await?;
    let mut managers = Vec::new();
    for i in 0..28 {
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
    // A full week: two full divisions (14 clubs each), one call per division
    // and half; the last day also elects 28 captains.
    let mut worst = 0;
    for day in 1..=7 {
        let calls = game.play_full_day(&managers[0]).await?;
        assert_eq!(calls.len(), 4, "two divisions, two halves");
        let gas: Vec<u64> = calls
            .iter()
            .map(|c| league_gas(c, game.league.id()))
            .collect();
        println!("28 clubs in 2 divisions, match day {day}: {gas:?} Tgas per call");
        for c in calls {
            c.into_result()?;
        }
        worst = worst.max(*gas.iter().max().unwrap());
    }
    println!("worst call: {worst} Tgas in the league");
    assert!(
        worst < 200,
        "a division's half too close to the 300 Tgas limit"
    );
    let captain = game
        .view("captain", json!({ "club_id": managers[0].id() }))
        .await?;
    assert_eq!(captain["votes"], 1);
    let table = game.view("table", json!({})).await?;
    assert_eq!(table.as_array().unwrap().len(), 28);
    let total: String = game.players.view("nft_total_supply").await?.json()?;
    assert_eq!(total, "315"); // 28 elevens and 7 persons
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

#[tokio::test]
async fn a_person_opens_a_pack_and_dresses_his_footballer() -> Result<()> {
    let game = deploy().await?;
    let club = game.account().await?;
    game.call(&club, "create_club", json!({ "name": "Rive Nord" }))
        .await?
        .into_result()?;
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
    let held = |items: Vec<String>, who: String| {
        let c = game.items.clone();
        async move {
            let v: Vec<String> = c
                .view("mt_batch_balance_of")
                .args_json(json!({ "account_id": who, "token_ids": items }))
                .await?
                .json()?;
            Ok::<Vec<String>, anyhow::Error>(v)
        }
    };

    // A pack: 500k G burned, three items minted to him.
    let supply = game.supply().await?;
    let r = koplo
        .call(game.goalars.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": game.league.id(),
            "amount": (500_000 * ONE_G).to_string(),
            "msg": json!({ "pack": {} }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    println!("pack: {} Tgas", r.total_gas_burnt.as_tgas());
    r.into_result()?;
    assert_eq!(game.supply().await?, supply - 500_000 * ONE_G);
    let got: Vec<String> = serde_json::from_value(
        game.view("last_unboxed", json!({ "account_id": koplo.id() }))
            .await?,
    )?;
    assert_eq!(got.len(), 3);
    let first = got[0].clone();
    let mine = held(vec![first.clone()], koplo.id().to_string()).await?;
    assert_ne!(mine[0], "0");

    // He wears the first one: the league keeps it while he does.
    let r = game
        .call(&koplo, "equip", json!({ "token_id": token, "item": first }))
        .await?;
    println!("equip: {} Tgas", r.total_gas_burnt.as_tgas());
    r.into_result()?;
    let kind = first.split('.').next().unwrap().to_string();
    let p = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    assert_eq!(p["look"][&kind], json!(first));
    let league_holds = held(vec![first.clone()], game.league.id().to_string()).await?;
    assert_eq!(league_holds[0], "1");

    // Taken off: it comes back to him.
    game.call(
        &koplo,
        "unequip",
        json!({ "token_id": token, "kind": kind }),
    )
    .await?
    .into_result()?;
    let p = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    assert_eq!(p["look"][&kind], Value::Null);
    assert_eq!(
        held(vec![first.clone()], game.league.id().to_string()).await?[0],
        "0"
    );
    assert_eq!(
        held(vec![first.clone()], koplo.id().to_string()).await?,
        mine
    );

    // Fusing items he does not hold burns nothing and mints nothing.
    let r = game
        .call(
            &koplo,
            "fuse",
            json!({ "items": ["hair.fire", "hair.fire", "hair.fire"] }),
        )
        .await?;
    assert!(r.into_result().is_err(), "legendary items do not fuse");
    let triple = if got.iter().filter(|i| *i == "boots.black").count() == 3 {
        "hair.short"
    } else {
        "boots.black"
    };
    let before = held(got.clone(), koplo.id().to_string()).await?;
    let _ = game
        .call(&koplo, "fuse", json!({ "items": [triple, triple, triple] }))
        .await?;
    assert_eq!(held(got.clone(), koplo.id().to_string()).await?, before);
    let after: Vec<String> = serde_json::from_value(
        game.view("last_unboxed", json!({ "account_id": koplo.id() }))
            .await?,
    )?;
    assert_eq!(after, got, "no fusion was recorded");
    Ok(())
}

#[tokio::test]
async fn a_season_ticket_earns_at_full_houses_and_its_g_go_with_it() -> Result<()> {
    let game = deploy().await?;
    let club = game.account().await?;
    game.call(&club, "create_club", json!({ "name": "Northbank Rovers" }))
        .await?
        .into_result()?;
    let other = game.account().await?;
    game.call(&other, "create_club", json!({ "name": "Moonhaven FC" }))
        .await?
        .into_result()?;
    // Two fans (the signup grant gives them G); one buys a season ticket.
    let ada = game.account().await?;
    let bob = game.account().await?;
    for fan in [&ada, &bob] {
        game.call(fan, "follow", json!({ "club_id": club.id() }))
            .await?
            .into_result()?;
    }
    let price = 300_000 * ONE_G;
    let r = ada
        .call(game.goalars.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": game.league.id(),
            "amount": price.to_string(),
            "msg": json!({ "season_ticket": club.id() }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    println!("season ticket: {} Tgas", r.total_gas_burnt.as_tgas());
    r.into_result()?;
    let mine: Vec<Value> = game
        .tickets
        .view("tickets_of")
        .args_json(json!({ "account_id": ada.id() }))
        .await?
        .json()?;
    assert_eq!(mine.len(), 1);
    let token = mine[0]["token_id"].as_str().unwrap().to_string();
    assert_eq!(mine[0]["number"], json!(1));
    assert_eq!(mine[0]["balance"], json!("0"));
    assert_eq!(
        g(&game
            .view("get_club", json!({ "club_id": club.id() }))
            .await?["treasury"]),
        price
    );

    // Both fans in: a full house. The ticket earns its share, held in it.
    for fan in [&ada, &bob] {
        game.call(fan, "check_in", json!({})).await?.into_result()?;
    }
    let calls = game.play_full_day(&club).await?;
    for c in &calls {
        println!("half: {} Tgas", league_gas(c, game.league.id()));
    }
    let ticket: Value = game
        .tickets
        .view("ticket")
        .args_json(json!({ "token_id": token }))
        .await?
        .json()?;
    let earned = g(&ticket["balance"]);
    assert!(earned > 0, "the ticket earned at the full house: {ticket}");
    assert!(earned <= 50_000 * ONE_G);
    let ledger: Vec<Value> = serde_json::from_value(game.view("ledger", json!({})).await?)?;
    assert!(ledger.iter().any(|e| e["kind"] == "season_tickets"));

    // Sold to Bob: the balance goes with it, Ada can no longer take it.
    ada.call(game.tickets.id(), "nft_transfer")
        .args_json(json!({ "receiver_id": bob.id(), "token_id": token }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let r = ada
        .call(game.tickets.id(), "withdraw")
        .args_json(json!({ "token_id": token }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?;
    assert!(r.is_failure(), "the old owner cannot withdraw");
    let before = game.balance(bob.id().as_str()).await?;
    bob.call(game.tickets.id(), "withdraw")
        .args_json(json!({ "token_id": token }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(60))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(game.balance(bob.id().as_str()).await?, before + earned);
    let ticket: Value = game
        .tickets
        .view("ticket")
        .args_json(json!({ "token_id": token }))
        .await?
        .json()?;
    assert_eq!(ticket["balance"], json!("0"));
    Ok(())
}

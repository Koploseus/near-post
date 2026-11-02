//! Sandbox tests: the four contracts deployed together on a local nearcore,
//! from the checked-in wasm in contracts/res.

use anyhow::Result;
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{Value, json};

const MATCH_INTERVAL_MS: u64 = 60_000;
const ONE_G: u128 = 1_000_000;

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

    game.wait_for_match_day().await?;
    let supply_before = game.supply().await?;
    let played = game.call(&fans[2], "play_match_day", json!({})).await?;
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
    for i in 0..64 {
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
    // A full week: the last day also elects 64 captains.
    let mut worst = 0;
    for day in 1..=7 {
        game.wait_for_match_day().await?;
        let played = game.call(&managers[0], "play_match_day", json!({})).await?;
        let gas = played.total_gas_burnt.as_tgas();
        let own = played
            .receipt_outcomes()
            .iter()
            .filter(|o| o.executor_id == *game.league.id())
            .map(|o| o.gas_burnt.as_tgas())
            .max()
            .unwrap_or(0);
        println!("64-club match day {day}: {gas} Tgas in total, {own} Tgas in the call itself");
        played.into_result()?;
        worst = worst.max(own);
    }
    println!("worst 64-club match day: {worst} Tgas in the league call");
    assert!(worst < 250, "match day too close to the 300 Tgas limit");
    let captain = game
        .view("captain", json!({ "club_id": managers[0].id() }))
        .await?;
    assert_eq!(captain["votes"], 1);
    let table = game.view("table", json!({})).await?;
    assert_eq!(table.as_array().unwrap().len(), 64);
    let total: String = game.players.view("nft_total_supply").await?.json()?;
    assert_eq!(total, "720");
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

    // He trains: 400k G sent to the league, burned, +1 attack.
    let before = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    let supply = game.supply().await?;
    koplo
        .call(game.goalars.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": game.league.id(),
            "amount": (400_000 * ONE_G).to_string(),
            "msg": json!({ "train": token }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?
        .into_result()?;
    let after = game
        .view("get_player", json!({ "token_id": token }))
        .await?;
    assert_eq!(
        after["attack"].as_u64().unwrap(),
        before["attack"].as_u64().unwrap() + 1
    );
    assert_eq!(supply - game.supply().await?, 400_000 * ONE_G);

    // The manager (no captain yet) puts him in the eleven; he reports; he plays.
    let mut xi: Vec<Value> = squad.as_array().unwrap()[..10]
        .iter()
        .map(|p| p["token_id"].clone())
        .collect();
    xi.push(json!(token));
    game.call(
        &club,
        "set_lineup",
        json!({ "club_id": club.id(), "token_ids": xi }),
    )
    .await?
    .into_result()?;
    game.call(&koplo, "report_for_match", json!({}))
        .await?
        .into_result()?;
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
    game.wait_for_match_day().await?;
    game.call(&koplo, "play_match_day", json!({}))
        .await?
        .into_result()?;
    Ok(())
}

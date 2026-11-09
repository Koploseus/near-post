"""
NEAR Post: the G economy over three years (one match day a day), every flow of the v8
league contract, plus the people who play, the accounts that farm, and a G/USDC pool
where G gets a price.

Flows modelled (rules from GET /v1/rules on league-v8, Nov 2026):
  mint   signup grant (1M) and welcome bonus (1M x 4 check-ins)          [onboarding]
         goals: 600k x stand fill, x2 late goal, x2 derby; 70% scorer / 30% club treasury
         full house (>= 60% of a club's fans in the stand): 100k per fan present
         season tickets: 50k each, per full house of its club
         every mint scaled by the room left under the 10B cap
  burn   own goal (600k, from the treasury), empty stand (2% of the treasury),
         relegation (10% of the treasury of the 3 relegated), training (400k),
         packs (500k), sale tax (3% of each transfer)
  move   season ticket price (300k, fan -> treasury), salaries (200k per human of the XI,
         treasury -> player): no mint, no burn, but they decide who can spend.
Market: a constant-product G/USDC pool. Players sell part of what they earn; newcomers
and spenders who lack G buy. No team allocation exists, so the pool's G comes from the
first earners who seed it (an assumption: someone has to).

Everything people do is an assumption and is listed in PEOPLE / BEHAVIOUR below.
"""
from __future__ import annotations
import json, math, sys
import numpy as np

CAP = 10e9
DAYS = 3 * 365
SEASON = 26

V8 = dict(
    name="v8", signup=1e6, welcome=1e6, visits=4, welcome_needs_match=False, stake_only=False,
    goal=600e3, scorer=.7, late=.12, derby_every=5, own_goal=.04, own_goal_burn=600e3,
    full_fan=100e3, full_pot=None, streak_bonus=0.0, target=.6, ticket_share=50e3,
    empty_burn=.02, releg_burn=.10, train=400e3, pack=500e3, tax=.03, ticket_price=300e3,
    salary=200e3, cap_room=True,
)
# The proposal: anti-farm, a fixed pot per full stand that grows with the club's streak,
# goals worth three times more. Same burns.
V9 = dict(V8, name="v9", signup=0, welcome=250e3, visits=1, welcome_needs_match=True, stake_only=True,
          goal=1.8e6, full_fan=None, full_pot=2.4e6, streak_bonus=.1)

# Who plays: new players a day (a curve), how long they stay, how often they come.
PEOPLE = {
    "Lent et régulier": dict(launch=300, new=lambda d: 15, churn=.004, attend=.65),
    "Viral puis essoufflement": dict(launch=500, new=lambda d: 400 * math.exp(-(d - 1) / 30) + 15, churn=.008, attend=.6),
    "Gros jeu (succès)": dict(launch=1000, new=lambda d: 60 + 140 * min(1, d / 365), churn=.003, attend=.7),
}
# What people do with G (assumptions).
BEHAVIOUR = dict(
    train_rate=.3,          # an active player trains on 30% of match days, if he can pay
    packs_per_100=3,        # packs a day per 100 active players
    transfers_per_100=2,    # transfers a day per 100 active players, at ~800k G
    transfer_price=800e3,
    tickets_take=.25,       # share of a club's fans who buy its season ticket (50 max)
    sell_share=.30,         # share of what players earn that they sell for USDC
    newcomer_buy=5.0,       # USDC a newcomer spends on G on day one
    pool_usdc=20_000.0,     # USDC put in the pool on day 1
    pool_g=200e6,           # G put in the pool on day 1 (bought from the first earners)
)


def run(rules: dict, people: dict, farm_per_day: float = 0, days: int = DAYS, seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    b = BEHAVIOUR
    supply = 0.0
    wallets = 0.0           # G held by players (outside treasuries and the pool)
    pool_g, pool_u = 0.0, 0.0
    clubs = 24
    treas = np.zeros(clubs)
    streak = np.zeros(clubs)
    tickets = np.zeros(clubs)
    players = float(people["launch"])
    farm = 0.0
    waiting = np.zeros(rules["visits"] + 1)   # accounts with k welcome bonuses left
    rec = {k: [] for k in ["supply", "price", "mcap", "active", "earn_g", "earn_usd", "minted", "burned", "onb", "pool_g"]}
    tot = dict(onb=0.0, goals=0.0, full=0.0, tickets=0.0, burn_spend=0.0, burn_club=0.0)

    def room():
        return max(0.0, (CAP - supply) / CAP) if rules["cap_room"] else 1.0

    def mint(x):
        nonlocal supply
        m = x * room()
        supply += m
        return m

    def burn_from_wallets(x):
        nonlocal supply, wallets
        x = min(x, wallets)
        wallets -= x
        supply -= x
        return x

    def onboard(n):
        nonlocal wallets
        m = mint(rules["signup"] * n)
        wallets += m
        tot["onb"] += m
        waiting[rules["visits"]] += n

    onboard(players)
    for day in range(1, days + 1):
        minted0 = supply
        burned_today = 0.0
        new = people["new"](day)
        players = players * (1 - people["churn"]) + new
        farm += farm_per_day
        onboard(new + farm_per_day)
        clubs_now = max(24, int(players / 30))       # people create clubs as the league grows
        if clubs_now > clubs:
            treas = np.concatenate([treas, np.zeros(clubs_now - clubs)])
            streak = np.concatenate([streak, np.zeros(clubs_now - clubs)])
            tickets = np.concatenate([tickets, np.zeros(clubs_now - clubs)])
            clubs = clubs_now
        active = players * people["attend"]

        # Welcome bonuses: real accounts collect when they come; farmed ones always "come",
        # unless the bonus needs a real match (they never play one).
        share_farm = farm / (players + farm) if players + farm else 0
        for k in range(1, rules["visits"] + 1):
            n = waiting[k]
            came_real = n * (1 - share_farm) * people["attend"]
            came_farm = 0 if rules["welcome_needs_match"] else n * share_farm
            came = came_real + came_farm
            m = mint(rules["welcome"] * came)
            wallets += m
            tot["onb"] += m
            waiting[k] -= came
            waiting[k - 1] += came

        # The stands: each club's fans, the farmed accounts always present unless a stake is needed.
        fans_real = players / clubs
        fans_farm = 0 if rules["stake_only"] else farm / clubs
        fans = fans_real + fans_farm
        target = math.ceil(rules["target"] * fans)
        present = rng.binomial(int(fans_real), people["attend"], clubs) + fans_farm
        fill = np.minimum(1, present / max(1, target))
        full = present >= target

        # Season tickets: a quarter of the fans buy one, 50 a club a season (fan -> treasury).
        want = np.minimum(50 - tickets, np.ceil(fans_real * b["tickets_take"] / SEASON))
        buy = np.minimum(want, np.floor(wallets / rules["ticket_price"] / clubs))
        tickets += buy
        moved = float(buy.sum() * rules["ticket_price"])
        wallets -= moved
        treas += buy * rules["ticket_price"]

        # Goals: two sides a match, Poisson 1.4 each.
        earned = 0.0
        goals = rng.poisson(1.4, clubs)
        derby = np.zeros(clubs)
        if day % rules["derby_every"] == 0:
            derby[:2] = 1
        for c in np.nonzero(goals)[0]:
            for _ in range(goals[c]):
                u = rng.random()
                if u < rules["own_goal"]:
                    x = min(treas[c], rules["own_goal_burn"])
                    treas[c] -= x
                    supply -= x
                    burned_today += x
                    tot["burn_club"] += x
                    continue
                k = (2 if u < rules["own_goal"] + rules["late"] else 1) * (2 if derby[c] else 1)
                m = mint(k * rules["goal"] * fill[c])
                tot["goals"] += m
                wallets += m * rules["scorer"]
                earned += m * rules["scorer"]
                treas[c] += m * (1 - rules["scorer"])

        # Full houses (and their season tickets) mint; empty stands burn the treasury.
        for c in range(clubs):
            if full[c]:
                streak[c] += 1
                if rules["full_pot"]:
                    pot = rules["full_pot"] * min(2.0, 1 + rules["streak_bonus"] * (streak[c] - 1))
                else:
                    pot = rules["full_fan"] * present[c]
                m = mint(pot)
                tot["full"] += m
                real_share = (present[c] - fans_farm) / present[c] if present[c] else 0
                wallets += m
                earned += m * real_share          # what farmed accounts get is not "earned" by players
                mt = mint(tickets[c] * rules["ticket_share"])
                tot["tickets"] += mt
                wallets += mt
                earned += mt
            else:
                streak[c] = 0
                x = treas[c] * rules["empty_burn"]
                treas[c] -= x
                supply -= x
                burned_today += x
                tot["burn_club"] += x

        # Salaries: up to ~6 humans in each XI, from the treasury, if it can pay.
        humans_xi = min(11, fans_real * 0.3)
        pay = np.minimum(treas, humans_xi * rules["salary"])
        treas -= pay
        wallets += float(pay.sum())
        earned += float(pay.sum())

        # Spending, burned: training, packs, sale tax. Players buy G on the pool when short.
        want_spend = (active * b["train_rate"] * rules["train"]
                      + active / 100 * b["packs_per_100"] * rules["pack"]
                      + active / 100 * b["transfers_per_100"] * b["transfer_price"] * rules["tax"])
        # Pool: opens on day 1 with the seeded liquidity (its G comes out of the wallets).
        if day == 1:
            seed_g = min(b["pool_g"], wallets)
            wallets -= seed_g
            pool_g, pool_u = seed_g, b["pool_usdc"]
        short = max(0.0, want_spend - wallets * .5)    # nobody spends more than half his G in a day
        if short > 0 and pool_g > 1:
            # buy `short` G from the pool, if it has them (x*y=k)
            g_out = min(short, pool_g * .2)
            u_in = pool_u * g_out / (pool_g - g_out)
            pool_g -= g_out
            pool_u += u_in
            wallets += g_out
        bs = burn_from_wallets(min(want_spend, wallets * .5))
        burned_today += bs
        tot["burn_spend"] += bs

        # Newcomers buy G with USDC; earners sell part of what they earned.
        if pool_g > 1:
            u_in = new * b["newcomer_buy"]
            g_out = pool_g * u_in / (pool_u + u_in)
            pool_g -= g_out
            pool_u += u_in
            wallets += g_out
            g_in = min(wallets, earned * b["sell_share"])
            u_out = pool_u * g_in / (pool_g + g_in)
            pool_g += g_in
            pool_u -= u_out
            wallets -= g_in

        # Relegation at the end of a season: the 3 last clubs (random here) burn 10%.
        if day % SEASON == 0:
            for c in rng.choice(clubs, 3, replace=False):
                x = treas[c] * rules["releg_burn"]
                treas[c] -= x
                supply -= x
                burned_today += x
                tot["burn_club"] += x
            tickets[:] = 0

        price = pool_u / pool_g if pool_g > 1 else 0.0
        rec["supply"].append(supply)
        rec["price"].append(price)
        rec["mcap"].append(price * supply)
        rec["active"].append(active)
        rec["earn_g"].append(earned / max(1, active))
        rec["earn_usd"].append(earned / max(1, active) * price)
        rec["minted"].append(max(0.0, supply - minted0 + burned_today))
        rec["burned"].append(burned_today)
        rec["onb"].append(tot["onb"])
        rec["pool_g"].append(pool_g)
    rec["totals"] = tot
    return rec


def summary(name: str, r: dict) -> dict:
    s, p = r["supply"], r["price"]
    at = lambda d: d - 1
    minted = sum(r["minted"]); burned = sum(r["burned"])
    t = r["totals"]; made = t["onb"] + t["goals"] + t["full"] + t["tickets"]
    return dict(
        name=name,
        supply_y1=s[at(365)], supply_y2=s[at(730)], supply_y3=s[at(1095)],
        price_d30=p[at(30)], price_y1=p[at(365)], price_y3=p[at(1095)],
        mcap_y3=r["mcap"][at(1095)],
        active_y3=r["active"][at(1095)],
        earn_usd_y1=float(np.mean(r["earn_usd"][330:365])), earn_usd_y3=float(np.mean(r["earn_usd"][1060:1095])),
        burn_ratio=burned / minted if minted else 0,
        from_onb=t["onb"] / made if made else 0, from_full=t["full"] / made if made else 0, from_goals=t["goals"] / made if made else 0,
        infl_y3=(s[at(1095)] - s[at(1095 - 30)]) / s[at(1095 - 30)] * 365 / 30 if s[at(1065)] else 0,
    )


if __name__ == "__main__":
    out = {"series": {}, "summary": []}
    for pname, people in PEOPLE.items():
        for rules in (V8, V9):
            key = f"{pname} · {rules['name']}"
            r = run(rules, people)
            out["series"][key] = {k: v for k, v in r.items() if k != "totals"}
            out["summary"].append(summary(key, r))
    for rules in (V8, V9):
        key = f"Viral + 50 faux comptes/jour · {rules['name']}"
        r = run(rules, PEOPLE["Viral puis essoufflement"], farm_per_day=50)
        out["series"][key] = {k: v for k, v in r.items() if k != "totals"}
        out["summary"].append(summary(key, r))
    json.dump(out, open(sys.argv[1], "w"))
    for s in out["summary"]:
        print(f"{s['name'][:44]:44} offre a1 {s['supply_y1']/1e9:4.1f} a3 {s['supply_y3']/1e9:4.1f} Md | prix J30 {s['price_d30']*1e6:6.2f} a1 {s['price_y1']*1e6:6.2f} a3 {s['price_y3']*1e6:6.2f} $/M G"
              f" | cap a3 {s['mcap_y3']/1e3:6.0f}k$ | actifs a3 {s['active_y3']:6.0f} | gain $/j/actif a1 {s['earn_usd_y1']:5.2f} a3 {s['earn_usd_y3']:5.2f}"
              f" | brûlé/créé {s['burn_ratio']*100:3.0f}% | accueil {s['from_onb']*100:3.0f}% tribune {s['from_full']*100:3.0f}% buts {s['from_goals']*100:3.0f}%")

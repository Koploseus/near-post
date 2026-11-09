"""G economy variants. Mirrors apps/sim/src/model.ts (v8 rules) with levers to compare.
One match day a day. Spending is bounded: players never burn more than 10% of supply in a day."""
import json, math, random, sys
CAP = 10e9
BASE = dict(signup=1e6, welcome=1e6, visits=4, goal=600e3, club_share=.3, full_fan=100e3, target=.6,
            empty_burn=.02, releg_burn=.1, train=400e3, pack=500e3, tax=.03, ticket_share=50e3,
            emission="cap", halving_days=None, floor=0.25, sink_mult=1.0, welcome_needs_match=False, buyback_share=0.0, stake_only=False, upkeep=0.0, full_pot=None)
def run(rules, days=365, accounts0=500, new_per_day=20, farm_per_day=0, attendance=.7, clubs=24, goals=2.8,
        packs=10, transfers=10, train_rate=.3, seed=7):
    R = random.Random(seed); r = dict(BASE, **rules)
    supply = 0.0; treas = [0.0]*clubs; minted_onb = 0.0; minted_play = 0.0; burned = 0.0
    earn_by_active = []  # G a real active player earns that day (presence + goals split)
    def factor(day):
        if r["emission"] == "cap": return max(0.0, (CAP-supply)/CAP)
        # halving per season, capped by room left too
        return max(r["floor"], 0.5 ** ((day-1)//r["halving_days"])) * max(0.0, (CAP-supply)/CAP)
    def mint(a, day, onb=False):
        nonlocal supply, minted_onb, minted_play
        m = a*factor(day); supply += m
        if onb: minted_onb += m
        else: minted_play += m
        return m
    def burn(a):
        nonlocal supply, burned
        b = min(a, supply); supply -= b; burned += b; return b
    waiting = [0]*(r["visits"]+1); real = accounts0; farm = 0
    def signup(n, day):
        for _ in range(n): mint(r["signup"], day, True)
        waiting[r["visits"]] += n
    signup(accounts0, 1)
    out = []
    for day in range(1, days+1):
        signup(new_per_day + farm_per_day, day); real += new_per_day; farm += farm_per_day
        # welcome bonuses: real accounts come with `attendance`, farmed ones always check in
        share_farm = farm/(real+farm) if real+farm else 0
        for k in range(1, r["visits"]+1):
            came = sum(1 for _ in range(waiting[k]) if R.random() < (attendance*(1-share_farm)+share_farm))
            if r["welcome_needs_match"]: came = int(came*(1-share_farm))  # farmed accounts never play a match
            for _ in range(came): mint(r["welcome"], day, True)
            waiting[k] -= came; waiting[k-1] += came
        # Farmed accounts always check in. With stake_only, only fans with a stake (a season
        # ticket or a footballer in the club) count in the stand: farmed accounts weigh nothing.
        real_fans = real//clubs; farm_fans = 0 if r["stake_only"] else farm//clubs
        fans = real_fans + farm_fans; target = math.ceil(r["target"]*fans)
        present = [farm_fans + sum(1 for _ in range(real_fans) if R.random() < attendance) for _ in range(clubs)]
        fill = lambda c: min(1, present[c]/target) if target else 0
        day_play_mint = 0.0
        for c in range(clubs):
            g = sum(1 for _ in range(int(goals*3)) if R.random() < goals/2/int(goals*3))
            for _ in range(g):
                m = mint(r["goal"]*fill(c), day); day_play_mint += m; treas[c] += m*r["club_share"]
            if present[c] >= target and target:
                day_play_mint += mint(r["full_pot"] if r["full_pot"] else present[c]*r["full_fan"], day)
            else:
                treas[c] -= burn(treas[c]*r["empty_burn"])
        # Stadium upkeep: every club pays a share of its treasury each match day, burned.
        if r["upkeep"]:
            for c in range(clubs): treas[c] -= burn(treas[c]*r["upkeep"])
        sm = r["sink_mult"]
        trainings = sum(1 for _ in range(real) if R.random() < train_rate*attendance)
        spend = sm*(trainings*r["train"] + packs*r["pack"]) + transfers*500e3*r["tax"]*sm
        burn(min(spend, r.get('spend_cap', .03)*supply))
        if r["buyback_share"]: burn(r["buyback_share"]*day_play_mint)  # revenue buys back part of the day's mint
        if day % 26 == 0:
            for c in range(clubs-3, clubs): treas[c] -= burn(treas[c]*r["releg_burn"])
        active = max(1, attendance*real)
        earn_by_active.append(day_play_mint*(1-r["club_share"]*0)/active)
        out.append(supply)
    return dict(supply=out, onb=minted_onb, play=minted_play, burned=burned, earn=earn_by_active)

AF = dict(signup=0, welcome=250e3, welcome_needs_match=True, stake_only=True)
VARIANTS = {
  "v8 actuel": {},
  "1 · Bienvenue après un match + tribune = fans avec un enjeu": AF,
  "2 · 1 + frais de stade (1 % de la trésorerie brûlé par journée)": {**AF, "upkeep": .01},
  "3 · 2 + entraînement progressif (coûte plus cher aux joueurs forts)": {**AF, "upkeep": .01, "spend_cap": .04},
  "4 · 3 + création ÷2 par saison (plancher 25 %)": {**AF, "upkeep": .01, "spend_cap": .04, "emission": "halving", "halving_days": 26, "floor": .25},
  "5 · 1 + tribune pleine = pot fixe de 2,4 M partagé": {**AF, "full_pot": 2.4e6},
  "6 · 5 + buts ×3 (1,8 M par but)": {**AF, "full_pot": 2.4e6, "goal": 1.8e6},
}
if __name__ == "__main__":
    res = {}
    for name, rules in VARIANTS.items():
        a = run(rules); f = run(rules, farm_per_day=50)
        s = a["supply"]
        res[name] = dict(supply=s, farm=f["supply"],
            d30=s[29], d98=s[97], d365=s[364],
            infl_last30=(s[364]-s[334])/s[334]*365/30 if s[334] else 0,
            onb_share=a["onb"]/(a["onb"]+a["play"]),
            farm_extra=(f["supply"][97]-s[97])/s[97] if s[97] else 0,
            earn_d10=sum(a["earn"][5:15])/10, earn_d300=sum(a["earn"][295:305])/10,
            ppm_d10=sum(a["earn"][i]/s[i] for i in range(5,15))/10*1e6, ppm_d300=sum(a["earn"][i]/s[i] for i in range(295,305) if s[i])/10*1e6)
        print(f'{name[:52]:52} d30 {s[29]/1e6:6.0f}M d98 {s[97]/1e6:6.0f}M d365 {s[364]/1e6:6.0f}M | infl/an fin {res[name]["infl_last30"]*100:5.0f}% | accueil {res[name]["onb_share"]*100:3.0f}% | +farm J98 {res[name]["farm_extra"]*100:4.0f}% | gain/j J10 {res[name]["earn_d10"]/1e3:5.0f}k J300 {res[name]["earn_d300"]/1e3:5.0f}k | part du gâteau/j J10 {res[name]["ppm_d10"]:5.0f} ppm J300 {res[name]["ppm_d300"]:5.0f} ppm')
    json.dump(res, open(sys.argv[1], "w"))

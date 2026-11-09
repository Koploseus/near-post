import json, numpy as np
import g3y
from g3y import V8, V9, PEOPLE, BEHAVIOUR, run, summary
# v10 "mème qui vit avec le jeu": anti-farm (v9), emission halved (goals 600k, pot 1.2M),
# G earned withdrawable after 7 days (modelled: players sell 10% of earnings, not 30%),
# entry in G (a newcomer's first season ticket/pack is bought with G: $20 of buying, not $5).
V10 = dict(V9, name="v10", goal=600e3, full_pot=1.2e6)
SETS = [("v8 actuel", V8, 5, .3), ("v9 (anti-farm, pot fixe, buts ×3)", V9, 5, .3), ("v10 mème (v9 + émission ÷2 + G bloqué 7 j + entrée en G)", V10, 20, .1)]
out = {"series": {}, "summary": []}
for pname, people in PEOPLE.items():
    for label, rules, buy, sell in SETS:
        g3y.BEHAVIOUR = dict(BEHAVIOUR, newcomer_buy=buy, sell_share=sell)
        r = run(rules, people)
        k = f"{pname} | {label}"
        out["series"][k] = {x: r[x] for x in ["supply", "price", "active", "earn_usd"]}
        out["summary"].append(summary(k, r))
for label, rules, buy, sell in SETS:
    g3y.BEHAVIOUR = dict(BEHAVIOUR, newcomer_buy=buy, sell_share=sell)
    r = run(rules, PEOPLE["Viral puis essoufflement"], farm_per_day=50)
    k = f"Viral + 50 faux comptes/j | {label}"
    out["series"][k] = {x: r[x] for x in ["supply", "price", "active", "earn_usd"]}
    out["summary"].append(summary(k, r))
json.dump(out, open("final.json", "w"))
p0 = 0.1  # $ per M G at day 1 = 20000$/200M G -> 100 $/M
for s in out["summary"]:
    print(f"{s['name'][:70]:70} offre a1 {s['supply_y1']/1e9:4.1f} a3 {s['supply_y3']/1e9:4.1f} Md | prix vs J1 a1 {s['price_y1']*1e6/100*100-100:+5.0f}% a3 {s['price_y3']*1e6/100*100-100:+5.0f}% | gain a3 {s['earn_usd_y3']:5.2f} $/j | brûlé/créé {s['burn_ratio']*100:3.0f}% | accueil {s['from_onb']*100:2.0f}%")

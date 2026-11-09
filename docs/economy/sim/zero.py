import numpy as np, g3y2 as m
from g3y2 import V8, V9, PEOPLE, BEHAVIOUR
V10 = dict(V9, name="v10", goal=600e3, full_pot=1.2e6)
cases = [
  ("v8 actuel", V8, 5, .3),
  ("v8 + 0 G à l'arrivée", dict(V8, signup=0, welcome=0), 5, .3),
  ("v8 + 0 G + dormants fondent 1 %/sem après départ", dict(V8, signup=0, welcome=0, demurrage=.01/7), 5, .3),
  ("v10", V10, 20, .1),
  ("v10 + 0 G à l'arrivée", dict(V10, signup=0, welcome=0), 20, .1),
  ("v10 + 0 G + dormants fondent 1 %/sem", dict(V10, signup=0, welcome=0, demurrage=.01/7), 20, .1),
]
for pname in ["Lent et régulier", "Gros jeu (succès)"]:
    for label, R, buy, sell in cases:
        m.BEHAVIOUR = dict(BEHAVIOUR, newcomer_buy=buy, sell_share=sell)
        r = m.run(R, PEOPLE[pname])
        p, s, d = r["price"], r["supply"], r["dormant"]
        print(f"{pname[:17]:17} {label[:48]:48} | prix J1 {p[0]*1e6:6.1f} | vs J1 a1 {(p[364]/p[0]-1)*100:+5.0f}% a3 {(p[1094]/p[0]-1)*100:+5.0f}% | offre a3 {s[1094]/1e9:4.2f} Md | G dormant a3 {d[1094]/s[1094]*100 if s[1094] else 0:3.0f}% de l'offre | brûlé dormants {r['totals'].get('burn_dormant',0)/1e9:4.2f} Md")

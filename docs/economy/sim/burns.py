import numpy as np, g3y3 as m
from g3y3 import V9, PEOPLE, BEHAVIOUR
V10 = dict(V9, name="v10", goal=600e3, full_pot=1.2e6)
m.BEHAVIOUR = dict(BEHAVIOUR, newcomer_buy=20, sell_share=.1)
cases = [("v10 seul", {}),
  ("+ pass saison 50 % brûlé", dict(ticket_burn=.5)),
  ("+ tifo 10k/case (1 fan sur 2 peint)", dict(tifo_pixel=10e3)),
  ("+ nutrition 20k/j (1 actif sur 2)", dict(nutrition=20e3)),
  ("trio : pass 50 % + tifo 10k + nutrition 20k", dict(ticket_burn=.5, tifo_pixel=10e3, nutrition=20e3)),
  ("trio fort : pass 50 % + tifo 25k + nutrition 50k", dict(ticket_burn=.5, tifo_pixel=25e3, nutrition=50e3))]
for pname in PEOPLE:
    base = None
    for label, extra in cases:
        P1=[];P3=[];S3=[];B=[]
        for seed in (1,2,3,4):
            r = m.run(dict(V10, **extra), PEOPLE[pname], seed=seed)
            P1.append(r["price"][364]); P3.append(r["price"][1094]); S3.append(r["supply"][1094])
            spend = sum(r["burned"]); B.append(spend)
        p1, p3, s3 = np.median(P1), np.median(P3), np.median(S3)
        if base is None: base = (p1, p3, s3)
        print(f"{pname[:17]:17} {label[:46]:46} | prix a1 x{p1/base[0]:4.2f} a3 x{p3/base[1]:4.2f} (vs v10 seul) | offre a3 {s3/1e9:4.2f} Md")
    print()

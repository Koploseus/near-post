/**
 * Goalars supply simulation. Amounts are in G and mirror the league contract's
 * rules(); every mint is scaled by the room left under the 10B cap, exactly as
 * the goalars contract does. Seeded and reproducible.
 */

export const RULES = {
  maxSupply: 10_000_000_000,
  starterGrant: 5_000_000,
  goalMint: 6_000_000,
  goalClubShare: 0.3, // 1.8M of 6M
  ownGoalBurn: 6_000_000,
  fullHouseMintPerFan: 100_000,
  stadiumTarget: 0.6,
  emptyStandBurn: 0.02,
  relegationBurn: 0.1,
  derbyMultiplier: 2,
  trainingCost: 400_000,
  saleTax: 0.03,
} as const;

export interface League {
  clubs: number;
  accounts0: number;
  newAccountsPerDay: number;
  supportersPerClub: number;
  fansPerAccount: number;
  goalsPerMatch: number;
  attendance: number;
  ownGoalShare: number;
  lateGoalShare: number;
  derbyEvery: number;
  seasonDays: number;
  trainRate: number;
  youthPerDay: number;
  youthCost: number;
  bootsPerDay: number;
  bootsCost: number;
  transfersPerDay: number;
  transferPrice: number;
}

export const SMALL_LEAGUE: Omit<League, "goalsPerMatch" | "attendance"> = {
  clubs: 8,
  accounts0: 100,
  newAccountsPerDay: 10,
  supportersPerClub: 50,
  fansPerAccount: 1 / 16,
  ownGoalShare: 0.04,
  lateGoalShare: 0.12,
  derbyEvery: 7,
  seasonDays: 38,
  trainRate: 0.7,
  youthPerDay: 2,
  youthCost: 5_000_000,
  bootsPerDay: 1,
  bootsCost: 3_000_000,
  transfersPerDay: 3,
  transferPrice: 30_000_000,
};

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(r: () => number, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0, p = 1;
  for (;;) {
    p *= r();
    if (p <= l) return k;
    k++;
  }
}

/** Supply at the end of each day. */
export function simulate(league: League, days = 60, seed = 7): number[] {
  const r = rng(seed);
  let supply = 0;
  const treasury = new Array<number>(league.clubs).fill(0);
  const mint = (amount: number) => {
    const minted = (amount * Math.max(0, RULES.maxSupply - supply)) / RULES.maxSupply;
    supply += minted;
    return minted;
  };
  const burn = (amount: number) => {
    const burned = Math.min(amount, supply);
    supply -= burned;
    return burned;
  };
  const burnTreasury = (club: number, share: number) => {
    treasury[club]! -= burn(treasury[club]! * share);
  };

  let accounts = league.accounts0;
  let players = league.accounts0;
  for (let i = 0; i < accounts; i++) mint(RULES.starterGrant);
  const out: number[] = [];

  for (let day = 1; day <= days; day++) {
    for (let i = 0; i < league.newAccountsPerDay; i++) mint(RULES.starterGrant);
    accounts += league.newAccountsPerDay;

    for (let side = 0; side < league.clubs; side++) {
      for (let g = poisson(r, league.goalsPerMatch / 2); g > 0; g--) {
        const roll = r();
        if (roll < league.ownGoalShare) {
          burnTreasury(side, Math.min(1, RULES.ownGoalBurn / Math.max(1, treasury[side]!)));
        } else {
          const k = roll < league.ownGoalShare + league.lateGoalShare ? 2 : 1;
          const minted = mint(k * RULES.goalMint);
          treasury[side]! += minted * RULES.goalClubShare;
        }
      }
    }

    const fans = league.supportersPerClub + Math.floor(accounts * league.fansPerAccount);
    const derby = day % league.derbyEvery === 0;
    for (let c = 0; c < league.clubs; c++) {
      const k = derby && c < 2 ? RULES.derbyMultiplier : 1;
      let present = 0;
      for (let f = 0; f < fans; f++) if (r() < league.attendance) present++;
      if (present >= Math.ceil(RULES.stadiumTarget * fans)) mint(k * present * RULES.fullHouseMintPerFan);
      else burnTreasury(c, Math.min(1, k * RULES.emptyStandBurn));
    }

    players += league.youthPerDay;
    let trainings = 0;
    for (let p = 0; p < players; p++) if (r() < league.trainRate) trainings++;
    burn(
      trainings * RULES.trainingCost +
        league.youthPerDay * league.youthCost +
        league.bootsPerDay * league.bootsCost +
        league.transfersPerDay * league.transferPrice * RULES.saleTax,
    );

    if (day === league.seasonDays) {
      for (const c of [league.clubs - 1, league.clubs - 2]) burnTreasury(c, RULES.relegationBurn);
    }
    out.push(supply);
  }
  return out;
}

export const SCENARIOS: Record<string, League> = {
  "Attacking, loyal fans": { ...SMALL_LEAGUE, goalsPerMatch: 3.2, attendance: 0.75 },
  "Attacking, absent fans": { ...SMALL_LEAGUE, goalsPerMatch: 3.2, attendance: 0.45 },
  "Defensive, loyal fans": { ...SMALL_LEAGUE, goalsPerMatch: 1.8, attendance: 0.75 },
  "Defensive, absent fans": { ...SMALL_LEAGUE, goalsPerMatch: 1.8, attendance: 0.45 },
  "Dead league: no newcomers, absent fans": {
    ...SMALL_LEAGUE,
    newAccountsPerDay: 0,
    goalsPerMatch: 1.8,
    attendance: 0.45,
  },
  "Big league (64 clubs), loyal fans": {
    ...SMALL_LEAGUE,
    clubs: 64,
    accounts0: 1_000,
    newAccountsPerDay: 200,
    goalsPerMatch: 3.2,
    attendance: 0.75,
  },
};

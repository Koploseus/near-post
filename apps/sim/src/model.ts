/**
 * Goalars supply simulation. Amounts are in G and mirror the league contract's
 * rules(); every mint is scaled by the room left under the 10B cap, exactly as
 * the goalars contract does. Seeded and reproducible.
 */

export const RULES = {
  maxSupply: 10_000_000_000,
  signupGrant: 1_000_000,
  welcomeBonus: 1_000_000,
  welcomeVisits: 4,
  // With a full stand behind the scorer; in proportion to the fans present
  // (up to the full-house target) otherwise, nothing with an empty stand.
  goalMint: 600_000,
  goalClubShare: 0.3, // 180k of 600k
  ownGoalBurn: 600_000,
  fullHouseMintPerFan: 100_000,
  stadiumTarget: 0.6,
  emptyStandBurn: 0.02,
  relegationBurn: 0.1,
  derbyMultiplier: 2,
  trainingCost: 400_000,
  saleTax: 0.03,
  packPrice: 500_000,
  seasonTicketPrice: 300_000,
  seasonTicketsPerClub: 50,
  seasonTicketShare: 50_000,
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
  /** Packs bought a day (each burns pack_price). */
  packsPerDay: number;
  /** Season tickets each club sells a day, until 50 a season (the price moves to the treasury: no mint, no burn). */
  ticketsPerClubPerDay: number;
  /** Clubs relegated at the end of a season (they burn a tenth of their treasury). */
  relegated: number;
}

/**
 * The v7 testnet league: 24 clubs in two divisions (19 match days a season),
 * 52 AI footballers and 24 AI coaches on day one, a few people a day.
 */
export const V7_LEAGUE: Omit<League, "goalsPerMatch" | "attendance"> = {
  clubs: 24,
  accounts0: 100,
  newAccountsPerDay: 10,
  supportersPerClub: 20,
  fansPerAccount: 1 / 24,
  ownGoalShare: 0.04,
  lateGoalShare: 0.12,
  derbyEvery: 5,
  seasonDays: 19,
  trainRate: 0.3,
  youthPerDay: 0,
  youthCost: 0,
  bootsPerDay: 0,
  bootsCost: 0,
  transfersPerDay: 4,
  transferPrice: 500_000,
  packsPerDay: 6,
  ticketsPerClubPerDay: 1,
  relegated: 2,
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
  // waiting[k] = accounts with k welcome bonuses still to collect.
  const waiting = new Array<number>(RULES.welcomeVisits + 1).fill(0);
  const signUp = (n: number) => {
    for (let i = 0; i < n; i++) mint(RULES.signupGrant);
    waiting[RULES.welcomeVisits]! += n;
  };
  signUp(accounts);
  const tickets = new Array<number>(league.clubs).fill(0);
  const out: number[] = [];

  for (let day = 1; day <= days; day++) {
    signUp(league.newAccountsPerDay);
    accounts += league.newAccountsPerDay;
    // Each newcomer who comes to the stadium collects one welcome bonus.
    for (let k = 1; k <= RULES.welcomeVisits; k++) {
      let came = 0;
      for (let i = 0; i < waiting[k]!; i++) if (r() < league.attendance) came++;
      for (let i = 0; i < came; i++) mint(RULES.welcomeBonus);
      waiting[k]! -= came;
      waiting[k - 1]! += came;
    }

    // Fans check in before the match: their stand sets what its goals are worth.
    const fans = league.supportersPerClub + Math.floor(accounts * league.fansPerAccount);
    const target = Math.ceil(RULES.stadiumTarget * fans);
    const present: number[] = [];
    for (let c = 0; c < league.clubs; c++) {
      let n = 0;
      for (let f = 0; f < fans; f++) if (r() < league.attendance) n++;
      present.push(n);
    }
    const fill = (c: number) => (target > 0 ? Math.min(1, present[c]! / target) : 0);

    for (let side = 0; side < league.clubs; side++) {
      for (let g = poisson(r, league.goalsPerMatch / 2); g > 0; g--) {
        const roll = r();
        if (roll < league.ownGoalShare) {
          burnTreasury(side, Math.min(1, RULES.ownGoalBurn / Math.max(1, treasury[side]!)));
        } else {
          const k = roll < league.ownGoalShare + league.lateGoalShare ? 2 : 1;
          const minted = mint(k * RULES.goalMint * fill(side));
          treasury[side]! += minted * RULES.goalClubShare;
        }
      }
    }

    const derby = day % league.derbyEvery === 0;
    for (let c = 0; c < league.clubs; c++) {
      const k = derby && c < 2 ? RULES.derbyMultiplier : 1;
      // A season ticket's price goes to the club's treasury: G change hands, none are made.
      const sold = Math.min(RULES.seasonTicketsPerClub - tickets[c]!, league.ticketsPerClubPerDay);
      tickets[c]! += sold;
      treasury[c]! += sold * RULES.seasonTicketPrice;
      if (present[c]! >= target) {
        mint(k * present[c]! * RULES.fullHouseMintPerFan);
        // ...and the club's season tickets each earn their share, minted into them.
        mint(k * tickets[c]! * RULES.seasonTicketShare);
      } else burnTreasury(c, Math.min(1, k * RULES.emptyStandBurn));
    }

    players += league.youthPerDay;
    let trainings = 0;
    for (let p = 0; p < players; p++) if (r() < league.trainRate) trainings++;
    burn(
      trainings * RULES.trainingCost +
        league.youthPerDay * league.youthCost +
        league.bootsPerDay * league.bootsCost +
        league.transfersPerDay * league.transferPrice * RULES.saleTax +
        league.packsPerDay * RULES.packPrice,
    );

    if (day % league.seasonDays === 0) {
      for (let i = 1; i <= league.relegated; i++) burnTreasury(league.clubs - i, RULES.relegationBurn);
      tickets.fill(0); // a new season, new season tickets
    }
    out.push(supply);
  }
  return out;
}

export const SCENARIOS: Record<string, League> = {
  "Loyal fans (75% come)": { ...V7_LEAGUE, goalsPerMatch: 2.6, attendance: 0.75 },
  "Absent fans (45% come)": { ...V7_LEAGUE, goalsPerMatch: 2.6, attendance: 0.45 },
  "Half-hearted fans (60%, on the edge)": { ...V7_LEAGUE, goalsPerMatch: 2.6, attendance: 0.6 },
  "Dead league: no newcomers, absent fans": { ...V7_LEAGUE, newAccountsPerDay: 0, goalsPerMatch: 2.6, attendance: 0.45, packsPerDay: 1 },
  "Full league (200 clubs), loyal fans": {
    ...V7_LEAGUE,
    clubs: 200,
    accounts0: 1_000,
    newAccountsPerDay: 200,
    goalsPerMatch: 2.6,
    attendance: 0.75,
    packsPerDay: 40,
    relegated: 27,
  },
};

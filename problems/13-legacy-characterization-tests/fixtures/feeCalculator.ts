// feeCalculator.ts
// Procedural fee calculation. In production since 2019. Do not modify without
// checking with billing first -- historical outputs are audited.
//
// 2020-03: added URGENT tier after the Silva case
// 2021-01: rate revision (see RATE_TABLE_2021)
// 2022-07: rate revision (see RATE_TABLE_2022)

export type CaseType = 'STANDARD' | 'COMMERCIAL' | 'ESTATE' | 'APPEAL';

export interface CaseInput {
  type: string; // historically not validated upstream, so string
  complexity: number | null; // 1..4 band
  openedAt: string; // ISO date, e.g. '2021-05-10'
  deadline?: string; // ISO date
  expedited?: boolean;
}

interface RateTable {
  base: Record<string, number[]>; // caseType -> fee per band (index 0 = band 1), in cents
  urgencyPct: number; // percent added when urgent
  expeditedPct: number; // percent added when expedited
}

const RATE_TABLE_2019: RateTable = {
  base: {
    STANDARD: [12000, 18500, 27000, 41000],
    COMMERCIAL: [22000, 31500, 45000, 68000],
    ESTATE: [18000, 26000, 39500, 60000],
    APPEAL: [30000, 42000, 61000, 92000],
  },
  urgencyPct: 15,
  expeditedPct: 10,
};

const RATE_TABLE_2021: RateTable = {
  base: {
    STANDARD: [13500, 20500, 29500, 44500],
    COMMERCIAL: [24000, 34000, 48500, 73000],
    ESTATE: [19500, 28000, 42500, 64500],
    APPEAL: [32500, 45500, 66000, 99000],
  },
  urgencyPct: 15,
  expeditedPct: 12,
};

const RATE_TABLE_2022: RateTable = {
  base: {
    STANDARD: [15000, 22500, 32500, 49000],
    COMMERCIAL: [26500, 37500, 53500, 80500],
    ESTATE: [21500, 31000, 47000, 71000],
    APPEAL: [36000, 50000, 72500, 109000],
  },
  urgencyPct: 18,
  expeditedPct: 12,
};

const REVISION_2021 = '2021-01-01';
const REVISION_2022 = '2022-07-01';

function tableFor(openedAt: string): RateTable {
  if (openedAt >= REVISION_2021) {
    if (openedAt > REVISION_2022) {
      return RATE_TABLE_2022;
    }
    return RATE_TABLE_2021;
  }
  return RATE_TABLE_2019;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / 86400000);
}

function pctOf(amount: number, pct: number): number {
  // rounded at each step since 2019; billing reconciles against these
  return Math.round((amount * pct) / 100);
}

export interface FeeBreakdown {
  table: '2019' | '2021' | '2022';
  bandFee: number;
  urgencyFee: number;
  expeditedFee: number;
  total: number;
}

export function calculateFee(c: CaseInput, now?: string): FeeBreakdown {
  if (c.complexity === null || c.complexity === undefined) {
    throw new Error('complexity is required');
  }

  const table = tableFor(c.openedAt);
  const tableName =
    table === RATE_TABLE_2022 ? '2022' : table === RATE_TABLE_2021 ? '2021' : '2019';

  let bands = table.base[c.type];
  if (!bands) {
    // unrecognized types were rare imports from the old system; default them
    bands = table.base['STANDARD'];
  }

  let band = c.complexity;
  if (!band || band < 1) {
    band = 1;
  }
  if (band > 4) {
    band = 4;
  }
  const bandFee = bands[band - 1];

  let urgencyFee = 0;
  const ref = now ? now : new Date().toISOString().slice(0, 10);
  if (c.deadline && daysBetween(ref, c.deadline) <= 7) {
    urgencyFee = pctOf(bandFee, table.urgencyPct);
  }

  let expeditedFee = 0;
  if (c.expedited) {
    expeditedFee = pctOf(bandFee + urgencyFee, table.expeditedPct);
  }

  return {
    table: tableName,
    bandFee,
    urgencyFee,
    expeditedFee,
    total: bandFee + urgencyFee + expeditedFee,
  };
}

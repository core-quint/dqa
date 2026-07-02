// ============================================================
// UWIN-specific types — separate from HMIS types
// ============================================================

import type {
  FacilityRecord,
  MonthData,
  FilterState,
  KpiStat,
  TableRows,
  T2Web,
  T3Web,
  PairMeta,
  DropoutWeb,
  CoAdminWeb,
  ChartPayload,
  KpiCard,
  SummaryRow,
} from '../dqa/types';

// Re-export shared types for convenience
export type {
  FacilityRecord,
  MonthData,
  FilterState,
  KpiStat,
  TableRows,
  T2Web,
  T3Web,
  PairMeta,
  DropoutWeb,
  CoAdminWeb,
  ChartPayload,
  KpiCard,
  SummaryRow,
};

// ---- UWIN CSV shape (extends HMIS ParsedCSV with beneficiary columns) ----

export interface UwinParsedCSV {
  portal: 'UWIN';
  header: string[];
  rows: string[][];
  idxBlock: number;
  idxFac: number;
  idxMonth: number;
  idxOwner: number | null;
  idxRU: number | null;
  idxState: number | null;
  idxDist: number | null;
  idxSessPlanned: number | null;
  idxSessHeld: number | null;
  // UWIN-specific beneficiary columns
  idxBenPW: number | null;
  idxBenInf: number | null;
  idxBenChild: number | null;
  idxBenAdol: number | null;
  // UWIN-specific Td columns (used by t9 "Zero coverage session")
  idxBenTd1: number | null;
  idxBenTd2: number | null;
  idxBenTdB: number | null;
  idxBenTd10: number | null;
  idxBenTd16: number | null;
  // Session Site Name column (drives session-site-wise analysis mode)
  idxSessionSite: number | null;
  // Column indices matching a known vaccine-dose "target" indicator (BCG, Penta1-3,
  // OPV1-3, MR1-2, RVV1-3, IPV1-3, PCV1-2, PCV Booster, HepB0, DPT boosters, etc.) —
  // used by t0 ("Indicators having 0 values but not blank") to scope its zero-check
  // to vaccine columns only, excluding Session Planned/Held/beneficiary/Td columns.
  targetIndicatorIndices: number[];
  indicatorMap: Record<string, number>;
  allIndicatorShorts: string[];
  facilityData: Record<string, FacilityRecord>;
  allMonths: Record<string, string>;
  globalFacilityCount: number;
  globalSessionSiteCount: number;
  globalBlockCount: number;
  publicCount: number;
  privateCount: number;
  ruralCount: number;
  urbanCount: number;
  stateName: string;
  distName: string;
  fileName: string;
}

// ---- T8: Avg beneficiaries per session < 10 ----

export interface T8MonthData {
  sessHeld: number | null;
  beneficiaries: number | null;
  avg: number | null;
  flag: boolean;
}

export interface T8Row {
  block: string;
  facility: string;
  sessionsite?: string;
  months: Record<string, T8MonthData>;
  allMonths: T8MonthData;
}

export interface T8Web {
  months: string[];
  monthLabels: Record<string, string>;
  rows: Record<string, T8Row>;
}

// ---- UWIN computed KPIs (superset of HMIS ComputedKpis) ----

export interface UwinComputedKpis {
  filteredFacilities: Record<string, FacilityRecord>;
  selMonths: string[];
  selMonthLabels: Record<string, string>;
  selVaxList: string[];

  // Analysis basis this result was computed with
  analysisMode: 'facility' | 'sessionsite';

  // Availability
  t0Rows: TableRows;
  t7Rows: TableRows;
  t9Rows: TableRows;
  t0Stat: KpiStat;
  t7Stat: KpiStat;
  t9Stat: KpiStat;
  t9HitMap: Record<string, Record<string, boolean>>;

  // Completeness
  t2Web: T2Web;
  t2Stat: KpiStat;
  blankCountsByVax: Record<string, number>;
  blankAllCountsByVax: Record<string, number>;

  // Accuracy
  t6Rows: TableRows;
  t6Stat: KpiStat;

  // t8: UWIN-specific (avg beneficiaries/session < 5)
  t8Stat: KpiStat;
  t8Web: T8Web;
  t8HitMap: Record<string, Record<string, boolean>>;

  t3Web: T3Web;
  t3Stat: KpiStat;
  t3HitMap: Record<string, Record<string, Record<string, boolean>>>;
  outAnyCounts: Record<string, number>;
  outAllCounts: Record<string, number>;

  dropTables: Record<string, DropoutWeb>;
  dropStats: Record<string, KpiStat>;
  dropPairMap: Record<string, { label: string; from: string; to: string }>;
  dropHitMap: Record<string, Record<string, Record<string, boolean>>>;

  // Consistency
  i1Rows: TableRows;
  i2Rows: TableRows;
  i1Stat: KpiStat;
  i2Stat: KpiStat;

  inconsTables: Record<string, TableRows>;
  inconsStats: Record<string, KpiStat>;
  inconsPairMap: Record<string, { from: string; to: string; label: string; pid: string }>;

  coTables: Record<string, CoAdminWeb>;
  coStats: Record<string, KpiStat>;

  charts: Record<string, ChartPayload>;
  cards: KpiCard[];
  pinkFacSets: Record<string, string[]>;

  globalDen: number;
  globalBlockCount: number;
  summaryByPid: Record<string, { any: SummaryRow[]; all: SummaryRow[]; overall?: SummaryRow[] }>;
}

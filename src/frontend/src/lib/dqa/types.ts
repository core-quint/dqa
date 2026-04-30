// ============================================================
// DQA Types
// ============================================================

export interface MonthData {
  label: string; // "Apr"
  yearMonth: string; // "Apr-25"
  raw: string;
  vals: Record<number, number | null>; // colIdx -> value
}

export interface FacilityRecord {
  block: string;
  facility: string;
  ownership: string; // "Public" | "Private" | "Mixed" | ""
  ru: string; // "Rural" | "Urban" | "Mixed" | ""
  months: Record<string, MonthData>; // YYYY-MM -> MonthData
}

export interface ParsedCSV {
  portal: 'HMIS';
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
  indicatorMap: Record<string, number>; // short -> colIdx (e.g. "BCG" -> 5)
  allIndicatorShorts: string[]; // ordered list of all shorts after Month col
  facilityData: Record<string, FacilityRecord>; // key (block||fac) -> record
  allMonths: Record<string, string>; // YYYY-MM -> short label
  globalFacilityCount: number;
  globalBlockCount: number;
  publicCount: number;
  privateCount: number;
  ruralCount: number;
  urbanCount: number;
  stateName: string;
  distName: string;
  fileName: string;
}

export interface FilterState {
  blocks: string[];
  months: string[]; // YYYY-MM keys
  ownership: string[]; // "Public" | "Private"
  ru: string[]; // "Rural" | "Urban"
  outliersVax: string[]; // base vaccines for outliers/completeness
  addVax: string[]; // additional vaccines
  outliersInc: string[]; // INC_LOW | INC_MOD | INC_EXT
  outliersDrop: string[]; // DROP_LOW | DROP_MOD | DROP_EXT
  dropRanges: string[]; // R5_10 | R11_20 | R20P
  dropPairs: string[]; // e.g. ["Penta1→Penta3"]
  dropFrom: string[]; // custom pair builder from
  dropTo: string[]; // custom pair builder to
  inconsFrom: string[]; // inconsistency pair builder from
  inconsTo: string[]; // inconsistency pair builder to
  activeGroup: string;
}

// KPI stat structure
export interface KpiStat {
  total: number;
  any: number;
  all: number;
  facilityKeys: Set<string>;
  anyFacilityKeys: Set<string>;
  allFacilityKeys: Set<string>;
}

// Flat table rows for display/export
export type TableRows = (string | number | null)[][];

// For t2: missing indicator matrix
export interface T2MatrixRow {
  block: string;
  facility: string;
  cells: Record<string, Record<string, string>>; // vax -> YYYY-MM -> "Y"|"N"
}

export interface T2Web {
  vaccines: string[];
  months: string[];
  monthLabels: Record<string, string>;
  rows: Record<string, T2MatrixRow>;
}

// For t3: outliers
export interface T3Cell {
  a: number | null;
  b: number | null;
  pct: number | null;
  hit: boolean;
}

export interface T3MatrixRow {
  block: string;
  facility: string;
  cells: Record<string, Record<string, T3Cell>>; // vax -> pairKey -> cell
}

export interface PairMeta {
  k: string; // "YYYY-MM|YYYY-MM"
  m1: string;
  m2: string;
  m1lbl: string;
  m2lbl: string;
}

export interface T3Web {
  vaccines: string[];
  pairs: PairMeta[];
  rows: Record<string, T3MatrixRow>;
}

// For dropouts
export interface DropoutCell {
  from: number | null;
  to: number | null;
  pct: number | null;
}

export interface DropoutRow {
  block: string;
  facility: string;
  cells: Record<string, DropoutCell>; // YYYY-MM -> cell
  all: DropoutCell;
}

export interface DropoutWeb {
  pairLabel: string;
  from: string;
  to: string;
  months: string[];
  monthLabels: Record<string, string>;
  rows: Record<string, DropoutRow>;
}

// For co-admin
export interface CoAdminRow {
  block: string;
  facility: string;
  vals: Record<string, Record<string, number | null>>; // YYYY-MM -> vax -> val
  totals: Record<string, number | null>;
}

export interface CoAdminWeb {
  key: string;
  vaccines: string[];
  months: string[];
  monthLabels: Record<string, string>;
  rows: Record<string, CoAdminRow>;
}

// Chart data
export interface ChartPayload {
  labels: string[];
  values: number[];
  color: string;
}

// KPI card
export interface KpiCard {
  id: string;
  name: string;
  stat: KpiStat;
  group: string;
  downloadKey: string;
}

// Computed results
export interface ComputedKpis {
  filteredFacilities: Record<string, FacilityRecord>;
  selMonths: string[];
  selMonthLabels: Record<string, string>;
  selVaxList: string[];

  // Availability
  t1Rows: TableRows;
  t0Rows: TableRows;
  t7Rows: TableRows;
  t1Stat: KpiStat;
  t0Stat: KpiStat;
  t7Stat: KpiStat;

  // Completeness
  t2Web: T2Web;
  t2Stat: KpiStat;
  blankCountsByVax: Record<string, number>;
  blankAllCountsByVax: Record<string, number>;

  // Accuracy
  t6Rows: TableRows;
  t6Stat: KpiStat;

  t3Web: T3Web;
  t3Stat: KpiStat;
  t3HitMap: Record<string, Record<string, Record<string, boolean>>>; // facKey -> YYYY-MM -> vax -> bool
  outAnyCounts: Record<string, number>;
  outAllCounts: Record<string, number>;

  dropTables: Record<string, DropoutWeb>;
  dropStats: Record<string, KpiStat>;
  dropPairMap: Record<string, { label: string; from: string; to: string }>;
  dropHitMap: Record<string, Record<string, Record<string, boolean>>>; // pairKey -> facKey -> YYYY-MM -> bool

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

  // Charts
  charts: Record<string, ChartPayload>;

  // Cards list
  cards: KpiCard[];

  // For highlighted export (pink_fac_sets)
  pinkFacSets: Record<string, string[]>; // KPI key -> array of facKeys

  // Overall score
  globalDen: number;
  globalBlockCount: number;

  // Summary by pid
  summaryByPid: Record<string, { any: SummaryRow[]; all: SummaryRow[]; overall?: SummaryRow[] }>;
}

export interface SummaryRow {
  name: string;
  count: number;
  pct: number;
}

export type ActiveGroup = 'availability' | 'completeness' | 'accuracy' | 'consistency' | '';

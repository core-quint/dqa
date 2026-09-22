export type StateHmisGroup =
  | "availability"
  | "completeness"
  | "accuracy"
  | "consistency";

export interface StateHmisItem {
  code: string;
  name: string;
  category: string;
  short: string;
}

export interface StateHmisMonthRecord {
  month: string;
  values: Record<string, number | null>;
  invalidCodes: string[];
  sourceFile: string;
}

export interface StateHmisDistrictRecord {
  district: string;
  months: Record<string, StateHmisMonthRecord>;
}

export type StateHmisReportLevel = "district" | "block";

export interface StateHmisUnitRecord {
  id: string;
  district: string;
  block: string | null;
  months: Record<string, StateHmisMonthRecord>;
}

export interface StateHmisFileSummary {
  fileName: string;
  stateName: string;
  month: string;
  districtCount: number;
  blockCount: number;
  reportLevel: StateHmisReportLevel;
  itemCount: number;
  m2ItemCount: number;
  m9ItemCount: number;
  districts: string[];
  unitIds: string[];
  itemCodes: string[];
}

export interface StateHmisValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  fileName?: string;
}

export interface StateHmisParsed {
  portal: "HMIS_STATE";
  stateName: string;
  reportLevel: StateHmisReportLevel;
  fileNames: string[];
  districts: string[];
  blocks: { id: string; district: string; block: string }[];
  blocksByDistrict: Record<string, string[]>;
  months: Record<string, string>;
  items: Record<string, StateHmisItem>;
  orderedItemCodes: string[];
  districtData: Record<string, StateHmisDistrictRecord>;
  unitData: Record<string, StateHmisUnitRecord>;
  fileSummaries: StateHmisFileSummary[];
  validationIssues: StateHmisValidationIssue[];
}

export interface StateHmisFilters {
  districts: string[];
  blocks: string[];
  months: string[];
  keyIndicators: string[];
  outlierSeverity: "low" | "moderate" | "extreme";
  /** Minimum cumulative dropout over the selected period (5 / 10 / 20%). */
  dropoutThreshold: 5 | 10 | 20;
  /** District/block totals aggregate many facilities, so co-admin allows a % spread. */
  coadminTolerance: 5 | 10 | 20;
  additionalPairs: { from: string; to: string }[];
}

export interface StateHmisHit {
  flag: boolean;
  /** false when this unit-month could not be checked. */
  evaluable?: boolean;
  detail: string;
  values?: Record<string, number | null>;
}

export interface StateHmisCard {
  id: string;
  name: string;
  description: string;
  group: StateHmisGroup;
  total: number;
  any: number;
  all: number;
  /** Units this check could be evaluated for; 0 makes the KPI N/A. */
  eligible: number;
  eligibleUnits: string[];
  /** Analysis-unit ids; retained name keeps older district reports compatible. */
  affectedDistricts: string[];
  affectedUnits: string[];
  /** "month": flagged per month. "period": flagged on the selected period's totals. */
  basis: "month" | "period";
  /** Monthly detail (for period checks, context only — the flag is `periodHits`). */
  hits: Record<string, Record<string, StateHmisHit>>;
  periodHits?: Record<string, StateHmisHit>;
}

export interface StateHmisComponentScore {
  group: StateHmisGroup;
  /** null = N/A: none of this component's checks could run. */
  score: number | null;
  worstIssuePct: number | null;
}

export interface StateHmisComputed {
  cards: StateHmisCard[];
  selectedUnits: string[];
  selectedDistricts: string[];
  selectedMonths: string[];
  denominator: number;
  componentScores: Record<StateHmisGroup, StateHmisComponentScore>;
  /** null when nothing in the selection could be scored ("No data"). */
  overallScore: number | null;
  scoredComponents: number;
  totalComponents: number;
  /** True when the analysis settings differ from the standard scoring settings. */
  customMethod: boolean;
  issueCountByUnit: Record<string, number>;
  issueNamesByUnit: Record<string, string[]>;
  /** Analysis-unit keyed compatibility aliases. */
  issueCountByDistrict: Record<string, number>;
  issueNamesByDistrict: Record<string, string[]>;
  districtRollups: Record<string, {
    unitCount: number;
    affectedUnitCount: number;
    issueCount: number;
    issueNames: string[];
  }>;
}

export const STATE_HMIS_KEY_INDICATORS = [
  "BCG",
  "Penta1",
  "Penta3",
  "OPV1",
  "OPV3",
  "MR1",
  "MR2",
] as const;

export const DEFAULT_STATE_HMIS_FILTERS: StateHmisFilters = {
  districts: [],
  blocks: [],
  months: [],
  keyIndicators: [...STATE_HMIS_KEY_INDICATORS],
  outlierSeverity: "extreme",
  dropoutThreshold: 20,
  coadminTolerance: 10,
  additionalPairs: [],
};

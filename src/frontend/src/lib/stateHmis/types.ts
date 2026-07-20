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
  dropoutThreshold: 5 | 11 | 20;
  coadminTolerance: 5 | 10 | 20;
  additionalPairs: { from: string; to: string }[];
}

export interface StateHmisHit {
  flag: boolean;
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
  /** Analysis-unit ids; retained name keeps older district reports compatible. */
  affectedDistricts: string[];
  affectedUnits: string[];
  hits: Record<string, Record<string, StateHmisHit>>;
}

export interface StateHmisComponentScore {
  group: StateHmisGroup;
  score: number;
  worstIssuePct: number;
}

export interface StateHmisComputed {
  cards: StateHmisCard[];
  selectedUnits: string[];
  selectedDistricts: string[];
  selectedMonths: string[];
  denominator: number;
  componentScores: Record<StateHmisGroup, StateHmisComponentScore>;
  overallScore: number;
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

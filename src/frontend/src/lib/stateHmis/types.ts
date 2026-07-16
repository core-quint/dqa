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

export interface StateHmisFileSummary {
  fileName: string;
  stateName: string;
  month: string;
  districtCount: number;
  itemCount: number;
  m2ItemCount: number;
  m9ItemCount: number;
  districts: string[];
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
  fileNames: string[];
  districts: string[];
  months: Record<string, string>;
  items: Record<string, StateHmisItem>;
  orderedItemCodes: string[];
  districtData: Record<string, StateHmisDistrictRecord>;
  fileSummaries: StateHmisFileSummary[];
  validationIssues: StateHmisValidationIssue[];
}

export interface StateHmisFilters {
  districts: string[];
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
  affectedDistricts: string[];
  hits: Record<string, Record<string, StateHmisHit>>;
}

export interface StateHmisComponentScore {
  group: StateHmisGroup;
  score: number;
  worstIssuePct: number;
}

export interface StateHmisComputed {
  cards: StateHmisCard[];
  selectedDistricts: string[];
  selectedMonths: string[];
  denominator: number;
  componentScores: Record<StateHmisGroup, StateHmisComponentScore>;
  overallScore: number;
  issueCountByDistrict: Record<string, number>;
  issueNamesByDistrict: Record<string, string[]>;
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
  months: [],
  keyIndicators: [...STATE_HMIS_KEY_INDICATORS],
  outlierSeverity: "extreme",
  dropoutThreshold: 20,
  coadminTolerance: 10,
  additionalPairs: [],
};

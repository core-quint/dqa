export type PctsGroup =
  | "availability"
  | "completeness"
  | "accuracy"
  | "consistency";

export type PctsRuralUrban = "Rural" | "Urban";
export type PctsOwnership = "Public" | "Private";

export type PctsIndicatorFamily =
  | "BCG"
  | "DPT"
  | "Pentavalent"
  | "OPV"
  | "Rotavirus"
  | "PCV"
  | "FIPV"
  | "MR"
  | "Hepatitis B"
  | "Td(PW)"
  | "TD"
  | "Vitamin A"
  | "JE"
  | "Fully Immunized"
  | "Other";

export interface PctsIndicator {
  /** Stable machine key used in value records and filters. */
  id: string;
  /** Short display name used in cards and tables. */
  label: string;
  family: PctsIndicatorFamily;
  dose?: string;
  /** Zero is meaningful, but this item is not included in the default service-availability set. */
  structuralZero?: boolean;
  /** Zero-based worksheet column in the standard PCTS template. */
  sourceColumn: number;
  sourceHeader: string;
}

export interface PctsMonthRecord {
  month: string;
  values: Record<string, number | null>;
  invalidIndicators: string[];
  rawInvalidValues: Record<string, string>;
  sourceFile: string;
  sourceRow: number;
}

export interface PctsFacilityRecord {
  key: string;
  serialNumber: number | null;
  block: string;
  facility: string;
  ruralUrban: PctsRuralUrban;
  ownership: PctsOwnership;
  facilityType: string;
  months: Record<string, PctsMonthRecord>;
}

export type PctsTotalKind =
  | "rural"
  | "urban"
  | "block"
  | "urban_units"
  | "district";

export interface PctsTotalRecord {
  key: string;
  kind: PctsTotalKind;
  label: string;
  block: string | null;
  ruralUrban: PctsRuralUrban | null;
  month: string;
  values: Record<string, number | null>;
  invalidIndicators: string[];
  rawInvalidValues: Record<string, string>;
  sourceFile: string;
  sourceRow: number;
}

export interface PctsFileSummary {
  fileName: string;
  sheetName: string;
  stateName: string;
  districtName: string;
  month: string;
  monthLabel: string;
  generatedAt: string | null;
  blockCount: number;
  facilityCount: number;
  ruralCount: number;
  urbanCount: number;
  publicCount: number;
  privateCount: number;
  facilityTypes: string[];
  indicatorCount: number;
  indicatorIds: string[];
  schemaFingerprint: string;
  reconciliationIssueCount: number;
}

export interface PctsValidationIssue {
  severity: "warning" | "info" | "error";
  code: string;
  message: string;
  fileName?: string;
  month?: string;
  block?: string;
  facility?: string;
  indicator?: string;
  sourceRow?: number;
  expected?: number | string;
  actual?: number | string | null;
}

export interface PctsParsed {
  portal: "PCTS";
  stateName: string;
  districtName: string;
  fileNames: string[];
  months: Record<string, string>;
  blocks: string[];
  facilityTypes: string[];
  facilities: Record<string, PctsFacilityRecord>;
  indicators: PctsIndicator[];
  orderedIndicatorIds: string[];
  totalsByMonth: Record<string, PctsTotalRecord[]>;
  fileSummaries: PctsFileSummary[];
  validationIssues: PctsValidationIssue[];
  globalFacilityCount: number;
  globalBlockCount: number;
  publicCount: number;
  privateCount: number;
  ruralCount: number;
  urbanCount: number;
}

export interface PctsPair {
  from: string;
  to: string;
}

export interface PctsFilters {
  blocks: string[];
  months: string[];
  ruralUrban: PctsRuralUrban[];
  ownership: PctsOwnership[];
  facilityTypes: string[];
  keyIndicators: string[];
  outlierSeverity: "low" | "moderate" | "extreme";
  dropoutThreshold: 5 | 11 | 20;
  coadminTolerance: 5 | 10 | 20;
  /** User-defined later-dose consistency comparisons. */
  additionalPairs: PctsPair[];
  issuesOnly: boolean;
  /** Optional exact facility selection; missing or empty means all matching facilities. */
  facilityKeys?: string[];
  /** Indicators added to keyIndicators; missing or empty means no additional indicators. */
  additionalIndicators?: string[];
  dropoutPairs?: PctsPair[];
}

export interface PctsHit {
  flag: boolean;
  detail: string;
  values?: Record<string, number | null>;
  indicators?: string[];
}

export interface PctsCard {
  id: string;
  name: string;
  description: string;
  group: PctsGroup;
  /** Facilities affected in at least one evaluated month. */
  total: number;
  /** Facilities affected in some, but not all, evaluated months. */
  any: number;
  /** Facilities affected in every evaluated month. */
  all: number;
  affectedFacilities: string[];
  hits: Record<string, Record<string, PctsHit>>;
}

export interface PctsComponentScore {
  group: PctsGroup;
  score: number;
  worstIssuePct: number;
}

export interface PctsBlockSummary {
  block: string;
  denominator: number;
  affectedFacilities: number;
  componentScores: Record<PctsGroup, PctsComponentScore>;
  overallScore: number;
}

export interface PctsComputed {
  cards: PctsCard[];
  selectedFacilityKeys: string[];
  /** When issuesOnly is enabled, this is the affected subset; scoring still uses the selected denominator. */
  visibleFacilityKeys: string[];
  selectedMonths: string[];
  denominator: number;
  componentScores: Record<PctsGroup, PctsComponentScore>;
  overallScore: number;
  issueCountByFacility: Record<string, number>;
  issueNamesByFacility: Record<string, string[]>;
  blockSummaries: Record<string, PctsBlockSummary>;
}

export interface PctsParseOptions {
  /** When supplied, a different district is a hard validation error. */
  expectedDistrictName?: string;
  /** Defaults to Rajasthan. */
  expectedStateName?: string;
}

export interface PctsFileParseResult {
  summary: PctsFileSummary;
  indicators: PctsIndicator[];
  facilities: PctsFacilityRecord[];
  totals: PctsTotalRecord[];
  validationIssues: PctsValidationIssue[];
}

export const PCTS_INDICATORS: readonly PctsIndicator[] = [
  { id: "bcg", label: "BCG", family: "BCG", sourceColumn: 2, sourceHeader: "BCG" },
  { id: "dptFirstBooster", label: "DPT 1st Booster", family: "DPT", sourceColumn: 3, sourceHeader: "DPT Ist Booster" },
  { id: "dpt1", label: "DPT 1", family: "DPT", dose: "1", structuralZero: true, sourceColumn: 4, sourceHeader: "DPT 1" },
  { id: "dpt2", label: "DPT 2", family: "DPT", dose: "2", structuralZero: true, sourceColumn: 5, sourceHeader: "DPT 2" },
  { id: "dpt3", label: "DPT 3", family: "DPT", dose: "3", structuralZero: true, sourceColumn: 6, sourceHeader: "DPT 3" },
  { id: "dptBooster", label: "DPT Booster", family: "DPT", dose: "B", structuralZero: true, sourceColumn: 7, sourceHeader: "DPT B" },
  { id: "penta1", label: "Penta 1", family: "Pentavalent", dose: "1", sourceColumn: 8, sourceHeader: "Pentavalent 1" },
  { id: "penta2", label: "Penta 2", family: "Pentavalent", dose: "2", sourceColumn: 9, sourceHeader: "Pentavalent 2" },
  { id: "penta3", label: "Penta 3", family: "Pentavalent", dose: "3", sourceColumn: 10, sourceHeader: "Pentavalent 3" },
  { id: "opv0", label: "OPV 0", family: "OPV", dose: "0", sourceColumn: 11, sourceHeader: "OPV 0" },
  { id: "opv1", label: "OPV 1", family: "OPV", dose: "1", sourceColumn: 12, sourceHeader: "OPV 1" },
  { id: "opv2", label: "OPV 2", family: "OPV", dose: "2", sourceColumn: 13, sourceHeader: "OPV 2" },
  { id: "opv3", label: "OPV 3", family: "OPV", dose: "3", sourceColumn: 14, sourceHeader: "OPV 3" },
  { id: "opvBooster", label: "OPV Booster", family: "OPV", dose: "B", sourceColumn: 15, sourceHeader: "OPV B" },
  { id: "rota1", label: "ROTA 1", family: "Rotavirus", dose: "1", sourceColumn: 16, sourceHeader: "ROTA 1" },
  { id: "rota2", label: "ROTA 2", family: "Rotavirus", dose: "2", sourceColumn: 17, sourceHeader: "ROTA 2" },
  { id: "rota3", label: "ROTA 3", family: "Rotavirus", dose: "3", sourceColumn: 18, sourceHeader: "ROTA 3" },
  { id: "pcv1", label: "PCV 1", family: "PCV", dose: "1", sourceColumn: 19, sourceHeader: "PCV 1" },
  { id: "pcv2", label: "PCV 2", family: "PCV", dose: "2", sourceColumn: 20, sourceHeader: "PCV 2" },
  { id: "pcvBooster", label: "PCV Booster", family: "PCV", dose: "B", sourceColumn: 21, sourceHeader: "PCV B" },
  { id: "fipv1", label: "FIPV 1", family: "FIPV", dose: "1", sourceColumn: 22, sourceHeader: "FIPV 1" },
  { id: "fipv2", label: "FIPV 2", family: "FIPV", dose: "2", sourceColumn: 23, sourceHeader: "FIPV 2" },
  { id: "fipv3", label: "FIPV 3", family: "FIPV", dose: "3", sourceColumn: 24, sourceHeader: "FIPV 3" },
  { id: "mr1", label: "MR 1", family: "MR", dose: "1", sourceColumn: 25, sourceHeader: "MR-1 1" },
  { id: "mr2", label: "MR 2", family: "MR", dose: "2", sourceColumn: 26, sourceHeader: "MR-1 2" },
  { id: "hepb0", label: "Hepatitis B 0", family: "Hepatitis B", dose: "0", sourceColumn: 27, sourceHeader: "Hepatitis B 0" },
  { id: "hepb1", label: "Hepatitis B 1", family: "Hepatitis B", dose: "1", structuralZero: true, sourceColumn: 28, sourceHeader: "Hepatitis B 1" },
  { id: "hepb2", label: "Hepatitis B 2", family: "Hepatitis B", dose: "2", structuralZero: true, sourceColumn: 29, sourceHeader: "Hepatitis B 2" },
  { id: "hepb3", label: "Hepatitis B 3", family: "Hepatitis B", dose: "3", structuralZero: true, sourceColumn: 30, sourceHeader: "Hepatitis B 3" },
  { id: "tdPw1", label: "Td(PW) 1", family: "Td(PW)", dose: "1", sourceColumn: 31, sourceHeader: "Td(PW) 1" },
  { id: "tdPw2", label: "Td(PW) 2", family: "Td(PW)", dose: "2", sourceColumn: 32, sourceHeader: "Td(PW) 2" },
  { id: "tdPwBooster", label: "Td(PW) Booster", family: "Td(PW)", dose: "B", sourceColumn: 33, sourceHeader: "Td(PW) B" },
  { id: "dpt5", label: "DPT 5", family: "DPT", dose: "5", sourceColumn: 34, sourceHeader: "DPT 5" },
  { id: "td10", label: "TD 10", family: "TD", dose: "10", sourceColumn: 35, sourceHeader: "TD 10" },
  { id: "td16", label: "TD 16", family: "TD", dose: "16", sourceColumn: 36, sourceHeader: "TD 16" },
  { id: "vitaminA1", label: "Vitamin A Dose 1", family: "Vitamin A", dose: "1", sourceColumn: 37, sourceHeader: "Vitamin A Dose 1" },
  { id: "vitaminA5", label: "Vitamin A Dose 5", family: "Vitamin A", dose: "5", sourceColumn: 38, sourceHeader: "Vitamin A Dose 5" },
  { id: "vitaminA9", label: "Vitamin A Dose 9", family: "Vitamin A", dose: "9", sourceColumn: 39, sourceHeader: "Vitamin A Dose 9" },
  { id: "jeVaccine", label: "JE Vaccine", family: "JE", structuralZero: true, sourceColumn: 40, sourceHeader: "JE Vaccine" },
  { id: "fullyImmunized", label: "Fully Immunized", family: "Fully Immunized", sourceColumn: 41, sourceHeader: "Fully Immunized" },
] as const;

export const PCTS_KEY_INDICATORS = [
  "bcg",
  "penta1",
  "penta3",
  "opv1",
  "opv3",
  "mr1",
  "mr2",
  "fullyImmunized",
] as const;

export const DEFAULT_PCTS_FILTERS: PctsFilters = {
  blocks: [],
  months: [],
  ruralUrban: [],
  ownership: [],
  facilityTypes: [],
  keyIndicators: [...PCTS_KEY_INDICATORS],
  outlierSeverity: "extreme",
  dropoutThreshold: 20,
  coadminTolerance: 10,
  additionalPairs: [],
  issuesOnly: false,
};

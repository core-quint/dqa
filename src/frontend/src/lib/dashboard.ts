// ============================================================
// Pure aggregation logic for the DQA Analytics Dashboard.
// No React, no Firebase — keep it this way so the logic stays
// verifiable with the esbuild+Node harness technique.
// ============================================================
import type { SnapshotRecord, TrendBasis } from "./snapshots";
import {
  getDataPeriod,
  getSnapshotBlock,
  getSnapshotDqaLevel,
  monthsBetween,
  normalizePortal,
} from "./snapshots";
import type { DistrictScope } from "./maps/priorityDistricts";
import {
  inDistrictScope,
  isPriorityDistrict,
  isPriorityState,
  priorityDistrictNames,
} from "./maps/priorityDistricts";

export type { TrendBasis, DistrictScope };

export const NOT_RECORDED = "Not recorded";

// State/district names arrive in whatever casing the source CSV used
// ("UTTAR PRADESH" vs "Uttar Pradesh") — group on a normalized key and
// display a title-cased form.
export function geoKey(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function titleCaseGeo(s: string | null | undefined): string {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export interface DashboardRecord {
  id: string;
  portal: "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
  state: string;
  stateKey: string;
  district: string;
  districtKey: string;
  block: string | null;
  blockKey: string | null;
  dqaLevel: "STATE" | "DISTRICT" | "BLOCK";
  analysisGranularity: "DISTRICT" | "BLOCK" | null;
  createdAtMs: number;
  monthKey: string; // YYYY-MM of the review date (local time)
  periodStart: string | null;
  periodEnd: string | null;
  /** Every month of data the review analysed; empty when the period was never recorded. */
  periodMonths: string[];
  /** How many months of data this one DQA session covered; null when unrecorded. */
  durationMonths: number | null;
  designation: string;
  purpose: string;
  purposeDetail: string | null;
  savedBy: string | null;
  /** Level of the account that saved the review (NATIONAL / STATE / ...). */
  savedByLevel: string | null;
  /** The saving account's own geography, e.g. "Uttar Pradesh / Agra". */
  savedByGeo: string | null;
  /** The duration label stored with the snapshot ("Apr 2025 - Jun 2025", "3 months", ...). */
  reportingMonth: string;
  overall: number;
  availability: number | null;
  completeness: number | null; // always null for U-WIN (portal has no completeness KPIs)
  accuracy: number | null;
  consistency: number | null;
  blockCount: number | null;
  facilityCount: number | null;
  sessionSiteCount: number | null;
  districtCount: number | null;
}

export function toDashboardRecord(s: SnapshotRecord): DashboardRecord | null {
  if (!s.createdAt) return null;
  const created = new Date(s.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const portal = normalizePortal(s.portal);
  const dqaLevel = getSnapshotDqaLevel(s);
  const block = getSnapshotBlock(s);
  const isStateDqa = portal === "HMIS_STATE" || portal === "UWIN_STATE" || dqaLevel === "STATE";
  const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
  // Validated in lib/snapshots — no createdAt fallback, so a review is never
  // attributed to months it did not analyse.
  const period = getDataPeriod(s);
  const periodMonths = period ? monthsBetween(period.start, period.end) : [];
  return {
    id: s.id,
    portal,
    state: titleCaseGeo(s.state),
    stateKey: geoKey(s.state),
    district: isStateDqa ? "" : titleCaseGeo(s.district),
    districtKey: isStateDqa ? "" : geoKey(s.district),
    block: block ? titleCaseGeo(block) : null,
    blockKey: block ? geoKey(block) : null,
    dqaLevel,
    analysisGranularity: s.kpiData?.analysisGranularity ?? null,
    createdAtMs: created.getTime(),
    monthKey,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    periodMonths,
    durationMonths: periodMonths.length || null,
    designation: s.kpiData?.designation?.trim() || NOT_RECORDED,
    purpose: s.kpiData?.purpose?.trim() || NOT_RECORDED,
    purposeDetail: s.kpiData?.purposeDetail?.trim() || null,
    savedBy: s.createdBy?.email ?? null,
    savedByLevel: s.createdBy?.level?.trim() || null,
    savedByGeo:
      [s.createdBy?.geoState, s.createdBy?.geoDistrict, s.createdBy?.geoBlock]
        .map((part) => titleCaseGeo(part))
        .filter(Boolean)
        .join(" / ") || null,
    reportingMonth: s.reportingMonth?.trim() || "",
    overall: s.overallScore ?? 0,
    availability: s.kpiData?.availabilityScore ?? null,
    completeness: portal === "UWIN" || portal === "UWIN_STATE" ? null : (s.kpiData?.completenessScore ?? null),
    accuracy: s.kpiData?.accuracyScore ?? null,
    consistency: s.kpiData?.consistencyScore ?? null,
    blockCount: s.kpiData?.blockCount ?? null,
    facilityCount: s.kpiData?.facilityCount ?? null,
    sessionSiteCount: s.kpiData?.sessionSiteCount ?? null,
    districtCount: s.kpiData?.districtCount ?? null,
  };
}

// ---------------------------------------------------------------
// Filters
// ---------------------------------------------------------------

export interface DashboardFilters {
  /**
   * Which time axis the whole dashboard is built on — the month a review was
   * saved ("review") or the months of data it analysed ("period").
   */
  basis: TrendBasis;
  /** Duration bucket key from `durationBucketKey`, "" = all durations. */
  duration: string;
  portal: "ALL" | "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
  dqaLevel: "ALL" | "STATE" | "DISTRICT" | "BLOCK";
  granularity: "ALL" | "DISTRICT" | "BLOCK";
  /** "PRIORITY" keeps only reviews inside the Gavi intervention districts. */
  districtScope: DistrictScope;
  state: string; // stateKey, "" = all
  district: string; // districtKey, "" = all
  block: string; // blockKey, "" = all
  designation: string; // "" = all
  purpose: string; // "" = all
  dateFrom: string; // yyyy-mm-dd, "" = open
  dateTo: string; // yyyy-mm-dd, "" = open
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  basis: "review",
  duration: "",
  portal: "ALL",
  dqaLevel: "ALL",
  granularity: "ALL",
  districtScope: "ALL",
  state: "",
  district: "",
  block: "",
  designation: "",
  purpose: "",
  dateFrom: "",
  dateTo: "",
};

export function applyDashboardFilters(
  records: DashboardRecord[],
  f: DashboardFilters,
): DashboardRecord[] {
  const fromMs = f.dateFrom ? new Date(`${f.dateFrom}T00:00:00`).getTime() : null;
  const toMs = f.dateTo ? new Date(`${f.dateTo}T23:59:59.999`).getTime() : null;
  const fromMonth = f.dateFrom ? f.dateFrom.slice(0, 7) : "";
  const toMonth = f.dateTo ? f.dateTo.slice(0, 7) : "";
  return records.filter((r) => {
    if (f.duration && durationBucketKey(r) !== f.duration) return false;
    if (f.portal !== "ALL" && r.portal !== f.portal) return false;
    if (f.dqaLevel !== "ALL" && r.dqaLevel !== f.dqaLevel) return false;
    if (f.granularity !== "ALL" && r.analysisGranularity !== f.granularity) return false;
    // State DQAs carry no district of their own, so they qualify on their state.
    if (!inDistrictScope(f.districtScope, r.stateKey, r.districtKey)) return false;
    if (f.state && r.stateKey !== f.state) return false;
    if (f.district && r.districtKey !== f.district) return false;
    if (f.block && r.blockKey !== f.block) return false;
    if (f.designation && r.designation !== f.designation) return false;
    if (f.purpose && r.purpose !== f.purpose) return false;
    if (f.basis === "period") {
      // Month-grain overlap: keep any review whose analysed period intersects the
      // window. A review with no recorded period can only survive an open window.
      if (r.periodMonths.length === 0) return !fromMonth && !toMonth;
      if (fromMonth && r.periodEnd! < fromMonth) return false;
      if (toMonth && r.periodStart! > toMonth) return false;
      return true;
    }
    if (fromMs !== null && r.createdAtMs < fromMs) return false;
    if (toMs !== null && r.createdAtMs > toMs) return false;
    return true;
  });
}

/** Month buckets a record contributes to on the selected axis. */
export function recordMonths(r: DashboardRecord, basis: TrendBasis): string[] {
  return basis === "review" ? [r.monthKey] : r.periodMonths;
}

// ---------------------------------------------------------------
// Headline stats
// ---------------------------------------------------------------

export interface DashboardStats {
  total: number;
  hmis: number;
  uwin: number;
  pcts: number;
  stateHmis: number;
  states: number;
  districts: number;
  /** Estimated blocks covered — see coverage-estimator note below. */
  blocks: number;
  /** Estimated unique facilities covered, reconciled at district/state grain. */
  facilities: number;
  /** Estimated session sites covered (U-WIN only). */
  sessionSites: number;
  reviewers: number;
  avgOverall: number | null;
  avgAvailability: number | null;
  avgCompleteness: number | null; // HMIS and PCTS records only
  avgAccuracy: number | null;
  avgConsistency: number | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Coverage estimator: snapshots store per-dataset totals (blockCount /
// facilityCount / sessionSiteCount), not identity lists. Take the widest saved
// review at each geography across every portal, then reconcile state totals
// against their district roll-up. Repeat reviews and cross-portal snapshots of
// the same geography therefore never add to the footprint more than once.
export function computeDashboardStats(
  records: DashboardRecord[],
  scope: DistrictScope = "ALL",
): DashboardStats {
  const states = new Set<string>();
  const reviewers = new Set<string>();

  const maxBlockCount = new Map<string, number>(); // state|district -> max blockCount
  const blockNames = new Map<string, Set<string>>(); // state|district -> unique block names
  const maxDistrictFacility = new Map<string, number>(); // state|district -> max facilityCount
  const maxStateFacility = new Map<string, number>(); // state -> max facilityCount
  const maxDistrictSessionSites = new Map<string, number>(); // state|district -> max sessionSiteCount
  const maxStateSessionSites = new Map<string, number>(); // state -> max sessionSiteCount
  const explicitDistrictsByState = new Map<string, Set<string>>();
  const maxStateDistrictCount = new Map<string, number>();
  const maxStateBlockCount = new Map<string, number>();

  let hmis = 0;
  let uwin = 0;
  let pcts = 0;
  let stateHmis = 0;

  for (const r of records) {
    if (r.portal === "HMIS_STATE") stateHmis += 1;
    else if (r.portal === "UWIN_STATE" || r.portal === "UWIN") uwin += 1;
    else if (r.portal === "PCTS") pcts += 1;
    else hmis += 1;
    if (r.stateKey) states.add(r.stateKey);
    const dKey = `${r.stateKey}|${r.districtKey}`;
    const stateLevel = r.dqaLevel === "STATE" || r.portal === "HMIS_STATE" || r.portal === "UWIN_STATE";
    if (!stateLevel && r.stateKey && r.districtKey) {
      const set = explicitDistrictsByState.get(r.stateKey) ?? new Set<string>();
      set.add(r.districtKey);
      explicitDistrictsByState.set(r.stateKey, set);
    }
    if (stateLevel && r.stateKey && r.districtCount !== null) {
      // A statewide review's dataset spans every district in the state. Under
      // the Gavi scope only the programme's districts count, so cap the claim
      // at how many of that state's districts the programme actually names.
      const cap = scope === "PRIORITY" ? priorityDistrictNames(r.stateKey).length : r.districtCount;
      maxStateDistrictCount.set(
        r.stateKey,
        Math.max(maxStateDistrictCount.get(r.stateKey) ?? 0, Math.min(r.districtCount, cap)),
      );
    }
    if (r.savedBy) reviewers.add(r.savedBy);

    if (r.blockCount !== null) {
      if (stateLevel && r.stateKey) {
        maxStateBlockCount.set(r.stateKey, Math.max(maxStateBlockCount.get(r.stateKey) ?? 0, r.blockCount));
      } else if (r.stateKey && r.districtKey && r.blockCount > (maxBlockCount.get(dKey) ?? 0)) {
        maxBlockCount.set(dKey, r.blockCount);
      }
    }
    if (!stateLevel && r.stateKey && r.districtKey && r.blockKey) {
      const set = blockNames.get(dKey) ?? new Set<string>();
      set.add(r.blockKey);
      blockNames.set(dKey, set);
    }
    if (r.facilityCount !== null && r.stateKey) {
      if (stateLevel) {
        maxStateFacility.set(r.stateKey, Math.max(maxStateFacility.get(r.stateKey) ?? 0, r.facilityCount));
      } else if (r.districtKey) {
        maxDistrictFacility.set(dKey, Math.max(maxDistrictFacility.get(dKey) ?? 0, r.facilityCount));
      }
    }
    if (
      (r.portal === "UWIN" || r.portal === "UWIN_STATE") &&
      r.sessionSiteCount !== null &&
      r.stateKey
    ) {
      if (stateLevel) {
        maxStateSessionSites.set(r.stateKey, Math.max(maxStateSessionSites.get(r.stateKey) ?? 0, r.sessionSiteCount));
      } else if (r.districtKey) {
        maxDistrictSessionSites.set(dKey, Math.max(maxDistrictSessionSites.get(dKey) ?? 0, r.sessionSiteCount));
      }
    }
  }

  // Blocks per district: the wider of "blocks in the dataset" (district-level
  // reviews) and "distinct blocks explicitly reviewed" (block-level reviews).
  const districtBlocksByState = new Map<string, number>();
  const districtKeys = new Set([...maxBlockCount.keys(), ...blockNames.keys()]);
  for (const key of districtKeys) {
    const stateKey = key.split("|")[0];
    const estimate = Math.max(maxBlockCount.get(key) ?? 0, blockNames.get(key)?.size ?? 0);
    districtBlocksByState.set(stateKey, (districtBlocksByState.get(stateKey) ?? 0) + estimate);
  }
  let blocks = 0;
  for (const stateKey of new Set([...districtBlocksByState.keys(), ...maxStateBlockCount.keys()])) {
    blocks += Math.max(districtBlocksByState.get(stateKey) ?? 0, maxStateBlockCount.get(stateKey) ?? 0);
  }

  const reconcileCoverage = (districtCounts: Map<string, number>, stateCounts: Map<string, number>) => {
    const districtTotalsByState = new Map<string, number>();
    for (const [key, count] of districtCounts) {
      const stateKey = key.split("|")[0];
      districtTotalsByState.set(stateKey, (districtTotalsByState.get(stateKey) ?? 0) + count);
    }
    let total = 0;
    for (const stateKey of new Set([...districtTotalsByState.keys(), ...stateCounts.keys()])) {
      total += Math.max(districtTotalsByState.get(stateKey) ?? 0, stateCounts.get(stateKey) ?? 0);
    }
    return total;
  };

  const facilities = reconcileCoverage(maxDistrictFacility, maxStateFacility);
  const sessionSites = reconcileCoverage(maxDistrictSessionSites, maxStateSessionSites);

  const nums = (pick: (r: DashboardRecord) => number | null) =>
    records.map(pick).filter((v): v is number => v !== null);

  return {
    total: records.length,
    hmis,
    uwin,
    pcts,
    stateHmis,
    states: states.size,
    districts: [...new Set([...explicitDistrictsByState.keys(), ...maxStateDistrictCount.keys()])]
      .reduce((sum, state) => sum + Math.max(explicitDistrictsByState.get(state)?.size ?? 0, maxStateDistrictCount.get(state) ?? 0), 0),
    blocks,
    facilities,
    sessionSites,
    reviewers: reviewers.size,
    avgOverall: mean(records.map((r) => r.overall)),
    avgAvailability: mean(nums((r) => r.availability)),
    avgCompleteness: mean(nums((r) => r.completeness)),
    avgAccuracy: mean(nums((r) => r.accuracy)),
    avgConsistency: mean(nums((r) => r.consistency)),
  };
}

// ---------------------------------------------------------------
// Monthly activity (review date, gaps filled)
// ---------------------------------------------------------------

export interface MonthBucket {
  key: string; // YYYY-MM
  label: string; // "Jul 26"
  hmis: number;
  uwin: number;
  pcts: number;
  stateHmis: number;
  total: number;
  avgOverall: number | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
}

function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * On the "period" axis a review that analysed Apr–Jun counts in all three months,
 * because its score describes that whole window. Reviews with no recorded period
 * contribute to no month at all and simply drop out of the time charts.
 */
export function groupByMonth(records: DashboardRecord[], basis: TrendBasis = "review"): MonthBucket[] {
  if (records.length === 0) return [];
  const byMonth = new Map<
    string,
    { hmis: number; uwin: number; pcts: number; stateHmis: number; scores: number[] }
  >();
  for (const r of records) {
    for (const month of recordMonths(r, basis)) {
      const bucket = byMonth.get(month) ?? { hmis: 0, uwin: 0, pcts: 0, stateHmis: 0, scores: [] };
      if (r.portal === "HMIS_STATE") bucket.stateHmis += 1;
      else if (r.portal === "UWIN_STATE" || r.portal === "UWIN") bucket.uwin += 1;
      else if (r.portal === "PCTS") bucket.pcts += 1;
      else bucket.hmis += 1;
      bucket.scores.push(r.overall);
      byMonth.set(month, bucket);
    }
  }
  const keys = [...byMonth.keys()].sort();
  // Every record may lack a period on the data axis, leaving nothing to plot.
  if (keys.length === 0) return [];
  const result: MonthBucket[] = [];
  // Fill gaps so the time axis is continuous (empty months render as zero).
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  let guard = 0;
  while (cursor <= last && guard < 240) {
    const bucket = byMonth.get(cursor);
    result.push({
      key: cursor,
      label: monthLabel(cursor),
      hmis: bucket?.hmis ?? 0,
      uwin: bucket?.uwin ?? 0,
      pcts: bucket?.pcts ?? 0,
      stateHmis: bucket?.stateHmis ?? 0,
      total: (bucket?.hmis ?? 0) + (bucket?.uwin ?? 0) + (bucket?.pcts ?? 0) + (bucket?.stateHmis ?? 0),
      avgOverall: bucket ? mean(bucket.scores) : null,
    });
    cursor = nextMonthKey(cursor);
    guard += 1;
  }
  return result;
}

// ---------------------------------------------------------------
// Review depth — how many months of data one DQA session covered
// ---------------------------------------------------------------

/**
 * Durations past a year are rare and long-tailed, so everything above
 * MAX_DURATION_BUCKET collapses into one "12+ months" bin rather than stretching
 * the axis with mostly-empty columns.
 */
export const MAX_DURATION_BUCKET = 12;
export const DURATION_OVERFLOW_KEY = `${MAX_DURATION_BUCKET}+`;
export const DURATION_UNKNOWN_KEY = "unknown";

/** Stable bucket id for one record — also what the duration filter matches on. */
export function durationBucketKey(r: Pick<DashboardRecord, "durationMonths">): string {
  if (r.durationMonths === null) return DURATION_UNKNOWN_KEY;
  return r.durationMonths > MAX_DURATION_BUCKET ? DURATION_OVERFLOW_KEY : String(r.durationMonths);
}

export function durationBucketLabel(key: string): string {
  if (key === DURATION_UNKNOWN_KEY) return NOT_RECORDED;
  if (key === DURATION_OVERFLOW_KEY) return `More than ${MAX_DURATION_BUCKET} months`;
  return `${key} month${key === "1" ? "" : "s"}`;
}

/** Compact axis tick, e.g. "1 mo", "12+". */
export function durationBucketShort(key: string): string {
  if (key === DURATION_UNKNOWN_KEY) return "Not rec.";
  if (key === DURATION_OVERFLOW_KEY) return DURATION_OVERFLOW_KEY;
  return `${key} mo`;
}

export interface DurationRow {
  key: string;
  label: string;
  short: string;
  /** Exact month count, null for the overflow and unrecorded bins. */
  months: number | null;
  total: number;
  hmis: number;
  uwin: number;
  pcts: number;
  stateHmis: number;
  avgOverall: number | null;
  /** Distinct people who saved a review of this length. */
  reviewers: number;
  /** Share of all records in the slice, 0–100. */
  share: number;
}

export interface DurationBreakdown {
  rows: DurationRow[];
  /** Records that actually carry a period — the base for mode/median/mean. */
  scored: number;
  /** Records with no recorded period; excluded from mode/median/mean. */
  missing: number;
  /** Most common duration in months, null when nothing is recorded. */
  modeMonths: number | null;
  medianMonths: number | null;
  meanMonths: number | null;
  maxMonths: number | null;
  /** Total months of data reviewed across the slice. */
  totalMonthsReviewed: number;
}

/**
 * Distribution of "how long a window did one DQA session cover" — one bin per
 * month count. Bins run contiguously from 1 to the longest observed duration so
 * an empty middle bin still shows as a gap in the histogram rather than being
 * silently dropped; unrecorded reviews get their own trailing bin.
 */
export function groupByDuration(records: DashboardRecord[]): DurationBreakdown {
  const byKey = new Map<string, DashboardRecord[]>();
  const durations: number[] = [];
  for (const r of records) {
    const key = durationBucketKey(r);
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
    if (r.durationMonths !== null) durations.push(r.durationMonths);
  }

  const maxObserved = durations.length ? Math.max(...durations) : 0;
  const contiguousTop = Math.min(maxObserved, MAX_DURATION_BUCKET);
  const keys: string[] = [];
  for (let m = 1; m <= contiguousTop; m += 1) keys.push(String(m));
  if (byKey.has(DURATION_OVERFLOW_KEY)) keys.push(DURATION_OVERFLOW_KEY);
  if (byKey.has(DURATION_UNKNOWN_KEY)) keys.push(DURATION_UNKNOWN_KEY);

  const total = records.length;
  const rows: DurationRow[] = keys.map((key) => {
    const list = byKey.get(key) ?? [];
    return {
      key,
      label: durationBucketLabel(key),
      short: durationBucketShort(key),
      months: key === DURATION_OVERFLOW_KEY || key === DURATION_UNKNOWN_KEY ? null : Number(key),
      total: list.length,
      hmis: list.filter((r) => r.portal === "HMIS").length,
      uwin: list.filter((r) => r.portal === "UWIN" || r.portal === "UWIN_STATE").length,
      pcts: list.filter((r) => r.portal === "PCTS").length,
      stateHmis: list.filter((r) => r.portal === "HMIS_STATE").length,
      avgOverall: mean(list.map((r) => r.overall)),
      reviewers: new Set(list.map((r) => r.savedBy).filter(Boolean)).size,
      share: total === 0 ? 0 : (list.length / total) * 100,
    };
  });

  const sorted = [...durations].sort((a, b) => a - b);
  let modeMonths: number | null = null;
  let bestCount = 0;
  const counts = new Map<number, number>();
  for (const d of durations) counts.set(d, (counts.get(d) ?? 0) + 1);
  // Ties resolve to the shorter duration — the conservative reading of "typical".
  for (const monthCount of [...counts.keys()].sort((a, b) => a - b)) {
    const c = counts.get(monthCount)!;
    if (c > bestCount) {
      bestCount = c;
      modeMonths = monthCount;
    }
  }
  const medianMonths = sorted.length
    ? sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : null;

  return {
    rows,
    scored: durations.length,
    missing: records.length - durations.length,
    modeMonths,
    medianMonths,
    meanMonths: mean(durations),
    maxMonths: sorted.length ? sorted[sorted.length - 1] : null,
    totalMonthsReviewed: durations.reduce((a, b) => a + b, 0),
  };
}

// ---------------------------------------------------------------
// Geographic disaggregation (state → district → block drill-down)
// ---------------------------------------------------------------

export type GeoLevel = "state" | "district" | "block";

export interface GeoRow {
  key: string; // normalized drill key at this level
  label: string; // display name
  total: number;
  hmis: number;
  uwin: number;
  pcts: number;
  stateHmis: number;
  districts: number; // unique districts under this row
  blocks: number; // coverage estimate, same rule as stats
  facilities: number;
  sessionSites: number;
  avgOverall: number | null;
  lastAtMs: number;
}

export interface GeoBreakdown {
  level: GeoLevel;
  rows: GeoRow[];
  /** Block grain only: district-level reviews that have no block identity. */
  unattributed: number;
}

export function groupByGeo(
  records: DashboardRecord[],
  level: GeoLevel,
  scope: DistrictScope = "ALL",
): GeoBreakdown {
  const groups = new Map<string, DashboardRecord[]>();
  let unattributed = 0;
  for (const r of records) {
    let key: string;
    let hasKey = true;
    if (level === "state") {
      key = r.stateKey;
      hasKey = !!r.stateKey;
    } else if (level === "district") {
      key = `${r.stateKey}|${r.districtKey}`;
      hasKey = !!r.districtKey;
    } else {
      key = r.blockKey ?? "";
      hasKey = !!r.blockKey;
    }
    if (!hasKey) {
      unattributed += 1;
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const rows: GeoRow[] = [...groups.entries()].map(([key, list]) => {
    const stats = computeDashboardStats(list, scope);
    const first = list[0];
    const label =
      level === "state" ? first.state || "(Unspecified)"
      : level === "district" ? first.district || "(Unspecified)"
      : first.block ?? "(Unspecified)";
    return {
      key,
      label,
      total: stats.total,
      hmis: stats.hmis,
      uwin: stats.uwin,
      pcts: stats.pcts,
      stateHmis: stats.stateHmis,
      districts: stats.districts,
      blocks: stats.blocks,
      facilities: stats.facilities,
      sessionSites: stats.sessionSites,
      avgOverall: stats.avgOverall,
      lastAtMs: Math.max(...list.map((r) => r.createdAtMs)),
    };
  });
  rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { level, rows, unattributed };
}

// ---------------------------------------------------------------
// Categorical breakdowns (designation / purpose)
// ---------------------------------------------------------------

export interface CategoryRow {
  label: string;
  total: number;
  hmis: number;
  uwin: number;
  pcts: number;
  stateHmis: number;
  avgOverall: number | null;
  /** For purpose rows: sub-option / free-text detail counts. */
  details: { label: string; count: number }[];
}

export function groupByCategory(
  records: DashboardRecord[],
  pick: (r: DashboardRecord) => string,
  detail?: (r: DashboardRecord) => string | null,
): CategoryRow[] {
  const groups = new Map<string, DashboardRecord[]>();
  for (const r of records) {
    const key = pick(r) || NOT_RECORDED;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const rows: CategoryRow[] = [...groups.entries()].map(([label, list]) => {
    const detailCounts = new Map<string, number>();
    if (detail) {
      for (const r of list) {
        const d = detail(r);
        if (d) detailCounts.set(d, (detailCounts.get(d) ?? 0) + 1);
      }
    }
    return {
      label,
      total: list.length,
      hmis: list.filter((r) => r.portal === "HMIS").length,
      uwin: list.filter((r) => r.portal === "UWIN" || r.portal === "UWIN_STATE").length,
      pcts: list.filter((r) => r.portal === "PCTS").length,
      stateHmis: list.filter((r) => r.portal === "HMIS_STATE").length,
      avgOverall: mean(list.map((r) => r.overall)),
      details: [...detailCounts.entries()]
        .map(([l, count]) => ({ label: l, count }))
        .sort((a, b) => b.count - a.count),
    };
  });
  rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return rows;
}

// ---------------------------------------------------------------
// Date presets
// ---------------------------------------------------------------

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type DatePreset = "30d" | "90d" | "fy" | "all";

/** Indian fiscal year: 1 April – 31 March. */
export function presetRange(preset: DatePreset, now = new Date()): { from: string; to: string } {
  if (preset === "all") return { from: "", to: "" };
  if (preset === "fy") {
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${fyStartYear}-04-01`, to: fmtDate(now) };
  }
  const days = preset === "30d" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: fmtDate(from), to: fmtDate(now) };
}

// ---------------------------------------------------------------
// Line list — one row per saved DQA review, with every detail the
// review actually stored. Kept here (pure) so the column set stays
// verifiable without a browser.
// ---------------------------------------------------------------

export const PORTAL_LABELS: Record<DashboardRecord["portal"], string> = {
  HMIS: "HMIS",
  HMIS_STATE: "State DQA (HMIS)",
  UWIN: "U-WIN",
  UWIN_STATE: "U-WIN State",
  PCTS: "PCTS",
};

export const DQA_LEVEL_LABELS: Record<DashboardRecord["dqaLevel"], string> = {
  STATE: "State DQA",
  DISTRICT: "District DQA",
  BLOCK: "Block DQA",
};

/** Same bands as the dashboard's score chips. */
export function performanceBand(score: number | null): string {
  if (score === null) return "";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Moderate";
  return "Needs attention";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "17 Apr 2025" in the viewer's local time — the same day the UI shows. */
export function linelistDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14:32", local time. */
export function linelistTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Apr 2025" from a YYYY-MM key; "" when the key is missing/invalid. */
function fullMonthLabel(key: string | null): string {
  if (!key) return "";
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Whether the review sits in the Gavi intervention scope. State reviews carry
 * no district of their own, so they are reported at state grain.
 */
function priorityFlag(r: DashboardRecord): string {
  if (!r.stateKey) return "";
  if (!r.districtKey) return isPriorityState(r.stateKey) ? "Priority state" : "No";
  return isPriorityDistrict(r.stateKey, r.districtKey) ? "Yes" : "No";
}

export const LINELIST_HEADERS = [
  "S. No.",
  "Review date",
  "Review time",
  "Review month",
  "Source",
  "Type of DQA",
  "State analysis grain",
  "State",
  "District",
  "Block",
  "Gavi priority district",
  "Data period from",
  "Data period to",
  "Months of data",
  "Duration label (as saved)",
  "Designation",
  "Purpose",
  "Purpose detail",
  "Overall score",
  "Performance band",
  "Availability",
  "Completeness",
  "Accuracy",
  "Consistency",
  "Districts in dataset",
  "Blocks in dataset",
  "Facilities in dataset",
  "Session sites in dataset",
  "Saved by",
  "Saved by level",
  "Saved by geography",
  "Review ID",
] as const;

export type LinelistCell = string | number;

const score = (v: number | null): LinelistCell => (v === null ? "" : Number(v.toFixed(1)));
const count = (v: number | null): LinelistCell => (v === null ? "" : v);

/**
 * One row per review, newest first. Blank cells (not "-") wherever a value was
 * never recorded, so the sheet stays sortable and countable in Excel.
 */
export function buildLinelistRows(records: DashboardRecord[]): LinelistCell[][] {
  return [...records]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .map((r, index) => [
      index + 1,
      linelistDate(r.createdAtMs),
      linelistTime(r.createdAtMs),
      fullMonthLabel(r.monthKey),
      PORTAL_LABELS[r.portal],
      DQA_LEVEL_LABELS[r.dqaLevel],
      r.analysisGranularity ? (r.analysisGranularity === "BLOCK" ? "Block-wise" : "District-wise") : "",
      r.state,
      r.district,
      r.block ?? "",
      priorityFlag(r),
      fullMonthLabel(r.periodStart),
      fullMonthLabel(r.periodEnd),
      r.durationMonths ?? "",
      r.reportingMonth,
      r.designation === NOT_RECORDED ? "" : r.designation,
      r.purpose === NOT_RECORDED ? "" : r.purpose,
      r.purposeDetail ?? "",
      Number(r.overall.toFixed(1)),
      performanceBand(r.overall),
      score(r.availability),
      // U-WIN has no completeness KPIs at all — say so rather than leaving a
      // blank that reads as "not recorded".
      r.portal === "UWIN" || r.portal === "UWIN_STATE" ? "N/A" : score(r.completeness),
      score(r.accuracy),
      score(r.consistency),
      count(r.districtCount),
      count(r.blockCount),
      count(r.facilityCount),
      count(r.sessionSiteCount),
      r.savedBy ?? "",
      r.savedByLevel ?? "",
      r.savedByGeo ?? "",
      r.id,
    ]);
}

/**
 * Excel re-reads unformatted cell text, which would turn a review ID or a
 * "Apr 2025" period into a number or a date of its own — so text is pinned to
 * the text format. The review date is the deliberate exception: it is handed
 * over as a real date so the sheet can be sorted and filtered on it.
 */
function cellStyle(cell: LinelistCell, isDate: boolean): string {
  if (typeof cell === "number") return "text-align:right;";
  if (isDate && cell) return "mso-number-format:'dd mmm yyyy';";
  return "mso-number-format:'\\@';";
}

const escapeXls = (value: LinelistCell): string =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The line list as an Excel-readable HTML table. Excel drops <style> blocks and
 * CSS classes when it opens an .xls HTML file, so every bit of formatting here
 * has to be an inline style attribute.
 */
export function buildLinelistXlsHtml(rows: LinelistCell[][], contextLines: string[]): string {
  const span = LINELIST_HEADERS.length;
  const context = contextLines
    .filter(Boolean)
    .map(
      (line, index) =>
        `<tr><td colspan="${span}" style="${index === 0 ? "font-weight:bold;font-size:11pt;" : "font-size:9pt;color:#475569;"}">${escapeXls(line)}</td></tr>`,
    )
    .join("");
  const head = LINELIST_HEADERS.map(
    (header) =>
      `<th style="background-color:#0f172a;color:#ffffff;font-weight:bold;text-align:left;vertical-align:middle;padding:4px;white-space:nowrap;">${escapeXls(header)}</th>`,
  ).join("");
  const dateColumn = LINELIST_HEADERS.indexOf("Review date");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, column) => `<td style="${cellStyle(cell, column === dateColumn)}">${escapeXls(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:10pt;">${context}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

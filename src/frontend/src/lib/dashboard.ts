// ============================================================
// Pure aggregation logic for the DQA Analytics Dashboard.
// No React, no Firebase — keep it this way so the logic stays
// verifiable with the esbuild+Node harness technique.
// ============================================================
import type { SnapshotRecord } from "./snapshots";
import { getSnapshotBlock, getSnapshotDqaLevel, normalizePortal } from "./snapshots";

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
  designation: string;
  purpose: string;
  purposeDetail: string | null;
  savedBy: string | null;
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
    periodStart: s.kpiData?.periodStart ?? null,
    periodEnd: s.kpiData?.periodEnd ?? null,
    designation: s.kpiData?.designation?.trim() || NOT_RECORDED,
    purpose: s.kpiData?.purpose?.trim() || NOT_RECORDED,
    purposeDetail: s.kpiData?.purposeDetail?.trim() || null,
    savedBy: s.createdBy?.email ?? null,
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
  portal: "ALL" | "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
  dqaLevel: "ALL" | "STATE" | "DISTRICT" | "BLOCK";
  granularity: "ALL" | "DISTRICT" | "BLOCK";
  state: string; // stateKey, "" = all
  district: string; // districtKey, "" = all
  block: string; // blockKey, "" = all
  designation: string; // "" = all
  purpose: string; // "" = all
  dateFrom: string; // yyyy-mm-dd, "" = open
  dateTo: string; // yyyy-mm-dd, "" = open
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  portal: "ALL",
  dqaLevel: "ALL",
  granularity: "ALL",
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
  return records.filter((r) => {
    if (f.portal !== "ALL" && r.portal !== f.portal) return false;
    if (f.dqaLevel !== "ALL" && r.dqaLevel !== f.dqaLevel) return false;
    if (f.granularity !== "ALL" && r.analysisGranularity !== f.granularity) return false;
    if (f.state && r.stateKey !== f.state) return false;
    if (f.district && r.districtKey !== f.district) return false;
    if (f.block && r.blockKey !== f.block) return false;
    if (f.designation && r.designation !== f.designation) return false;
    if (f.purpose && r.purpose !== f.purpose) return false;
    if (fromMs !== null && r.createdAtMs < fromMs) return false;
    if (toMs !== null && r.createdAtMs > toMs) return false;
    return true;
  });
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
export function computeDashboardStats(records: DashboardRecord[]): DashboardStats {
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
      maxStateDistrictCount.set(r.stateKey, Math.max(maxStateDistrictCount.get(r.stateKey) ?? 0, r.districtCount));
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

export function groupByMonth(records: DashboardRecord[]): MonthBucket[] {
  if (records.length === 0) return [];
  const byMonth = new Map<
    string,
    { hmis: number; uwin: number; pcts: number; stateHmis: number; scores: number[] }
  >();
  for (const r of records) {
    const bucket = byMonth.get(r.monthKey) ?? { hmis: 0, uwin: 0, pcts: 0, stateHmis: 0, scores: [] };
    if (r.portal === "HMIS_STATE") bucket.stateHmis += 1;
    else if (r.portal === "UWIN_STATE" || r.portal === "UWIN") bucket.uwin += 1;
    else if (r.portal === "PCTS") bucket.pcts += 1;
    else bucket.hmis += 1;
    bucket.scores.push(r.overall);
    byMonth.set(r.monthKey, bucket);
  }
  const keys = [...byMonth.keys()].sort();
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

export function groupByGeo(records: DashboardRecord[], level: GeoLevel): GeoBreakdown {
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
    const stats = computeDashboardStats(list);
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

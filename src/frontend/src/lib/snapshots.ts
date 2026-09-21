import type { FilterState } from "./dqa/types";
import type { AuthState } from "../components/dqa/LoginPage";
import { periodMonthBounds } from "./dqa/parseUtils";

export type SnapshotPortal = "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
export type SnapshotDqaLevel = "STATE" | "DISTRICT" | "BLOCK";

export interface SnapshotKpiData {
  availabilityScore?: number;
  completenessScore?: number;
  accuracyScore?: number;
  consistencyScore?: number;
  dqaLevel?: SnapshotDqaLevel;
  block?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  blockCount?: number | null;
  facilityCount?: number | null;
  sessionSiteCount?: number | null;
  districtCount?: number | null;
  analysisGranularity?: "DISTRICT" | "BLOCK" | null;
  designation?: string | null;
  purpose?: string | null;
  purposeDetail?: string | null;
}

export interface SnapshotRecord {
  id: string;
  state: string;
  district: string;
  reportingMonth: string;
  overallScore: number;
  createdAt: string;
  portal?: string;
  canDelete?: boolean;
  createdBy?: {
    id: string;
    email: string;
    level: string;
    geoState: string | null;
    geoDistrict: string | null;
    geoBlock: string | null;
  } | null;
  kpiData: SnapshotKpiData;
}

export interface SnapshotSaveMeta {
  dqaLevel: SnapshotDqaLevel;
  block?: string;
  periodStart?: string;
  periodEnd?: string;
}

export function normalizePortal(portal?: string | null): SnapshotPortal {
  const normalized = portal?.toUpperCase();
  if (normalized === "UWIN") return "UWIN";
  if (normalized === "UWIN_STATE") return "UWIN_STATE";
  if (normalized === "HMIS_STATE") return "HMIS_STATE";
  if (normalized === "PCTS") return "PCTS";
  return "HMIS";
}

export function getSnapshotDqaLevel(snapshot: Pick<SnapshotRecord, "kpiData">): SnapshotDqaLevel {
  if (snapshot.kpiData?.dqaLevel === "STATE") return "STATE";
  return snapshot.kpiData?.dqaLevel === "BLOCK" && snapshot.kpiData?.block
    ? "BLOCK"
    : "DISTRICT";
}

export function getSnapshotBlock(snapshot: Pick<SnapshotRecord, "kpiData">): string | null {
  return snapshot.kpiData?.block?.trim() || null;
}

export function getSnapshotPeriod(snapshot: Pick<SnapshotRecord, "createdAt" | "kpiData">) {
  const fallbackMonth = snapshot.createdAt.slice(0, 7);
  return {
    start: snapshot.kpiData?.periodStart || fallbackMonth,
    end: snapshot.kpiData?.periodEnd || fallbackMonth,
  };
}

/**
 * Which time axis a trend is built on:
 *  - "review" -> the month the DQA review was saved (snapshot.createdAt)
 *  - "period" -> the months of data that were actually uploaded and analysed
 *                (kpiData.periodStart..periodEnd), so a 3-month upload contributes
 *                its score to all three of those months.
 */
export type TrendBasis = "review" | "period";

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2025-04-17T…" -> "2025-04" */
export function monthKeyOf(isoDate: string): string {
  const parsed = new Date(isoDate);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Inclusive list of month keys from start to end (empty when start > end). */
export function monthsBetween(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 240) {
    result.push(cursor);
    cursor = nextMonthKey(cursor);
    guard += 1;
  }
  return result;
}

/** Short month plus 4-digit year, e.g. "2025-04" -> "Apr 2025". */
export function monthFullLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!MONTH_KEY_RE.test(key)) return key;
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/**
 * Last calendar day of a month key as YYYY-MM-DD. Built by hand because
 * `toISOString()` on a local-midnight Date rolls back a day in +05:30.
 */
export function monthEndDate(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return `${key}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
}

/**
 * The months of data a review actually covered, read strictly from what was saved.
 * No createdAt fallback here — guessing would plot a review on months it never
 * analysed. Snapshots saved before the period was captured return null.
 */
export function getDataPeriod(
  snapshot: Pick<SnapshotRecord, "kpiData">,
): { start: string; end: string } | null {
  const start = snapshot.kpiData?.periodStart?.trim() ?? "";
  const end = snapshot.kpiData?.periodEnd?.trim() ?? "";
  if (!MONTH_KEY_RE.test(start) || !MONTH_KEY_RE.test(end)) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

/** "Apr 2025 – Jun 2025", or "Apr 2025" for a single month, or null when unrecorded. */
export function dataPeriodLabel(snapshot: Pick<SnapshotRecord, "kpiData">): string | null {
  const period = getDataPeriod(snapshot);
  if (!period) return null;
  return period.start === period.end
    ? monthFullLabel(period.start)
    : `${monthFullLabel(period.start)} – ${monthFullLabel(period.end)}`;
}

/** How many months of data the review covered; falls back to the stored label. */
export function dataDurationLabel(
  snapshot: Pick<SnapshotRecord, "kpiData" | "reportingMonth">,
): string {
  // A sub-month review (a weekly U-WIN upload) stores its real span here. The
  // month axis below can only round that up to "1 month", so trust what was saved.
  const stored = snapshot.reportingMonth?.trim() ?? "";
  if (/^\d+ (day|week)s?$/i.test(stored)) return stored;
  const period = getDataPeriod(snapshot);
  if (!period) return snapshot.reportingMonth?.trim() || "—";
  const span = monthsBetween(period.start, period.end).length;
  return `${span} month${span === 1 ? "" : "s"}`;
}

/** Month buckets a snapshot contributes to on the selected axis. */
export function snapshotTrendMonths(
  snapshot: Pick<SnapshotRecord, "createdAt" | "kpiData">,
  basis: TrendBasis,
): string[] {
  if (basis === "review") return [monthKeyOf(snapshot.createdAt)];
  const period = getDataPeriod(snapshot);
  return period ? monthsBetween(period.start, period.end) : [];
}

/** Recency key on the selected axis — data-period end when available, else review date. */
export function snapshotOrderValue(
  snapshot: Pick<SnapshotRecord, "createdAt" | "kpiData">,
  basis: TrendBasis,
): number {
  if (basis === "period") {
    const period = getDataPeriod(snapshot);
    if (period) return new Date(`${period.end}-01T00:00:00`).getTime();
  }
  return new Date(snapshot.createdAt).getTime();
}

export function buildSnapshotSaveMeta(
  auth: Pick<AuthState, "level" | "geoBlock">,
  filters: Pick<FilterState, "blocks">,
  allMonths: Record<string, string>,
): SnapshotSaveMeta {
  // Trends and the dashboard plot on a calendar-month axis, so a sub-month
  // reporting period (a weekly U-WIN upload) is recorded as the month it falls in.
  const bounds = periodMonthBounds(Object.keys(allMonths));
  const periodStart = bounds?.start;
  const periodEnd = bounds?.end;
  const selectedBlocks = uniqueNonEmpty(filters.blocks);
  const scopedBlock = auth.geoBlock?.trim();

  if (auth.level === "BLOCK" && scopedBlock) {
    return {
      dqaLevel: "BLOCK",
      block: scopedBlock,
      periodStart,
      periodEnd,
    };
  }

  if (selectedBlocks.length === 1) {
    return {
      dqaLevel: "BLOCK",
      block: selectedBlocks[0],
      periodStart,
      periodEnd,
    };
  }

  return {
    dqaLevel: "DISTRICT",
    periodStart,
    periodEnd,
  };
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

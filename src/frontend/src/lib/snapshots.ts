import type { FilterState } from "./dqa/types";
import type { AuthState } from "../components/dqa/LoginPage";
import { periodDurationLabel, periodMonthBounds, periodMonths } from "./dqa/parseUtils";
import { SCORING_METHOD_VERSION } from "./dqa/scoring";

export type SnapshotPortal = "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
export type SnapshotDqaLevel = "STATE" | "DISTRICT" | "BLOCK";

/**
 * Exactly what a saved review covered, so it is only ever compared with a review
 * of the same scope. Empty lists mean "all".
 */
export interface SnapshotScope {
  blocks: string[];
  districts: string[];
  /** Calendar months analysed ("YYYY-MM"). */
  months: string[];
  ownership: string[];
  ruralUrban: string[];
  facilityTypes: string[];
  /** U-WIN facility / sub-center / session-site analysis; null elsewhere. */
  analysisMode: string | null;
  /** True when the review covers only part of the geography its level names. */
  partial: boolean;
}

export interface SnapshotKpiData {
  /** null = the component could not be scored (method v2). */
  availabilityScore?: number | null;
  completenessScore?: number | null;
  accuracyScore?: number | null;
  consistencyScore?: number | null;
  /** Scoring method the scores were computed with; absent = v1 (before 2026-09-22). */
  methodVersion?: number | null;
  scope?: SnapshotScope | null;
  scoredComponents?: number | null;
  uploadBlockCount?: number | null;
  uploadFacilityCount?: number | null;
  uploadSessionSiteCount?: number | null;
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
  /** Span of the analysed months, e.g. "3 months" — what the review covered, not the upload. */
  duration: string;
  scope: SnapshotScope;
}

/**
 * Whether a saved review was scored with the current method. Informational only:
 * saved scores are always shown and compared exactly as they were stored.
 */
export function isCurrentMethod(snapshot: Pick<SnapshotRecord, "kpiData">): boolean {
  return snapshot.kpiData?.methodVersion === SCORING_METHOD_VERSION;
}

function sortedList(values: string[] | undefined | null): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
}

/**
 * Everything about a review's scope except its period. Two reviews are only
 * compared when this matches — a Public-only review or a 3-of-12-block review is
 * never measured against the whole district.
 */
export function scopeSignature(snapshot: Pick<SnapshotRecord, "kpiData">): string {
  const scope = snapshot.kpiData?.scope;
  return JSON.stringify([
    getSnapshotDqaLevel(snapshot),
    (getSnapshotBlock(snapshot) ?? "").toLowerCase(),
    sortedList(scope?.blocks),
    sortedList(scope?.districts),
    sortedList(scope?.ownership),
    sortedList(scope?.ruralUrban),
    sortedList(scope?.facilityTypes),
    scope?.analysisMode ?? null,
    snapshot.kpiData?.analysisGranularity ?? null,
  ]);
}

/**
 * "" for a review of the whole named geography — including every review saved
 * before scopes were recorded — otherwise the scope signature. Keeps a partial
 * review (some blocks, Public only, session-site mode...) from being compared with
 * a full one, while full reviews stay comparable across the method change.
 */
export function comparisonScopeKey(snapshot: Pick<SnapshotRecord, "kpiData">): string {
  const scope = snapshot.kpiData?.scope;
  if (!scope) return "";
  const full =
    !scope.partial &&
    scope.ownership.length === 0 &&
    scope.ruralUrban.length === 0 &&
    scope.facilityTypes.length === 0 &&
    (scope.analysisMode ?? "facility") === "facility";
  return full ? "" : scopeSignature(snapshot);
}

/** Reviews in the same group are like-for-like: same level, block, file grain and scope. */
export function reviewComparisonGroup(snapshot: Pick<SnapshotRecord, "kpiData">): string {
  return JSON.stringify([
    getSnapshotDqaLevel(snapshot),
    (getSnapshotBlock(snapshot) ?? "").toLowerCase(),
    snapshot.kpiData?.analysisGranularity ?? null,
    comparisonScopeKey(snapshot),
  ]);
}

/** Calendar months covered by a list of analysed period keys. */
export function analysedMonths(periodKeys: string[]): string[] {
  return [...new Set(periodKeys.flatMap(periodMonths))].sort();
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

/** "Apr 2025 – Jun 2025", or "Apr 2025" for a single month. */
export function periodRangeLabel(start: string, end: string): string {
  return start === end ? monthFullLabel(start) : `${monthFullLabel(start)} – ${monthFullLabel(end)}`;
}

/** "Apr 2025 – Jun 2025", or "Apr 2025" for a single month, or null when unrecorded. */
export function dataPeriodLabel(snapshot: Pick<SnapshotRecord, "kpiData">): string | null {
  const period = getDataPeriod(snapshot);
  if (!period) return null;
  return periodRangeLabel(period.start, period.end);
}

/**
 * A past review to measure the one on screen against.
 *
 * "latest" is simply the most recent review of this geography, whatever months it
 * covered. "samePeriod" is the most recent review of the SAME months — the only
 * like-for-like comparison, and the one that answers "has this data improved since
 * we last reviewed it". One snapshot can be both, and is then returned once as
 * "both" rather than offered twice.
 */
export type BaselineKind = "samePeriod" | "latest" | "both";

export interface ReviewBaseline {
  id: string;
  kind: BaselineKind;
  createdAt: string;
  period: { start: string; end: string } | null;
  overall: number | null;
  availabilityScore: number | null;
  completenessScore: number | null;
  accuracyScore: number | null;
  consistencyScore: number | null;
}

function toBaseline(snapshot: SnapshotRecord, kind: BaselineKind): ReviewBaseline {
  return {
    id: snapshot.id,
    kind,
    createdAt: snapshot.createdAt,
    period: getDataPeriod(snapshot),
    overall: typeof snapshot.overallScore === "number" ? snapshot.overallScore : null,
    availabilityScore: snapshot.kpiData?.availabilityScore ?? null,
    completenessScore: snapshot.kpiData?.completenessScore ?? null,
    accuracyScore: snapshot.kpiData?.accuracyScore ?? null,
    consistencyScore: snapshot.kpiData?.consistencyScore ?? null,
  };
}

/**
 * Baselines for the review on screen, preferred first: the same-period review when
 * one exists, then the latest review when that is a different one. Pass the
 * snapshots already narrowed to this portal and geography.
 *
 * Saved scores are used exactly as stored, whichever scoring method produced
 * them. When `currentScope` is given, only reviews of the same level, block and
 * scope are offered (see reviewComparisonGroup).
 */
export function pickReviewBaselines(
  matches: SnapshotRecord[],
  currentPeriod: { start: string; end: string } | null,
  currentScope?: Pick<SnapshotRecord, "kpiData">,
): ReviewBaseline[] {
  const wantedGroup = currentScope ? reviewComparisonGroup(currentScope) : null;
  const comparable = matches.filter(
    (snapshot) => wantedGroup === null || reviewComparisonGroup(snapshot) === wantedGroup,
  );
  const sorted = [...comparable].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latest = sorted[0];
  if (!latest) return [];

  const samePeriod = currentPeriod
    ? sorted.find((snapshot) => {
        const period = getDataPeriod(snapshot);
        return period !== null && period.start === currentPeriod.start && period.end === currentPeriod.end;
      })
    : undefined;

  if (samePeriod && samePeriod.id === latest.id) return [toBaseline(latest, "both")];
  if (samePeriod) return [toBaseline(samePeriod, "samePeriod"), toBaseline(latest, "latest")];
  return [toBaseline(latest, "latest")];
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

/**
 * Level, period and scope of an HMIS / U-WIN review as it will be saved — built
 * from what was actually SCORED (the month and scope filters), never from the
 * whole upload.
 */
export function buildSnapshotSaveMeta(
  auth: Pick<AuthState, "level" | "geoBlock">,
  filters: Pick<FilterState, "blocks" | "months" | "ownership" | "ru"> & Partial<Pick<FilterState, "districts" | "analysisMode">>,
  allMonths: Record<string, string>,
  options: { analysisMode?: boolean } = {},
): SnapshotSaveMeta {
  // `[]` means every month. Trends and the dashboard plot on a calendar-month
  // axis, so a sub-month period (a weekly U-WIN upload) is recorded as its month.
  const periodKeys = filters.months.length > 0 ? filters.months : Object.keys(allMonths);
  const bounds = periodMonthBounds(periodKeys);
  const periodStart = bounds?.start;
  const periodEnd = bounds?.end;
  const selectedBlocks = uniqueNonEmpty(filters.blocks);
  const selectedDistricts = uniqueNonEmpty(filters.districts ?? []);
  const scopedBlock = auth.geoBlock?.trim();
  const narrowedFacilities = filters.ownership.length > 0 || filters.ru.length > 0;

  const scope = (partial: boolean): SnapshotScope => ({
    blocks: selectedBlocks,
    districts: selectedDistricts,
    months: analysedMonths(periodKeys),
    ownership: uniqueNonEmpty(filters.ownership),
    ruralUrban: uniqueNonEmpty(filters.ru),
    facilityTypes: [],
    analysisMode: options.analysisMode ? filters.analysisMode ?? "facility" : null,
    partial,
  });
  const duration = periodDurationLabel(periodKeys);

  if (auth.level === "BLOCK" && scopedBlock) {
    return {
      dqaLevel: "BLOCK",
      block: scopedBlock,
      periodStart,
      periodEnd,
      duration,
      scope: scope(narrowedFacilities),
    };
  }

  if (selectedBlocks.length === 1) {
    return {
      dqaLevel: "BLOCK",
      block: selectedBlocks[0],
      periodStart,
      periodEnd,
      duration,
      scope: scope(narrowedFacilities),
    };
  }

  return {
    dqaLevel: "DISTRICT",
    periodStart,
    periodEnd,
    duration,
    // Several (not all) blocks, a district subset of a state upload, or an
    // ownership / rural-urban filter: only part of the named geography.
    scope: scope(selectedBlocks.length > 1 || selectedDistricts.length > 0 || narrowedFacilities),
  };
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

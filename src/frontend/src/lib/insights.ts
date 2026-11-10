// ============================================================
// Pure aggregation logic for the DQA Insights dashboard (the reimagined
// analytics dashboard). No React, no Firebase - verifiable with the
// esbuild + Node harness, like lib/dashboard.ts.
//
// The page answers five questions from the saved reviews:
//   1. Is DQA being practised?        (reach, rhythm, freshness)
//   2. How good is the data?          (latest score of every district / block)
//   3. Where is quality lost?         (component profile)
//   4. Is it improving?               (first vs latest, re-review of the same months)
//   5. Where should we act first?     (score x recency priority matrix)
//
// Scores are never mixed across scoring families, and a unit (state, district or
// block) is always described by reviews of that WHOLE unit: partial-scope reviews
// count as activity but never set a unit's score.
// ============================================================
import type { SnapshotRecord } from "./snapshots";
import { monthsBetween } from "./snapshots";
import type { SnapshotBreakdown } from "./snapshotBreakdown";
import {
  expandGridBlocks,
  toDashboardRecord,
  type DashboardRecord,
  type ScoreFamily,
} from "./dashboard";
import { inDistrictScope, type DistrictScope } from "./maps/priorityDistricts";
import { SCORING_METHOD_VERSION } from "./dqa/scoring";

const DAY = 86_400_000;

// ---------------------------------------------------------------
// Score bands - one diverging scale around the "Good" line (70):
// red arm below it, blue arm above it. Validated colour-blind safe.
// ---------------------------------------------------------------

export interface Band {
  key: "attention" | "moderate" | "good" | "excellent";
  label: string;
  range: string;
  min: number;
  color: string;
  /** Text colour that stays readable on top of `color`. */
  ink: string;
}

export const BANDS: Band[] = [
  { key: "attention", label: "Needs attention", range: "Below 50", min: 0, color: "#b3292e", ink: "#ffffff" },
  { key: "moderate", label: "Moderate", range: "50–69", min: 50, color: "#ee8f6c", ink: "#0f172a" },
  { key: "good", label: "Good", range: "70–84", min: 70, color: "#6da7ec", ink: "#0f172a" },
  { key: "excellent", label: "Excellent", range: "85–100", min: 85, color: "#184f95", ink: "#ffffff" },
];

export const GOOD_LINE = 70;

export function bandOf(score: number | null): Band | null {
  if (score === null) return null;
  if (score >= 85) return BANDS[3];
  if (score >= 70) return BANDS[2];
  if (score >= 50) return BANDS[1];
  return BANDS[0];
}

// ---------------------------------------------------------------
// Records
// ---------------------------------------------------------------

export interface InsightRecord extends DashboardRecord {
  methodVersion: number | null;
  /** The review scored only part of the geography its level names. */
  partial: boolean;
  /** The saved data period is believable next to the review date. */
  periodOk: boolean;
  /** Days between the end of the data period and the review; null when the period is not usable. */
  lagDays: number | null;
  /** A weekly / part-month upload. */
  subMonth: boolean;
}

function monthKeyOfMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, by: number): string {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(year, month - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function toInsightRecord(s: SnapshotRecord, grid?: SnapshotBreakdown | null): InsightRecord | null {
  const base = toDashboardRecord(s, grid);
  if (!base) return null;
  const scope = s.kpiData?.scope;
  const partial = Boolean(
    scope &&
      (scope.partial ||
        (scope.ownership?.length ?? 0) > 0 ||
        (scope.ruralUrban?.length ?? 0) > 0 ||
        (scope.facilityTypes?.length ?? 0) > 0),
  );
  // Some older reviews carry impossible periods (year 2001, 2089...) from a parsing
  // bug. A period is trusted when it ends no later than the month after the review
  // and starts within the three years before it.
  const reviewMonth = monthKeyOfMs(base.createdAtMs);
  const periodOk =
    base.periodStart !== null &&
    base.periodEnd !== null &&
    base.periodEnd <= shiftMonth(reviewMonth, 1) &&
    base.periodStart >= shiftMonth(reviewMonth, -36);
  let lagDays: number | null = null;
  if (periodOk) {
    const [year, month] = base.periodEnd!.split("-").map(Number);
    lagDays = Math.round((base.createdAtMs - new Date(year, month, 0, 23, 59, 59).getTime()) / DAY);
  }
  return {
    ...base,
    methodVersion: s.kpiData?.methodVersion ?? null,
    partial,
    periodOk,
    lagDays,
    subMonth: /\b(day|week)s?\b/i.test(base.reportingMonth) && !/^(2[89]|3[01]) days$/i.test(base.reportingMonth),
  };
}

// ---------------------------------------------------------------
// Filters and time window
// ---------------------------------------------------------------

export type InsightPreset = "30d" | "90d" | "fy" | "all" | "custom";
export const PROGRAMME_PURPOSES = "__programme__";

export interface InsightFilters {
  family: ScoreFamily;
  preset: InsightPreset;
  /** yyyy-mm-dd, used when preset = "custom". */
  from: string;
  to: string;
  state: string; // stateKey
  district: string; // districtKey
  scope: DistrictScope;
  /** "" = all, PROGRAMME_PURPOSES = desk reviews + review meetings, else one purpose. */
  purpose: string;
  method: "all" | "current";
}

export const DEFAULT_INSIGHT_FILTERS: Omit<InsightFilters, "family"> = {
  preset: "90d",
  from: "",
  to: "",
  state: "",
  district: "",
  scope: "ALL",
  purpose: "",
  method: "all",
};

export interface InsightWindow {
  fromMs: number | null;
  toMs: number;
  /** The equally long window just before, for "vs previous period"; null for open windows. */
  prevFromMs: number | null;
  prevToMs: number | null;
  label: string;
  prevLabel: string | null;
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function resolveWindow(f: Pick<InsightFilters, "preset" | "from" | "to">, nowMs: number): InsightWindow {
  const endOfToday = new Date(nowMs);
  endOfToday.setHours(23, 59, 59, 999);
  let toMs = endOfToday.getTime();
  let fromMs: number | null = null;
  let label = "All time";
  if (f.preset === "30d" || f.preset === "90d") {
    const days = f.preset === "30d" ? 30 : 90;
    fromMs = toMs - days * DAY + 1;
    label = `Last ${days} days`;
  } else if (f.preset === "fy") {
    const now = new Date(nowMs);
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    fromMs = new Date(startYear, 3, 1).getTime();
    label = `FY ${startYear}–${String(startYear + 1).slice(2)}`;
  } else if (f.preset === "custom") {
    if (f.from) fromMs = new Date(`${f.from}T00:00:00`).getTime();
    if (f.to) toMs = new Date(`${f.to}T23:59:59.999`).getTime();
    label = fromMs !== null ? `${dayLabel(fromMs)} – ${dayLabel(toMs)}` : `Up to ${dayLabel(toMs)}`;
  }
  // Rolling and custom windows compare with the equally long window before them. A
  // financial year in progress has no fair "previous" yet, so it gets none.
  const comparable = fromMs !== null && f.preset !== "fy";
  const prevToMs = comparable ? fromMs! - 1 : null;
  const prevFromMs = comparable ? fromMs! - (toMs - fromMs!) - 1 : null;
  return {
    fromMs,
    toMs,
    prevFromMs,
    prevToMs,
    label,
    prevLabel: comparable ? `previous ${Math.round((toMs - fromMs!) / DAY)} days` : null,
  };
}

/** Everything except the time window, so the same slice can be cut for two windows. */
export function matchesInsightFilters(r: InsightRecord, f: InsightFilters): boolean {
  if (r.scoreFamily !== f.family) return false;
  if (!inDistrictScope(f.scope, r.stateKey, r.districtKey)) return false;
  if (f.state && r.stateKey !== f.state) return false;
  if (f.district && r.districtKey !== f.district) return false;
  if (f.purpose === PROGRAMME_PURPOSES) {
    if (r.purpose !== "Desk Review" && r.purpose !== "Review Meeting") return false;
  } else if (f.purpose && r.purpose !== f.purpose) {
    return false;
  }
  if (f.method === "current" && r.methodVersion !== SCORING_METHOD_VERSION) return false;
  return true;
}

export function inWindow(r: InsightRecord, fromMs: number | null, toMs: number | null): boolean {
  if (fromMs !== null && r.createdAtMs < fromMs) return false;
  if (toMs !== null && r.createdAtMs > toMs) return false;
  return true;
}

// ---------------------------------------------------------------
// Units: the states / districts / blocks being compared
// ---------------------------------------------------------------

export type UnitLevel = "state" | "district" | "block";

export const UNIT_NOUN: Record<UnitLevel, { one: string; many: string }> = {
  state: { one: "state", many: "states" },
  district: { one: "district", many: "districts" },
  block: { one: "block", many: "blocks" },
};

export function unitLevelFor(f: Pick<InsightFilters, "family" | "district">): UnitLevel {
  if (f.family === "HMIS_STATE") return "state";
  return f.district ? "block" : "district";
}

export type ComponentKey = "availability" | "completeness" | "accuracy" | "consistency";
export const COMPONENT_KEYS: ComponentKey[] = ["availability", "completeness", "accuracy", "consistency"];
export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  availability: "Availability",
  completeness: "Completeness",
  accuracy: "Accuracy",
  consistency: "Consistency",
};

export interface Unit {
  key: string;
  name: string;
  /** State of a district, district of a block, "" for a state. */
  parent: string;
  parentKey: string;
  stateKey: string;
  districtKey: string;
  blockKey: string | null;
  /** Scored whole-unit reviews, oldest first. */
  reviews: InsightRecord[];
  first: InsightRecord;
  latest: InsightRecord;
  score: number;
  /**
   * Latest score minus the score of the first review made with the SAME scoring
   * method as the latest one (a change across methods would mostly measure the
   * method switch); null when there is no such earlier review.
   */
  change: number | null;
  /** The earlier review `change` is measured from; the latest itself when there is none. */
  baseline: InsightRecord;
  daysSince: number;
  facilities: number | null;
}

const PSEUDO_DISTRICTS = new Set(["", "multiple", "all districts", "all"]);

/** The whole-unit reviews that may set a unit's score at this level. */
export function unitPool(records: InsightRecord[], level: UnitLevel): InsightRecord[] {
  if (level === "state") return records.filter((r) => r.dqaLevel === "STATE" && !r.partial);
  const districtReviews = records.filter(
    (r) => r.dqaLevel === "DISTRICT" && !r.partial && !PSEUDO_DISTRICTS.has(r.districtKey),
  );
  if (level === "district") return districtReviews;
  // Blocks: a district review saved with a score grid speaks for each of its blocks;
  // a block review speaks for its own block.
  const fromGrids = expandGridBlocks(
    districtReviews.filter((r) => r.gridBlocks && r.gridBlocks.length > 0),
  ) as InsightRecord[];
  const blockReviews = records.filter((r) => r.dqaLevel === "BLOCK" && !r.partial && r.blockKey);
  return [...fromGrids, ...blockReviews];
}

function unitKeyOf(r: InsightRecord, level: UnitLevel): string | null {
  if (!r.stateKey) return null;
  if (level === "state") return r.stateKey;
  if (!r.districtKey) return null;
  if (level === "district") return `${r.stateKey}|${r.districtKey}`;
  return r.blockKey ? `${r.stateKey}|${r.districtKey}|${r.blockKey}` : null;
}

export function buildUnits(records: InsightRecord[], level: UnitLevel, refMs: number): Unit[] {
  const groups = new Map<string, InsightRecord[]>();
  for (const r of unitPool(records, level)) {
    if (r.overall === null) continue;
    const key = unitKeyOf(r, level);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const units: Unit[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    const first = list[0];
    const latest = list[list.length - 1];
    const baseline = list.find((r) => r.methodVersion === latest.methodVersion) ?? latest;
    units.push({
      key,
      name: level === "state" ? latest.state : level === "district" ? latest.district : (latest.block ?? ""),
      parent: level === "state" ? "" : level === "district" ? latest.state : latest.district,
      parentKey: level === "state" ? "" : level === "district" ? latest.stateKey : latest.districtKey,
      stateKey: latest.stateKey,
      districtKey: latest.districtKey,
      blockKey: level === "block" ? latest.blockKey : null,
      reviews: list,
      first,
      latest,
      score: latest.overall!,
      change: baseline !== latest ? latest.overall! - baseline.overall! : null,
      baseline,
      daysSince: Math.max(0, Math.floor((refMs - latest.createdAtMs) / DAY)),
      facilities: latest.facilityCount,
    });
  }
  return units.sort((a, b) => a.score - b.score);
}

// ---------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------

export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (values: number[]) => quantile(values, 0.5);

// ---------------------------------------------------------------
// 1. Pulse
// ---------------------------------------------------------------

export const STALE_DAYS = 30;
/** A score change smaller than this is treated as "no real change". */
export const CHANGE_NOISE = 2;

export interface Pulse {
  reviews: number;
  prevReviews: number | null;
  units: number;
  prevUnits: number | null;
  states: number;
  medianScore: number | null;
  prevMedianScore: number | null;
  p25: number | null;
  p75: number | null;
  bandCounts: number[]; // aligned with BANDS
  belowGood: number;
  attention: number;
  repeatUnits: number;
  improved: number;
  declined: number;
  medianChange: number | null;
  stale: number;
  reviewers: number;
  prevReviewers: number | null;
  medianLag: number | null;
  prevMedianLag: number | null;
  partialReviews: number;
  oddPeriods: number;
}

/** The scoring method most of the units' latest reviews were made with. */
export function dominantMethod(units: Unit[]): number | null {
  const counts = new Map<number | null, number>();
  for (const u of units) counts.set(u.latest.methodVersion, (counts.get(u.latest.methodVersion) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = -1;
  for (const [method, count] of counts) {
    if (count > bestCount) {
      best = method;
      bestCount = count;
    }
  }
  return best;
}

/**
 * `prevScoreUnits` are the previous window's units scored with the same method as
 * the current window (see dominantMethod), so the score delta never measures a
 * method switch. Fewer than three such units give no delta.
 */
export function computePulse(
  current: InsightRecord[],
  previous: InsightRecord[] | null,
  units: Unit[],
  prevUnits: Unit[] | null,
  prevScoreUnits: Unit[] | null = prevUnits,
): Pulse {
  const scores = units.map((u) => u.score);
  const changes = units.filter((u) => u.change !== null).map((u) => u.change!);
  const lags = (list: InsightRecord[]) => list.filter((r) => r.lagDays !== null).map((r) => Math.max(0, r.lagDays!));
  const reviewers = (list: InsightRecord[]) => new Set(list.map((r) => r.savedBy ?? r.id)).size;
  const bandCounts = BANDS.map((band) => units.filter((u) => bandOf(u.score)?.key === band.key).length);
  return {
    reviews: current.length,
    prevReviews: previous ? previous.length : null,
    units: units.length,
    prevUnits: prevUnits ? prevUnits.length : null,
    states: new Set(units.map((u) => u.stateKey)).size,
    medianScore: median(scores),
    prevMedianScore: prevScoreUnits && prevScoreUnits.length >= 3 ? median(prevScoreUnits.map((u) => u.score)) : null,
    p25: quantile(scores, 0.25),
    p75: quantile(scores, 0.75),
    bandCounts,
    belowGood: bandCounts[0] + bandCounts[1],
    attention: bandCounts[0],
    repeatUnits: changes.length,
    improved: changes.filter((c) => c > CHANGE_NOISE).length,
    declined: changes.filter((c) => c < -CHANGE_NOISE).length,
    medianChange: median(changes),
    stale: units.filter((u) => u.daysSince > STALE_DAYS).length,
    reviewers: reviewers(current),
    prevReviewers: previous ? reviewers(previous) : null,
    medianLag: median(lags(current)),
    prevMedianLag: previous ? median(lags(previous)) : null,
    partialReviews: current.filter((r) => r.partial).length,
    oddPeriods: current.filter((r) => !r.periodOk).length,
  };
}

// ---------------------------------------------------------------
// 2. Landscape: units grouped for the strip plot
// ---------------------------------------------------------------

export interface UnitGroup {
  key: string;
  name: string;
  units: Unit[];
  median: number;
}

export function groupUnits(units: Unit[], level: UnitLevel): UnitGroup[] {
  const groups = new Map<string, UnitGroup>();
  for (const u of units) {
    const key = level === "state" ? "all" : u.parentKey;
    const name = level === "state" ? "All states" : u.parent;
    const g = groups.get(key) ?? { key, name, units: [], median: 0 };
    g.units.push(u);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.median = median(g.units.map((u) => u.score)) ?? 0;
  return list.sort((a, b) => b.median - a.median);
}

// ---------------------------------------------------------------
// 3. Component profile
// ---------------------------------------------------------------

export interface ComponentProfile {
  key: ComponentKey;
  label: string;
  values: number[];
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  /** Units whose latest review scores this component under the Good line. */
  belowGood: number;
}

export function componentProfiles(units: Unit[]): ComponentProfile[] {
  const out: ComponentProfile[] = [];
  for (const key of COMPONENT_KEYS) {
    const values = units.map((u) => u.latest[key]).filter((v): v is number => typeof v === "number");
    if (values.length === 0) continue;
    out.push({
      key,
      label: COMPONENT_LABELS[key],
      values,
      p10: quantile(values, 0.1)!,
      p25: quantile(values, 0.25)!,
      median: quantile(values, 0.5)!,
      p75: quantile(values, 0.75)!,
      p90: quantile(values, 0.9)!,
      belowGood: values.filter((v) => v < GOOD_LINE).length,
    });
  }
  return out;
}

// ---------------------------------------------------------------
// 4. Trajectory
// ---------------------------------------------------------------

export interface TimeBucket {
  key: number; // bucket start (ms)
  label: string;
  longLabel: string;
  reviews: number;
  units: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface Timeline {
  grain: "week" | "month";
  buckets: TimeBucket[];
  /** Index of the bucket in which the current scoring method was first used; null when outside the chart. */
  methodChangeIndex: number | null;
}

function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

function monthStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Reviews saved per week (or month, for long windows) and the spread of unit scores:
 * within a bucket every unit counts once, by its last review of that bucket.
 */
export function buildTimeline(records: InsightRecord[], level: UnitLevel, win: InsightWindow): Timeline {
  if (records.length === 0) return { grain: "week", buckets: [], methodChangeIndex: null };
  const firstMs = Math.max(win.fromMs ?? 0, Math.min(...records.map((r) => r.createdAtMs)));
  const lastMs = Math.min(win.toMs, Math.max(...records.map((r) => r.createdAtMs)));
  const grain: Timeline["grain"] = (lastMs - firstMs) / DAY > 200 ? "month" : "week";
  const startOf = grain === "week" ? weekStart : monthStart;
  const next = (ms: number) => {
    const d = new Date(ms);
    if (grain === "week") d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    return d.getTime();
  };
  const counts = new Map<number, number>();
  for (const r of records) counts.set(startOf(r.createdAtMs), (counts.get(startOf(r.createdAtMs)) ?? 0) + 1);
  const lastPerUnit = new Map<number, Map<string, InsightRecord>>();
  for (const r of unitPool(records, level)) {
    if (r.overall === null) continue;
    const unitKey = unitKeyOf(r, level);
    if (!unitKey) continue;
    const bucket = startOf(r.createdAtMs);
    const map = lastPerUnit.get(bucket) ?? new Map<string, InsightRecord>();
    const held = map.get(unitKey);
    if (!held || held.createdAtMs < r.createdAtMs) map.set(unitKey, r);
    lastPerUnit.set(bucket, map);
  }
  const buckets: TimeBucket[] = [];
  let guard = 0;
  for (let key = startOf(firstMs); key <= lastMs && guard < 400; key = next(key), guard += 1) {
    const scores = [...(lastPerUnit.get(key)?.values() ?? [])].map((r) => r.overall!);
    const d = new Date(key);
    buckets.push({
      key,
      label:
        grain === "week"
          ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
          : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
      longLabel:
        grain === "week"
          ? `Week of ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
          : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      reviews: counts.get(key) ?? 0,
      units: scores.length,
      median: median(scores),
      p25: scores.length >= 4 ? quantile(scores, 0.25) : null,
      p75: scores.length >= 4 ? quantile(scores, 0.75) : null,
    });
  }
  // Where the current scoring method starts, when older-method reviews precede it.
  let firstCurrent = Infinity;
  let firstOlder = Infinity;
  for (const r of records) {
    if (r.methodVersion === SCORING_METHOD_VERSION) firstCurrent = Math.min(firstCurrent, r.createdAtMs);
    else firstOlder = Math.min(firstOlder, r.createdAtMs);
  }
  const changeIndex =
    Number.isFinite(firstCurrent) && firstOlder < firstCurrent ? buckets.findIndex((b) => b.key === startOf(firstCurrent)) : -1;
  return { grain, buckets, methodChangeIndex: changeIndex > 0 ? changeIndex : null };
}

export interface Mover {
  unit: Unit;
  from: number;
  to: number;
  change: number;
}

export function movers(units: Unit[], limit: number): { improved: Mover[]; declined: Mover[] } {
  const all = units
    .filter((u) => u.change !== null)
    .map((u) => ({ unit: u, from: u.baseline.overall!, to: u.score, change: u.change! }));
  return {
    improved: all.filter((m) => m.change > CHANGE_NOISE).sort((a, b) => b.change - a.change).slice(0, limit),
    declined: all.filter((m) => m.change < -CHANGE_NOISE).sort((a, b) => a.change - b.change).slice(0, limit),
  };
}

export interface ReReviewBin {
  label: string;
  count: number;
  tone: "down" | "flat" | "up";
}

export interface ReReview {
  /** Unit x data-period combinations reviewed more than once with the same method. */
  groups: number;
  improved: number;
  unchanged: number;
  declined: number;
  medianGain: number | null;
  bins: ReReviewBin[];
}

const REREVIEW_EDGES: Array<{ label: string; max: number; tone: ReReviewBin["tone"] }> = [
  { label: "−10 or worse", max: -10, tone: "down" },
  { label: "−10 to −5", max: -5, tone: "down" },
  { label: "−5 to −1", max: -1, tone: "down" },
  { label: "No change", max: 1, tone: "flat" },
  { label: "+1 to +5", max: 5, tone: "up" },
  { label: "+5 to +10", max: 10, tone: "up" },
  { label: "+10 or more", max: Infinity, tone: "up" },
];

/**
 * The correction loop: when the SAME months of data of the same unit were reviewed
 * again (same scoring method), did the score move? Change = last minus first review
 * of that period.
 */
export function reReviewEffect(units: Unit[]): ReReview {
  const deltas: number[] = [];
  for (const u of units) {
    const byPeriod = new Map<string, InsightRecord[]>();
    for (const r of u.reviews) {
      if (!r.periodStart || !r.periodEnd) continue;
      const key = `${r.periodStart}_${r.periodEnd}_${r.methodVersion ?? 0}`;
      const list = byPeriod.get(key);
      if (list) list.push(r);
      else byPeriod.set(key, [r]);
    }
    for (const list of byPeriod.values()) {
      if (list.length > 1) deltas.push(list[list.length - 1].overall! - list[0].overall!);
    }
  }
  const bins: ReReviewBin[] = REREVIEW_EDGES.map((edge) => ({ label: edge.label, count: 0, tone: edge.tone }));
  for (const d of deltas) {
    // "No change" is the closed band [-1, +1]; other bins take their upper edge.
    const index = d >= -1 && d <= 1 ? 3 : REREVIEW_EDGES.findIndex((edge, i) => i !== 3 && d <= edge.max);
    bins[index === -1 ? bins.length - 1 : index].count += 1;
  }
  const gains = deltas.filter((d) => d > 1);
  return {
    groups: deltas.length,
    improved: gains.length,
    unchanged: deltas.filter((d) => d >= -1 && d <= 1).length,
    declined: deltas.filter((d) => d < -1).length,
    medianGain: median(gains),
    bins,
  };
}

// ---------------------------------------------------------------
// 5. Data-month matrix: which months of data were checked, and how they scored
// ---------------------------------------------------------------

export interface MatrixCell {
  value: number | null;
  /** True when the value is that month's own score, false when it is a multi-month review's single score. */
  exact: boolean;
  /** Units behind the value (1 on a unit row). */
  n: number;
}

export interface MatrixRow {
  key: string;
  name: string;
  sub: string;
  /** Filter to apply when the row is clicked. */
  stateKey: string;
  districtKey: string;
  score: number | null;
  cells: MatrixCell[];
  covered: number;
}

export interface Matrix {
  months: string[];
  rows: MatrixRow[];
  rowLevel: "state" | UnitLevel;
}

function unitMonthCell(u: Unit, month: string): MatrixCell {
  let pick: InsightRecord | null = null;
  for (const r of u.reviews) {
    if (r.periodOk && r.periodMonths.includes(month)) pick = r; // reviews are oldest first
  }
  if (!pick) return { value: null, exact: false, n: 0 };
  const own = pick.monthScores?.[month];
  if (typeof own === "number") return { value: own, exact: true, n: 1 };
  return { value: pick.overall, exact: pick.durationMonths === 1, n: 1 };
}

export function buildMatrix(units: Unit[], level: UnitLevel, byState: boolean, nowMs: number, span = 12): Matrix {
  const thisMonth = monthKeyOfMs(nowMs);
  let last = "";
  for (const u of units) {
    for (const r of u.reviews) {
      if (r.periodOk && r.periodEnd! <= thisMonth && r.periodEnd! > last) last = r.periodEnd!;
    }
  }
  if (!last) return { months: [], rows: [], rowLevel: byState ? "state" : level };
  let earliest = last;
  for (const u of units) {
    for (const r of u.reviews) if (r.periodOk && r.periodStart! < earliest) earliest = r.periodStart!;
  }
  const from = shiftMonth(last, -(span - 1));
  const months = monthsBetween(earliest > from ? earliest : from, last);

  const unitRows: MatrixRow[] = units.map((u) => {
    const cells = months.map((m) => unitMonthCell(u, m));
    return {
      key: u.key,
      name: u.name,
      sub: u.parent,
      stateKey: u.stateKey,
      districtKey: level === "state" ? "" : u.districtKey,
      score: u.score,
      cells,
      covered: cells.filter((c) => c.value !== null).length,
    };
  });
  if (!byState || level !== "district") return { months, rows: unitRows, rowLevel: level };

  // National view: one row per state, each cell the median of its districts.
  const byStateKey = new Map<string, { name: string; rows: MatrixRow[]; scores: number[] }>();
  units.forEach((u, i) => {
    const g = byStateKey.get(u.stateKey) ?? { name: u.parent, rows: [], scores: [] };
    g.rows.push(unitRows[i]);
    g.scores.push(u.score);
    byStateKey.set(u.stateKey, g);
  });
  const rows: MatrixRow[] = [...byStateKey.entries()].map(([stateKey, g]) => {
    const cells = months.map((_, i) => {
      const held = g.rows.map((row) => row.cells[i]).filter((c) => c.value !== null);
      return {
        value: median(held.map((c) => c.value!)),
        exact: held.length > 0 && held.every((c) => c.exact),
        n: held.length,
      };
    });
    return {
      key: stateKey,
      name: g.name,
      sub: `${g.rows.length} district${g.rows.length === 1 ? "" : "s"}`,
      stateKey,
      districtKey: "",
      score: median(g.scores),
      cells,
      covered: cells.filter((c) => c.value !== null).length,
    };
  });
  return { months, rows: rows.sort((a, b) => (a.score ?? 0) - (b.score ?? 0)), rowLevel: "state" };
}

// ---------------------------------------------------------------
// 6. Practice: how reviews are being done
// ---------------------------------------------------------------

export interface CountRow {
  label: string;
  count: number;
}

export interface Practice {
  purposes: CountRow[];
  depth: CountRow[];
  lag: CountRow[];
  lagKnown: number;
}

export function buildPractice(records: InsightRecord[]): Practice {
  const purposeCounts = new Map<string, number>();
  for (const r of records) purposeCounts.set(r.purpose, (purposeCounts.get(r.purpose) ?? 0) + 1);
  const depthDefs: Array<{ label: string; test: (r: InsightRecord) => boolean }> = [
    { label: "Under a month", test: (r) => r.subMonth },
    { label: "1 month", test: (r) => !r.subMonth && r.durationMonths === 1 },
    { label: "2–3 months", test: (r) => !r.subMonth && (r.durationMonths === 2 || r.durationMonths === 3) },
    { label: "4–6 months", test: (r) => !r.subMonth && r.durationMonths !== null && r.durationMonths >= 4 && r.durationMonths <= 6 },
    { label: "7–12 months", test: (r) => !r.subMonth && r.durationMonths !== null && r.durationMonths >= 7 && r.durationMonths <= 12 },
  ];
  const usable = records.filter((r) => r.periodOk);
  const lagDefs: Array<{ label: string; test: (lag: number) => boolean }> = [
    { label: "Month still running", test: (lag) => lag < 0 },
    { label: "Within 15 days", test: (lag) => lag >= 0 && lag <= 15 },
    { label: "16–30 days", test: (lag) => lag > 15 && lag <= 30 },
    { label: "31–60 days", test: (lag) => lag > 30 && lag <= 60 },
    { label: "61–90 days", test: (lag) => lag > 60 && lag <= 90 },
    { label: "Over 90 days", test: (lag) => lag > 90 },
  ];
  return {
    purposes: [...purposeCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    depth: depthDefs.map((d) => ({ label: d.label, count: usable.filter(d.test).length })),
    lag: lagDefs.map((d) => ({ label: d.label, count: usable.filter((r) => d.test(r.lagDays!)).length })),
    lagKnown: usable.length,
  };
}

// ---------------------------------------------------------------
// Takeaways: the page's findings in plain sentences
// ---------------------------------------------------------------

export interface Takeaway {
  tone: "good" | "watch" | "neutral";
  title: string;
  text: string;
}

const f1 = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

export function buildTakeaways(
  pulse: Pulse,
  units: Unit[],
  profiles: ComponentProfile[],
  rereview: ReReview,
  level: UnitLevel,
): Takeaway[] {
  const noun = UNIT_NOUN[level];
  const out: Takeaway[] = [];
  if (units.length === 0 || pulse.medianScore === null) return out;

  const belowShare = pct(pulse.belowGood, units.length);
  out.push({
    tone: belowShare >= 50 ? "watch" : "good",
    title: `${belowShare}% of ${noun.many} are below the Good line`,
    text:
      `${pulse.belowGood} of ${units.length} ${units.length === 1 ? noun.one : noun.many} score under ${GOOD_LINE} on their latest review` +
      (pulse.attention > 0 ? `, ${pulse.attention} of them under 50` : "") +
      `. The typical ${noun.one} scores ${f1(pulse.medianScore)}.`,
  });

  if (profiles.length > 1) {
    const weakest = [...profiles].sort((a, b) => a.median - b.median)[0];
    const strongest = [...profiles].sort((a, b) => b.median - a.median)[0];
    out.push({
      tone: weakest.median < GOOD_LINE ? "watch" : "neutral",
      title: `${weakest.label} is where quality is lost`,
      text: `Median ${weakest.label.toLowerCase()} is ${f1(weakest.median)}, against ${f1(strongest.median)} for ${strongest.label.toLowerCase()}. ${weakest.belowGood} of ${weakest.values.length} ${noun.many} are under ${GOOD_LINE} on it.`,
    });
  }

  if (pulse.repeatUnits > 0) {
    out.push({
      tone: pulse.improved >= pulse.declined ? "good" : "watch",
      title: `${pulse.improved} of ${pulse.repeatUnits} repeat-reviewed ${noun.many} improved`,
      text:
        `${pulse.declined} dropped and ${pulse.repeatUnits - pulse.improved - pulse.declined} held steady between their earlier and latest review (same scoring method)` +
        (pulse.medianChange !== null ? ` (median change ${signed(pulse.medianChange)}).` : "."),
    });
  }

  if (rereview.groups >= 5) {
    const share = pct(rereview.improved, rereview.groups);
    out.push({
      tone: share >= 40 ? "good" : "watch",
      title: `${share}% of re-checked data came back better`,
      text:
        `${rereview.groups} data periods were reviewed more than once. ${rereview.improved} scored higher the second time` +
        (rereview.medianGain !== null ? ` (typical gain ${signed(rereview.medianGain)})` : "") +
        `, ${rereview.unchanged} did not move: a sign corrections are not reaching the source data there.`,
    });
  }

  if (pulse.stale > 0) {
    const actNow = units.filter((u) => u.daysSince > STALE_DAYS && u.score < GOOD_LINE).length;
    out.push({
      tone: "watch",
      title: `${pulse.stale} ${pulse.stale === 1 ? noun.one : noun.many} gone quiet`,
      text: `No whole-${noun.one} review in the last ${STALE_DAYS} days. ${actNow} of them also score under ${GOOD_LINE}: these are the first to follow up.`,
    });
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------
// System (scoring family) summary for the selector cards
// ---------------------------------------------------------------

export interface FamilySummary {
  family: ScoreFamily;
  reviews: number;
  units: number;
  level: UnitLevel;
  medianScore: number | null;
}

export function familySummaries(
  records: InsightRecord[],
  filters: Omit<InsightFilters, "family">,
  win: InsightWindow,
): FamilySummary[] {
  const families: ScoreFamily[] = ["HMIS", "UWIN", "PCTS", "HMIS_STATE"];
  return families.map((family) => {
    const f: InsightFilters = { ...filters, family };
    const level = unitLevelFor(f);
    const list = records.filter((r) => matchesInsightFilters(r, f) && inWindow(r, win.fromMs, win.toMs));
    const units = buildUnits(list, level, win.toMs);
    return { family, reviews: list.length, units: units.length, level, medianScore: median(units.map((u) => u.score)) };
  });
}

// ---------------------------------------------------------------
// League table export (Excel reads HTML: inline styles only)
// ---------------------------------------------------------------

export function leagueXlsHtml(units: Unit[], level: UnitLevel, contextLines: string[], componentKeys: ComponentKey[]): string {
  const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const th = 'style="background:#0f172a;color:#ffffff;font-weight:bold;border:1px solid #cbd5e1;padding:4px 8px;text-align:left"';
  const td = 'style="border:1px solid #e2e8f0;padding:4px 8px"';
  const scoreTd = (v: number | null) => {
    const band = bandOf(v);
    return band
      ? `<td style="border:1px solid #e2e8f0;padding:4px 8px;background:${band.color};color:${band.ink};text-align:right">${v!.toFixed(1)}</td>`
      : `<td ${td}></td>`;
  };
  const headers = [
    "Rank (lowest first)",
    level === "block" ? "Block" : level === "district" ? "District" : "State",
    ...(level === "state" ? [] : [level === "block" ? "District" : "State"]),
    "Latest score",
    "Band",
    ...componentKeys.map((k) => COMPONENT_LABELS[k]),
    "Earlier score (first review, same scoring method)",
    "Change since then",
    "Reviews",
    "Last reviewed",
    "Days since last review",
    "Data period of latest review",
  ];
  const rows = units.map((u, i) => {
    const period = u.latest.periodOk ? `${u.latest.periodStart} to ${u.latest.periodEnd}` : "";
    return `<tr><td ${td}>${i + 1}</td><td ${td}>${esc(u.name)}</td>${level === "state" ? "" : `<td ${td}>${esc(u.parent)}</td>`}${scoreTd(u.score)}<td ${td}>${esc(bandOf(u.score)?.label)}</td>${componentKeys.map((k) => scoreTd(u.latest[k])).join("")}<td ${td}>${u.change === null ? "" : u.baseline.overall!.toFixed(1)}</td><td ${td}>${u.change === null ? "" : u.change.toFixed(1)}</td><td ${td}>${u.reviews.length}</td><td ${td}>${esc(dayLabel(u.latest.createdAtMs))}</td><td ${td}>${u.daysSince}</td><td ${td}>${esc(period)}</td></tr>`;
  });
  return `<table>${contextLines.map((line) => `<tr><td colspan="${headers.length}" style="font-weight:bold">${esc(line)}</td></tr>`).join("")}<tr></tr><tr>${headers.map((h) => `<th ${th}>${esc(h)}</th>`).join("")}</tr>${rows.join("")}</table>`;
}

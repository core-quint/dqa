// ============================================================
// Saved-review score grid
//
// Every snapshot saves, beside its headline score (which follows the on-screen
// filters), a small grid computed for the COMPLETE upload with the standard
// scoring settings, whatever filters were on screen:
//
//   * area x cumulative    - the district (or state) over the whole upload
//   * area x each period   - the district (or state) for each month, or each week
//                            of a weekly U-WIN upload
//   * row  x cumulative    - each block (state portals: each district) over the
//                            whole upload
//   * row  x each period   - each block (or district) for each month / week
//
// Rows are subsets of a run (computeSubsetScore), so they cost no extra engine
// runs; each period is one run with only that period selected, the same as saving
// a one-period review, so checks that compare a period with the next are N/A
// there. Grids saved before row periods existed (2026-10-14) have rows without
// `periods`.
//
// The grid is stored apart from the snapshot (snapshotBreakdowns/{id}) and read on
// demand: the snapshot list is fetched whole by Trends and the Dashboard.
//
// Reviews saved before the grid existed get a read-time grid built from their
// headline score, filling only the one cell that score represents.
// ============================================================

import type { OverallScoreResult } from './dqa/scoring';
import { computeSubsetScore } from './dqa/scoreUtils';
import { monthLongLabel, periodMonths } from './dqa/parseUtils';
import type { KpiCard } from './dqa/types';
import { getDataPeriod, getSnapshotBlock, getSnapshotDqaLevel, monthsBetween, normalizePortal, type SnapshotKpiData, type SnapshotRecord } from './snapshots';
import { windowLabel } from './uwin/uploadPeriod';

export const BREAKDOWN_VERSION = 1;

export const BREAKDOWN_COMPONENTS = ['availability', 'completeness', 'accuracy', 'consistency'] as const;
export type BreakdownComponent = (typeof BREAKDOWN_COMPONENTS)[number];

export interface BreakdownCell {
  overall: number | null;
  availability: number | null;
  /** Always null for U-WIN, whose framework has no completeness component. */
  completeness: number | null;
  accuracy: number | null;
  consistency: number | null;
  /** Units scored (facilities, sub-centers, districts...); null when not recorded. */
  units: number | null;
}

export interface BreakdownPeriod {
  /** "YYYY-MM", or "YYYY-MM-DD..YYYY-MM-DD" for a week. */
  key: string;
  label: string;
  /** Declared From-To dates behind the period (U-WIN), else null. */
  from: string | null;
  to: string | null;
  cell: BreakdownCell;
}

export interface BreakdownRowPeriod {
  /** Same key as the matching entry of SnapshotBreakdown.periods. */
  key: string;
  cell: BreakdownCell;
}

export interface BreakdownRow {
  name: string;
  /** The block (or district) over the whole upload. */
  cell: BreakdownCell;
  /** The block (or district) for each period; absent on grids saved before it existed. */
  periods?: BreakdownRowPeriod[];
}

export interface SnapshotBreakdown {
  version: number;
  methodVersion: number;
  areaLevel: 'STATE' | 'DISTRICT';
  areaName: string;
  rowLevel: 'BLOCK' | 'DISTRICT';
  unitLabel: string;
  periodKind: 'MONTH' | 'WEEK';
  /** Null only on a read-time grid for a review that never scored the whole area. */
  cumulative: BreakdownCell | null;
  periods: BreakdownPeriod[];
  rows: BreakdownRow[];
}

export interface ResolvedBreakdown extends SnapshotBreakdown {
  /** "saved" = computed at save time; "legacy" = rebuilt from an older review's headline. */
  source: 'saved' | 'legacy';
}

function round2(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** Grid cell from a shared-scoring result (HMIS / U-WIN / HMIS-State subsets). */
export function cellFromScore(result: OverallScoreResult): BreakdownCell {
  return {
    overall: round2(result.overall),
    availability: round2(result.components.availability?.score),
    completeness: round2(result.components.completeness?.score),
    accuracy: round2(result.components.accuracy?.score),
    consistency: round2(result.components.consistency?.score),
    units: result.denominator,
  };
}

/** Grid cell from an engine that reports component scores directly (PCTS, HMIS-State). */
export function cellFromComponents(
  overall: number | null,
  components: Partial<Record<BreakdownComponent, { score: number | null } | undefined>>,
  units: number,
): BreakdownCell {
  return {
    overall: round2(overall),
    availability: round2(components.availability?.score),
    completeness: round2(components.completeness?.score),
    accuracy: round2(components.accuracy?.score),
    consistency: round2(components.consistency?.score),
    units,
  };
}

/**
 * One row per group of analysed units (block, or district), scored as subsets of
 * a single engine run. `kpis` must come from that run.
 */
export function subsetRows<U>(
  kpis: { filteredFacilities: Record<string, U>; cards: KpiCard[]; scoreCards?: KpiCard[] },
  groups: string[],
  rowName: (unit: U) => string,
): BreakdownRow[] {
  const units = new Map<string, Set<string>>();
  for (const [key, unit] of Object.entries(kpis.filteredFacilities)) {
    const name = rowName(unit);
    if (!units.has(name)) units.set(name, new Set());
    units.get(name)!.add(key);
  }
  return [...units.entries()].map(([name, keys]) => ({
    name,
    cell: cellFromScore(computeSubsetScore(kpis, keys, groups)),
  }));
}

/** What a portal supplies to build its grid. */
export interface BreakdownPlan {
  areaLevel: SnapshotBreakdown['areaLevel'];
  areaName: string;
  rowLevel: SnapshotBreakdown['rowLevel'];
  unitLabel: string;
  periodKind: SnapshotBreakdown['periodKind'];
  periodKeys: string[];
  methodVersion: number;
  periodInfo: (key: string) => { label: string; from: string | null; to: string | null };
  /** The complete upload with standard settings: area cumulative plus one row per block / district. */
  scoreWhole: () => { cumulative: BreakdownCell; rows: BreakdownRow[] };
  /** The complete upload restricted to one period: the area plus one row per block / district. */
  scorePeriod: (key: string) => { cell: BreakdownCell; rows: BreakdownRow[] };
}

/** Hands the browser a frame between engine runs, so a large upload never freezes the page. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function buildBreakdown(plan: BreakdownPlan): Promise<SnapshotBreakdown> {
  const whole = plan.scoreWhole();
  const periods: BreakdownPeriod[] = [];
  const rowPeriods = new Map<string, BreakdownRowPeriod[]>(whole.rows.map((row) => [row.name, []]));
  for (const key of [...plan.periodKeys].sort()) {
    await yieldToBrowser();
    const scored = plan.scorePeriod(key);
    periods.push({ key, ...plan.periodInfo(key), cell: scored.cell });
    for (const row of scored.rows) rowPeriods.get(row.name)?.push({ key, cell: row.cell });
  }
  return {
    version: BREAKDOWN_VERSION,
    methodVersion: plan.methodVersion,
    areaLevel: plan.areaLevel,
    areaName: plan.areaName,
    rowLevel: plan.rowLevel,
    unitLabel: plan.unitLabel,
    periodKind: plan.periodKind,
    cumulative: whole.cumulative,
    periods,
    rows: whole.rows
      .map((row) => ({ ...row, periods: rowPeriods.get(row.name) ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * A grid for a review saved without one: its headline score placed in the one cell
 * it represents. A 1-month whole-area review fills that month and the cumulative; a
 * multi-month one the cumulative only; a block review its block row. A partial
 * review (some blocks, an ownership / rural-urban / facility-type filter) fills
 * nothing: its score is not any cell of the standard grid.
 */
export function legacyBreakdown(snapshot: SnapshotRecord): ResolvedBreakdown | null {
  const data: SnapshotKpiData = snapshot.kpiData ?? {};
  const scope = data.scope;
  if (scope && (scope.partial || scope.ownership.length > 0 || scope.ruralUrban.length > 0 || scope.facilityTypes.length > 0)) {
    return null;
  }
  const portal = normalizePortal(snapshot.portal);
  const isState = portal === 'HMIS_STATE' || portal === 'UWIN_STATE' || data.dqaLevel === 'STATE';
  const cell: BreakdownCell = {
    overall: round2(snapshot.overallScore),
    availability: round2(data.availabilityScore),
    completeness: round2(data.completenessScore),
    accuracy: round2(data.accuracyScore),
    consistency: round2(data.consistencyScore),
    units: null,
  };
  const base: ResolvedBreakdown = {
    version: BREAKDOWN_VERSION,
    methodVersion: data.methodVersion ?? 1,
    areaLevel: isState ? 'STATE' : 'DISTRICT',
    areaName: isState ? snapshot.state : snapshot.district,
    rowLevel: isState ? 'DISTRICT' : 'BLOCK',
    unitLabel: '',
    periodKind: data.uploadDuration === 'WEEKLY' ? 'WEEK' : 'MONTH',
    cumulative: null,
    periods: [],
    rows: [],
    source: 'legacy',
  };

  const block = getSnapshotBlock(snapshot);
  if (!isState && getSnapshotDqaLevel(snapshot) === 'BLOCK' && block) {
    return { ...base, rows: [{ name: block, cell }] };
  }

  const period = getDataPeriod(snapshot);
  const singleMonth = period !== null && period.start === period.end && data.uploadDuration !== 'WEEKLY';
  return {
    ...base,
    cumulative: cell,
    periods: singleMonth
      ? [{ key: period.start, label: monthLongLabel(period.start), from: data.dataFrom ?? null, to: data.dataTo ?? null, cell }]
      : [],
  };
}

function headlineCoversWholeArea(snapshot: SnapshotRecord): boolean {
  const data: SnapshotKpiData = snapshot.kpiData ?? {};
  const scope = data.scope;
  const portal = normalizePortal(snapshot.portal);
  const isState = portal === 'HMIS_STATE' || portal === 'UWIN_STATE' || data.dqaLevel === 'STATE';
  if (!isState && getSnapshotDqaLevel(snapshot) === 'BLOCK') return false;
  return !(scope && (scope.partial || scope.ownership.length > 0 || scope.ruralUrban.length > 0 || scope.facilityTypes.length > 0));
}

/**
 * Per-month overall scores a review contributes on a data-period axis, from its
 * saved grid: one value per calendar month (weeks in the same month averaged; a
 * week spanning two months counts in both). Only for reviews whose headline covers
 * the whole area, so the month cells split that same score over time, and only for
 * the months the review analysed. Null means "use the headline score".
 */
export function gridMonthScores(
  snapshot: SnapshotRecord,
  grid: SnapshotBreakdown | null | undefined,
  months: string[],
  pick: (cell: BreakdownCell) => number | null = (cell) => cell.overall,
): Record<string, number | null> | null {
  if (!grid || grid.periods.length === 0 || !headlineCoversWholeArea(snapshot)) return null;
  return monthScoresFromPeriods(grid.periods, months, pick);
}

/**
 * One overall score per calendar month from a list of period cells (an area's or
 * one block's): weeks in the same month averaged, a week spanning two months
 * counted in both, months outside `months` ignored. Null when nothing falls inside.
 */
export function monthScoresFromPeriods(
  periods: { key: string; cell: BreakdownCell }[] | undefined,
  months: string[],
  pick: (cell: BreakdownCell) => number | null = (cell) => cell.overall,
): Record<string, number | null> | null {
  if (!periods || periods.length === 0) return null;
  const wanted = new Set(months);
  const values = new Map<string, number[]>();
  for (const period of periods) {
    for (const month of periodMonths(period.key)) {
      if (!wanted.has(month)) continue;
      const list = values.get(month) ?? [];
      const value = pick(period.cell);
      if (value !== null) list.push(value);
      values.set(month, list);
    }
  }
  if (values.size === 0) return null;
  const scores: Record<string, number | null> = {};
  for (const [month, list] of values) {
    scores[month] = list.length > 0 ? list.reduce((sum, value) => sum + value, 0) / list.length : null;
  }
  return scores;
}

/**
 * Mean of the month scores inside a "YYYY-MM" window, from a list of period cells
 * (an area's or one block's). Null when the window takes none or all of the
 * review's months - a whole-period window is the review's own cumulative score,
 * which is not the mean of its months - or when no cell in it has a value.
 */
export function windowMean(
  periods: { key: string; cell: BreakdownCell }[] | undefined,
  reviewMonths: string[],
  windowStart: string,
  windowEnd: string,
  pick: (cell: BreakdownCell) => number | null,
): number | null {
  const inWindow = reviewMonths.filter((month) => month >= windowStart && month <= windowEnd);
  if (inWindow.length === 0 || inWindow.length === reviewMonths.length) return null;
  const scores = monthScoresFromPeriods(periods, inWindow, pick);
  const values = scores ? Object.values(scores).filter((value): value is number => value !== null) : [];
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * A review's score for only the months of a "YYYY-MM" window, from its saved grid:
 * the area's month cells for a whole-area review, the block's own month cells for
 * a block review. Null when the grid cannot answer (no grid, a filtered headline,
 * a window taking none or all of its months); the caller then keeps the review's
 * own score.
 */
export function gridWindowScore(
  snapshot: SnapshotRecord,
  grid: SnapshotBreakdown | null | undefined,
  windowStart: string,
  windowEnd: string,
  pick: (cell: BreakdownCell) => number | null,
): number | null {
  const period = getDataPeriod(snapshot);
  if (!grid || !period) return null;
  const reviewMonths = monthsBetween(period.start, period.end);
  let periods: { key: string; cell: BreakdownCell }[] | undefined;
  const block = getSnapshotBlock(snapshot);
  const scope = snapshot.kpiData?.scope;
  const portal = normalizePortal(snapshot.portal);
  const isState = portal === 'HMIS_STATE' || portal === 'UWIN_STATE' || snapshot.kpiData?.dqaLevel === 'STATE';
  if (!isState && getSnapshotDqaLevel(snapshot) === 'BLOCK' && block) {
    const unfiltered = !scope || (scope.ownership.length === 0 && scope.ruralUrban.length === 0 && scope.facilityTypes.length === 0);
    const key = block.trim().toLowerCase();
    periods = unfiltered ? grid.rows.find((row) => row.name.trim().toLowerCase() === key)?.periods : undefined;
  } else if (headlineCoversWholeArea(snapshot)) {
    periods = grid.periods;
  }
  return windowMean(periods, reviewMonths, windowStart, windowEnd, pick);
}

/**
 * Block rows a district review's grid can place on a block map. The grid always
 * covers the complete upload, so the rows hold whatever the headline was filtered
 * to; state reviews (district rows) and grids without block rows give none.
 */
export function gridBlockRows(grid: SnapshotBreakdown | null | undefined): BreakdownRow[] {
  if (!grid || grid.areaLevel !== 'DISTRICT' || grid.rowLevel !== 'BLOCK') return [];
  return grid.rows;
}

/** The grid to show for a review: the saved one when present, else the read-time one. */
export function resolveBreakdown(snapshot: SnapshotRecord, saved: SnapshotBreakdown | null): ResolvedBreakdown | null {
  return saved ? { ...saved, source: 'saved' } : legacyBreakdown(snapshot);
}

/** "May 2026 (20 Apr - 20 May 2026)" when the declared dates differ from the label, else the label. */
export function periodDisplayLabel(period: BreakdownPeriod): string {
  if (!period.from || !period.to) return period.label;
  const dates = windowLabel(period.from, period.to);
  return dates === period.label ? period.label : `${period.label} (${dates})`;
}

const esc = (value: unknown) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TEXT_CELL = `style="mso-number-format:'\\@';border:1px solid #cbd5e1;padding:4px 8px"`;
const NUM_CELL = `style="mso-number-format:'0.0';border:1px solid #cbd5e1;padding:4px 8px;text-align:right"`;
const HEAD_CELL = `style="background:#0f172a;color:#ffffff;font-weight:bold;border:1px solid #0f172a;padding:4px 8px"`;

function gridColumns(breakdown: SnapshotBreakdown): BreakdownComponent[] {
  // U-WIN has no completeness component; drop the column when nothing has it.
  const cells = [breakdown.cumulative, ...breakdown.periods.map((p) => p.cell), ...breakdown.rows.map((r) => r.cell)];
  return BREAKDOWN_COMPONENTS.filter((group) => group !== 'completeness' || cells.some((cell) => cell?.completeness !== null && cell?.completeness !== undefined));
}

const COMPONENT_TITLES: Record<BreakdownComponent, string> = {
  availability: 'Availability',
  completeness: 'Completeness',
  accuracy: 'Accuracy',
  consistency: 'Consistency',
};

function tableHtml(firstHeader: string, rows: { label: string; cell: BreakdownCell | null }[], columns: BreakdownComponent[], unitLabel: string): string {
  const head = [firstHeader, 'Overall', ...columns.map((group) => COMPONENT_TITLES[group]), unitLabel || 'Units']
    .map((title) => `<th ${HEAD_CELL}>${esc(title)}</th>`).join('');
  const num = (value: number | null | undefined) => (value === null || value === undefined ? `<td ${TEXT_CELL}>N/A</td>` : `<td ${NUM_CELL}>${value}</td>`);
  const body = rows.map(({ label, cell }) => {
    if (!cell) return `<tr><td ${TEXT_CELL}>${esc(label)}</td><td ${TEXT_CELL} colspan="${columns.length + 2}">Not recorded</td></tr>`;
    const units = cell.units === null ? `<td ${TEXT_CELL}></td>` : `<td ${NUM_CELL.replace("'0.0'", "'0'")}>${cell.units}</td>`;
    return `<tr><td ${TEXT_CELL}>${esc(label)}</td>${num(cell.overall)}${columns.map((group) => num(cell[group])).join('')}${units}</tr>`;
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The .xls document for one review's grid (inline styles only: Excel drops classes). */
export function breakdownWorkbookHtml(snapshot: SnapshotRecord, breakdown: ResolvedBreakdown, contextLines: string[]): string {
  const columns = gridColumns(breakdown);
  const area = breakdown.areaLevel === 'STATE' ? 'State' : 'District';
  const periodTitle = breakdown.periodKind === 'WEEK' ? 'Week' : 'Month';
  const rowTitle = breakdown.rowLevel === 'BLOCK' ? 'Block' : 'District';
  const overTime = [
    { label: `${breakdown.areaName || area} - all ${periodTitle.toLowerCase()}s (cumulative)`, cell: breakdown.cumulative },
    ...breakdown.periods.map((period) => ({ label: periodDisplayLabel(period), cell: period.cell })),
  ];
  const byRow = breakdown.rows.map((row) => ({ label: row.name, cell: row.cell }));
  const periodLabels = new Map(breakdown.periods.map((period) => [period.key, periodDisplayLabel(period)]));
  const byRowPeriod = breakdown.rows.flatMap((row) =>
    (row.periods ?? []).map((period) => ({ label: `${row.name} - ${periodLabels.get(period.key) ?? period.key}`, cell: period.cell })),
  );
  const intro = [
    `Score grid · ${snapshot.state}${breakdown.areaLevel === 'DISTRICT' ? ` · ${snapshot.district}` : ''}`,
    ...contextLines,
    breakdown.source === 'legacy'
      ? 'Saved before score grids were recorded: only the cell this review scored is filled.'
      : 'Complete upload, standard scoring settings; on-screen filters are not applied.',
  ].map((line) => `<tr><td ${TEXT_CELL}>${esc(line)}</td></tr>`).join('');
  return `<html><head><meta charset="UTF-8"></head><body>`
    + `<table>${intro}</table><br/>`
    + `<table><tr><td ${TEXT_CELL}><b>${esc(`${area} by ${periodTitle.toLowerCase()}`)}</b></td></tr></table>`
    + tableHtml(periodTitle, overTime, columns, breakdown.unitLabel)
    + `<br/><table><tr><td ${TEXT_CELL}><b>${esc(`${rowTitle} - cumulative`)}</b></td></tr></table>`
    + (byRow.length > 0 ? tableHtml(rowTitle, byRow, columns, breakdown.unitLabel) : `<table><tr><td ${TEXT_CELL}>Not recorded</td></tr></table>`)
    + (byRowPeriod.length > 0
      ? `<br/><table><tr><td ${TEXT_CELL}><b>${esc(`${rowTitle} by ${periodTitle.toLowerCase()}`)}</b></td></tr></table>`
        + tableHtml(`${rowTitle} - ${periodTitle}`, byRowPeriod, columns, breakdown.unitLabel)
      : '')
    + `</body></html>`;
}

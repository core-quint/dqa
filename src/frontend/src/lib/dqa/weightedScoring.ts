// ============================================================
// Weighted scoring — the check weights and the weighted score
//
// Scoring method v8 (adopted 2026-10-29, designed 2026-10-19). Every score in
// the app goes through lib/dqa/scoring.ts `scoreComponents`, which calls
// `scoreWeighted` below, so the screen, saved reviews, PDFs and score grids
// always agree.
//
// THE METHOD:
//   - Every standard check has a fixed weight; weights depend on the portal and
//     on how many periods are selected: one month or one week uses the
//     1-period set, two or more the multi-period set.
//   - Check % = units flagged ÷ ALL units in scope (as today); check score =
//     100 − check %. A check that ran and flagged no one scores 100.
//   - A check that cannot run (no unit could be evaluated: a column is missing,
//     the months are not consecutive, ...) passes its weight on, in proportion
//     to the receivers' weights: first to the other checks in its group, then
//     to the other groups in its component, then to the other components.
//   - Component score = weighted average of its checks; overall = Σ (weight
//     used × check score) ÷ 100. Weights are exact fractions; only the
//     display is rounded.
// ============================================================

// Lives here (re-exported by scoring.ts) so this module imports nothing from scoring.ts.
export const COMPONENT_LABELS: Record<string, string> = {
  availability: 'Availability',
  completeness: 'Completeness',
  accuracy: 'Accuracy',
  consistency: 'Consistency',
};

export type WeightPortal = 'HMIS' | 'HMIS_STATE' | 'UWIN' | 'PCTS';
export type WeightMode = 'single' | 'multi';

interface CheckWeight {
  id: string;
  /** Fallback name when the check produced no card at all. */
  label: string;
  component: string;
  group: string;
  /** % of the overall score before any weight is passed on. */
  weight: number;
}

/** A group's weight split equally between its checks. */
function group(
  component: string,
  groupLabel: string,
  groupWeight: number,
  checks: Array<[id: string, label: string]>,
): CheckWeight[] {
  return checks.map(([id, label]) => ({
    id,
    label,
    component,
    group: groupLabel,
    weight: groupWeight / checks.length,
  }));
}

const HMIS_DROPOUTS: Array<[string, string]> = [
  ['drop_penta1_penta3', 'Dropouts — Penta1→Penta3'],
  ['drop_mr1_mr2', 'Dropouts — MR1→MR2'],
  ['drop_penta3_mr1', 'Dropouts — Penta3→MR1'],
];
const STATE_DROPOUTS: Array<[string, string]> = [
  ['drop_Penta1_Penta3', 'Penta1 → Penta3 Dropout'],
  ['drop_MR1_MR2', 'MR1 → MR2 Dropout'],
  ['drop_Penta3_MR1', 'Penta3 → MR1 Dropout'],
];
const PCTS_DROPOUTS: Array<[string, string]> = [
  ['drop_penta1_penta3', 'Penta 1 → Penta 3 Dropout'],
  ['drop_mr1_mr2', 'MR 1 → MR 2 Dropout'],
  ['drop_penta3_mr1', 'Penta 3 → MR 1 Dropout'],
];
const COADMIN: Array<[string, string]> = [
  ['co1', 'Co-administration — 6 weeks'],
  ['co2', 'Co-administration — 10 weeks'],
  ['co3', 'Co-administration — 14 weeks'],
  ['co4', 'Co-administration — 9 months'],
  ['co5', 'Co-administration — 2 years'],
];
const PCTS_COADMIN: Array<[string, string]> = [
  ['coadmin_6_weeks', 'Co-administered Antigens — 6 weeks'],
  ['coadmin_10_weeks', 'Co-administered Antigens — 10 weeks'],
  ['coadmin_14_weeks', 'Co-administered Antigens — 14 weeks'],
  ['coadmin_9_months', 'Co-administered Antigens — 9 months'],
  ['coadmin_16_24_months', 'Co-administered Antigens — 16–24 months'],
];

const ALL = 'All checks';
const INCONSISTENCIES = 'Inconsistencies';
const CO_ADMINISTRATION = 'Co-administration';

/** The weight tables agreed with the programme team (2026-10-19). Each mode totals 100. */
export const CHECK_WEIGHTS: Record<WeightPortal, Record<WeightMode, CheckWeight[]>> = {
  HMIS: {
    single: [
      ...group('availability', ALL, 20, [['t1', 'All Indicators Blank'], ['t0', 'Indicators having 0 values but not blank'], ['t10', 'Session Not Held but Vaccinated']]),
      ...group('completeness', ALL, 30, [['t2', 'Key Missing Indicators']]),
      ...group('consistency', INCONSISTENCIES, 25, [['t6', 'Sessions Held > Sessions Planned'], ['i1', 'Inconsistencies — Penta3>Penta1'], ['i2', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 25, COADMIN),
    ],
    multi: [
      ...group('availability', ALL, 20, [['t1', 'All Indicators Blank'], ['t0', 'Indicators having 0 values but not blank'], ['t10', 'Session Not Held but Vaccinated'], ['t7', 'Duplicate Monthly Record']]),
      ...group('completeness', ALL, 30, [['t2', 'Key Missing Indicators']]),
      ...group('accuracy', 'Outliers', 12.5, [['t3', 'Outliers']]),
      ...group('accuracy', 'Dropouts', 12.5, HMIS_DROPOUTS),
      ...group('consistency', INCONSISTENCIES, 12.5, [['t6', 'Sessions Held > Sessions Planned'], ['i1', 'Inconsistencies — Penta3>Penta1'], ['i2', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 12.5, COADMIN),
    ],
  },
  HMIS_STATE: {
    single: [
      ...group('availability', ALL, 20, [['all_m9_blank', 'All M9 Indicators Blank'], ['key_all_zero', 'Key Indicators All Zero']]),
      ...group('completeness', ALL, 30, [['key_missing', 'Key Missing Indicators']]),
      ...group('consistency', INCONSISTENCIES, 25, [['held_gt_planned', 'Sessions Held > Sessions Planned'], ['penta3_gt_penta1', 'Inconsistencies — Penta3>Penta1'], ['mr2_gt_mr1', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 25, COADMIN),
    ],
    multi: [
      ...group('availability', ALL, 20, [['all_m9_blank', 'All M9 Indicators Blank'], ['key_all_zero', 'Key Indicators All Zero'], ['repeated_profile', 'Duplicate Monthly Record']]),
      ...group('completeness', ALL, 30, [['key_missing', 'Key Missing Indicators']]),
      ...group('accuracy', 'Outliers', 12.5, [['outliers', 'Month-on-Month Outliers']]),
      ...group('accuracy', 'Dropouts', 12.5, STATE_DROPOUTS),
      ...group('consistency', INCONSISTENCIES, 12.5, [['held_gt_planned', 'Sessions Held > Sessions Planned'], ['penta3_gt_penta1', 'Inconsistencies — Penta3>Penta1'], ['mr2_gt_mr1', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 12.5, COADMIN),
    ],
  },
  // U-WIN and U-WIN State: Completeness is not scored.
  UWIN: {
    single: [
      ...group('availability', ALL, 100 / 3, [['t0', 'Indicators having 0 values but not blank'], ['t7', 'Indicators with same values'], ['t9', 'Zero coverage session']]),
      ...group('accuracy', 'Sessions', 100 / 3, [['t6', 'Planned but not held'], ['t8', 'Avg Beneficiaries per Session < 5']]),
      ...group('consistency', INCONSISTENCIES, 50 / 3, [['i1', 'Inconsistencies — Penta3>Penta1'], ['i2', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 50 / 3, COADMIN),
    ],
    multi: [
      ...group('availability', ALL, 100 / 3, [['t0', 'Indicators having 0 values but not blank'], ['t7', 'Indicators with same values'], ['t9', 'Zero coverage session']]),
      ...group('accuracy', 'Sessions', 100 / 9, [['t6', 'Planned but not held'], ['t8', 'Avg Beneficiaries per Session < 5']]),
      ...group('accuracy', 'Outliers', 100 / 9, [['t3', 'Outliers']]),
      ...group('accuracy', 'Dropouts', 100 / 9, HMIS_DROPOUTS),
      ...group('consistency', INCONSISTENCIES, 50 / 3, [['i1', 'Inconsistencies — Penta3>Penta1'], ['i2', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 50 / 3, COADMIN),
    ],
  },
  PCTS: {
    single: [
      ...group('availability', ALL, 20, [['key_indicators_zero', 'Key Indicators All Zero']]),
      ...group('completeness', ALL, 30, [['key_indicators_missing', 'Key Indicators Missing']]),
      ...group('consistency', INCONSISTENCIES, 25, [['penta3_gt_penta1', 'Inconsistencies — Penta3>Penta1'], ['mr2_gt_mr1', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 25, PCTS_COADMIN),
    ],
    multi: [
      ...group('availability', ALL, 20, [['key_indicators_zero', 'Key Indicators All Zero'], ['repeated_key_profile', 'Repeated Key-Indicator Profile']]),
      ...group('completeness', ALL, 30, [['key_indicators_missing', 'Key Indicators Missing']]),
      ...group('accuracy', 'Outliers', 12.5, [['month_outliers', 'Month-on-Month Outliers']]),
      ...group('accuracy', 'Dropouts', 12.5, PCTS_DROPOUTS),
      ...group('consistency', INCONSISTENCIES, 12.5, [['penta3_gt_penta1', 'Inconsistencies — Penta3>Penta1'], ['mr2_gt_mr1', 'Inconsistencies — MR2>MR1']]),
      ...group('consistency', CO_ADMINISTRATION, 12.5, PCTS_COADMIN),
    ],
  },
};

/** Strips float noise from sums of fractions (e.g. 100.00000000000001). */
function clean(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** One month or one week → the 1-period weights; two or more → the multi-period weights. */
export function weightMode(periodCount: number): WeightMode {
  return periodCount >= 2 ? 'multi' : 'single';
}

/** A check's result as the engines report it (the standard-settings score cards). */
export interface WeightedInputCard {
  id: string;
  name: string;
  /** Units flagged. */
  flagged: number;
  /** Units the check could be evaluated for; 0 = the check cannot run. */
  eligible: number;
}

export interface WeightedCheckResult {
  id: string;
  name: string;
  component: string;
  group: string;
  /** Weight in the table for this mode (% of the overall). */
  baseWeight: number;
  /** Weight actually used after passing on the weight of checks that cannot run. */
  effectiveWeight: number;
  flagged: number | null;
  eligible: number;
  /** % of all units in scope flagged; null when the check cannot run. */
  pct: number | null;
  /** 100 − pct; null when the check cannot run. */
  score: number | null;
  /** effectiveWeight × score ÷ 100 — this check's share of the overall. */
  points: number | null;
  canRun: boolean;
}

export interface WeightedComponentResult {
  key: string;
  name: string;
  /** The component's weight in the table for this mode. */
  baseWeight: number;
  /** The weight it carries after passing on (0 when none of its checks can run). */
  effectiveWeight: number;
  /** Weighted average of its checks; null when no check can run or it has no weight in this mode. */
  score: number | null;
  points: number | null;
}

export interface WeightedScoreResult {
  mode: WeightMode;
  periodCount: number;
  denominator: number;
  /** null when nothing in the selection can be scored ("No data"). */
  overall: number | null;
  components: Record<string, WeightedComponentResult>;
  checks: WeightedCheckResult[];
  /** Components that carry weight in this mode / that could be scored — for the coverage note. */
  totalComponents: number;
  scoredComponents: number;
}

/**
 * The weighted score for one analysis. `groups` lists the components to
 * report, in display order (U-WIN leaves out completeness).
 */
export function scoreWeighted(
  cards: WeightedInputCard[],
  denominator: number,
  portal: WeightPortal,
  periodCount: number,
  groups: string[],
): WeightedScoreResult {
  const mode = weightMode(periodCount);
  const table = CHECK_WEIGHTS[portal][mode];
  const den = denominator > 0 ? denominator : 0;
  const byId = new Map(cards.map((card) => [card.id, card]));

  const checks: WeightedCheckResult[] = table.map((entry) => {
    const card = byId.get(entry.id);
    const canRun = den > 0 && card !== undefined && card.eligible > 0;
    const pct = canRun ? (card.flagged / den) * 100 : null;
    return {
      id: entry.id,
      name: card?.name ?? entry.label,
      component: entry.component,
      group: entry.group,
      baseWeight: entry.weight,
      effectiveWeight: 0,
      flagged: card ? card.flagged : null,
      eligible: card?.eligible ?? 0,
      pct,
      score: pct === null ? null : Math.max(0, 100 - pct),
      points: null,
      canRun,
    };
  });

  // Base and runnable weight per group, per component, and overall.
  const groupKey = (check: WeightedCheckResult) => `${check.component}|${check.group}`;
  const groupBase = new Map<string, number>();
  const groupRunBase = new Map<string, number>();
  for (const check of checks) {
    const key = groupKey(check);
    groupBase.set(key, (groupBase.get(key) ?? 0) + check.baseWeight);
    if (check.canRun) groupRunBase.set(key, (groupRunBase.get(key) ?? 0) + check.baseWeight);
  }
  const componentBase = new Map<string, number>();
  const componentRunBase = new Map<string, number>();
  for (const [key, weight] of groupBase) {
    const component = key.split('|')[0];
    componentBase.set(component, (componentBase.get(component) ?? 0) + weight);
    if ((groupRunBase.get(key) ?? 0) > 0) {
      componentRunBase.set(component, (componentRunBase.get(component) ?? 0) + weight);
    }
  }
  let totalRunBase = 0;
  for (const [component, weight] of componentBase) {
    if ((componentRunBase.get(component) ?? 0) > 0) totalRunBase += weight;
  }

  // Pass weight on: within the group, then the component, then across components.
  let overallPoints = 0;
  for (const check of checks) {
    if (!check.canRun || totalRunBase <= 0) continue;
    const key = groupKey(check);
    check.effectiveWeight = check.baseWeight
      * ((groupBase.get(key) ?? 0) / (groupRunBase.get(key) ?? 1))
      * ((componentBase.get(check.component) ?? 0) / (componentRunBase.get(check.component) ?? 1))
      * (100 / totalRunBase);
    check.points = (check.effectiveWeight * (check.score ?? 0)) / 100;
    overallPoints += check.points;
  }

  const components: Record<string, WeightedComponentResult> = {};
  let totalComponents = 0;
  let scoredComponents = 0;
  for (const key of groups) {
    const own = checks.filter((check) => check.component === key);
    const effective = own.reduce((sum, check) => sum + check.effectiveWeight, 0);
    const points = own.reduce((sum, check) => sum + (check.points ?? 0), 0);
    const baseWeight = componentBase.get(key) ?? 0;
    if (baseWeight > 0) totalComponents += 1;
    if (effective > 0) scoredComponents += 1;
    components[key] = {
      key,
      name: COMPONENT_LABELS[key] ?? key,
      baseWeight,
      effectiveWeight: clean(effective),
      score: effective > 0 ? clean((points * 100) / effective) : null,
      points: effective > 0 ? clean(points) : null,
    };
  }

  return {
    mode,
    periodCount,
    denominator: den,
    overall: totalRunBase > 0 ? clean(overallPoints) : null,
    components,
    checks,
    totalComponents,
    scoredComponents,
  };
}

/** "Multi-period weights (2+ months or weeks)" / "1-period weights (1 month or 1 week)". */
export function weightModeLabel(mode: WeightMode): string {
  return mode === 'single' ? '1-period weights (1 month or 1 week)' : 'Multi-period weights (2+ months or weeks)';
}

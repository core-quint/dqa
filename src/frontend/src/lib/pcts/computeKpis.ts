// ============================================================
// PCTS KPI engine — scoring method v2 (agreed 2026-09-22)
//
// Shared rules live in lib/dqa/checkRules.ts (outlier bands, small-count bands,
// dropout thresholds, matched-month totals) and lib/dqa/scoring.ts (component
// and overall scores). PCTS specifics:
//   - Month-on-month checks compare calendar-adjacent months only.
//   - Dropouts and later-dose > earlier-dose checks are judged on the totals of
//     the selected period (months where both doses were reported).
//   - Co-administered doses: shared rule in lib/dqa/coadmin.ts (±25% of the
//     visit's reference count, ±50% when it is under 10).
//   - The score always uses the standard settings; the reviewer's settings
//     only change the drill-downs.
// ============================================================

import {
  DEFAULT_PCTS_FILTERS,
  PCTS_INDICATORS,
  type PctsBlockSummary,
  type PctsCard,
  type PctsComponentScore,
  type PctsComputed,
  type PctsFacilityRecord,
  type PctsFilters,
  type PctsGroup,
  type PctsHit,
  type PctsPair,
  type PctsParsed,
} from "./types";
import { scoreComponents, type OverallScoreResult, type ScoringCard } from "../dqa/scoring";
import { coadminDetail, coadminRedCells } from "../dqa/coadmin";
import {
  dropoutPct,
  doseExcessLabel,
  formatChange,
  laterDoseExceeds,
  matchedTotals,
  isStandardOutlierIndicator,
  monthOnMonthChange,
  passesChangeSeverity,
} from "../dqa/checkRules";
import { periodsAreConsecutive } from "../dqa/parseUtils";

type Evaluator = (facilityKey: string, month: string) => PctsHit | null;

interface PeriodResult {
  period: PctsHit;
  months: Record<string, PctsHit>;
  evaluableMonths: number;
  hitMonths: number;
}

type PeriodEvaluator = (facilityKey: string) => PeriodResult;

const GROUPS: PctsGroup[] = ["availability", "completeness", "accuracy", "consistency"];

/** Later dose > earlier dose checks, the same two in every portal. */
const DOSE_ORDER_CHECKS: { id: string; name: string; from: string; to: string }[] = [
  { id: "penta3_gt_penta1", name: "Inconsistencies — Penta3>Penta1", from: "penta1", to: "penta3" },
  { id: "mr2_gt_mr1", name: "Inconsistencies — MR2>MR1", from: "mr1", to: "mr2" },
];

/** Standard dropout pairs, the same in every portal; only these are scored. */
const DEFAULT_DROPOUT_PAIRS: PctsPair[] = [
  { from: "penta1", to: "penta3" },
  { from: "mr1", to: "mr2" },
  { from: "penta3", to: "mr1" },
];

/** A month-by-month check: flagged when any checkable month is flagged. */
function makeCard(
  id: string,
  name: string,
  description: string,
  group: PctsGroup,
  facilityKeys: string[],
  months: string[],
  evaluator: Evaluator,
): PctsCard {
  const hits: PctsCard["hits"] = {};
  const affectedFacilities: string[] = [];
  const eligibleFacilities: string[] = [];
  let all = 0;
  for (const facilityKey of facilityKeys) {
    hits[facilityKey] = {};
    const evaluated: PctsHit[] = [];
    for (const month of months) {
      const hit = evaluator(facilityKey, month);
      if (hit === null) continue;
      hits[facilityKey][month] = hit;
      if (hit.evaluable !== false) evaluated.push(hit);
    }
    if (evaluated.length === 0) continue;
    eligibleFacilities.push(facilityKey);
    if (evaluated.some((hit) => hit.flag)) affectedFacilities.push(facilityKey);
    if (evaluated.every((hit) => hit.flag)) all += 1;
  }
  const total = affectedFacilities.length;
  return {
    id,
    name,
    description,
    group,
    total,
    any: total - all,
    all,
    eligible: eligibleFacilities.length,
    eligibleFacilities,
    affectedFacilities,
    basis: "month",
    hits,
  };
}

/** A check judged on the selected period's totals; monthly detail is context. */
function makePeriodCard(
  id: string,
  name: string,
  description: string,
  group: PctsGroup,
  facilityKeys: string[],
  evaluator: PeriodEvaluator,
): PctsCard {
  const hits: PctsCard["hits"] = {};
  const periodHits: Record<string, PctsHit> = {};
  const affectedFacilities: string[] = [];
  const eligibleFacilities: string[] = [];
  let all = 0;
  for (const facilityKey of facilityKeys) {
    const result = evaluator(facilityKey);
    hits[facilityKey] = result.months;
    periodHits[facilityKey] = result.period;
    if (result.period.evaluable === false) continue;
    eligibleFacilities.push(facilityKey);
    if (!result.period.flag) continue;
    affectedFacilities.push(facilityKey);
    if (result.evaluableMonths > 0 && result.hitMonths === result.evaluableMonths) all += 1;
  }
  const total = affectedFacilities.length;
  return {
    id,
    name,
    description,
    group,
    total,
    any: total - all,
    all,
    eligible: eligibleFacilities.length,
    eligibleFacilities,
    affectedFacilities,
    basis: "period",
    hits,
    periodHits,
  };
}

function uniquePairs(pairs: PctsPair[]): PctsPair[] {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.from}->${pair.to}`;
    if (!pair.from || !pair.to || pair.from === pair.to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The reviewer's extra later-dose pairs: valid, unique and not a standard check. */
function customConsistencyPairs(filters: PctsFilters): PctsPair[] {
  const standard = new Set(DOSE_ORDER_CHECKS.map((check) => `${check.from}->${check.to}`));
  return uniquePairs(filters.additionalPairs).filter((pair) => !standard.has(`${pair.from}->${pair.to}`));
}

// ---- standard scoring profile ----

function standardPctsFilters(filters: PctsFilters): PctsFilters {
  return {
    ...filters,
    keyIndicators: [...DEFAULT_PCTS_FILTERS.keyIndicators],
    additionalIndicators: [],
    outlierExtraIndicators: [],
    outlierSeverity: DEFAULT_PCTS_FILTERS.outlierSeverity,
    dropoutThreshold: DEFAULT_PCTS_FILTERS.dropoutThreshold,
    additionalPairs: [],
    dropoutPairs: [],
  };
}

function methodSignature(filters: PctsFilters): string {
  const pairKeys = (pairs: PctsPair[] | undefined) =>
    uniquePairs(pairs ?? []).map((pair) => `${pair.from}->${pair.to}`).sort();
  const defaultDropouts = new Set(pairKeys(DEFAULT_DROPOUT_PAIRS));
  return JSON.stringify([
    [...new Set([...filters.keyIndicators, ...(filters.additionalIndicators ?? [])])].sort(),
    filters.outlierSeverity,
    [...new Set(filters.outlierExtraIndicators ?? [])].sort(),
    filters.dropoutThreshold,
    pairKeys(customConsistencyPairs(filters)),
    pairKeys(filters.dropoutPairs).filter((key) => !defaultDropouts.has(key)),
  ]);
}

// ---- scoring ----

function countIn(keys: string[], subset: Set<string>): number {
  let count = 0;
  for (const key of keys) if (subset.has(key)) count += 1;
  return count;
}

function scoringCards(cards: PctsCard[], subset?: Set<string>): ScoringCard[] {
  return cards.map((card) => {
    const flagged = subset ? countIn(card.affectedFacilities, subset) : card.total;
    return {
      id: card.id,
      name: card.name,
      group: card.group,
      flagged,
      eligible: subset ? countIn(card.eligibleFacilities, subset) : card.eligible,
      any: subset ? flagged : card.any,
      all: subset ? 0 : card.all,
    };
  });
}

function toComponentScores(result: OverallScoreResult): Record<PctsGroup, PctsComponentScore> {
  return Object.fromEntries(GROUPS.map((group) => [group, {
    group,
    score: result.components[group]?.score ?? null,
    worstIssuePct: result.components[group]?.maxTot ?? null,
  }])) as Record<PctsGroup, PctsComponentScore>;
}

// ---- main export ----

/** Doses given at the same visit (the co-administration checks), by indicator id. */
export const PCTS_COADMIN_GROUPS: readonly { id: string; name: string; ids: string[] }[] = [
  { id: "coadmin_6_weeks", name: "Co-administered Antigens — 6 weeks", ids: ["opv1", "penta1", "rota1", "pcv1", "fipv1"] },
  { id: "coadmin_10_weeks", name: "Co-administered Antigens — 10 weeks", ids: ["opv2", "penta2", "rota2"] },
  { id: "coadmin_14_weeks", name: "Co-administered Antigens — 14 weeks", ids: ["opv3", "penta3", "rota3", "pcv2", "fipv2"] },
  { id: "coadmin_9_months", name: "Co-administered Antigens — 9 months", ids: ["mr1", "pcvBooster", "fipv3"] },
  { id: "coadmin_16_24_months", name: "Co-administered Antigens — 16–24 months", ids: ["mr2", "dptFirstBooster"] },
];

export function computePctsKpis(data: PctsParsed, filters: PctsFilters): PctsComputed {
  const view = computeCards(data, filters);
  const standard = standardPctsFilters(filters);
  const customMethod = methodSignature(filters) !== methodSignature(standard);
  const scoreCards = customMethod ? computeCards(data, standard).cards : view.cards;

  const { cards, selectedFacilityKeys, selectedMonths } = view;
  const facility = (facilityKey: string): PctsFacilityRecord => data.facilities[facilityKey];
  const denominator = selectedMonths.length > 0 ? selectedFacilityKeys.length : 0;
  const scoring = { portal: "PCTS" as const, periodCount: selectedMonths.length };
  const result = scoreComponents(scoringCards(scoreCards), denominator, GROUPS, scoring);

  const issueNamesByFacility: Record<string, string[]> = Object.fromEntries(
    selectedFacilityKeys.map((facilityKey) => [facilityKey, []]),
  );
  for (const card of cards) {
    for (const facilityKey of card.affectedFacilities) issueNamesByFacility[facilityKey].push(card.name);
  }
  const issueCountByFacility = Object.fromEntries(
    selectedFacilityKeys.map((facilityKey) => [facilityKey, issueNamesByFacility[facilityKey].length]),
  );
  const affectedSet = new Set(cards.flatMap((card) => card.affectedFacilities));
  const visibleFacilityKeys = filters.issuesOnly
    ? selectedFacilityKeys.filter((facilityKey) => affectedSet.has(facilityKey))
    : selectedFacilityKeys;

  const selectedBlocks = [...new Set(selectedFacilityKeys.map((facilityKey) => facility(facilityKey).block))];
  const blockSummaries: Record<string, PctsBlockSummary> = {};
  for (const block of selectedBlocks) {
    const blockKeys = selectedFacilityKeys.filter((facilityKey) => facility(facilityKey).block === block);
    const blockKeySet = new Set(blockKeys);
    const blockResult = scoreComponents(
      scoringCards(scoreCards, blockKeySet),
      selectedMonths.length > 0 ? blockKeys.length : 0,
      GROUPS,
      scoring,
    );
    blockSummaries[block] = {
      block,
      denominator: blockKeys.length,
      affectedFacilities: blockKeys.filter((facilityKey) => affectedSet.has(facilityKey)).length,
      componentScores: toComponentScores(blockResult),
      overallScore: blockResult.overall,
    };
  }

  return {
    cards,
    scoreCards,
    selectedFacilityKeys,
    visibleFacilityKeys,
    selectedMonths,
    denominator,
    componentScores: toComponentScores(result),
    overallScore: result.overall,
    weighted: result.weighted,
    scoredComponents: result.scoredComponents,
    totalComponents: result.totalComponents,
    customMethod,
    issueCountByFacility,
    issueNamesByFacility,
    blockSummaries,
  };
}

function computeCards(data: PctsParsed, filters: PctsFilters) {
  const indicatorById = new Map(data.indicators.map((indicator) => [indicator.id, indicator]));
  const label = (id: string) => indicatorById.get(id)?.label
    ?? PCTS_INDICATORS.find((indicator) => indicator.id === id)?.label
    ?? id;
  const selectedFacilityKeys = Object.values(data.facilities)
    .filter((facility) => filters.blocks.length === 0 || filters.blocks.includes(facility.block))
    .filter((facility) => filters.ruralUrban.length === 0 || filters.ruralUrban.includes(facility.ruralUrban))
    .filter((facility) => filters.ownership.length === 0 || filters.ownership.includes(facility.ownership))
    .filter((facility) => filters.facilityTypes.length === 0 || filters.facilityTypes.includes(facility.facilityType))
    .filter((facility) => !filters.facilityKeys?.length || filters.facilityKeys.includes(facility.key))
    .map((facility) => facility.key)
    .sort((a, b) => {
      const left = data.facilities[a];
      const right = data.facilities[b];
      return left.block.localeCompare(right.block) || left.facility.localeCompare(right.facility);
    });
  const allMonths = Object.keys(data.months).sort();
  const selectedMonths = (filters.months.length > 0 ? filters.months : allMonths)
    .filter((month) => Object.prototype.hasOwnProperty.call(data.months, month))
    .sort();
  const selectedIndicators = [...new Set([
    ...filters.keyIndicators,
    ...(filters.additionalIndicators ?? []),
  ])].filter((id) => indicatorById.has(id));
  // The standard outlier check leaves out OPV1/OPV3; the reviewer may add them back.
  const outlierIndicators = [...new Set([
    ...selectedIndicators.filter(isStandardOutlierIndicator),
    ...(filters.outlierExtraIndicators ?? []).filter((id) => indicatorById.has(id)),
  ])];
  const cards: PctsCard[] = [];
  const facility = (facilityKey: string): PctsFacilityRecord => data.facilities[facilityKey];
  const record = (facilityKey: string, month: string) => facility(facilityKey)?.months[month];
  const value = (facilityKey: string, month: string, indicatorId: string): number | null => {
    const monthRecord = record(facilityKey, month);
    if (!monthRecord || !Object.prototype.hasOwnProperty.call(monthRecord.values, indicatorId)) return null;
    return monthRecord.values[indicatorId];
  };
  const valuesFor = (facilityKey: string, month: string, indicatorIds: string[]) => indicatorIds.map(
    (indicatorId) => value(facilityKey, month, indicatorId),
  );
  /** The previous selected month, only when it is the calendar month before. */
  const previousMonthOf = (month: string): string | null => {
    const index = selectedMonths.indexOf(month);
    if (index <= 0) return null;
    const previous = selectedMonths[index - 1];
    return periodsAreConsecutive(previous, month) ? previous : null;
  };
  const missingReport = (detail = "Facility report is missing"): PctsHit => ({ flag: false, evaluable: false, detail });
  /** Every key indicator reported and 0 — the zero report "Key Indicators All Zero" owns. */
  const keyIndicatorsZero = (facilityKey: string, month: string): boolean =>
    Boolean(record(facilityKey, month)) && selectedIndicators.length > 0
    && valuesFor(facilityKey, month, selectedIndicators).every((item) => item === 0);

  cards.push(makeCard(
    "key_indicators_zero",
    "Key Indicators All Zero",
    "All selected key indicators are reported as zero.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport();
      if (selectedIndicators.length === 0) return missingReport("No key indicator selected");
      const flag = keyIndicatorsZero(facilityKey, month);
      return {
        flag,
        detail: flag ? "All selected key indicators are zero" : "At least one selected indicator is non-zero or blank",
        indicators: flag ? selectedIndicators : undefined,
      };
    },
  ));

  cards.push(makeCard(
    "repeated_key_profile",
    "Repeated Key-Indicator Profile",
    "All selected key indicators exactly match the preceding calendar month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const previousMonth = previousMonthOf(month);
      if (!previousMonth) return null;
      const currentValues = valuesFor(facilityKey, month, selectedIndicators);
      const previousValues = valuesFor(facilityKey, previousMonth, selectedIndicators);
      const complete = selectedIndicators.length > 0
        && [...currentValues, ...previousValues].every((item) => item !== null);
      if (!complete) return missingReport(`Selected profile incomplete in ${data.months[month]} or ${data.months[previousMonth]}`);
      // Two all-zero months are not a repeat (that is "Key Indicators All Zero"):
      // a repeat needs at least one non-zero value, as in HMIS t7.
      const flag = currentValues.every((item, valueIndex) => item === previousValues[valueIndex])
        && currentValues.some((item) => item !== 0);
      return { flag, detail: flag ? `Selected profile exactly matches ${data.months[previousMonth]}` : `Selected profile differs from ${data.months[previousMonth]}` };
    },
  ));

  cards.push(makeCard(
    "key_indicators_missing",
    "Key Indicators Missing",
    "One or more selected key indicators are blank or absent.",
    "completeness",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport();
      if (selectedIndicators.length === 0) return missingReport("No key indicator selected");
      const missing = selectedIndicators.filter((id) =>
        !Object.prototype.hasOwnProperty.call(monthRecord.values, id) || monthRecord.values[id] === null);
      return {
        flag: missing.length > 0,
        detail: missing.length > 0 ? `Missing: ${missing.map(label).join(", ")}` : "All selected key indicators are present",
        indicators: missing,
      };
    },
  ));

  cards.push(makeCard(
    "month_outliers",
    "Month-on-Month Outliers",
    "Selected indicators cross the chosen increase/decrease threshold. When both months are under 10, a rise needs twice the % (Extreme: over 200%) and falls are not flagged.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const previousMonth = previousMonthOf(month);
      if (!previousMonth) return null;
      // A pair with an all-zero month is "Key Indicators All Zero"'s finding; the
      // fall to 0 / rise from 0 would flag it a second time.
      if (keyIndicatorsZero(facilityKey, previousMonth) || keyIndicatorsZero(facilityKey, month)) {
        return missingReport("Compared with an all-zero month (counted under Key Indicators All Zero)");
      }
      const outliers: { id: string; change: string }[] = [];
      let comparable = 0;
      for (const id of outlierIndicators) {
        const change = monthOnMonthChange(value(facilityKey, previousMonth, id), value(facilityKey, month, id));
        if (!change) continue;
        comparable += 1;
        if (passesChangeSeverity(change, filters.outlierSeverity)) outliers.push({ id, change: formatChange(change) });
      }
      if (comparable === 0) return missingReport(`No indicator comparable with ${data.months[previousMonth]}`);
      return {
        flag: outliers.length > 0,
        detail: outliers.length > 0
          ? outliers.map((item) => `${label(item.id)} ${item.change}`).join("; ")
          : `No outlier from ${data.months[previousMonth]}`,
        indicators: outliers.map((item) => item.id),
      };
    },
  ));

  // Dropouts — cumulative over the selected period, months where both doses
  // were reported. A single month's pair is not the same cohort of children,
  // so a single-month analysis has no dropout cards.
  const dropoutPairs = selectedMonths.length < 2
    ? []
    : uniquePairs([...DEFAULT_DROPOUT_PAIRS, ...(filters.dropoutPairs ?? [])]);
  for (const pair of dropoutPairs) {
    cards.push(makePeriodCard(
      `drop_${pair.from}_${pair.to}`,
      `${label(pair.from)} → ${label(pair.to)} Dropout`,
      `Cumulative dropout over the selected period is at least ${filters.dropoutThreshold}%.`,
      "accuracy",
      selectedFacilityKeys,
      (facilityKey) => {
        const months: Record<string, PctsHit> = {};
        const pairs: Array<[number | null, number | null]> = [];
        let evaluableMonths = 0;
        let hitMonths = 0;
        for (const month of selectedMonths) {
          const from = value(facilityKey, month, pair.from);
          const to = value(facilityKey, month, pair.to);
          pairs.push([from, to]);
          const monthly = dropoutPct(from, to);
          if (monthly === null) continue;
          evaluableMonths += 1;
          const monthFlag = monthly >= filters.dropoutThreshold;
          if (monthFlag) hitMonths += 1;
          months[month] = {
            flag: monthFlag,
            detail: `${monthly.toFixed(1)}% (${from} → ${to})`,
            values: { [pair.from]: from, [pair.to]: to },
          };
        }
        const totals = matchedTotals(pairs);
        const pct = dropoutPct(totals.a, totals.b);
        const flag = pct !== null && pct >= filters.dropoutThreshold;
        return {
          period: pct === null
            ? { flag: false, evaluable: false, detail: "Not evaluable: no month with both doses reported" }
            : {
                flag,
                detail: `${pct.toFixed(1)}% over ${totals.months} month${totals.months === 1 ? "" : "s"} (${totals.a} → ${totals.b})`,
                values: { [pair.from]: totals.a, [pair.to]: totals.b },
                indicators: flag ? [pair.from, pair.to] : undefined,
              },
          months,
          evaluableMonths,
          hitMonths,
        };
      },
    ));
  }

  // Later dose > earlier dose — judged on the selected period's totals over
  // months where both doses were reported. Monthly reversals are shown as context.
  const doseOrderCard = (id: string, name: string, description: string, links: Array<[string, string]>) =>
    makePeriodCard(id, name, description, "consistency", selectedFacilityKeys, (facilityKey) => {
      const months: Record<string, PctsHit> = {};
      let evaluableMonths = 0;
      let hitMonths = 0;
      for (const month of selectedMonths) {
        const reversals: string[] = [];
        let comparable = false;
        for (const [beforeId, afterId] of links) {
          const before = value(facilityKey, month, beforeId);
          const after = value(facilityKey, month, afterId);
          if (before === null || after === null) continue;
          comparable = true;
          if (laterDoseExceeds(before, after)) reversals.push(`${label(afterId)} ${after} > ${label(beforeId)} ${before} (${doseExcessLabel(before, after)})`);
        }
        if (!comparable) continue;
        evaluableMonths += 1;
        if (reversals.length > 0) hitMonths += 1;
        months[month] = {
          flag: reversals.length > 0,
          detail: reversals.length > 0 ? reversals.join("; ") : "Dose order consistent this month",
        };
      }
      const reversals: string[] = [];
      const affected = new Set<string>();
      let comparableLinks = 0;
      for (const [beforeId, afterId] of links) {
        const totals = matchedTotals(selectedMonths.map((month) => [
          value(facilityKey, month, beforeId),
          value(facilityKey, month, afterId),
        ] as [number | null, number | null]));
        if (totals.months === 0) continue;
        comparableLinks += 1;
        if (laterDoseExceeds(totals.a, totals.b)) {
          reversals.push(`${label(afterId)} ${totals.b} > ${label(beforeId)} ${totals.a} (${doseExcessLabel(totals.a, totals.b)})`);
          affected.add(beforeId);
          affected.add(afterId);
        }
      }
      return {
        period: comparableLinks === 0
          ? { flag: false, evaluable: false, detail: "Not evaluable: no month with both doses reported" }
          : {
              flag: reversals.length > 0,
              detail: reversals.length > 0 ? `Period totals: ${reversals.join("; ")}` : "Dose order consistent over the period",
              indicators: [...affected],
            },
        months,
        evaluableMonths,
        hitMonths,
      };
    });

  // Later dose > earlier dose: Penta3 > Penta1 and MR2 > MR1, as in every portal.
  for (const check of DOSE_ORDER_CHECKS) {
    cards.push(doseOrderCard(check.id, check.name, "Later dose exceeds the earlier dose by more than 25% (50% when both are under 10) over the selected period.", [[check.from, check.to]]));
  }

  customConsistencyPairs(filters).forEach((pair, index) => {
    cards.push(doseOrderCard(
      `custom_consistency_${index}_${pair.from}_${pair.to}`,
      `${label(pair.to)} > ${label(pair.from)}`,
      "User-defined later-dose pair, flagged when the later dose exceeds the earlier one by more than 25% (50% when both are under 10) over the selected period.",
      [[pair.from, pair.to]],
    ));
  });

  // Co-administered doses are given at the same visit, so their monthly counts
  // should be close: shared rule in lib/dqa/coadmin.ts (blanks are a
  // completeness finding).
  for (const spec of PCTS_COADMIN_GROUPS) {
    cards.push(makeCard(
      spec.id,
      spec.name,
      "A dose differs from the visit's reference count by more than 25% (50% when the reference is under 10).",
      "consistency",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const comparable = spec.ids
          .map((id) => [id, value(facilityKey, month, id)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] !== null);
        if (comparable.length < 2) return missingReport("Fewer than two comparable values");
        const valsById: Record<string, number | null> = Object.fromEntries(comparable);
        const outOfRange = [...coadminRedCells(valsById)];
        const flag = outOfRange.length > 0;
        return {
          flag,
          detail: coadminDetail(valsById, label),
          values: Object.fromEntries(comparable),
          indicators: flag ? outOfRange : undefined,
        };
      },
    ));
  }

  return { cards, selectedFacilityKeys, selectedMonths };
}

// ============================================================
// PCTS KPI engine — scoring method v2 (agreed 2026-09-22)
//
// Shared rules live in lib/dqa/checkRules.ts (outlier bands, volume floor,
// dropout thresholds, matched-month totals) and lib/dqa/scoring.ts (component
// and overall scores). PCTS specifics:
//   - Month-on-month checks compare calendar-adjacent months only.
//   - Dropouts and later-dose > earlier-dose checks are judged on the totals of
//     the selected period (months where both doses were reported).
//   - Co-administered doses must match exactly at facility level.
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
import { coadminHasDifference } from "../dqa/coadmin";
import {
  dropoutPct,
  formatChange,
  matchedTotals,
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

const SERVICE_INDICATORS = [
  "bcg",
  "dptFirstBooster",
  "penta1",
  "penta2",
  "penta3",
  "opv0",
  "opv1",
  "opv2",
  "opv3",
  "opvBooster",
  "rota1",
  "rota2",
  "rota3",
  "pcv1",
  "pcv2",
  "pcvBooster",
  "fipv1",
  "fipv2",
  "fipv3",
  "mr1",
  "mr2",
  "hepb0",
  "dpt5",
  "fullyImmunized",
];

const DEFAULT_DROPOUT_PAIRS: PctsPair[] = [
  { from: "penta1", to: "penta3" },
  { from: "opv1", to: "opv3" },
  { from: "rota1", to: "rota3" },
  { from: "fipv1", to: "fipv3" },
  { from: "pcv1", to: "pcv2" },
  { from: "mr1", to: "mr2" },
  { from: "bcg", to: "mr1" },
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

// ---- standard scoring profile ----

function standardPctsFilters(filters: PctsFilters): PctsFilters {
  return {
    ...filters,
    keyIndicators: [...DEFAULT_PCTS_FILTERS.keyIndicators],
    additionalIndicators: [],
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
    filters.dropoutThreshold,
    pairKeys(filters.additionalPairs),
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

export function computePctsKpis(data: PctsParsed, filters: PctsFilters): PctsComputed {
  const view = computeCards(data, filters);
  const standard = standardPctsFilters(filters);
  const customMethod = methodSignature(filters) !== methodSignature(standard);
  const scoreCards = customMethod ? computeCards(data, standard).cards : view.cards;

  const { cards, selectedFacilityKeys, selectedMonths } = view;
  const facility = (facilityKey: string): PctsFacilityRecord => data.facilities[facilityKey];
  const denominator = selectedMonths.length > 0 ? selectedFacilityKeys.length : 0;
  const result = scoreComponents(scoringCards(scoreCards), denominator, GROUPS);

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
    selectedFacilityKeys,
    visibleFacilityKeys,
    selectedMonths,
    denominator,
    componentScores: toComponentScores(result),
    overallScore: result.overall,
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

  cards.push(makeCard(
    "all_indicators_zero",
    "All Indicators Zero",
    "Every reported PCTS indicator is zero for the facility-month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport();
      const values = data.orderedIndicatorIds.map((id) => monthRecord.values[id]);
      const flag = values.length > 0 && values.every((item) => item !== null && item !== undefined && item === 0);
      return { flag, detail: flag ? "All indicators are zero" : "At least one indicator is non-zero or blank" };
    },
  ));

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
      const values = valuesFor(facilityKey, month, selectedIndicators);
      const flag = values.every((item) => item !== null && item === 0);
      return {
        flag,
        detail: flag ? "All selected key indicators are zero" : "At least one selected indicator is non-zero or blank",
        indicators: flag ? selectedIndicators : undefined,
      };
    },
  ));

  const activeServiceIndicators = SERVICE_INDICATORS.filter((id) => indicatorById.has(id));
  cards.push(makeCard(
    "no_active_service",
    "No Active Immunization Service",
    "All service-delivery immunization indicators are zero; structural zero-only items are excluded.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport();
      if (activeServiceIndicators.length === 0) return missingReport("No service indicator in this file");
      const values = valuesFor(facilityKey, month, activeServiceIndicators);
      const flag = values.every((item) => item !== null && item === 0);
      return { flag, detail: flag ? "No active immunization service reported" : "Service activity or a blank value is present" };
    },
  ));

  cards.push(makeCard(
    "repeated_full_profile",
    "Repeated Complete Profile",
    "The full indicator profile exactly matches the preceding calendar month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const previousMonth = previousMonthOf(month);
      if (!previousMonth) return null;
      const current = record(facilityKey, month);
      const previous = record(facilityKey, previousMonth);
      if (!current || !previous) return missingReport("One of the compared facility reports is missing");
      const complete = data.orderedIndicatorIds.every((id) =>
        current.values[id] !== null && current.values[id] !== undefined
        && previous.values[id] !== null && previous.values[id] !== undefined);
      if (!complete) return missingReport(`Profile incomplete in ${data.months[month]} or ${data.months[previousMonth]}`);
      const flag = data.orderedIndicatorIds.every((id) => current.values[id] === previous.values[id]);
      return { flag, detail: flag ? `Complete profile exactly matches ${data.months[previousMonth]}` : `Profile differs from ${data.months[previousMonth]}` };
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
      const flag = currentValues.every((item, valueIndex) => item === previousValues[valueIndex]);
      return { flag, detail: flag ? `Selected profile exactly matches ${data.months[previousMonth]}` : `Selected profile differs from ${data.months[previousMonth]}` };
    },
  ));

  cards.push(makeCard(
    "missing_facility_report",
    "Missing Facility-Month Report",
    "The facility appears in the uploaded roster but is absent from a selected month.",
    "completeness",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const flag = !record(facilityKey, month);
      return { flag, detail: flag ? "Facility is absent from this monthly workbook" : "Facility report present" };
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
      if (!monthRecord) return missingReport("Facility report is missing and counted separately");
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
    "partial_reporting",
    "Partial Indicator Reporting",
    "At least one indicator in the monthly schema is blank.",
    "completeness",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport("Facility report is missing and counted separately");
      const blank = data.orderedIndicatorIds.filter((id) =>
        !Object.prototype.hasOwnProperty.call(monthRecord.values, id) || monthRecord.values[id] === null);
      return {
        flag: blank.length > 0,
        detail: blank.length > 0 ? `${blank.length} indicator(s) blank or absent` : "All schema indicators are populated",
        indicators: blank,
      };
    },
  ));

  cards.push(makeCard(
    "invalid_counts",
    "Invalid Counts",
    "Negative, decimal, boolean, or malformed indicator counts.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return missingReport();
      const invalid = monthRecord.invalidIndicators ?? [];
      return {
        flag: invalid.length > 0,
        detail: invalid.length > 0 ? `Invalid: ${invalid.map(label).join(", ")}` : "All counts are non-negative integers or blank",
        indicators: invalid,
      };
    },
  ));

  cards.push(makeCard(
    "abrupt_zero",
    "Abrupt Zero",
    "A selected indicator falls from a positive value to zero in the next calendar month.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const previousMonth = previousMonthOf(month);
      if (!previousMonth) return null;
      const comparable = selectedIndicators.filter((id) =>
        value(facilityKey, previousMonth, id) !== null && value(facilityKey, month, id) !== null);
      if (comparable.length === 0) return missingReport(`No indicator reported in both ${data.months[previousMonth]} and ${data.months[month]}`);
      const affected = comparable.filter((id) =>
        (value(facilityKey, previousMonth, id) ?? 0) > 0 && value(facilityKey, month, id) === 0);
      return {
        flag: affected.length > 0,
        detail: affected.length > 0 ? `Dropped to zero: ${affected.map(label).join(", ")}` : `No abrupt zero from ${data.months[previousMonth]}`,
        indicators: affected,
      };
    },
  ));

  cards.push(makeCard(
    "month_outliers",
    "Month-on-Month Outliers",
    "Selected indicators cross the chosen increase/decrease threshold (months under 10 on both sides are not compared).",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const previousMonth = previousMonthOf(month);
      if (!previousMonth) return null;
      const outliers: { id: string; change: string }[] = [];
      let comparable = 0;
      for (const id of selectedIndicators) {
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

  cards.push(makeCard(
    "fully_immunized_exceeds_prerequisites",
    "Fully Immunized Exceeds Prerequisites",
    "Fully Immunized exceeds Penta 3, OPV 3, or MR 1.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const fully = value(facilityKey, month, "fullyImmunized");
      const prerequisites = ["penta3", "opv3", "mr1"];
      const present = prerequisites.filter((id) => value(facilityKey, month, id) !== null);
      if (fully === null || present.length === 0) return missingReport("Fully Immunized or its prerequisites not reported");
      const exceeded = present.filter((id) => fully > (value(facilityKey, month, id) as number));
      return {
        flag: exceeded.length > 0,
        detail: exceeded.length > 0
          ? `Fully Immunized ${fully} exceeds ${exceeded.map((id) => `${label(id)} ${value(facilityKey, month, id)}`).join(", ")}`
          : "Fully Immunized does not exceed the prerequisite indicators",
        values: {
          fullyImmunized: fully,
          penta3: value(facilityKey, month, "penta3"),
          opv3: value(facilityKey, month, "opv3"),
          mr1: value(facilityKey, month, "mr1"),
        },
        indicators: exceeded,
      };
    },
  ));

  // Dropouts — cumulative over the selected period, months where both doses
  // were reported. A single month's pair is not the same cohort of children.
  const dropoutPairs = uniquePairs([...DEFAULT_DROPOUT_PAIRS, ...(filters.dropoutPairs ?? [])]);
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
          if (after > before) reversals.push(`${label(afterId)} ${after} > ${label(beforeId)} ${before}`);
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
        if (totals.b > totals.a) {
          reversals.push(`${label(afterId)} ${totals.b} > ${label(beforeId)} ${totals.a}`);
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

  const sequenceSpecs: { id: string; name: string; doses: string[] }[] = [
    { id: "penta_sequence", name: "Penta Dose Sequence", doses: ["penta1", "penta2", "penta3"] },
    { id: "opv_sequence", name: "OPV Dose Sequence", doses: ["opv1", "opv2", "opv3"] },
    { id: "rota_sequence", name: "ROTA Dose Sequence", doses: ["rota1", "rota2", "rota3"] },
    { id: "fipv_sequence", name: "FIPV Dose Sequence", doses: ["fipv1", "fipv2", "fipv3"] },
    { id: "pcv_sequence", name: "PCV Dose Sequence", doses: ["pcv1", "pcv2"] },
    { id: "mr_sequence", name: "MR Dose Sequence", doses: ["mr1", "mr2"] },
  ];
  for (const spec of sequenceSpecs) {
    const links: Array<[string, string]> = spec.doses.slice(1).map((dose, index) => [spec.doses[index], dose]);
    cards.push(doseOrderCard(spec.id, spec.name, "A later dose exceeds the preceding dose over the selected period.", links));
  }

  uniquePairs(filters.additionalPairs).forEach((pair, index) => {
    cards.push(doseOrderCard(
      `custom_consistency_${index}_${pair.from}_${pair.to}`,
      `${label(pair.to)} > ${label(pair.from)}`,
      "User-defined later-dose comparison over the selected period.",
      [[pair.from, pair.to]],
    ));
  });

  // Co-administered doses are given at the same visit, so at facility level
  // their monthly counts must match exactly (blanks are a completeness finding).
  const coadminGroups: { id: string; name: string; ids: string[] }[] = [
    { id: "coadmin_6_weeks", name: "Co-administered Antigens — 6 weeks", ids: ["opv1", "penta1", "rota1", "pcv1", "fipv1"] },
    { id: "coadmin_10_weeks", name: "Co-administered Antigens — 10 weeks", ids: ["opv2", "penta2", "rota2"] },
    { id: "coadmin_14_weeks", name: "Co-administered Antigens — 14 weeks", ids: ["opv3", "penta3", "rota3", "pcv2", "fipv2"] },
    { id: "coadmin_9_months", name: "Co-administered Antigens — 9 months", ids: ["mr1", "pcvBooster", "fipv3"] },
    { id: "coadmin_16_24_months", name: "Co-administered Antigens — 16–24 months", ids: ["mr2", "dptFirstBooster"] },
  ];
  for (const spec of coadminGroups) {
    cards.push(makeCard(
      spec.id,
      spec.name,
      "Doses given at the same visit are reported with different counts.",
      "consistency",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const comparable = spec.ids
          .map((id) => [id, value(facilityKey, month, id)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] !== null);
        if (comparable.length < 2) return missingReport("Fewer than two comparable values");
        const flag = coadminHasDifference(comparable.map((entry) => entry[1]));
        return {
          flag,
          detail: flag
            ? `Counts differ: ${comparable.map(([id, count]) => `${label(id)} ${count}`).join(", ")}`
            : "All reported counts match",
          values: Object.fromEntries(comparable),
          indicators: flag ? comparable.map((entry) => entry[0]) : undefined,
        };
      },
    ));
  }

  return { cards, selectedFacilityKeys, selectedMonths };
}

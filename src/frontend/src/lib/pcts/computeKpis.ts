import {
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

type Evaluator = (facilityKey: string, month: string) => PctsHit | null;

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
  let all = 0;
  for (const facilityKey of facilityKeys) {
    hits[facilityKey] = {};
    const evaluated: PctsHit[] = [];
    for (const month of months) {
      const hit = evaluator(facilityKey, month);
      if (hit === null) continue;
      hits[facilityKey][month] = hit;
      evaluated.push(hit);
    }
    if (evaluated.some((hit) => hit.flag)) affectedFacilities.push(facilityKey);
    if (evaluated.length > 0 && evaluated.every((hit) => hit.flag)) all += 1;
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
    affectedFacilities,
    hits,
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

function pctChange(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function passesOutlier(change: number, severity: PctsFilters["outlierSeverity"]): boolean {
  if (severity === "low") return change >= 25 || change <= -25;
  if (severity === "moderate") return change > 50 || change < -50;
  return change > 100 || change <= -75;
}

function scoreComponents(
  cards: PctsCard[],
  denominator: number,
  facilityKeys?: Set<string>,
): Record<PctsGroup, PctsComponentScore> {
  return Object.fromEntries(GROUPS.map((group) => {
    const groupCards = cards.filter((card) => card.group === group);
    const counts = groupCards.map((card) => facilityKeys
      ? card.affectedFacilities.filter((key) => facilityKeys.has(key)).length
      : card.total);
    const worstIssuePct = denominator > 0
      ? Math.max(0, ...counts.map((count) => (count / denominator) * 100))
      : 100;
    return [group, {
      group,
      worstIssuePct,
      score: denominator > 0 ? Math.max(0, 100 - worstIssuePct) : 0,
    }];
  })) as Record<PctsGroup, PctsComponentScore>;
}

function averageComponentScore(scores: Record<PctsGroup, PctsComponentScore>): number {
  return GROUPS.reduce((sum, group) => sum + scores[group].score, 0) / GROUPS.length;
}

export function computePctsKpis(data: PctsParsed, filters: PctsFilters): PctsComputed {
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

  cards.push(makeCard(
    "all_indicators_zero",
    "All Indicators Zero",
    "Every reported PCTS indicator is zero for the facility-month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const monthRecord = record(facilityKey, month);
      if (!monthRecord) return { flag: false, detail: "Facility report is missing" };
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
      if (!monthRecord) return { flag: false, detail: "Facility report is missing" };
      const values = valuesFor(facilityKey, month, selectedIndicators);
      const flag = values.length > 0 && values.every((item) => item !== null && item === 0);
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
      if (!monthRecord) return { flag: false, detail: "Facility report is missing" };
      const values = valuesFor(facilityKey, month, activeServiceIndicators);
      const flag = values.length > 0 && values.every((item) => item !== null && item === 0);
      return { flag, detail: flag ? "No active immunization service reported" : "Service activity or a blank value is present" };
    },
  ));

  cards.push(makeCard(
    "repeated_full_profile",
    "Repeated Complete Profile",
    "The full indicator profile exactly matches the preceding selected month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const index = selectedMonths.indexOf(month);
      if (index <= 0) return null;
      const previousMonth = selectedMonths[index - 1];
      const current = record(facilityKey, month);
      const previous = record(facilityKey, previousMonth);
      if (!current || !previous) return { flag: false, detail: "One of the compared facility reports is missing" };
      const complete = data.orderedIndicatorIds.every((id) =>
        current.values[id] !== null && current.values[id] !== undefined
        && previous.values[id] !== null && previous.values[id] !== undefined);
      const flag = complete && data.orderedIndicatorIds.every((id) => current.values[id] === previous.values[id]);
      return { flag, detail: flag ? `Complete profile exactly matches ${data.months[previousMonth]}` : `Profile differs from ${data.months[previousMonth]} or is incomplete` };
    },
  ));

  cards.push(makeCard(
    "repeated_key_profile",
    "Repeated Key-Indicator Profile",
    "All selected key indicators exactly match the preceding selected month.",
    "availability",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const index = selectedMonths.indexOf(month);
      if (index <= 0) return null;
      const previousMonth = selectedMonths[index - 1];
      const currentValues = valuesFor(facilityKey, month, selectedIndicators);
      const previousValues = valuesFor(facilityKey, previousMonth, selectedIndicators);
      const complete = selectedIndicators.length > 0
        && [...currentValues, ...previousValues].every((item) => item !== null);
      const flag = complete && currentValues.every((item, valueIndex) => item === previousValues[valueIndex]);
      return { flag, detail: flag ? `Selected profile exactly matches ${data.months[previousMonth]}` : `Selected profile differs from ${data.months[previousMonth]} or is incomplete` };
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
      if (!monthRecord) return { flag: false, detail: "Facility report is missing and counted separately" };
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
      if (!monthRecord) return { flag: false, detail: "Facility report is missing and counted separately" };
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
      const invalid = record(facilityKey, month)?.invalidIndicators ?? [];
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
    "A selected indicator falls from a positive value to zero.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const index = selectedMonths.indexOf(month);
      if (index <= 0) return null;
      const previousMonth = selectedMonths[index - 1];
      const affected = selectedIndicators.filter((id) =>
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
    "Selected indicators cross the chosen increase/decrease threshold.",
    "accuracy",
    selectedFacilityKeys,
    selectedMonths,
    (facilityKey, month) => {
      const index = selectedMonths.indexOf(month);
      if (index <= 0) return null;
      const previousMonth = selectedMonths[index - 1];
      const outliers: { id: string; change: number }[] = [];
      for (const id of selectedIndicators) {
        const change = pctChange(value(facilityKey, previousMonth, id), value(facilityKey, month, id));
        if (change !== null && passesOutlier(change, filters.outlierSeverity)) outliers.push({ id, change });
      }
      return {
        flag: outliers.length > 0,
        detail: outliers.length > 0
          ? outliers.map((item) => `${label(item.id)} ${item.change.toFixed(1)}%`).join("; ")
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
      const exceeded = prerequisites.filter((id) => {
        const prerequisite = value(facilityKey, month, id);
        return fully !== null && prerequisite !== null && fully > prerequisite;
      });
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

  const dropoutPairs = uniquePairs([...DEFAULT_DROPOUT_PAIRS, ...(filters.dropoutPairs ?? [])]);
  for (const pair of dropoutPairs) {
    cards.push(makeCard(
      `drop_${pair.from}_${pair.to}`,
      `${label(pair.from)} → ${label(pair.to)} Dropout`,
      `Dropout is at least ${filters.dropoutThreshold}%.`,
      "accuracy",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const from = value(facilityKey, month, pair.from);
        const to = value(facilityKey, month, pair.to);
        const dropout = from !== null && to !== null && from > 0 && to < from
          ? ((from - to) / from) * 100
          : null;
        const flag = dropout !== null && dropout >= filters.dropoutThreshold;
        return {
          flag,
          detail: dropout === null ? "Not evaluable or no dropout" : `${dropout.toFixed(1)}% dropout`,
          values: { [pair.from]: from, [pair.to]: to },
          indicators: flag ? [pair.from, pair.to] : undefined,
        };
      },
    ));
  }

  const sequenceSpecs: { id: string; name: string; doses: string[] }[] = [
    { id: "penta_sequence", name: "Penta Dose Sequence", doses: ["penta1", "penta2", "penta3"] },
    { id: "opv_sequence", name: "OPV Dose Sequence", doses: ["opv1", "opv2", "opv3"] },
    { id: "rota_sequence", name: "ROTA Dose Sequence", doses: ["rota1", "rota2", "rota3"] },
    { id: "fipv_sequence", name: "FIPV Dose Sequence", doses: ["fipv1", "fipv2", "fipv3"] },
    { id: "pcv_sequence", name: "PCV Dose Sequence", doses: ["pcv1", "pcv2"] },
    { id: "mr_sequence", name: "MR Dose Sequence", doses: ["mr1", "mr2"] },
  ];
  for (const spec of sequenceSpecs) {
    cards.push(makeCard(
      spec.id,
      spec.name,
      "A later dose exceeds the preceding dose.",
      "consistency",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const reversals: string[] = [];
        const affected = new Set<string>();
        for (let index = 1; index < spec.doses.length; index += 1) {
          const beforeId = spec.doses[index - 1];
          const afterId = spec.doses[index];
          const before = value(facilityKey, month, beforeId);
          const after = value(facilityKey, month, afterId);
          if (before !== null && after !== null && after > before) {
            reversals.push(`${label(afterId)} ${after} > ${label(beforeId)} ${before}`);
            affected.add(beforeId); affected.add(afterId);
          }
        }
        return {
          flag: reversals.length > 0,
          detail: reversals.length > 0 ? reversals.join("; ") : "Dose sequence is consistent",
          indicators: [...affected],
        };
      },
    ));
  }

  uniquePairs(filters.additionalPairs).forEach((pair, index) => {
    cards.push(makeCard(
      `custom_consistency_${index}_${pair.from}_${pair.to}`,
      `${label(pair.to)} > ${label(pair.from)}`,
      "User-defined later-dose comparison.",
      "consistency",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const from = value(facilityKey, month, pair.from);
        const to = value(facilityKey, month, pair.to);
        const flag = from !== null && to !== null && to > from;
        return {
          flag,
          detail: `${label(pair.from)} ${from ?? "blank"}; ${label(pair.to)} ${to ?? "blank"}`,
          values: { [pair.from]: from, [pair.to]: to },
          indicators: flag ? [pair.from, pair.to] : undefined,
        };
      },
    ));
  });

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
      `Relative spread exceeds ${filters.coadminTolerance}%.`,
      "consistency",
      selectedFacilityKeys,
      selectedMonths,
      (facilityKey, month) => {
        const comparable = spec.ids
          .map((id) => [id, value(facilityKey, month, id)] as const)
          .filter((entry): entry is readonly [string, number] => entry[1] !== null);
        if (comparable.length < 2) return { flag: false, detail: "Fewer than two comparable values" };
        const numericValues = comparable.map((entry) => entry[1]);
        const maximum = Math.max(...numericValues);
        const minimum = Math.min(...numericValues);
        const spread = maximum > 0 ? ((maximum - minimum) / maximum) * 100 : 0;
        const flag = spread > filters.coadminTolerance;
        return {
          flag,
          detail: `${spread.toFixed(1)}% relative spread`,
          values: Object.fromEntries(comparable),
          indicators: flag ? comparable.map((entry) => entry[0]) : undefined,
        };
      },
    ));
  }

  const denominator = selectedFacilityKeys.length;
  const componentScores = scoreComponents(cards, denominator);
  const overallScore = averageComponentScore(componentScores);
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
    const blockScores = scoreComponents(cards, blockKeys.length, blockKeySet);
    blockSummaries[block] = {
      block,
      denominator: blockKeys.length,
      affectedFacilities: blockKeys.filter((facilityKey) => affectedSet.has(facilityKey)).length,
      componentScores: blockScores,
      overallScore: averageComponentScore(blockScores),
    };
  }

  return {
    cards,
    selectedFacilityKeys,
    visibleFacilityKeys,
    selectedMonths,
    denominator,
    componentScores,
    overallScore,
    issueCountByFacility,
    issueNamesByFacility,
    blockSummaries,
  };
}

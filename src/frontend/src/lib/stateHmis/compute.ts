// ============================================================
// HMIS-State KPI engine — scoring method v2 (agreed 2026-09-22)
//
// Shared rules: lib/dqa/checkRules.ts (outlier bands, volume floor, dropout
// thresholds, matched-month totals) and lib/dqa/scoring.ts (scores).
// State specifics: the units are districts (or blocks), so co-administered
// doses keep a % tolerance — district totals aggregate many facilities.
// ============================================================

import {
  DEFAULT_STATE_HMIS_FILTERS,
  type StateHmisCard,
  type StateHmisComputed,
  type StateHmisFilters,
  type StateHmisGroup,
  type StateHmisHit,
  type StateHmisParsed,
} from "./types";
import { scoreComponents, type OverallScoreResult, type ScoringCard } from "../dqa/scoring";
import {
  dropoutPct,
  formatChange,
  matchedTotals,
  monthOnMonthChange,
  passesChangeSeverity,
} from "../dqa/checkRules";
import { periodsAreConsecutive } from "../dqa/parseUtils";

type Evaluator = (district: string, month: string) => StateHmisHit | null;

interface PeriodResult {
  period: StateHmisHit;
  months: Record<string, StateHmisHit>;
  evaluableMonths: number;
  hitMonths: number;
}

const GROUPS: StateHmisGroup[] = ["availability", "completeness", "accuracy", "consistency"];

function valueByShort(data: StateHmisParsed, district: string, month: string, short: string) {
  const code = data.orderedItemCodes.find((itemCode) => data.items[itemCode]?.short === short);
  return code ? data.unitData[district]?.months[month]?.values[code] ?? null : null;
}

function codeByShort(data: StateHmisParsed, short: string): string | null {
  return data.orderedItemCodes.find((code) => data.items[code]?.short === short) ?? null;
}

function notEvaluable(detail: string): StateHmisHit {
  return { flag: false, evaluable: false, detail };
}

/** A month-by-month check: flagged when any checkable month is flagged. */
function makeCard(
  id: string,
  name: string,
  description: string,
  group: StateHmisGroup,
  districts: string[],
  months: string[],
  evaluator: Evaluator,
): StateHmisCard {
  const hits: StateHmisCard["hits"] = {};
  const affectedDistricts: string[] = [];
  const eligibleUnits: string[] = [];
  let all = 0;
  for (const district of districts) {
    hits[district] = {};
    const evaluated: StateHmisHit[] = [];
    for (const month of months) {
      const hit = evaluator(district, month);
      if (hit === null) continue;
      hits[district][month] = hit;
      if (hit.evaluable !== false) evaluated.push(hit);
    }
    if (evaluated.length === 0) continue;
    eligibleUnits.push(district);
    if (evaluated.some((hit) => hit.flag)) affectedDistricts.push(district);
    if (evaluated.every((hit) => hit.flag)) all += 1;
  }
  const total = affectedDistricts.length;
  return {
    id, name, description, group, total, any: total - all, all,
    eligible: eligibleUnits.length,
    eligibleUnits,
    affectedDistricts,
    affectedUnits: affectedDistricts,
    basis: "month",
    hits,
  };
}

/** A check judged on the selected period's totals; monthly detail is context. */
function makePeriodCard(
  id: string,
  name: string,
  description: string,
  group: StateHmisGroup,
  districts: string[],
  evaluator: (district: string) => PeriodResult,
): StateHmisCard {
  const hits: StateHmisCard["hits"] = {};
  const periodHits: Record<string, StateHmisHit> = {};
  const affectedDistricts: string[] = [];
  const eligibleUnits: string[] = [];
  let all = 0;
  for (const district of districts) {
    const result = evaluator(district);
    hits[district] = result.months;
    periodHits[district] = result.period;
    if (result.period.evaluable === false) continue;
    eligibleUnits.push(district);
    if (!result.period.flag) continue;
    affectedDistricts.push(district);
    if (result.evaluableMonths > 0 && result.hitMonths === result.evaluableMonths) all += 1;
  }
  const total = affectedDistricts.length;
  return {
    id, name, description, group, total, any: total - all, all,
    eligible: eligibleUnits.length,
    eligibleUnits,
    affectedDistricts,
    affectedUnits: affectedDistricts,
    basis: "period",
    hits,
    periodHits,
  };
}

// ---- standard scoring profile ----

function standardStateFilters(filters: StateHmisFilters): StateHmisFilters {
  return {
    ...filters,
    keyIndicators: [...DEFAULT_STATE_HMIS_FILTERS.keyIndicators],
    outlierSeverity: DEFAULT_STATE_HMIS_FILTERS.outlierSeverity,
    dropoutThreshold: DEFAULT_STATE_HMIS_FILTERS.dropoutThreshold,
    coadminTolerance: DEFAULT_STATE_HMIS_FILTERS.coadminTolerance,
    additionalPairs: [],
  };
}

function methodSignature(filters: StateHmisFilters): string {
  return JSON.stringify([
    [...new Set(filters.keyIndicators)].sort(),
    filters.outlierSeverity,
    filters.dropoutThreshold,
    filters.coadminTolerance,
    filters.additionalPairs
      .filter((pair) => pair.from && pair.to && pair.from !== pair.to)
      .map((pair) => `${pair.from}->${pair.to}`)
      .sort(),
  ]);
}

function scoringCards(cards: StateHmisCard[]): ScoringCard[] {
  return cards.map((card) => ({
    id: card.id,
    name: card.name,
    group: card.group,
    flagged: card.total,
    eligible: card.eligible,
    any: card.any,
    all: card.all,
  }));
}

function toComponentScores(result: OverallScoreResult): StateHmisComputed["componentScores"] {
  return Object.fromEntries(GROUPS.map((group) => [group, {
    group,
    score: result.components[group]?.score ?? null,
    worstIssuePct: result.components[group]?.maxTot ?? null,
  }])) as StateHmisComputed["componentScores"];
}

// ---- main export ----

export function computeStateHmisKpis(
  data: StateHmisParsed,
  filters: StateHmisFilters,
): StateHmisComputed {
  const view = computeCards(data, filters);
  const standard = standardStateFilters(filters);
  const customMethod = methodSignature(filters) !== methodSignature(standard);
  const scoreCards = customMethod ? computeCards(data, standard).cards : view.cards;

  const { cards, selectedDistricts, selectedMonths, filteredDistricts } = view;
  const denominator = selectedMonths.length > 0 ? selectedDistricts.length : 0;
  const result = scoreComponents(scoringCards(scoreCards), denominator, GROUPS);

  const issueNamesByDistrict: Record<string, string[]> = Object.fromEntries(selectedDistricts.map((district) => [district, []]));
  for (const card of cards) for (const district of card.affectedDistricts) issueNamesByDistrict[district].push(card.name);
  const issueCountByDistrict = Object.fromEntries(selectedDistricts.map((district) => [district, issueNamesByDistrict[district].length]));
  const districtRollups = Object.fromEntries(filteredDistricts.map((district) => {
    const units = selectedDistricts.filter((id) => data.unitData[id]?.district === district);
    const issueNames = [...new Set(units.flatMap((id) => issueNamesByDistrict[id] ?? []))];
    return [district, {
      unitCount: units.length,
      affectedUnitCount: units.filter((id) => (issueCountByDistrict[id] ?? 0) > 0).length,
      issueCount: units.reduce((sum, id) => sum + (issueCountByDistrict[id] ?? 0), 0),
      issueNames,
    }];
  }));
  return {
    cards,
    selectedUnits: selectedDistricts,
    selectedDistricts,
    selectedMonths,
    denominator,
    componentScores: toComponentScores(result),
    overallScore: result.overall,
    scoredComponents: result.scoredComponents,
    totalComponents: result.totalComponents,
    customMethod,
    issueCountByUnit: issueCountByDistrict,
    issueNamesByUnit: issueNamesByDistrict,
    issueCountByDistrict,
    issueNamesByDistrict,
    districtRollups,
  };
}

function computeCards(data: StateHmisParsed, filters: StateHmisFilters) {
  const filteredDistricts = (filters.districts.length ? filters.districts : data.districts)
    .filter((district) => data.districts.includes(district));
  const eligibleUnits = data.reportLevel === "block"
    ? filteredDistricts.flatMap((district) => data.blocksByDistrict[district] ?? [])
    : filteredDistricts;
  const selectedDistricts = (data.reportLevel === "block" && filters.blocks.length
    ? filters.blocks
    : eligibleUnits).filter((id) => eligibleUnits.includes(id) && data.unitData[id]);
  const allMonths = Object.keys(data.months).sort();
  const selectedMonths = (filters.months.length ? filters.months : allMonths)
    .filter((month) => data.months[month])
    .sort();
  const m9Codes = data.orderedItemCodes.filter((code) => /^M9\b/i.test(data.items[code]?.category ?? ""));
  const keyShorts = filters.keyIndicators.filter((short) => codeByShort(data, short));
  const keyCodes = keyShorts.map((short) => codeByShort(data, short)!).filter(Boolean);
  const cards: StateHmisCard[] = [];
  const record = (district: string, month: string) => data.unitData[district]?.months[month];
  const value = (district: string, month: string, short: string) => valueByShort(data, district, month, short);
  const unitLabel = data.reportLevel === "block" ? "Block" : "District";
  /** The previous selected month, only when it is the calendar month before. */
  const previousMonthOf = (month: string): string | null => {
    const index = selectedMonths.indexOf(month);
    if (index <= 0) return null;
    const previous = selectedMonths[index - 1];
    return periodsAreConsecutive(previous, month) ? previous : null;
  };

  cards.push(makeCard("all_m9_blank", "All M9 Indicators Blank", "Every M9 data item is blank.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m);
    if (!rec) return notEvaluable(`${unitLabel} report is missing`);
    if (m9Codes.length === 0) return notEvaluable("No M9 items in this file");
    const flag = m9Codes.every((code) => rec.values[code] === null);
    return { flag, detail: flag ? "All M9 values are blank" : "M9 data reported" };
  }));

  cards.push(makeCard("key_all_zero", "Key Indicators All Zero", "All selected key indicators are reported as zero.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m);
    if (!rec) return notEvaluable(`${unitLabel} report is missing`);
    if (keyCodes.length === 0) return notEvaluable("No key indicator in this file");
    const vals = keyCodes.map((code) => rec.values[code]);
    const flag = vals.every((v) => v !== null && v === 0);
    return { flag, detail: flag ? "All selected key indicators are zero" : "Not all zero" };
  }));

  cards.push(makeCard("repeated_profile", "Repeated Monthly Profile", "The M9 profile exactly matches the preceding calendar month.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const previousMonth = previousMonthOf(m);
    if (!previousMonth) return null;
    const current = record(d, m); const previous = record(d, previousMonth);
    if (!current || !previous) return notEvaluable(`One of the compared ${unitLabel.toLowerCase()} reports is missing`);
    const inBoth = m9Codes.filter((code) => current.values[code] !== undefined && previous.values[code] !== undefined);
    // Two blank profiles are not a repeat (that is "All M9 Indicators Blank"): a
    // repeat needs reported values, and blanks must line up with blanks.
    const reported = inBoth.filter((code) => current.values[code] !== null || previous.values[code] !== null);
    if (reported.length === 0) return notEvaluable(`No M9 values reported in ${m} or ${previousMonth}`);
    const flag = reported.every((code) => current.values[code] === previous.values[code]);
    return { flag, detail: flag ? `Profile exactly matches ${previousMonth}` : `Profile differs from ${previousMonth}` };
  }));

  cards.push(makeCard("zero_sessions_vax", "Zero Sessions with Vaccination Data", "Sessions held is zero while one or more key vaccinations are reported.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    if (!record(d, m)) return notEvaluable(`${unitLabel} report is missing`);
    const held = value(d, m, "Sessions Held");
    if (held === null) return notEvaluable("Sessions held not reported");
    const positive = keyShorts.filter((short) => (value(d, m, short) ?? 0) > 0);
    const flag = held === 0 && positive.length > 0;
    return { flag, detail: flag ? `Zero sessions; positive: ${positive.join(", ")}` : "No contradiction" };
  }));

  cards.push(makeCard("missing_unit", `Missing ${unitLabel} Report`, `The ${unitLabel.toLowerCase()} is absent from a monthly workbook.`, "completeness", selectedDistricts, selectedMonths, (d, m) => {
    const flag = !record(d, m); return { flag, detail: flag ? `${unitLabel} is absent from this file` : `${unitLabel} report present` };
  }));
  cards.push(makeCard("key_missing", "Key Missing Indicators", "One or more selected key indicators are blank or absent.", "completeness", selectedDistricts, selectedMonths, (d, m) => {
    if (keyShorts.length === 0) return notEvaluable("No key indicator selected");
    const rec = record(d, m);
    const missing = rec ? keyShorts.filter((short) => { const code = codeByShort(data, short); return !code || rec.values[code] === null || rec.values[code] === undefined; }) : keyShorts;
    return { flag: missing.length > 0, detail: missing.length ? `Missing: ${missing.join(", ")}` : "All selected key indicators present" };
  }));
  cards.push(makeCard("partial_m9", "Partial M9 Reporting", "At least one M9 value is blank.", "completeness", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m); if (!rec) return { flag: true, detail: `${unitLabel} report is missing` };
    const blank = m9Codes.filter((code) => rec.values[code] === null);
    return { flag: blank.length > 0, detail: blank.length ? `${blank.length} blank M9 item(s)` : "All M9 values populated" };
  }));
  cards.push(makeCard("missing_items", "Missing Data Items", "Expected M9 codes are absent from the monthly schema.", "completeness", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m); if (!rec) return { flag: true, detail: `${unitLabel} report is missing` };
    const missing = m9Codes.filter((code) => rec.values[code] === undefined);
    return { flag: missing.length > 0, detail: missing.length ? `${missing.length} M9 item(s) absent from schema` : "M9 schema complete" };
  }));

  cards.push(makeCard("held_gt_planned", "Sessions Held > Sessions Planned", "Held exceeds planned (including sessions held with none planned).", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const planned = value(d, m, "Sessions Planned"); const held = value(d, m, "Sessions Held");
    if (planned === null || held === null) return notEvaluable(`Planned ${planned ?? "blank"}; held ${held ?? "blank"}`);
    const flag = held > planned;
    return { flag, detail: `Planned ${planned}; held ${held}`, values: { Planned: planned, Held: held } };
  }));
  cards.push(makeCard("outliers", "Month-on-Month Outliers", "Selected indicators cross the chosen increase/decrease threshold (months under 10 on both sides are not compared).", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const previousMonth = previousMonthOf(m);
    if (!previousMonth) return null;
    const outliers: string[] = [];
    let comparable = 0;
    for (const short of keyShorts) {
      const change = monthOnMonthChange(value(d, previousMonth, short), value(d, m, short));
      if (!change) continue;
      comparable += 1;
      if (passesChangeSeverity(change, filters.outlierSeverity)) outliers.push(`${short} ${formatChange(change)}`);
    }
    if (comparable === 0) return notEvaluable(`No indicator comparable with ${previousMonth}`);
    return { flag: outliers.length > 0, detail: outliers.length ? outliers.join("; ") : `No outlier from ${previousMonth}` };
  }));
  cards.push(makeCard("abrupt_zero", "Abrupt Zero", "A selected key indicator falls from a positive value to zero in the next calendar month.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const previousMonth = previousMonthOf(m);
    if (!previousMonth) return null;
    const comparable = keyShorts.filter((short) => value(d, previousMonth, short) !== null && value(d, m, short) !== null);
    if (comparable.length === 0) return notEvaluable(`No indicator reported in both ${previousMonth} and ${m}`);
    const affected = comparable.filter((short) => (value(d, previousMonth, short) ?? 0) > 0 && value(d, m, short) === 0);
    return { flag: affected.length > 0, detail: affected.length ? `Dropped to zero: ${affected.join(", ")}` : "No abrupt zero" };
  }));
  cards.push(makeCard("invalid_counts", "Invalid Counts", "Negative, decimal, or malformed count values.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m);
    if (!rec) return notEvaluable(`${unitLabel} report is missing`);
    const invalid = rec.invalidCodes ?? [];
    return { flag: invalid.length > 0, detail: invalid.length ? `Invalid item codes: ${invalid.join(", ")}` : "Counts are non-negative integers" };
  }));

  // Dropouts — cumulative over the selected period (months where both doses
  // were reported); a single month's pair is not the same cohort of children.
  const dropoutPairs: [string, string][] = [["Penta1", "Penta3"], ["MR1", "MR2"], ["BCG", "MR1"], ["Penta3", "MR1"]];
  for (const [from, to] of dropoutPairs) {
    cards.push(makePeriodCard(`drop_${from}_${to}`, `${from} → ${to} Dropout`, `Cumulative dropout over the selected period is at least ${filters.dropoutThreshold}%.`, "accuracy", selectedDistricts, (d) => {
      const months: Record<string, StateHmisHit> = {};
      const pairs: Array<[number | null, number | null]> = [];
      let evaluableMonths = 0;
      let hitMonths = 0;
      for (const m of selectedMonths) {
        const a = value(d, m, from); const b = value(d, m, to);
        pairs.push([a, b]);
        const monthly = dropoutPct(a, b);
        if (monthly === null) continue;
        evaluableMonths += 1;
        const monthFlag = monthly >= filters.dropoutThreshold;
        if (monthFlag) hitMonths += 1;
        months[m] = { flag: monthFlag, detail: `${monthly.toFixed(1)}% (${a} → ${b})`, values: { [from]: a, [to]: b } };
      }
      const totals = matchedTotals(pairs);
      const pct = dropoutPct(totals.a, totals.b);
      return {
        period: pct === null
          ? notEvaluable("Not evaluable: no month with both doses reported")
          : {
              flag: pct >= filters.dropoutThreshold,
              detail: `${pct.toFixed(1)}% over ${totals.months} month${totals.months === 1 ? "" : "s"} (${totals.a} → ${totals.b})`,
              values: { [from]: totals.a, [to]: totals.b },
            },
        months,
        evaluableMonths,
        hitMonths,
      };
    }));
  }

  // Later dose > earlier dose — judged on the selected period's totals over
  // months where both doses were reported. Monthly reversals are context.
  const doseOrderCard = (id: string, name: string, description: string, links: Array<[string, string]>) =>
    makePeriodCard(id, name, description, "consistency", selectedDistricts, (d) => {
      const months: Record<string, StateHmisHit> = {};
      let evaluableMonths = 0;
      let hitMonths = 0;
      for (const m of selectedMonths) {
        const reversals: string[] = [];
        let comparable = false;
        for (const [before, after] of links) {
          const a = value(d, m, before); const b = value(d, m, after);
          if (a === null || b === null) continue;
          comparable = true;
          if (b > a) reversals.push(`${after} ${b} > ${before} ${a}`);
        }
        if (!comparable) continue;
        evaluableMonths += 1;
        if (reversals.length > 0) hitMonths += 1;
        months[m] = { flag: reversals.length > 0, detail: reversals.length ? reversals.join("; ") : "Dose order consistent this month" };
      }
      const reversals: string[] = [];
      let comparableLinks = 0;
      for (const [before, after] of links) {
        const totals = matchedTotals(selectedMonths.map((m) => [value(d, m, before), value(d, m, after)] as [number | null, number | null]));
        if (totals.months === 0) continue;
        comparableLinks += 1;
        if (totals.b > totals.a) reversals.push(`${after} ${totals.b} > ${before} ${totals.a}`);
      }
      return {
        period: comparableLinks === 0
          ? notEvaluable("Not evaluable: no month with both doses reported")
          : { flag: reversals.length > 0, detail: reversals.length ? `Period totals: ${reversals.join("; ")}` : "Dose order consistent over the period" },
        months,
        evaluableMonths,
        hitMonths,
      };
    });

  const sequenceCards: { id: string; name: string; doses: string[] }[] = [
    { id: "penta_sequence", name: "Penta Dose Sequence", doses: ["Penta1", "Penta2", "Penta3"] },
    { id: "opv_sequence", name: "OPV Dose Sequence", doses: ["OPV1", "OPV2", "OPV3"] },
    { id: "rvv_sequence", name: "RVV Dose Sequence", doses: ["RVV1", "RVV2", "RVV3"] },
  ];
  for (const spec of sequenceCards) {
    const links: Array<[string, string]> = spec.doses.slice(1).map((dose, index) => [spec.doses[index], dose]);
    cards.push(doseOrderCard(spec.id, spec.name, "A later dose exceeds the preceding dose over the selected period.", links));
  }
  for (const [id, from, to] of [["penta3_gt_penta1", "Penta1", "Penta3"], ["opv3_gt_opv1", "OPV1", "OPV3"]] as const) {
    cards.push(doseOrderCard(id, `${to} > ${from}`, "Later dose exceeds the first dose over the selected period.", [[from, to]]));
  }
  filters.additionalPairs.forEach((pair, index) => {
    cards.push(doseOrderCard(`custom_${index}`, `${pair.to} > ${pair.from}`, "User-defined sequence comparison over the selected period.", [[pair.from, pair.to]]));
  });

  const coadminGroups: [string, string, string[]][] = [
    ["co1", "Co-administered Antigens — 6 weeks", ["OPV1", "Penta1", "RVV1", "PCV1", "IPV1"]],
    ["co2", "Co-administered Antigens — 10 weeks", ["OPV2", "Penta2", "RVV2"]],
    ["co3", "Co-administered Antigens — 14 weeks", ["OPV3", "Penta3", "RVV3", "PCV2", "IPV2"]],
    ["co4", "Co-administered Antigens — 9 months", ["MR1", "PCV Booster", "IPV3"]],
    ["co5", "Co-administered Antigens — 16–24 months", ["MR2", "DPT 1st Booster"]],
  ];
  for (const [id, name, shorts] of coadminGroups) {
    cards.push(makeCard(id, name, `Relative spread exceeds ${filters.coadminTolerance}%.`, "consistency", selectedDistricts, selectedMonths, (d, m) => {
      const values = shorts.map((short) => [short, value(d, m, short)] as const).filter((entry) => entry[1] !== null);
      if (values.length < 2) return notEvaluable("Fewer than two comparable values");
      const nums = values.map((entry) => entry[1] as number); const max = Math.max(...nums); const min = Math.min(...nums);
      const gap = max > 0 ? ((max - min) / max) * 100 : 0; const flag = gap > filters.coadminTolerance;
      return { flag, detail: `${gap.toFixed(1)}% relative spread`, values: Object.fromEntries(values) };
    }));
  }
  cards.push(makeCard("aefi_deaths", "AEFI Deaths > Serious AEFI", "Reported AEFI deaths cannot exceed serious AEFI cases.", "consistency", selectedDistricts, selectedMonths, (d, m) => {
    const serious = value(d, m, "AEFI Serious"); const deaths = value(d, m, "AEFI Deaths");
    if (serious === null || deaths === null) return notEvaluable(`Serious ${serious ?? "blank"}; deaths ${deaths ?? "blank"}`);
    const flag = deaths > serious;
    return { flag, detail: `Serious ${serious}; deaths ${deaths}` };
  }));

  return { cards, selectedDistricts, selectedMonths, filteredDistricts };
}

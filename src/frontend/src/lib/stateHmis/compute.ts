import type {
  StateHmisCard,
  StateHmisComputed,
  StateHmisFilters,
  StateHmisGroup,
  StateHmisHit,
  StateHmisParsed,
} from "./types";

type Evaluator = (district: string, month: string) => StateHmisHit | null;

const GROUPS: StateHmisGroup[] = ["availability", "completeness", "accuracy", "consistency"];

function valueByShort(data: StateHmisParsed, district: string, month: string, short: string) {
  const code = data.orderedItemCodes.find((itemCode) => data.items[itemCode]?.short === short);
  return code ? data.unitData[district]?.months[month]?.values[code] ?? null : null;
}

function codeByShort(data: StateHmisParsed, short: string): string | null {
  return data.orderedItemCodes.find((code) => data.items[code]?.short === short) ?? null;
}

function pctChange(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function passesOutlier(value: number, severity: StateHmisFilters["outlierSeverity"]): boolean {
  if (severity === "low") return value >= 25 || value <= -25;
  if (severity === "moderate") return value > 50 || value < -50;
  return value > 100 || value <= -75;
}

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
  let all = 0;
  for (const district of districts) {
    hits[district] = {};
    const evaluated: StateHmisHit[] = [];
    for (const month of months) {
      const hit = evaluator(district, month);
      if (hit === null) continue;
      hits[district][month] = hit;
      evaluated.push(hit);
    }
    if (evaluated.some((hit) => hit.flag)) affectedDistricts.push(district);
    if (evaluated.length > 0 && evaluated.every((hit) => hit.flag)) all += 1;
  }
  const total = affectedDistricts.length;
  return {
    id, name, description, group, total, any: total - all, all,
    affectedDistricts,
    affectedUnits: affectedDistricts,
    hits,
  };
}

export function computeStateHmisKpis(
  data: StateHmisParsed,
  filters: StateHmisFilters,
): StateHmisComputed {
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
  const unitLabel = data.reportLevel === "block" ? "Block" : "District";

  cards.push(makeCard("all_m9_blank", "All M9 Indicators Blank", "Every M9 data item is blank.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m);
    if (!rec) return { flag: false, detail: `${unitLabel} report is missing` };
    const flag = m9Codes.length > 0 && m9Codes.every((code) => rec.values[code] === null);
    return { flag, detail: flag ? "All M9 values are blank" : "M9 data reported" };
  }));

  cards.push(makeCard("key_all_zero", "Key Indicators All Zero", "All selected key indicators are reported as zero.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const rec = record(d, m); if (!rec) return { flag: false, detail: `${unitLabel} report is missing` };
    const vals = keyCodes.map((code) => rec.values[code]);
    const flag = vals.length > 0 && vals.every((value) => value !== null && value === 0);
    return { flag, detail: flag ? "All selected key indicators are zero" : "Not all zero" };
  }));

  cards.push(makeCard("repeated_profile", "Repeated Monthly Profile", "The complete M9 profile exactly matches the preceding uploaded month.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const index = selectedMonths.indexOf(m); if (index <= 0) return null;
    const previousMonth = selectedMonths[index - 1];
    const current = record(d, m); const previous = record(d, previousMonth);
    if (!current || !previous) return { flag: false, detail: `One of the compared ${unitLabel.toLowerCase()} reports is missing` };
    const comparable = m9Codes.filter((code) => current.values[code] !== undefined && previous.values[code] !== undefined);
    const flag = comparable.length > 0 && comparable.every((code) => current.values[code] === previous.values[code]);
    return { flag, detail: flag ? `Profile exactly matches ${previousMonth}` : `Profile differs from ${previousMonth}` };
  }));

  cards.push(makeCard("zero_sessions_vax", "Zero Sessions with Vaccination Data", "Sessions held is zero while one or more key vaccinations are reported.", "availability", selectedDistricts, selectedMonths, (d, m) => {
    const held = valueByShort(data, d, m, "Sessions Held");
    const positive = keyShorts.filter((short) => (valueByShort(data, d, m, short) ?? 0) > 0);
    const flag = held === 0 && positive.length > 0;
    return { flag, detail: flag ? `Zero sessions; positive: ${positive.join(", ")}` : "No contradiction" };
  }));

  cards.push(makeCard("missing_unit", `Missing ${unitLabel} Report`, `The ${unitLabel.toLowerCase()} is absent from a monthly workbook.`, "completeness", selectedDistricts, selectedMonths, (d, m) => {
    const flag = !record(d, m); return { flag, detail: flag ? `${unitLabel} is absent from this file` : `${unitLabel} report present` };
  }));
  cards.push(makeCard("key_missing", "Key Missing Indicators", "One or more selected key indicators are blank or absent.", "completeness", selectedDistricts, selectedMonths, (d, m) => {
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

  cards.push(makeCard("held_gt_planned", "Sessions Held > Sessions Planned", "Held exceeds planned where planned is greater than zero.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const planned = valueByShort(data, d, m, "Sessions Planned"); const held = valueByShort(data, d, m, "Sessions Held");
    const flag = planned !== null && held !== null && planned > 0 && held > planned;
    return { flag, detail: `Planned ${planned ?? "blank"}; held ${held ?? "blank"}`, values: { Planned: planned, Held: held } };
  }));
  cards.push(makeCard("outliers", "Month-on-Month Outliers", "Selected indicators cross the chosen increase/decrease threshold.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const index = selectedMonths.indexOf(m); if (index <= 0) return null;
    const previousMonth = selectedMonths[index - 1]; const outliers: string[] = [];
    for (const short of keyShorts) {
      const change = pctChange(valueByShort(data, d, previousMonth, short), valueByShort(data, d, m, short));
      if (change !== null && passesOutlier(change, filters.outlierSeverity)) outliers.push(`${short} ${change.toFixed(1)}%`);
    }
    return { flag: outliers.length > 0, detail: outliers.length ? outliers.join("; ") : `No outlier from ${previousMonth}` };
  }));
  cards.push(makeCard("abrupt_zero", "Abrupt Zero", "A selected key indicator falls from a positive value to zero.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const index = selectedMonths.indexOf(m); if (index <= 0) return null;
    const previousMonth = selectedMonths[index - 1];
    const affected = keyShorts.filter((short) => (valueByShort(data, d, previousMonth, short) ?? 0) > 0 && valueByShort(data, d, m, short) === 0);
    return { flag: affected.length > 0, detail: affected.length ? `Dropped to zero: ${affected.join(", ")}` : "No abrupt zero" };
  }));
  cards.push(makeCard("invalid_counts", "Invalid Counts", "Negative, decimal, or malformed count values.", "accuracy", selectedDistricts, selectedMonths, (d, m) => {
    const invalid = record(d, m)?.invalidCodes ?? [];
    return { flag: invalid.length > 0, detail: invalid.length ? `Invalid item codes: ${invalid.join(", ")}` : "Counts are non-negative integers" };
  }));

  const dropoutPairs: [string, string][] = [["Penta1", "Penta3"], ["MR1", "MR2"], ["BCG", "MR1"], ["Penta3", "MR1"]];
  for (const [from, to] of dropoutPairs) {
    cards.push(makeCard(`drop_${from}_${to}`, `${from} → ${to} Dropout`, `Dropout is at least ${filters.dropoutThreshold}%.`, "accuracy", selectedDistricts, selectedMonths, (d, m) => {
      const a = valueByShort(data, d, m, from); const b = valueByShort(data, d, m, to);
      const pct = a !== null && b !== null && a > 0 && b < a ? ((a - b) / a) * 100 : null;
      const flag = pct !== null && pct >= filters.dropoutThreshold;
      return { flag, detail: pct === null ? "Not evaluable/no dropout" : `${pct.toFixed(1)}% dropout`, values: { [from]: a, [to]: b } };
    }));
  }

  const sequenceCards: { id: string; name: string; doses: string[] }[] = [
    { id: "penta_sequence", name: "Penta Dose Sequence", doses: ["Penta1", "Penta2", "Penta3"] },
    { id: "opv_sequence", name: "OPV Dose Sequence", doses: ["OPV1", "OPV2", "OPV3"] },
    { id: "rvv_sequence", name: "RVV Dose Sequence", doses: ["RVV1", "RVV2", "RVV3"] },
  ];
  for (const spec of sequenceCards) {
    cards.push(makeCard(spec.id, spec.name, "A later dose exceeds the preceding dose.", "consistency", selectedDistricts, selectedMonths, (d, m) => {
      const reversals: string[] = [];
      for (let index = 1; index < spec.doses.length; index += 1) {
        const from = spec.doses[index - 1]; const to = spec.doses[index];
        const a = valueByShort(data, d, m, from); const b = valueByShort(data, d, m, to);
        if (a !== null && b !== null && b > a) reversals.push(`${to} ${b} > ${from} ${a}`);
      }
      return { flag: reversals.length > 0, detail: reversals.length ? reversals.join("; ") : "Dose sequence consistent" };
    }));
  }
  for (const [id, from, to] of [["penta3_gt_penta1", "Penta1", "Penta3"], ["opv3_gt_opv1", "OPV1", "OPV3"]] as const) {
    cards.push(makeCard(id, `${to} > ${from}`, "Later dose exceeds the first dose.", "consistency", selectedDistricts, selectedMonths, (d, m) => {
      const a = valueByShort(data, d, m, from); const b = valueByShort(data, d, m, to); const flag = a !== null && b !== null && b > a;
      return { flag, detail: `${from} ${a ?? "blank"}; ${to} ${b ?? "blank"}` };
    }));
  }
  filters.additionalPairs.forEach((pair, index) => {
    cards.push(makeCard(`custom_${index}`, `${pair.to} > ${pair.from}`, "User-defined sequence comparison.", "consistency", selectedDistricts, selectedMonths, (d, m) => {
      const a = valueByShort(data, d, m, pair.from); const b = valueByShort(data, d, m, pair.to); const flag = a !== null && b !== null && b > a;
      return { flag, detail: `${pair.from} ${a ?? "blank"}; ${pair.to} ${b ?? "blank"}` };
    }));
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
      const values = shorts.map((short) => [short, valueByShort(data, d, m, short)] as const).filter((entry) => entry[1] !== null);
      if (values.length < 2) return { flag: false, detail: "Fewer than two comparable values" };
      const nums = values.map((entry) => entry[1] as number); const max = Math.max(...nums); const min = Math.min(...nums);
      const gap = max > 0 ? ((max - min) / max) * 100 : 0; const flag = gap > filters.coadminTolerance;
      return { flag, detail: `${gap.toFixed(1)}% relative spread`, values: Object.fromEntries(values) };
    }));
  }
  cards.push(makeCard("aefi_deaths", "AEFI Deaths > Serious AEFI", "Reported AEFI deaths cannot exceed serious AEFI cases.", "consistency", selectedDistricts, selectedMonths, (d, m) => {
    const serious = valueByShort(data, d, m, "AEFI Serious"); const deaths = valueByShort(data, d, m, "AEFI Deaths");
    const flag = serious !== null && deaths !== null && deaths > serious;
    return { flag, detail: `Serious ${serious ?? "blank"}; deaths ${deaths ?? "blank"}` };
  }));

  const denominator = Math.max(1, selectedDistricts.length);
  const componentScores = Object.fromEntries(GROUPS.map((group) => {
    const groupCards = cards.filter((card) => card.group === group);
    const worstIssuePct = Math.max(0, ...groupCards.map((card) => (card.total / denominator) * 100));
    return [group, { group, worstIssuePct, score: Math.max(0, 100 - worstIssuePct) }];
  })) as StateHmisComputed["componentScores"];
  const overallScore = GROUPS.reduce((sum, group) => sum + componentScores[group].score, 0) / GROUPS.length;
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
    componentScores,
    overallScore,
    issueCountByUnit: issueCountByDistrict,
    issueNamesByUnit: issueNamesByDistrict,
    issueCountByDistrict,
    issueNamesByDistrict,
    districtRollups,
  };
}

// ============================================================
// PCTS "Download Report" — the two-page DQA brief
// (docs/Report Template/HMIS DQA Brief - Template.pdf, lib/report/brief.ts).
// Units are facilities, grouped by block.
// ============================================================

import type { ReviewBaseline } from "../snapshots";
import {
  briefDay,
  briefFindDay,
  briefPeriod,
  briefPlaceName,
  buildBrief,
  saveBrief,
  type BriefCheckText,
  type DqaBrief,
} from "../report/brief";
import { PCTS_COADMIN_GROUPS } from "./computeKpis";
import { DEFAULT_PCTS_FILTERS, PCTS_INDICATORS, type PctsComputed, type PctsParsed } from "./types";

const COMPONENTS = [
  { key: "availability", name: "Availability", description: ["Reporting gaps and", "duplicates"] },
  { key: "completeness", name: "Completeness", description: ["Key immunization data points", "missing in report"] },
  { key: "accuracy", name: "Accuracy", description: ["Sudden jumps or falls on", "month-wise reported data"] },
  { key: "consistency", name: "Consistency", description: ["Do numbers follow a logical", "pattern?"] },
];

const LABEL = new Map(PCTS_INDICATORS.map((indicator) => [indicator.id, indicator.label]));

/** Wording for the PCTS checks the generic rules cannot name. */
const CHECK_TEXT: Record<string, BriefCheckText> = {
  key_indicators_zero: { title: "All key indicators 0", short: "All key indicators 0" },
  repeated_key_profile: { title: "Duplicate monthly record" },
  key_indicators_missing: { title: "Key indicators missing" },
  month_outliers: { title: "Outliers", detail: "month-on-month jumps", detailAlign: "title" },
  ...Object.fromEntries(
    PCTS_COADMIN_GROUPS.map((group) => [
      group.id,
      {
        title: `Co-admin ${group.name.split(/\s+[—–]\s+/).pop()}`,
        detail: `${group.ids.map((id) => LABEL.get(id) ?? id).join(", ")} not equal`,
      },
    ]),
  ),
};

/** The brief for the PCTS analysis on screen (exported for checks). */
export function buildPctsBrief(
  data: PctsParsed,
  computed: PctsComputed,
  previous: ReviewBaseline | null = null,
  now?: Date,
): DqaBrief {
  const months = [...computed.selectedMonths].sort();
  const district = briefPlaceName(data.districtName);
  const state = briefPlaceName(data.stateName);
  // "Status as on …" of the latest report in the selection.
  const selected = new Set(months);
  const asOn = data.fileSummaries
    .filter((file) => selected.size === 0 || selected.has(file.month))
    .map((file) => briefFindDay(file.generatedAt))
    .filter((day): day is string => Boolean(day))
    .sort()
    .pop();
  return buildBrief({
    portal: "PCTS",
    place: [district, state].filter(Boolean).join(", ") || "PCTS upload",
    period: months.length ? briefPeriod(months[0], months[months.length - 1]) : "No period selected",
    dataAsOn: briefDay(asOn),
    unit: { one: "facility", many: "facilities" },
    area: { one: "block", many: "blocks" },
    units: computed.selectedFacilityKeys.map((key) => ({
      key,
      name: data.facilities[key]?.facility || key,
      area: data.facilities[key]?.block ?? "",
    })),
    cards: computed.scoreCards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.eligible,
      flaggedUnits: card.affectedFacilities,
    })),
    components: COMPONENTS,
    weighted: computed.weighted,
    periodCount: months.length,
    periodNoun: "month",
    checkText: CHECK_TEXT,
    spotlight: { id: "key_indicators_zero", verb: "reported every key indicator as 0" },
    dropoutThreshold: DEFAULT_PCTS_FILTERS.dropoutThreshold,
    previous,
    uploadedUnits: Object.keys(data.facilities).length,
    totalLabel: district ? "District total" : "Total",
    now,
  });
}

export async function downloadPctsDqaReport(
  data: PctsParsed,
  computed: PctsComputed,
  previous: ReviewBaseline | null = null,
): Promise<void> {
  await saveBrief(
    buildPctsBrief(data, computed, previous),
    ["PCTS-DQA-Brief", data.stateName, data.districtName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

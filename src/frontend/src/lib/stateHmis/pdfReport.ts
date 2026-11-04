// ============================================================
// HMIS-State "Download Report" — the two-page DQA brief
// (docs/Report Template/HMIS DQA Brief - Template.pdf, lib/report/brief.ts).
// A block-level upload reports blocks grouped by district; a district-level
// upload reports the districts themselves (page 2 lists every district with
// the checks flagged for it).
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
import { STATE_HMIS_COADMIN_GROUPS } from "./compute";
import { DEFAULT_STATE_HMIS_FILTERS, type StateHmisComputed, type StateHmisParsed } from "./types";

const COMPONENTS = [
  { key: "availability", name: "Availability", description: ["Reporting gaps and", "duplicates"] },
  { key: "completeness", name: "Completeness", description: ["Key immunization data points", "missing in report"] },
  { key: "accuracy", name: "Accuracy", description: ["Sudden jumps or falls on", "month-wise reported data"] },
  { key: "consistency", name: "Consistency", description: ["Do numbers follow a logical", "pattern?"] },
];

/** Wording for the HMIS-State checks the generic rules cannot name. */
const CHECK_TEXT: Record<string, BriefCheckText> = {
  all_m9_blank: { title: "All indicators blank" },
  key_all_zero: { title: "All key indicators 0" },
  repeated_profile: { title: "Duplicate monthly record" },
  key_missing: { title: "Key indicators missing" },
  held_gt_planned: { title: "Sessions held > planned" },
  outliers: { title: "Outliers", detail: "month-on-month jumps", detailAlign: "title" },
  ...Object.fromEntries(
    STATE_HMIS_COADMIN_GROUPS.map(([id, name, shorts]) => [
      id,
      { title: `Co-admin ${name.split(/\s+[—–]\s+/).pop()}`, detail: `${shorts.join(", ")} not equal` },
    ]),
  ),
};

/** Tool order of the checks on the brief (dropouts follow the outliers as computed). */
const CHECK_ORDER = [
  "all_m9_blank", "key_all_zero", "repeated_profile",
  "key_missing",
  "outliers",
  "held_gt_planned", "penta3_gt_penta1", "mr2_gt_mr1", "co1", "co2", "co3", "co4", "co5",
];

/** The brief for the HMIS-State analysis on screen (exported for checks). */
export function buildStateHmisBrief(
  data: StateHmisParsed,
  computed: StateHmisComputed,
  previous: ReviewBaseline | null = null,
  now?: Date,
): DqaBrief {
  const blockLevel = data.reportLevel === "block";
  const months = [...computed.selectedMonths].sort();
  // HMIS names its exports "… as on 16th October 2026 at …".
  const asOn = data.fileNames
    .map((name) => /as\s+on\s+(.+)/i.exec(name)?.[1])
    .map((rest) => briefFindDay(rest))
    .filter((day): day is string => Boolean(day))
    .sort()
    .pop();
  const units = computed.selectedUnits.map((id) => {
    const record = data.unitData[id];
    const district = record?.district?.trim() ?? "";
    return {
      key: id,
      name: blockLevel ? record?.block?.trim() || "Unknown block" : district || "Unknown district",
      area: district,
    };
  });
  const district = { one: "district", many: "districts" };
  return buildBrief({
    portal: "HMIS State",
    system: "HMIS",
    place: briefPlaceName(data.stateName) || "HMIS state upload",
    period: months.length ? briefPeriod(months[0], months[months.length - 1]) : "No period selected",
    dataAsOn: briefDay(asOn),
    unit: blockLevel ? { one: "block", many: "blocks" } : district,
    area: district,
    units,
    unitIsArea: !blockLevel,
    cards: computed.scoreCards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.eligible,
      flaggedUnits: card.affectedUnits,
    })),
    components: COMPONENTS,
    weighted: computed.weighted,
    periodCount: months.length,
    periodNoun: "month",
    checkText: CHECK_TEXT,
    checkOrder: CHECK_ORDER,
    spotlight: { id: "all_m9_blank", verb: "left every indicator blank" },
    dropoutThreshold: DEFAULT_STATE_HMIS_FILTERS.dropoutThreshold,
    previous,
    uploadedUnits: Object.keys(data.unitData).length,
    totalLabel: "State total",
    now,
  });
}

export async function downloadStateHmisDqaReport(
  data: StateHmisParsed,
  computed: StateHmisComputed,
  previous: ReviewBaseline | null = null,
): Promise<void> {
  await saveBrief(
    buildStateHmisBrief(data, computed, previous),
    ["HMIS-State-DQA-Brief", data.stateName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

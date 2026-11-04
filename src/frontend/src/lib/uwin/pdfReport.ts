// ============================================================
// U-WIN / U-WIN State "Download Report" — the two-page DQA brief
// (docs/Report Template/HMIS DQA Brief - Template.pdf, lib/report/brief.ts).
// U-WIN scores Availability, Accuracy and Consistency; units follow the
// analysis level on screen (facilities, sub centers or session sites), grouped
// by block (district upload) or district (state upload).
// ============================================================

import type { UwinParsedCSV, UwinComputedKpis } from "./types";
import type { ComputedKpis } from "../dqa/types";
import type { ReviewBaseline } from "../snapshots";
import { computeOverallScore } from "../dqa/scoreUtils";
import { isMonthKey, monthLongLabel } from "../dqa/parseUtils";
import { declaredWindow } from "./uploadPeriod";
import {
  briefDays,
  briefPeriod,
  briefPlaceName,
  buildBrief,
  saveBrief,
  type BriefCheckText,
  type BriefNoun,
  type DqaBrief,
} from "../report/brief";

const UNIT_NOUN: Record<UwinComputedKpis["analysisMode"], BriefNoun> = {
  facility: { one: "facility", many: "facilities" },
  subcenter: { one: "sub center", many: "sub centers" },
  sessionsite: { one: "session site", many: "session sites" },
};

/** Tool order of the U-WIN checks on the brief. */
const CHECK_ORDER = [
  "t0", "t7", "t9",
  "t6", "t8", "t3", "drop_penta1_penta3", "drop_mr1_mr2", "drop_penta3_mr1",
  "i1", "i2", "co1", "co2", "co3", "co4", "co5",
];

function checkText(weekly: boolean): Record<string, BriefCheckText> {
  return {
    t0: { title: "0 entered instead of blank", short: "0 instead of blank" },
    t7: { title: "Same value in every indicator", short: "Same value everywhere" },
    t9: { title: "Zero coverage session" },
    t6: { title: "Sessions planned but not held", short: "Planned, not held" },
    t8: { title: "Under 5 beneficiaries per session", short: "Under 5 per session" },
    t3: { title: "Outliers", detail: weekly ? "week-on-week jumps" : "month-on-month jumps", detailAlign: "title" },
  };
}

/** The brief for the U-WIN analysis on screen (exported for checks). */
export function buildUwinBrief(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  previous: ReviewBaseline | null = null,
  now?: Date,
): DqaBrief {
  const isState = csv.portal === "UWIN_STATE";
  const mode = kpis.analysisMode;
  const keys = [...kpis.selMonths].sort();
  const declared = declaredWindow(csv.reportingPeriods ?? [], kpis.selMonths);
  const weekly = declared?.duration === "WEEKLY" || keys.some((key) => !isMonthKey(key));
  const period = declared && weekly
    ? briefDays(declared.from, declared.to)
    : keys.length && keys.every(isMonthKey)
      ? briefPeriod(keys[0], keys[keys.length - 1])
      : keys.map(monthLongLabel).join(", ") || "No period selected";

  // Sub center and session site names repeat across facilities; name the facility when one repeats in its area.
  const units = Object.entries(kpis.filteredFacilities).map(([key, record]) => {
    const own = mode === "sessionsite" ? record.sessionsite : mode === "subcenter" ? record.subcenter : record.facility;
    return {
      key,
      name: own?.trim() || record.facility,
      facility: record.facility,
      area: isState ? record.district ?? "" : record.block,
    };
  });
  const seen = new Map<string, number>();
  for (const unit of units) seen.set(`${unit.area}||${unit.name}`, (seen.get(`${unit.area}||${unit.name}`) ?? 0) + 1);
  const named = units.map((unit) => ({
    key: unit.key,
    area: unit.area,
    name: mode !== "facility" && (seen.get(`${unit.area}||${unit.name}`) ?? 0) > 1 && unit.facility && unit.facility !== unit.name
      ? `${unit.name} (${unit.facility})`
      : unit.name,
  }));

  const district = briefPlaceName(csv.distName);
  const state = briefPlaceName(csv.stateName);
  const components = [
    { key: "availability", name: "Availability", description: ["Reporting gaps and", "duplicates"] },
    { key: "accuracy", name: "Accuracy", description: ["Sessions held as planned,", "jumps and dropouts"] },
    { key: "consistency", name: "Consistency", description: ["Do numbers follow a logical", "pattern?"] },
  ];
  const uploaded = mode === "sessionsite"
    ? csv.globalSessionSiteCount
    : mode === "subcenter"
      ? csv.globalSubCenterCount
      : csv.globalFacilityCount;
  return buildBrief({
    portal: "U-WIN",
    place: (isState ? state : [district, state].filter(Boolean).join(", ")) || "U-WIN upload",
    period,
    dataAsOn: null,
    unit: UNIT_NOUN[mode] ?? UNIT_NOUN.facility,
    area: isState ? { one: "district", many: "districts" } : { one: "block", many: "blocks" },
    units: named,
    cards: (kpis.scoreCards ?? kpis.cards).map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.stat.eligible,
      flaggedUnits: card.stat.facilityKeys,
    })),
    components,
    weighted: computeOverallScore(kpis as unknown as ComputedKpis, "UWIN", components.map((c) => c.key)).weighted,
    periodCount: keys.length,
    periodNoun: weekly ? "week" : "month",
    checkText: checkText(weekly),
    checkOrder: CHECK_ORDER,
    spotlight: { id: "t9", verb: "had a zero coverage session" },
    dropoutThreshold: 20,
    previous,
    uploadedUnits: uploaded || named.length,
    totalLabel: isState ? "State total" : district ? "District total" : "Total",
    now,
  });
}

export async function downloadUwinDqaReport(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  previous: ReviewBaseline | null = null,
): Promise<void> {
  const isState = csv.portal === "UWIN_STATE";
  await saveBrief(
    buildUwinBrief(csv, kpis, previous),
    [
      isState ? "UWIN-State-DQA-Brief" : "UWIN-DQA-Brief",
      csv.stateName,
      isState ? "All-Districts" : csv.distName,
      new Date().toISOString().slice(0, 10),
    ].join("-"),
  );
}

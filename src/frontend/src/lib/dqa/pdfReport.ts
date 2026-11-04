// ============================================================
// HMIS "Download Report" — the two-page DQA brief
// (docs/Report Template/HMIS DQA Brief - Template.pdf, adopted 2026-11-04).
// lib/report/brief.ts derives what it says and lib/report/briefPdf.ts draws
// it; this file only maps the HMIS analysis on screen onto the brief input.
// ============================================================

import type { ParsedCSV, ComputedKpis } from "./types";
import type { ReviewBaseline } from "../snapshots";
import { computeOverallScore } from "./scoreUtils";
import {
  briefDay,
  briefPeriod,
  briefPlaceName,
  buildBrief,
  saveBrief,
  type BriefCheckText,
  type DqaBrief,
} from "../report/brief";

const COMPONENTS = [
  { key: "availability", name: "Availability", description: ["Reporting gaps and", "duplicates"] },
  { key: "completeness", name: "Completeness", description: ["Key immunization data points", "missing in report"] },
  { key: "accuracy", name: "Accuracy", description: ["Sudden jumps or falls on", "month-wise reported data"] },
  { key: "consistency", name: "Consistency", description: ["Do numbers follow a logical", "pattern?"] },
];

/** Wording for the HMIS checks the generic rules cannot name. */
const CHECK_TEXT: Record<string, BriefCheckText> = {
  t1: { title: "All indicators blank" },
  t0: { title: "0 entered instead of blank", short: "0 instead of blank" },
  t7: { title: "Duplicate monthly record" },
  t10: { title: "Session not held but vaccinated", short: "Vaccinated, no session" },
  t2: { title: "Key indicators missing" },
  t3: { title: "Outliers", detail: "month-on-month jumps", detailAlign: "title" },
  t6: { title: "Sessions held > planned" },
};

/** The brief for the HMIS analysis on screen (exported for checks). */
export function buildHmisBrief(
  csv: ParsedCSV,
  kpis: ComputedKpis,
  previous: ReviewBaseline | null = null,
  now?: Date,
): DqaBrief {
  const months = [...kpis.selMonths].sort();
  const district = briefPlaceName(csv.distName);
  const state = briefPlaceName(csv.stateName);
  return buildBrief({
    portal: "HMIS",
    place: [district, state].filter(Boolean).join(", ") || "HMIS upload",
    period: months.length ? briefPeriod(months[0], months[months.length - 1]) : "No period selected",
    dataAsOn: briefDay(csv.dataAsOn),
    unit: { one: "facility", many: "facilities" },
    area: { one: "block", many: "blocks" },
    units: Object.entries(kpis.filteredFacilities).map(([key, record]) => ({
      key,
      name: record.facility,
      area: record.block,
    })),
    cards: (kpis.scoreCards ?? kpis.cards).map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.stat.eligible,
      flaggedUnits: card.stat.facilityKeys,
    })),
    components: COMPONENTS,
    weighted: computeOverallScore(kpis, "HMIS", COMPONENTS.map((component) => component.key)).weighted,
    periodCount: months.length,
    periodNoun: "month",
    checkText: CHECK_TEXT,
    spotlight: { id: "t1", verb: "left every indicator blank" },
    dropoutThreshold: 20,
    previous,
    uploadedUnits: Object.keys(csv.facilityData).length,
    totalLabel: district ? "District total" : "Total",
    now,
  });
}

/**
 * Saves the brief for the analysis on screen. `previous` is the last saved
 * review of the period before this one (pickPreviousPeriodReview); without it
 * the score's change line is left out.
 */
export async function downloadHmisDqaReport(
  csv: ParsedCSV,
  kpis: ComputedKpis,
  previous: ReviewBaseline | null = null,
): Promise<void> {
  await saveBrief(
    buildHmisBrief(csv, kpis, previous),
    ["HMIS-DQA-Brief", csv.stateName, csv.distName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

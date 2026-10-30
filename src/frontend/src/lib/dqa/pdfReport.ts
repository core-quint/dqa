// ============================================================
// HMIS "Download Report" — the DQA analysis report in the agreed template
// (docs/Data Template for Data Quality Assessment.pdf, adopted 2026-10-29).
// The layout and every derived figure live in lib/report/; this file only
// maps the HMIS analysis on screen onto the shared report input.
// ============================================================

import type { ParsedCSV, ComputedKpis } from "./types";
import { computeOverallScore } from "./scoreUtils";
import { displayBlockLabel, monthLongLabel } from "./parseUtils";
import { buildReportModel, periodRange, saveReport } from "../report/buildReportModel";
import type { ReportModel } from "../report/dqaReportPdf";

const GROUPS = ["availability", "completeness", "accuracy", "consistency"];

/** "… flagged for <phrase>." in the key findings. */
const PHRASES: Record<string, string> = {
  t1: "all M9 indicators blank",
  t0: "indicators reported as 0 instead of left blank",
  t7: "a duplicate monthly record (M9 values repeated from the previous month)",
  t10: "vaccinations reported in a month with no session held",
  t2: "key missing indicators",
  t3: "month-on-month outliers",
  t6: "more sessions held than planned",
};

/** The report model for the HMIS analysis on screen (exported for checks). */
export function buildHmisReportModel(csv: ParsedCSV, kpis: ComputedKpis): ReportModel {
  const period = periodRange(kpis.selMonths, monthLongLabel);
  const blocks = kpis.globalBlockCount;
  return buildReportModel({
    kicker: "DQA Desk Review · District report",
    title: "Data Quality Assessment (DQA) Analysis – HMIS",
    meta: [
      { label: "State", value: csv.stateName || "—" },
      { label: "Period", value: period },
      { label: "District", value: csv.distName || "—" },
      { label: "Coverage", value: `${kpis.globalDen} facilities · ${blocks} block${blocks === 1 ? "" : "s"}` },
    ],
    footer: `HMIS DQA · ${csv.distName}, ${csv.stateName} · ${period}`,
    unit: { one: "facility", many: "facilities" },
    area: { one: "block", many: "blocks" },
    units: Object.entries(kpis.filteredFacilities).map(([key, record]) => ({
      key,
      name: record.facility || "Unknown facility",
      area: displayBlockLabel(record.block),
    })),
    cards: (kpis.scoreCards ?? kpis.cards).map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.stat.eligible,
      flaggedUnits: card.stat.facilityKeys,
    })),
    groups: GROUPS,
    weighted: computeOverallScore(kpis, "HMIS", GROUPS).weighted,
    phrases: PHRASES,
    dropoutThreshold: 20,
    uploadedUnits: Object.keys(csv.facilityData).length,
  });
}

export async function downloadHmisDqaReport(csv: ParsedCSV, kpis: ComputedKpis): Promise<void> {
  await saveReport(
    buildHmisReportModel(csv, kpis),
    ["DQA-Report-HMIS", csv.stateName, csv.distName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

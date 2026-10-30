// ============================================================
// U-WIN / U-WIN State "Download Report" — the DQA analysis report in the
// agreed template (lib/report/). U-WIN scores Availability, Accuracy and
// Consistency; units follow the analysis level on screen (facilities, sub
// centers or session sites), grouped by block (district upload) or district
// (state upload).
// ============================================================

import type { UwinParsedCSV, UwinComputedKpis } from "./types";
import type { ComputedKpis } from "../dqa/types";
import { computeOverallScore } from "../dqa/scoreUtils";
import { displayBlockLabel, monthLongLabel } from "../dqa/parseUtils";
import { declaredWindow, windowLabel } from "./uploadPeriod";
import { buildReportModel, periodRange, saveReport } from "../report/buildReportModel";
import type { ReportModel } from "../report/dqaReportPdf";

const UWIN_GROUPS = ["availability", "accuracy", "consistency"];

const PHRASES: Record<string, string> = {
  t0: "indicators reported as 0 instead of left blank",
  t7: "the same value reported in every indicator",
  t9: "sessions held with no beneficiaries recorded",
  t6: "sessions planned but not held",
  t8: "fewer than 5 beneficiaries per session",
  t3: "outliers",
};

const UNIT_NOUN = {
  facility: { one: "facility", many: "facilities" },
  subcenter: { one: "sub center", many: "sub centers" },
  sessionsite: { one: "session site", many: "session sites" },
} as const;

/** The report model for the U-WIN analysis on screen (exported for checks). */
export function buildUwinReportModel(csv: UwinParsedCSV, kpis: UwinComputedKpis): ReportModel {
  const isState = csv.portal === "UWIN_STATE";
  const unit = UNIT_NOUN[kpis.analysisMode] ?? UNIT_NOUN.facility;
  const area = isState ? { one: "district", many: "districts" } : { one: "block", many: "blocks" };
  // monthLongLabel also spells out weekly period keys ("1–7 March 2026").
  const period = periodRange(kpis.selMonths, monthLongLabel);
  const declared = declaredWindow(csv.reportingPeriods ?? [], kpis.selMonths);
  const weekly = declared?.duration === "WEEKLY";
  const units = Object.entries(kpis.filteredFacilities).map(([key, record]) => ({
    key,
    name: (kpis.analysisMode === "sessionsite" ? record.sessionsite : kpis.analysisMode === "subcenter" ? record.subcenter : record.facility)
      || record.facility
      || "Unknown",
    area: isState ? record.district?.trim() || "Unknown district" : displayBlockLabel(record.block),
  }));
  const areaCount = new Set(units.map((row) => row.area)).size;
  const place = isState ? csv.stateName : `${csv.distName}, ${csv.stateName}`;
  return buildReportModel({
    kicker: `DQA Desk Review · ${isState ? "State" : "District"} report`,
    title: `Data Quality Assessment (DQA) Analysis – U-WIN${isState ? " (State)" : ""}`,
    meta: [
      { label: "State", value: csv.stateName || "—" },
      { label: "Period", value: period },
      isState
        ? { label: "Scope", value: "All districts in the upload" }
        : { label: "District", value: csv.distName || "—" },
      { label: "Coverage", value: `${units.length} ${unit.many} · ${areaCount} ${areaCount === 1 ? area.one : area.many}` },
      ...(declared && weekly ? [{ label: "Dates", value: windowLabel(declared.from, declared.to) }] : []),
    ],
    footer: `U-WIN DQA · ${place} · ${period}`,
    unit,
    area,
    units,
    cards: (kpis.scoreCards ?? kpis.cards).map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.stat.eligible,
      flaggedUnits: card.stat.facilityKeys,
    })),
    groups: UWIN_GROUPS,
    weighted: computeOverallScore(kpis as unknown as ComputedKpis, "UWIN", UWIN_GROUPS).weighted,
    phrases: PHRASES,
    dropoutThreshold: 20,
    uploadedUnits: units.length,
    extraNotes: ["The U-WIN score covers Availability, Accuracy and Consistency; Completeness is not part of it."],
  });
}

export async function downloadUwinDqaReport(csv: UwinParsedCSV, kpis: UwinComputedKpis): Promise<void> {
  const isState = csv.portal === "UWIN_STATE";
  await saveReport(
    buildUwinReportModel(csv, kpis),
    [
      isState ? "DQA-Report-UWIN-State" : "DQA-Report-UWIN",
      csv.stateName,
      isState ? "All-Districts" : csv.distName,
      new Date().toISOString().slice(0, 10),
    ].join("-"),
  );
}

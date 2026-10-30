// ============================================================
// PCTS "Download Report" — the DQA analysis report in the agreed template
// (lib/report/). Units are facilities, grouped by block.
// ============================================================

import { displayBlockLabel, monthLongLabel } from "../dqa/parseUtils";
import { buildReportModel, periodRange, saveReport } from "../report/buildReportModel";
import type { ReportModel } from "../report/dqaReportPdf";
import { DEFAULT_PCTS_FILTERS, type PctsComputed, type PctsParsed } from "./types";

const GROUPS = ["availability", "completeness", "accuracy", "consistency"];

const PHRASES: Record<string, string> = {
  key_indicators_zero: "all key indicators reported as zero",
  repeated_key_profile: "key indicators repeated exactly from the previous month",
  key_indicators_missing: "key indicators missing",
  month_outliers: "month-on-month outliers",
};

/** The report model for the PCTS analysis on screen (exported for checks). */
export function buildPctsReportModel(data: PctsParsed, computed: PctsComputed): ReportModel {
  const period = periodRange(computed.selectedMonths, (key) => data.months[key] ?? monthLongLabel(key));
  const units = computed.selectedFacilityKeys.map((key) => ({
    key,
    name: data.facilities[key]?.facility || key,
    area: displayBlockLabel(data.facilities[key]?.block ?? ""),
  }));
  const blocks = new Set(units.map((row) => row.area)).size;
  return buildReportModel({
    kicker: "DQA Desk Review · District report",
    title: "Data Quality Assessment (DQA) Analysis – PCTS",
    meta: [
      { label: "State", value: data.stateName || "—" },
      { label: "Period", value: period },
      { label: "District", value: data.districtName || "—" },
      { label: "Coverage", value: `${units.length} facilities · ${blocks} block${blocks === 1 ? "" : "s"}` },
    ],
    footer: `PCTS DQA · ${data.districtName}, ${data.stateName} · ${period}`,
    unit: { one: "facility", many: "facilities" },
    area: { one: "block", many: "blocks" },
    units,
    cards: computed.scoreCards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.eligible,
      flaggedUnits: card.affectedFacilities,
    })),
    groups: GROUPS,
    weighted: computed.weighted,
    phrases: PHRASES,
    dropoutThreshold: DEFAULT_PCTS_FILTERS.dropoutThreshold,
    uploadedUnits: Object.keys(data.facilities).length,
  });
}

export async function downloadPctsDqaReport(data: PctsParsed, computed: PctsComputed): Promise<void> {
  await saveReport(
    buildPctsReportModel(data, computed),
    ["DQA-Report-PCTS", data.stateName, data.districtName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

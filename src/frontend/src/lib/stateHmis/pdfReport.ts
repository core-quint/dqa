// ============================================================
// HMIS-State "Download Report" — the DQA analysis report in the agreed
// template (lib/report/). A block-level upload reports blocks grouped by
// district; a district-level upload reports the districts themselves.
// ============================================================

import { monthLongLabel } from "../dqa/parseUtils";
import { buildReportModel, periodRange, saveReport } from "../report/buildReportModel";
import type { ReportModel } from "../report/dqaReportPdf";
import { DEFAULT_STATE_HMIS_FILTERS, type StateHmisComputed, type StateHmisParsed } from "./types";

const GROUPS = ["availability", "completeness", "accuracy", "consistency"];

const PHRASES: Record<string, string> = {
  all_m9_blank: "all M9 indicators blank",
  key_all_zero: "all key indicators reported as zero",
  repeated_profile: "a duplicate monthly record (M9 values repeated from the previous month)",
  key_missing: "key missing indicators",
  held_gt_planned: "more sessions held than planned",
  outliers: "month-on-month outliers",
};

/** The report model for the HMIS-State analysis on screen (exported for checks). */
export function buildStateHmisReportModel(data: StateHmisParsed, computed: StateHmisComputed): ReportModel {
  const blockLevel = data.reportLevel === "block";
  const period = periodRange(computed.selectedMonths, (key) => data.months[key] ?? monthLongLabel(key));
  const units = computed.selectedUnits.map((id) => {
    const record = data.unitData[id];
    const district = record?.district?.trim() || "Unknown district";
    return {
      key: id,
      name: blockLevel ? record?.block?.trim() || "Unknown block" : district,
      area: district,
    };
  });
  const districts = new Set(units.map((row) => row.area)).size;
  const unit = blockLevel ? { one: "block", many: "blocks" } : { one: "district", many: "districts" };
  return buildReportModel({
    kicker: "DQA Desk Review · State report",
    title: "Data Quality Assessment (DQA) Analysis – HMIS (State)",
    meta: [
      { label: "State", value: data.stateName || "—" },
      { label: "Period", value: period },
      { label: "Report", value: blockLevel ? "Block-wise (blocks within districts)" : "District-wise" },
      {
        label: "Coverage",
        value: blockLevel
          ? `${units.length} blocks · ${districts} district${districts === 1 ? "" : "s"}`
          : `${units.length} district${units.length === 1 ? "" : "s"}`,
      },
    ],
    footer: `HMIS State DQA · ${data.stateName} · ${period}`,
    unit,
    area: { one: "district", many: "districts" },
    unitIsArea: !blockLevel,
    units,
    cards: computed.scoreCards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      eligible: card.eligible,
      flaggedUnits: card.affectedUnits,
    })),
    groups: GROUPS,
    weighted: computed.weighted,
    phrases: PHRASES,
    dropoutThreshold: DEFAULT_STATE_HMIS_FILTERS.dropoutThreshold,
    uploadedUnits: Object.keys(data.unitData).length,
  });
}

export async function downloadStateHmisDqaReport(data: StateHmisParsed, computed: StateHmisComputed): Promise<void> {
  await saveReport(
    buildStateHmisReportModel(data, computed),
    ["DQA-Report-HMIS-State", data.stateName, new Date().toISOString().slice(0, 10)].join("-"),
  );
}

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadXLS } from "../dqa/exportUtils";
import type { StateHmisCard, StateHmisComputed, StateHmisParsed } from "./types";

export function stateCardRows(data: StateHmisParsed, card: StateHmisCard, months: string[]) {
  const rows: (string | number | null)[][] = [[
    "District",
    ...(data.reportLevel === "block" ? ["Health Block"] : []),
    ...months,
    "Flagged months",
  ]];
  for (const id of Object.keys(card.hits).sort((a, b) => {
    const left = data.unitData[a]; const right = data.unitData[b];
    return (left?.district ?? a).localeCompare(right?.district ?? b) ||
      (left?.block ?? "").localeCompare(right?.block ?? "");
  })) {
    const unit = data.unitData[id];
    const hitMonths = months.filter((month) => card.hits[id]?.[month]?.flag);
    rows.push([
      unit?.district ?? id,
      ...(data.reportLevel === "block" ? [unit?.block ?? ""] : []),
      ...months.map((month) => card.hits[id]?.[month]?.detail ?? "Not evaluated"),
      hitMonths.length,
    ]);
  }
  return rows;
}

export function downloadStateCard(data: StateHmisParsed, card: StateHmisCard, months: string[]) {
  downloadXLS(stateCardRows(data, card, months), `HMIS State - ${card.name}`);
}

export function downloadStateOverall(data: StateHmisParsed, computed: StateHmisComputed) {
  const rows: (string | number | null)[][] = [[
    "State", "District", ...(data.reportLevel === "block" ? ["Health Block"] : []),
    "DQ issues", "Indicators",
  ]];
  for (const id of computed.selectedUnits) {
    const unit = data.unitData[id];
    rows.push([
      data.stateName,
      unit?.district ?? id,
      ...(data.reportLevel === "block" ? [unit?.block ?? ""] : []),
      computed.issueCountByUnit[id],
      computed.issueNamesByUnit[id].join(", ") || "None",
    ]);
  }
  downloadXLS(rows, `HMIS State Overall - ${data.stateName}`);
}

export function downloadStateHmisPdf(data: StateHmisParsed, computed: StateHmisComputed) {
  const doc = new jsPDF({ orientation: "landscape" });
  const months = computed.selectedMonths;
  const unitLabel = data.reportLevel === "block" ? "blocks" : "districts";
  doc.setFontSize(18);
  doc.text(`HMIS State ${data.reportLevel === "block" ? "Block-wise" : "District-wise"} DQA Report`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${data.stateName} | ${months[0] ?? "-"} to ${months[months.length - 1] ?? "-"} | ${computed.selectedUnits.length} ${unitLabel}`, 14, 23);
  doc.text(`Overall score: ${computed.overallScore.toFixed(1)}`, 14, 29);
  autoTable(doc, {
    startY: 34,
    head: [["Component", "Score", "Worst issue %"]],
    body: Object.values(computed.componentScores).map((component) => [component.group, component.score.toFixed(1), component.worstIssuePct.toFixed(1)]),
  });

  if (data.reportLevel === "block") {
    doc.addPage(); doc.setFontSize(15); doc.text("District roll-up", 14, 16);
    autoTable(doc, {
      startY: 22,
      head: [["District", "Blocks", "Affected blocks", "Issue occurrences", "Indicators"]],
      body: Object.entries(computed.districtRollups).map(([district, rollup]) => [
        district, rollup.unitCount, rollup.affectedUnitCount, rollup.issueCount, rollup.issueNames.join(", ") || "None",
      ]),
      styles: { fontSize: 7 },
    });
  }

  doc.addPage(); doc.setFontSize(15); doc.text(`${data.reportLevel === "block" ? "Health block" : "District"} issue summary`, 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["District", ...(data.reportLevel === "block" ? ["Health Block"] : []), "Issues", "Indicators"]],
    body: computed.selectedUnits.map((id) => {
      const unit = data.unitData[id];
      return [unit?.district ?? id, ...(data.reportLevel === "block" ? [unit?.block ?? ""] : []), computed.issueCountByUnit[id], computed.issueNamesByUnit[id].join(", ") || "None"];
    }),
    styles: { fontSize: 7 },
  });
  doc.save(`HMIS_State_DQA_${data.stateName.replace(/\W+/g, "_")}.pdf`);
}

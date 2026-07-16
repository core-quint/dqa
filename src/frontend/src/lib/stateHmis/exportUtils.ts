import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadXLS } from "../dqa/exportUtils";
import type { StateHmisCard, StateHmisComputed, StateHmisParsed } from "./types";

export function stateCardRows(card: StateHmisCard, months: string[]) {
  const rows: (string | number | null)[][] = [["District", ...months, "Flagged months"]];
  for (const district of Object.keys(card.hits).sort()) {
    const hitMonths = months.filter((month) => card.hits[district]?.[month]?.flag);
    rows.push([district, ...months.map((month) => card.hits[district]?.[month]?.detail ?? "Not evaluated"), hitMonths.length]);
  }
  return rows;
}

export function downloadStateCard(card: StateHmisCard, months: string[]) {
  downloadXLS(stateCardRows(card, months), `HMIS State - ${card.name}`);
}

export function downloadStateOverall(data: StateHmisParsed, computed: StateHmisComputed) {
  const rows: (string | number | null)[][] = [["State", "District", "DQ issues", "Indicators"]];
  for (const district of computed.selectedDistricts) rows.push([data.stateName, district, computed.issueCountByDistrict[district], computed.issueNamesByDistrict[district].join(", ") || "None"]);
  downloadXLS(rows, `HMIS State Overall - ${data.stateName}`);
}

export function downloadStateHmisPdf(data: StateHmisParsed, computed: StateHmisComputed) {
  const doc = new jsPDF({ orientation: "landscape" });
  const months = computed.selectedMonths;
  doc.setFontSize(18); doc.text("HMIS State District-wise DQA Report", 14, 16);
  doc.setFontSize(10); doc.text(`${data.stateName} | ${months[0] ?? "-"} to ${months[months.length - 1] ?? "-"} | ${computed.selectedDistricts.length} districts`, 14, 23);
  doc.text(`Overall score: ${computed.overallScore.toFixed(1)}`, 14, 29);
  autoTable(doc, {
    startY: 34,
    head: [["Component", "Score", "Worst issue %"]],
    body: Object.values(computed.componentScores).map((component) => [component.group, component.score.toFixed(1), component.worstIssuePct.toFixed(1)]),
  });
  doc.addPage(); doc.setFontSize(15); doc.text("District issue summary", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["District", "Issues", "Indicators"]],
    body: computed.selectedDistricts.map((district) => [district, computed.issueCountByDistrict[district], computed.issueNamesByDistrict[district].join(", ") || "None"]),
    styles: { fontSize: 7 },
  });
  doc.save(`HMIS_State_DQA_${data.stateName.replace(/\W+/g, "_")}.pdf`);
}

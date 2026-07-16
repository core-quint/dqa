import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { downloadXLS } from "../dqa/exportUtils";
import type { PctsCard, PctsComputed, PctsParsed } from "./types";

type ExportRow = (string | number | null)[];

export function pctsCardRows(
  data: PctsParsed,
  card: PctsCard,
  months: string[],
  facilityKeys: string[] = card.affectedFacilities,
): ExportRow[] {
  const rows: ExportRow[] = [[
    "Block / group",
    "Facility",
    "Facility type",
    "Rural / Urban",
    "Ownership",
    ...months,
    "Flagged months",
  ]];

  const visibleFacilityKeys = new Set(facilityKeys);
  const affectedFacilities = card.affectedFacilities
    .filter((facilityKey) => visibleFacilityKeys.has(facilityKey))
    .sort((left, right) => {
      const a = data.facilities[left];
      const b = data.facilities[right];
      return (a?.block ?? "").localeCompare(b?.block ?? "")
        || (a?.facility ?? "").localeCompare(b?.facility ?? "");
    });

  for (const facilityKey of affectedFacilities) {
    const facility = data.facilities[facilityKey];
    if (!facility) continue;
    const flaggedMonths = months.filter((month) => card.hits[facilityKey]?.[month]?.flag);
    rows.push([
      facility.block,
      facility.facility,
      facility.facilityType,
      facility.ruralUrban,
      facility.ownership,
      ...months.map((month) => card.hits[facilityKey]?.[month]?.detail ?? "Not evaluated"),
      flaggedMonths.length,
    ]);
  }
  return rows;
}

export function downloadPctsCard(
  data: PctsParsed,
  card: PctsCard,
  months: string[],
  facilityKeys?: string[],
) {
  downloadXLS(pctsCardRows(data, card, months, facilityKeys), `PCTS - ${card.name}`);
}

export function pctsOverallRows(data: PctsParsed, computed: PctsComputed): ExportRow[] {
  const rows: ExportRow[] = [[
    "State",
    "District",
    "Block / group",
    "Facility",
    "Facility type",
    "Rural / Urban",
    "Ownership",
    "No. of Data Quality Issues identified",
    "Indicators identified",
  ]];
  const facilities = [...computed.visibleFacilityKeys].sort((left, right) => {
    const a = data.facilities[left];
    const b = data.facilities[right];
    return (
      (computed.issueCountByFacility[right] ?? 0) -
        (computed.issueCountByFacility[left] ?? 0) ||
      (a?.block ?? "").localeCompare(b?.block ?? "") ||
      (a?.facility ?? "").localeCompare(b?.facility ?? "")
    );
  });
  for (const facilityKey of facilities) {
    const facility = data.facilities[facilityKey];
    if (!facility) continue;
    rows.push([
      data.stateName,
      data.districtName,
      facility.block,
      facility.facility,
      facility.facilityType,
      facility.ruralUrban,
      facility.ownership,
      computed.issueCountByFacility[facilityKey] ?? 0,
      computed.issueNamesByFacility[facilityKey]?.join(", ") || "None",
    ]);
  }
  return rows;
}

export function downloadPctsOverall(data: PctsParsed, computed: PctsComputed) {
  downloadXLS(
    pctsOverallRows(data, computed),
    `PCTS Overall - ${data.districtName}`,
  );
}

export function downloadPctsPdf(data: PctsParsed, computed: PctsComputed) {
  const doc = new jsPDF({ orientation: "landscape" });
  const months = computed.selectedMonths;
  const visibleFacilityKeys = computed.visibleFacilityKeys;
  const safeDistrict = data.districtName.replace(/\W+/g, "_");

  doc.setFontSize(18);
  doc.text("PCTS Facility-wise Data Quality Assessment", 14, 16);
  doc.setFontSize(10);
  doc.text(
    `${data.stateName} | ${data.districtName} | ${months[0] ?? "-"} to ${months[months.length - 1] ?? "-"} | ${visibleFacilityKeys.length} displayed of ${computed.denominator} selected facilities`,
    14,
    23,
  );
  doc.text(`Overall score: ${computed.overallScore.toFixed(1)}`, 14, 29);

  autoTable(doc, {
    startY: 34,
    head: [["Component", "Score", "Worst issue %"]],
    body: Object.values(computed.componentScores).map((component) => [
      component.group,
      component.score.toFixed(1),
      component.worstIssuePct.toFixed(1),
    ]),
  });

  doc.addPage();
  doc.setFontSize(15);
  doc.text("Facility issue summary", 14, 16);
  autoTable(doc, {
    startY: 22,
    head: [["Block / group", "Facility", "Type", "Issues", "Indicators"]],
    body: visibleFacilityKeys
      .map((facilityKey) => {
        const facility = data.facilities[facilityKey];
        return [
          facility?.block ?? "",
          facility?.facility ?? facilityKey,
          facility?.facilityType ?? "",
          computed.issueCountByFacility[facilityKey] ?? 0,
          computed.issueNamesByFacility[facilityKey]?.join(", ") || "None",
        ];
      })
      .sort((a, b) => Number(b[3]) - Number(a[3])),
    styles: { fontSize: 7 },
  });

  for (const card of computed.cards.filter((candidate) => candidate.total > 0)) {
    const rows = pctsCardRows(data, card, months, visibleFacilityKeys);
    if (rows.length <= 1) continue;
    doc.addPage();
    doc.setFontSize(14);
    doc.text(card.name, 14, 16);
    doc.setFontSize(9);
    doc.text(card.description, 14, 22, { maxWidth: 260 });
    autoTable(doc, {
      startY: 29,
      head: [rows[0].map((value) => String(value ?? ""))],
      body: rows.slice(1).map((row) => row.map((value) => String(value ?? ""))),
      styles: { fontSize: 6 },
    });
  }

  doc.save(`PCTS_DQA_${safeDistrict}.pdf`);
}

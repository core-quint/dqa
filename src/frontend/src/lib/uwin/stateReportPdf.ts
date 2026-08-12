import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { UwinStateReportRecord } from "./stateReports";

type RGB = [number, number, number];
const C = {
  navy: [15, 23, 42] as RGB,
  blue: [29, 78, 216] as RGB,
  paleBlue: [239, 246, 255] as RGB,
  green: [21, 128, 61] as RGB,
  amber: [180, 83, 9] as RGB,
  red: [185, 28, 28] as RGB,
  slate: [71, 85, 105] as RGB,
  light: [248, 250, 252] as RGB,
  border: [226, 232, 240] as RGB,
  white: [255, 255, 255] as RGB,
};
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 38;
const WIDTH = PAGE_W - MARGIN * 2;

function safe(value: unknown): string {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[^ -~]/g, "?");
}

function scoreColor(score: number): RGB {
  if (score >= 80) return C.green;
  if (score >= 60) return C.blue;
  if (score >= 40) return C.amber;
  return C.red;
}

function analysisUnitPlural(mode: UwinStateReportRecord["analysisMode"]): string {
  if (mode === "sessionsite") return "session sites";
  if (mode === "subcenter") return "sub centers";
  return "facilities";
}

function addPageFrame(doc: jsPDF, report: UwinStateReportRecord, page: number) {
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, PAGE_W, 34, "F");
  doc.setTextColor(...C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("U-WIN STATE DATA QUALITY ASSESSMENT", MARGIN, 21);
  doc.setFont("helvetica", "normal");
  doc.text(`${safe(report.reportNumber)} | Page ${page} of 3`, PAGE_W - MARGIN, 21, { align: "right" });

  doc.setDrawColor(...C.border);
  doc.line(MARGIN, PAGE_H - 25, PAGE_W - MARGIN, PAGE_H - 25);
  doc.setTextColor(...C.slate);
  doc.setFontSize(6.5);
  doc.text(`Generated from saved DQA evidence | Rules: ${safe(report.factPack?.rulesVersion)}`, MARGIN, PAGE_H - 12);
  doc.text("DQA findings require validation and do not measure immunization coverage.", PAGE_W - MARGIN, PAGE_H - 12, { align: "right" });
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setTextColor(...C.navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(safe(title), MARGIN, y);
  doc.setDrawColor(...C.blue);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y + 5, MARGIN + 34, y + 5);
}

function wrapped(doc: jsPDF, value: string, x: number, y: number, width: number, size = 8, color: RGB = C.slate) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(...color);
  const lines = doc.splitTextToSize(safe(value), width) as string[];
  doc.text(lines, x, y, { lineHeightFactor: 1.35 });
  return y + lines.length * size * 1.35;
}

export function generateUwinStateExecutivePdf(report: UwinStateReportRecord) {
  const facts = report.factPack;
  if (!facts) throw new Error("The saved report has no evidence pack");
  const analysisUnits = analysisUnitPlural(facts.scope.analysisMode);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

  // Page 1 — executive status.
  addPageFrame(doc, report, 1);
  doc.setTextColor(...C.navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.text("State DQA Executive Report", MARGIN, 70);
  doc.setFontSize(10);
  doc.setTextColor(...C.slate);
  doc.text(`${safe(report.state)} | ${safe(report.periodStart)} to ${safe(report.periodEnd)} | Version ${report.version}`, MARGIN, 90);

  const scoreItems = [
    ["Overall", facts.scores.overall],
    ["Availability", facts.scores.availability],
    ["Accuracy", facts.scores.accuracy],
    ["Consistency", facts.scores.consistency],
  ] as const;
  scoreItems.forEach(([label, score], index) => {
    const width = (WIDTH - 24) / 4;
    const x = MARGIN + index * (width + 8);
    doc.setFillColor(...C.light);
    doc.roundedRect(x, 112, width, 70, 5, 5, "F");
    doc.setTextColor(...scoreColor(score));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.text(`${score.toFixed(1)}%`, x + width / 2, 145, { align: "center" });
    doc.setTextColor(...C.slate);
    doc.setFontSize(7);
    doc.text(label.toUpperCase(), x + width / 2, 165, { align: "center" });
  });

  sectionTitle(doc, "Executive assessment", 216);
  const urgent = facts.districtDistribution.CRITICAL + facts.districtDistribution.HIGH;
  let y = wrapped(
    doc,
    `The statewide DQA score is ${facts.scores.overall.toFixed(1)}% (${facts.scores.status.replace(/_/g, " ")}). ` +
      `${urgent} of ${facts.scope.districtCount} analysed districts are in critical or high-priority bands and should receive focused data validation follow-up. ` +
      `The assessment covers ${facts.scope.analysedUnits.toLocaleString("en-IN")} ${analysisUnits} across ${facts.scope.blockCount.toLocaleString("en-IN")} blocks.`,
    MARGIN, 238, WIDTH, 9, C.navy,
  );
  if (report.aiNarrative?.validated && report.aiNarrative.executiveSummary[0]) {
    doc.setTextColor(...C.blue);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("AI-ASSISTED EDITORIAL NOTE", MARGIN, y + 12);
    y = wrapped(doc, report.aiNarrative.executiveSummary[0].statement, MARGIN, y + 25, WIDTH, 7.5, C.slate);
  }

  sectionTitle(doc, "District priority distribution", y + 24);
  y += 45;
  const distribution = [
    ["Critical (<40)", facts.districtDistribution.CRITICAL, C.red],
    ["High (40-59.9)", facts.districtDistribution.HIGH, C.amber],
    ["Moderate (60-79.9)", facts.districtDistribution.MODERATE, C.blue],
    ["Routine (>=80)", facts.districtDistribution.ROUTINE, C.green],
  ] as const;
  distribution.forEach(([label, count, color], index) => {
    const boxW = (WIDTH - 18) / 4;
    const x = MARGIN + index * (boxW + 6);
    doc.setFillColor(...color);
    doc.roundedRect(x, y, boxW, 45, 4, 4, "F");
    doc.setTextColor(...C.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(String(count), x + boxW / 2, y + 20, { align: "center" });
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), x + boxW / 2, y + 35, { align: "center" });
  });

  sectionTitle(doc, "Key findings requiring attention", y + 82);
  y += 105;
  facts.findings.slice(0, 5).forEach((finding, index) => {
    doc.setFillColor(...(index % 2 === 0 ? C.light : C.white));
    doc.roundedRect(MARGIN, y - 11, WIDTH, 39, 3, 3, "F");
    doc.setTextColor(...scoreColor(100 - finding.affectedPercent));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`${index + 1}. ${safe(finding.title)}`, MARGIN + 8, y + 2);
    doc.setTextColor(...C.slate);
    doc.setFont("helvetica", "normal");
    doc.text(`${finding.affectedUnits.toLocaleString("en-IN")} of ${finding.denominator.toLocaleString("en-IN")} ${analysisUnits} (${finding.affectedPercent.toFixed(1)}%) | ${finding.evidenceId}`, PAGE_W - MARGIN - 8, y + 2, { align: "right" });
    y += 41;
  });

  // Page 2 — district priorities and evidence.
  doc.addPage();
  addPageFrame(doc, report, 2);
  sectionTitle(doc, "District priorities", 64);
  wrapped(doc, "Priority is determined from district DQA scores using the fixed report rules. A priority band is not a judgement of immunization programme performance.", MARGIN, 84, WIDTH, 8);
  autoTable(doc, {
    startY: 112,
    margin: { left: MARGIN, right: MARGIN },
    head: [["District", "Overall", "Availability", "Accuracy", "Consistency", "Priority", "Main evidence"]],
    body: facts.districts.slice(0, 18).map((district) => [
      safe(district.district),
      `${district.scores.overall.toFixed(1)}%`,
      `${district.scores.availability.toFixed(1)}%`,
      `${district.scores.accuracy.toFixed(1)}%`,
      `${district.scores.consistency.toFixed(1)}%`,
      district.priority,
      district.mainFindingEvidenceId ?? "No flag",
    ]),
    theme: "grid",
    tableWidth: WIDTH,
    styles: { font: "helvetica", fontSize: 6.7, cellPadding: 4, textColor: C.navy },
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C.light },
    columnStyles: {
      0: { cellWidth: 110 }, 1: { cellWidth: 50 }, 2: { cellWidth: 65 },
      3: { cellWidth: 55 }, 4: { cellWidth: 65 }, 5: { cellWidth: 70 }, 6: { cellWidth: 104 },
    },
  });
  sectionTitle(doc, "Statewide evidence summary", 540);
  autoTable(doc, {
    startY: 558,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Evidence", "DQA finding", "Area", `Affected ${analysisUnits}`, "Severity"]],
    body: facts.findings.slice(0, 7).map((finding) => [
      finding.evidenceId,
      safe(finding.title),
      finding.group.toUpperCase(),
      `${finding.affectedUnits.toLocaleString("en-IN")} (${finding.affectedPercent.toFixed(1)}%)`,
      finding.severity,
    ]),
    theme: "grid",
    tableWidth: WIDTH,
    styles: { font: "helvetica", fontSize: 6.6, cellPadding: 3.5, textColor: C.navy },
    headStyles: { fillColor: C.blue, textColor: C.white, fontStyle: "bold" },
    alternateRowStyles: { fillColor: C.paleBlue },
  });

  // Page 3 — action plan and governance.
  doc.addPage();
  addPageFrame(doc, report, 3);
  sectionTitle(doc, "Recommended action and follow-up plan", 64);
  wrapped(doc, "Actions are selected from the configured action library. State and district teams should use these recommendations to assign local ownership and practical timelines.", MARGIN, 84, WIDTH, 8);
  const actionById = new Map(facts.actionRules.map((action) => [action.id, action]));
  autoTable(doc, {
    startY: 112,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Priority evidence", "Action", "Owner", "Timeline", "Verification"]],
    body: facts.findings.slice(0, 6).map((finding) => {
      const action = actionById.get(finding.actionRuleId);
      return [
        `${finding.evidenceId}\n${safe(finding.title)}`,
        safe(action?.action),
        safe(action?.responsibleLevel.replace(/_/g, "/")),
        action ? `${action.timelineDays} days` : "To agree",
        safe(action?.verification),
      ];
    }),
    theme: "grid",
    styles: { font: "helvetica", fontSize: 6.2, cellPadding: 4, textColor: C.navy, valign: "top" },
    headStyles: { fillColor: C.navy, textColor: C.white, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 82 }, 1: { cellWidth: 154 }, 2: { cellWidth: 58 }, 3: { cellWidth: 50 }, 4: { cellWidth: 175 } },
  });

  sectionTitle(doc, "Positive findings", 490);
  y = 512;
  facts.positiveFindings.forEach((finding) => {
    y = wrapped(doc, `• ${finding}`, MARGIN + 4, y, WIDTH - 8, 7.5, C.navy) + 5;
  });
  sectionTitle(doc, "Interpretation and limitations", y + 14);
  y += 35;
  facts.limitations.forEach((limitation) => {
    y = wrapped(doc, `• ${limitation}`, MARGIN + 4, y, WIDTH - 8, 7, C.slate) + 4;
  });
  doc.setFillColor(...C.light);
  doc.roundedRect(MARGIN, 730, WIDTH, 58, 4, 4, "F");
  doc.setTextColor(...C.navy);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("REPORT CONTROL", MARGIN + 10, 746);
  doc.setFont("helvetica", "normal");
  doc.text(`Status: SAVED | Version: ${report.version} | Fingerprint: ${report.analysisFingerprint.slice(0, 16)}...`, MARGIN + 10, 762);
  doc.text(`Created: ${safe(report.createdAt ? new Date(report.createdAt).toLocaleString("en-IN") : "Pending")} | Created by: ${safe(report.createdBy?.email)} | Narrative: ${report.aiNarrative?.validated ? "AI-assisted, validated" : "Deterministic"}`, MARGIN + 10, 777);

  return {
    blob: doc.output("blob"),
    fileName: `${safe(report.reportNumber).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`,
  };
}

export function downloadUwinStateDistrictAnnex(report: UwinStateReportRecord) {
  const facts = report.factPack;
  if (!facts) throw new Error("The saved report has no evidence pack");
  const analysedUnitsColumn = `Analysed ${analysisUnitPlural(facts.scope.analysisMode)}`;
  const rows = facts.districts.map((district) => ({
    District: district.district,
    [analysedUnitsColumn]: district.analysedUnits,
    "Overall score": district.scores.overall,
    "Availability score": district.scores.availability,
    "Accuracy score": district.scores.accuracy,
    "Consistency score": district.scores.consistency,
    Status: district.status,
    Priority: district.priority,
    "Main evidence": district.mainFindingEvidenceId ?? "",
    "Affected indicator count": district.affectedIndicatorCount,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "District priorities");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(facts.findings), "Evidence summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(facts.actionRules), "Action library");
  XLSX.writeFile(workbook, `${report.reportNumber}-district-annex.xlsx`);
}

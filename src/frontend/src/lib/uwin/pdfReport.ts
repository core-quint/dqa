import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { UwinParsedCSV, UwinComputedKpis } from "./types";
import type { ComputedKpis } from "../dqa/types";
import { computeOverallScore, scoreGrade } from "../dqa/scoreUtils";
import { generateBlockMapDataUrl, buildLegendItems } from "../maps/blockMapUtils";

// ─── Page geometry ────────────────────────────────────────────────────────────
const PW = 595.28;
const PH = 841.89;
const ML = 42;
const MR = 42;
const CW = PW - ML - MR; // 511.28

// ─── Light palette ────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const P = {
  blue:        [37, 99, 235]   as RGB,
  blueSoft:    [219, 234, 254] as RGB,
  blueXSoft:   [239, 246, 255] as RGB,
  white:       [255, 255, 255] as RGB,
  ink:         [15, 23, 42]    as RGB,
  ink700:      [51, 65, 85]    as RGB,
  ink500:      [100, 116, 139] as RGB,
  ink400:      [148, 163, 184] as RGB,
  bg50:        [248, 250, 252] as RGB,
  bg100:       [241, 245, 249] as RGB,
  border:      [226, 232, 240] as RGB,
  border300:   [203, 213, 225] as RGB,

  // Availability — blue (U-WIN uses blue for avail, not red)
  avail:       [29, 78, 216]   as RGB,
  availMid:    [37, 99, 235]   as RGB,
  availSoft:   [191, 219, 254] as RGB,
  availXSoft:  [239, 246, 255] as RGB,

  // Accuracy — amber
  accur:       [146, 64, 14]   as RGB,
  accurMid:    [217, 119, 6]   as RGB,
  accurSoft:   [254, 243, 199] as RGB,
  accurXSoft:  [255, 251, 235] as RGB,

  // Consistency — green
  consist:     [21, 128, 61]   as RGB,
  consistMid:  [22, 163, 74]   as RGB,
  consistSoft: [220, 252, 231] as RGB,
  consistXSoft:[240, 253, 244] as RGB,

  // Severity
  good:        [22, 163, 74]   as RGB,
  goodSoft:    [220, 252, 231] as RGB,
  warn:        [161, 82, 3]    as RGB,
  warnSoft:    [254, 243, 199] as RGB,
  danger:      [185, 28, 28]   as RGB,
  dangerSoft:  [254, 226, 226] as RGB,
};

const UWIN_GROUPS = ["availability", "accuracy", "consistency"];

const GROUP_COLOR: Record<string, RGB> = {
  availability: P.availMid,
  accuracy:     P.accurMid,
  consistency:  P.consistMid,
};
const GROUP_DARK: Record<string, RGB> = {
  availability: P.avail,
  accuracy:     P.accur,
  consistency:  P.consist,
};
const GROUP_SOFT: Record<string, RGB> = {
  availability: P.availSoft,
  accuracy:     P.accurSoft,
  consistency:  P.consistSoft,
};
const GROUP_XSOFT: Record<string, RGB> = {
  availability: P.availXSoft,
  accuracy:     P.accurXSoft,
  consistency:  P.consistXSoft,
};
const GROUP_LABEL: Record<string, string> = {
  availability: "Availability",
  accuracy:     "Accuracy",
  consistency:  "Consistency",
};
const GROUP_DESC: Record<string, string> = {
  availability: "Measures whether session sites submitted data for each reporting period and whether all indicators were filled.",
  accuracy:     "Identifies session sites with statistical outliers, consecutive identical values, or abnormal beneficiary-per-session averages.",
  consistency:  "Checks internal logical relationships between indicators and co-administration ratios.",
};

function sanitize(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/—/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[^\x00-\x7E]/g, "?");
}

function scoreRGB(s: number): RGB {
  if (s >= 70) return P.good;
  if (s >= 40) return P.warn;
  return P.danger;
}
function scoreSoftRGB(s: number): RGB {
  if (s >= 70) return P.goodSoft;
  if (s >= 40) return P.warnSoft;
  return P.dangerSoft;
}
function scoreLabel(s: number) {
  if (s >= 80) return "Good";
  if (s >= 60) return "Satisfactory";
  if (s >= 40) return "Needs Improvement";
  return "Poor";
}

function fill(doc: jsPDF, c: RGB) { doc.setFillColor(c[0], c[1], c[2]); }
function stroke(doc: jsPDF, c: RGB) { doc.setDrawColor(c[0], c[1], c[2]); }
function textC(doc: jsPDF, c: RGB) { doc.setTextColor(c[0], c[1], c[2]); }
function font(doc: jsPDF, style: "normal" | "bold", size: number) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
}
function hRule(doc: jsPDF, y: number) {
  stroke(doc, P.border);
  doc.setLineWidth(0.4);
  doc.line(ML, y, ML + CW, y);
}

// ─── Light header / footer ────────────────────────────────────────────────────
function addHeaderFooter(
  doc: jsPDF, pageNo: number, totalPages: number,
  reportTitle: string, genDate: string,
) {
  fill(doc, P.bg100);
  doc.rect(0, 0, PW, 22, "F");
  fill(doc, P.blue);
  doc.rect(0, 0, 4, 22, "F");

  textC(doc, P.ink500);
  font(doc, "bold", 7);
  doc.text("DQA DESK REVIEW", ML, 14);
  font(doc, "normal", 7);
  doc.text(reportTitle, PW / 2, 14, { align: "center" });
  doc.text(`Page ${pageNo} / ${totalPages}`, PW - MR, 14, { align: "right" });

  fill(doc, P.bg50);
  doc.rect(0, PH - 18, PW, 18, "F");
  stroke(doc, P.border);
  doc.setLineWidth(0.3);
  doc.line(0, PH - 18, PW, PH - 18);
  textC(doc, P.ink400);
  font(doc, "normal", 6);
  doc.text("CONFIDENTIAL — Generated by DQA Desk Review System", ML, PH - 6);
  doc.text(genDate, PW - MR, PH - 6, { align: "right" });
}

// ─── Cover page ───────────────────────────────────────────────────────────────
function buildCover(
  doc: jsPDF,
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  period: string,
  genDate: string,
  totalFac: number,
  scoreResult: ReturnType<typeof computeOverallScore>,
) {
  fill(doc, P.white);
  doc.rect(0, 0, PW, PH, "F");

  fill(doc, P.blue);
  doc.rect(0, 0, PW, 88, "F");
  fill(doc, [20, 68, 180] as RGB);
  doc.rect(0, 84, PW, 4, "F");

  textC(doc, P.blueSoft);
  font(doc, "normal", 7.5);
  doc.text("GOVERNMENT DATA QUALITY ASSESSMENT", ML, 26, { charSpace: 1 });

  textC(doc, P.white);
  font(doc, "bold", 26);
  doc.text("DQA Desk Review", ML, 60);
  font(doc, "normal", 12);
  doc.text("Comprehensive Data Quality Report", ML, 78);

  fill(doc, P.white);
  doc.roundedRect(ML, 76, 60, 22, 4, 4, "F");
  stroke(doc, P.blueSoft);
  doc.setLineWidth(1);
  doc.roundedRect(ML, 76, 60, 22, 4, 4, "S");
  textC(doc, P.blue);
  font(doc, "bold", 9.5);
  doc.text("U-WIN", ML + 30, 90, { align: "center" });

  // Geography card
  fill(doc, P.white);
  doc.roundedRect(ML, 116, CW, 96, 6, 6, "F");
  stroke(doc, P.border);
  doc.setLineWidth(0.5);
  doc.roundedRect(ML, 116, CW, 96, 6, 6, "S");
  fill(doc, P.blue);
  doc.roundedRect(ML, 116, 4, 96, 2, 2, "F");

  const infoLeft = ML + 18;
  let iy = 140;
  const ROW = 22;
  const infoRows: [string, string][] = [
    ["State",    csv.stateName || "—"],
    ["District", csv.distName  || "—"],
    ["Period",   period],
    ["File",     csv.fileName  || "—"],
  ];
  for (const [lbl, val] of infoRows) {
    textC(doc, P.ink500);
    font(doc, "normal", 8);
    doc.text(lbl, infoLeft, iy);
    textC(doc, P.ink);
    font(doc, "bold", 8);
    const truncVal = val.length > 55 ? val.slice(0, 52) + "…" : val;
    doc.text(truncVal, infoLeft + 66, iy);
    iy += ROW;
  }

  // Stats row
  const stats = [
    { n: String(totalFac),               lbl: "Session Sites", color: P.blue },
    { n: String(csv.globalBlockCount),   lbl: "Blocks",        color: P.blue },
    { n: String(kpis.selMonths.length),  lbl: "Months",        color: P.blue },
    { n: `${scoreResult.overall.toFixed(1)}%`, lbl: "Overall Score", color: scoreRGB(scoreResult.overall) },
  ];
  const statW = CW / stats.length;
  const statY = 228;

  fill(doc, P.bg50);
  doc.roundedRect(ML, statY, CW, 60, 6, 6, "F");
  stroke(doc, P.border);
  doc.setLineWidth(0.4);
  doc.roundedRect(ML, statY, CW, 60, 6, 6, "S");
  stats.forEach((s, i) => {
    const sx = ML + i * statW;
    if (i > 0) {
      stroke(doc, P.border);
      doc.setLineWidth(0.4);
      doc.line(sx, statY + 8, sx, statY + 52);
    }
    textC(doc, s.color);
    font(doc, "bold", 19);
    doc.text(s.n, sx + statW / 2, statY + 34, { align: "center" });
    textC(doc, P.ink500);
    font(doc, "normal", 7);
    doc.text(s.lbl, sx + statW / 2, statY + 48, { align: "center" });
  });

  // Component score circles
  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text("COMPONENT SCORES", ML, 316, { charSpace: 0.8 });
  stroke(doc, P.border);
  doc.setLineWidth(0.4);
  doc.line(ML, 322, ML + CW, 322);

  const colW = CW / UWIN_GROUPS.length;
  UWIN_GROUPS.forEach((g, i) => {
    const comp = scoreResult.components[g];
    if (!comp) return;
    const cx = ML + i * colW + colW / 2;
    const cy = 374;
    const r = 32;
    const color = scoreRGB(comp.score);
    const soft  = scoreSoftRGB(comp.score);
    fill(doc, soft);
    doc.circle(cx, cy, r, "F");
    stroke(doc, color);
    doc.setLineWidth(1.5);
    doc.circle(cx, cy, r, "S");
    textC(doc, color);
    font(doc, "bold", 13);
    doc.text(`${comp.score.toFixed(0)}%`, cx, cy + 4, { align: "center" });
    textC(doc, P.ink700);
    font(doc, "bold", 7);
    doc.text(GROUP_LABEL[g], cx, cy + r + 12, { align: "center" });
    textC(doc, color);
    font(doc, "normal", 6.5);
    doc.text(scoreLabel(comp.score), cx, cy + r + 21, { align: "center" });
  });

  const grade = scoreGrade(scoreResult.overall);
  fill(doc, scoreSoftRGB(scoreResult.overall));
  doc.roundedRect(PW - MR - 58, 336, 58, 36, 6, 6, "F");
  stroke(doc, scoreRGB(scoreResult.overall));
  doc.setLineWidth(1.2);
  doc.roundedRect(PW - MR - 58, 336, 58, 36, 6, 6, "S");
  textC(doc, scoreRGB(scoreResult.overall));
  font(doc, "normal", 7);
  doc.text("DQ GRADE", PW - MR - 29, 348, { align: "center" });
  font(doc, "bold", 18);
  doc.text(grade, PW - MR - 29, 364, { align: "center" });

  textC(doc, P.ink400);
  font(doc, "normal", 6.5);
  doc.text(`Generated on ${genDate}`, ML, PH - 22);
  doc.text("This report is system-generated. Please verify data before use.", PW / 2, PH - 22, { align: "center" });
}

// ─── Executive summary ────────────────────────────────────────────────────────
function buildSummary(
  doc: jsPDF,
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  period: string,
  totalFac: number,
  scoreResult: ReturnType<typeof computeOverallScore>,
) {
  let y = 30;

  fill(doc, P.blueXSoft);
  doc.roundedRect(ML, y, CW, 36, 4, 4, "F");
  fill(doc, P.blue);
  doc.rect(ML, y, 5, 36, "F");
  textC(doc, P.blue);
  font(doc, "bold", 13);
  doc.text("Executive Summary", ML + 14, y + 23);
  y += 46;

  const CX = ML + 52, CY = y + 52;
  const R = 42;
  const sc = scoreResult.overall;
  fill(doc, scoreSoftRGB(sc));
  doc.circle(CX, CY, R, "F");
  stroke(doc, scoreRGB(sc));
  doc.setLineWidth(2);
  doc.circle(CX, CY, R, "S");
  textC(doc, scoreRGB(sc));
  font(doc, "bold", 21);
  doc.text(`${sc.toFixed(1)}%`, CX, CY + 5, { align: "center" });
  textC(doc, P.ink500);
  font(doc, "normal", 6.5);
  doc.text("OVERALL SCORE", CX, CY + 17, { align: "center" });
  fill(doc, scoreRGB(sc));
  doc.roundedRect(CX - 18, CY + 26, 36, 16, 4, 4, "F");
  textC(doc, P.white);
  font(doc, "bold", 8.5);
  doc.text(`Grade ${scoreGrade(sc)}`, CX, CY + 37, { align: "center" });

  const tblX = ML + 116;
  const tblW = CW - 116;
  autoTable(doc, {
    startY: y,
    margin: { left: tblX, right: MR },
    tableWidth: tblW,
    head: [["Component", "Score", "Grade", "Status", "Max Flag%"]],
    body: UWIN_GROUPS.map(g => {
      const comp = scoreResult.components[g];
      if (!comp) return [GROUP_LABEL[g], "—", "—", "—", "—"];
      return [GROUP_LABEL[g], `${comp.score.toFixed(1)}%`, scoreGrade(comp.score), scoreLabel(comp.score), `${comp.maxTot.toFixed(1)}%`];
    }),
    styles: { fontSize: 8, cellPadding: 4.5, font: "helvetica" },
    headStyles: { fillColor: P.bg100, textColor: P.ink700, fontStyle: "bold", fontSize: 7.5, lineColor: P.border, lineWidth: 0.4 },
    alternateRowStyles: { fillColor: P.bg50 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 80 },
      1: { halign: "center", cellWidth: 48 },
      2: { halign: "center", cellWidth: 34 },
      3: { cellWidth: 84 },
      4: { halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body") {
        const g = UWIN_GROUPS[data.row.index];
        const comp = scoreResult.components[g ?? ""];
        if (!comp) return;
        if (data.column.index === 0) {
          const dc = GROUP_DARK[g ?? ""];
          if (dc) data.cell.styles.textColor = dc;
        }
        if (data.column.index === 2) {
          data.cell.styles.textColor = scoreRGB(comp.score);
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text("KEY STATISTICS", ML, y, { charSpace: 0.8 });
  y += 6;
  hRule(doc, y);
  y += 10;

  const statRows = [
    ["State",                         csv.stateName || "—"],
    ["District",                      csv.distName  || "—"],
    ["Analysis Period",                period],
    ["Months Analyzed",                String(kpis.selMonths.length)],
    ["Total Session Sites (CSV)",      String(csv.globalFacilityCount)],
    ["Session Sites in Analysis",      String(totalFac)],
    ["Blocks",                         String(csv.globalBlockCount)],
    ["Public / Private",               `${csv.publicCount} / ${csv.privateCount}`],
    ["Rural / Urban",                  `${csv.ruralCount} / ${csv.urbanCount}`],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    tableWidth: CW,
    body: statRows,
    styles: { fontSize: 8, cellPadding: 4, font: "helvetica" },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: P.bg100, cellWidth: 160, textColor: P.ink700 },
      1: { textColor: P.ink },
    },
    showHead: false,
    alternateRowStyles: {},
  });

  y = (doc as any).lastAutoTable.finalY + 16;

  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text("KEY FINDINGS", ML, y, { charSpace: 0.8 });
  y += 6;
  hRule(doc, y);
  y += 12;

  for (const g of UWIN_GROUPS) {
    const comp = scoreResult.components[g];
    if (!comp || comp.topKpis.length === 0) continue;
    const color = GROUP_COLOR[g];
    if (!color) continue;
    fill(doc, color);
    doc.circle(ML + 4, y, 3, "F");
    textC(doc, GROUP_DARK[g] ?? color);
    font(doc, "bold", 8);
    doc.text(`${GROUP_LABEL[g]}:`, ML + 10, y + 2.5);
    const worst = comp.topKpis[0];
    textC(doc, P.ink700);
    font(doc, "normal", 8);
    doc.text(
      `${worst.name} — ${worst.total} sites (${worst.pct.toFixed(1)}%) flagged`,
      ML + 10 + 70, y + 2.5,
    );
    y += 14;
  }
}

// ─── Horizontal bar chart ─────────────────────────────────────────────────────
function drawBarChart(
  doc: jsPDF,
  x: number, y: number, w: number,
  items: { label: string; value: number }[],
  maxVal: number,
  color: RGB,
  totalFac: number,
): number {
  if (items.length === 0) return y;
  const BH = 13;
  const BG = 4;
  const LABW = 158;
  const BARW = w - LABW - 56;
  const chartH = items.length * (BH + BG) + 22;

  fill(doc, P.bg50);
  doc.roundedRect(x, y, w, chartH, 4, 4, "F");
  stroke(doc, P.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, chartH, 4, 4, "S");

  textC(doc, P.ink400);
  font(doc, "normal", 5.5);
  doc.text("← Session sites flagged →", x + LABW + BARW / 2, y + 7, { align: "center" });

  for (let i = 0; i <= 4; i++) {
    const gx = x + LABW + (BARW * i) / 4;
    stroke(doc, P.border);
    doc.setLineWidth(0.2);
    doc.line(gx, y + 10, gx, y + chartH - 3);
    textC(doc, P.ink400);
    font(doc, "normal", 5);
    doc.text(String(Math.round((maxVal * i) / 4)), gx, y + 9.5, { align: "center" });
  }

  items.forEach((item, i) => {
    const by = y + 14 + i * (BH + BG);
    const ratio = maxVal > 0 ? Math.min(1, item.value / maxVal) : 0;
    const bw = ratio * BARW;

    textC(doc, P.ink700);
    font(doc, "normal", 6.5);
    const lbl = item.label.length > 26 ? item.label.slice(0, 24) + "…" : item.label;
    doc.text(lbl, x + LABW - 4, by + BH / 2 + 2, { align: "right" });

    fill(doc, P.border);
    doc.roundedRect(x + LABW, by, BARW, BH, 2, 2, "F");
    if (bw > 1) {
      fill(doc, color);
      doc.roundedRect(x + LABW, by, bw, BH, 2, 2, "F");
    }
    if (item.value > 0) {
      const pct = totalFac > 0 ? ((item.value / totalFac) * 100).toFixed(1) : "0.0";
      textC(doc, P.ink700);
      font(doc, "bold", 6);
      doc.text(`${item.value} (${pct}%)`, x + LABW + BARW + 4, by + BH / 2 + 2);
    }
  });

  return y + chartH + 8;
}

// ─── Block map section ────────────────────────────────────────────────────────
function drawMapSection(
  doc: jsPDF, y: number,
  mapImg: string | null,
  maxCount: number,
  groupLabel: string,
): number {
  const mapH = 200;
  const legH = 32;
  const totalH = 26 + mapH + legH + 10;

  if (y + totalH > PH - 30) {
    doc.addPage();
    y = 30;
  }

  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text(`DISTRICT BLOCK MAP — ${groupLabel.toUpperCase()}`, ML, y, { charSpace: 0.6 });
  y += 6;
  hRule(doc, y);
  y += 10;

  if (mapImg) {
    stroke(doc, P.border);
    doc.setLineWidth(0.5);
    doc.roundedRect(ML, y, CW, mapH, 4, 4, "S");
    doc.addImage(mapImg, "PNG", ML + 1, y + 1, CW - 2, mapH - 2);
    y += mapH + 6;

    const items = buildLegendItems(maxCount);
    const itemW = Math.floor(CW / items.length);
    items.forEach((item, i) => {
      const lx = ML + i * itemW;
      const r = parseInt(item.color.slice(1, 3), 16);
      const g = parseInt(item.color.slice(3, 5), 16);
      const b = parseInt(item.color.slice(5, 7), 16);
      fill(doc, [r, g, b] as RGB);
      doc.roundedRect(lx, y, 9, 9, 1.5, 1.5, "F");
      stroke(doc, P.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(lx, y, 9, 9, 1.5, 1.5, "S");
      textC(doc, P.ink500);
      font(doc, "normal", 5.5);
      const shortLbl = item.label.replace(" facilities", " fac.").replace(" facility", " fac.");
      doc.text(shortLbl, lx + 11, y + 7);
    });
    y += legH;
  } else {
    fill(doc, P.bg50);
    doc.roundedRect(ML, y, CW, 40, 4, 4, "F");
    stroke(doc, P.border);
    doc.setLineWidth(0.4);
    doc.roundedRect(ML, y, CW, 40, 4, 4, "S");
    textC(doc, P.ink400);
    font(doc, "normal", 8);
    doc.text("Block map not available for this district.", ML + CW / 2, y + 22, { align: "center" });
    y += 50;
  }
  return y + 6;
}

// ─── Component section ────────────────────────────────────────────────────────
function buildComponentSection(
  doc: jsPDF,
  kpis: UwinComputedKpis,
  group: string,
  totalFac: number,
  mapImg: string | null,
) {
  let y = 30;
  const color = GROUP_COLOR[group] ?? P.blue;
  const dark  = GROUP_DARK[group]  ?? P.blue;
  const soft  = GROUP_SOFT[group]  ?? P.blueSoft;
  const xsoft = GROUP_XSOFT[group] ?? P.blueXSoft;
  const comp  = computeOverallScore(kpis as unknown as ComputedKpis, UWIN_GROUPS).components[group];

  // Section header (light)
  fill(doc, xsoft);
  doc.roundedRect(ML, y, CW, 40, 4, 4, "F");
  fill(doc, color);
  doc.rect(ML, y, 5, 40, "F");
  stroke(doc, soft);
  doc.setLineWidth(0.5);
  doc.roundedRect(ML, y, CW, 40, 4, 4, "S");

  textC(doc, dark);
  font(doc, "bold", 14);
  doc.text(GROUP_LABEL[group] ?? group, ML + 14, y + 25);

  if (comp) {
    const scoreC = scoreRGB(comp.score);
    const scoreSoft = scoreSoftRGB(comp.score);
    fill(doc, scoreSoft);
    doc.roundedRect(PW - MR - 92, y + 8, 92, 24, 4, 4, "F");
    stroke(doc, scoreC);
    doc.setLineWidth(0.8);
    doc.roundedRect(PW - MR - 92, y + 8, 92, 24, 4, 4, "S");
    textC(doc, scoreC);
    font(doc, "bold", 8);
    doc.text("COMPONENT SCORE", PW - MR - 46, y + 18, { align: "center" });
    font(doc, "bold", 10);
    doc.text(`${comp.score.toFixed(1)}%  ${scoreLabel(comp.score)}`, PW - MR - 46, y + 28, { align: "center" });
  }
  y += 50;

  fill(doc, P.bg50);
  doc.roundedRect(ML, y, CW, 24, 3, 3, "F");
  textC(doc, P.ink500);
  font(doc, "normal", 7);
  doc.text(GROUP_DESC[group] ?? "", ML + 10, y + 9, { maxWidth: CW - 20 });
  y += 32;

  const cards = kpis.cards.filter(c => c.group === group);
  const maxVal = Math.max(1, ...cards.map(c => c.stat.total));

  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text("FLAGGED SESSION SITES BY INDICATOR", ML, y, { charSpace: 0.6 });
  y += 6;
  hRule(doc, y);
  y += 10;

  y = drawBarChart(doc, ML, y, CW, cards.map(c => ({ label: sanitize(c.name), value: c.stat.total })), maxVal, color, totalFac);
  y += 4;

  textC(doc, P.ink500);
  font(doc, "bold", 7.5);
  doc.text("INDICATOR SUMMARY", ML, y, { charSpace: 0.6 });
  y += 6;
  hRule(doc, y);
  y += 8;

  const den = Math.max(1, kpis.globalDen);
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    tableWidth: CW,
    head: [["Indicator", "Flagged", "Any Mth", "All Mths", "% of Sites", "Severity"]],
    body: cards.map(c => [
      sanitize(c.name),
      String(c.stat.total),
      String(c.stat.any),
      String(c.stat.all),
      `${((c.stat.total / den) * 100).toFixed(1)}%`,
      c.stat.total === 0 ? "None"
        : c.stat.total / den >= 0.5 ? "High"
        : c.stat.total / den >= 0.25 ? "Medium"
        : "Low",
    ]),
    styles: { fontSize: 7.5, cellPadding: 4, font: "helvetica", overflow: "linebreak" },
    headStyles: { fillColor: xsoft, textColor: dark, fontStyle: "bold", fontSize: 7, lineColor: soft, lineWidth: 0.4 },
    alternateRowStyles: { fillColor: P.bg50 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 160, textColor: dark },
      1: { halign: "center", cellWidth: 50 },
      2: { halign: "center", cellWidth: 46 },
      3: { halign: "center", cellWidth: 46 },
      4: { halign: "center", cellWidth: 58 },
      5: { halign: "center", cellWidth: 151 },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        const v = data.cell.text[0];
        if (v === "High")   { data.cell.styles.textColor = P.danger; data.cell.styles.fontStyle = "bold"; }
        else if (v === "Medium") { data.cell.styles.textColor = P.warn;   data.cell.styles.fontStyle = "bold"; }
        else if (v === "Low")    { data.cell.styles.textColor = P.good; }
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 12;

  const allFacKeys = new Set(cards.flatMap(c => [...c.stat.facilityKeys]));
  if (allFacKeys.size > 0) {
    const facRows: { block: string; facility: string; indicators: string; count: number }[] = [];
    for (const fk of allFacKeys) {
      const fd = kpis.filteredFacilities[fk];
      if (!fd) continue;
      // One indicator per line — guarantees wrapping regardless of jspdf-autotable version
      const flaggedIndicators = cards.filter(c => c.stat.facilityKeys.has(fk)).map(c => sanitize(c.name));
      facRows.push({ block: fd.block, facility: fd.facility, indicators: flaggedIndicators.join("\n"), count: flaggedIndicators.length });
    }
    facRows.sort((a, b) => b.count - a.count);
    const top = facRows.slice(0, 20);

    textC(doc, P.ink500);
    font(doc, "bold", 7.5);
    doc.text(`TOP AFFECTED SESSION SITES (${top.length} of ${allFacKeys.size})`, ML, y, { charSpace: 0.6 });
    y += 6;
    hRule(doc, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      tableWidth: CW,
      head: [["#", "Block", "Session Site", "Flagged Indicators", "N"]],
      body: top.map((r, i) => [String(i + 1), r.block, r.facility, r.indicators, String(r.count)]),
      styles: { fontSize: 7, cellPadding: 3.5, font: "helvetica", overflow: "linebreak" },
      headStyles: { fillColor: xsoft, textColor: dark, fontStyle: "bold", fontSize: 6.5, lineColor: soft, lineWidth: 0.4 },
      alternateRowStyles: { fillColor: P.bg50 },
      columnStyles: {
        0: { halign: "center", cellWidth: 20 },
        1: { cellWidth: 80 },
        2: { cellWidth: 105 },
        3: { cellWidth: 268, fontSize: 6.5 },
        4: { halign: "center", cellWidth: 38 },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          const v = parseInt(data.cell.text[0]);
          if (v >= 3) { data.cell.styles.textColor = P.danger; data.cell.styles.fontStyle = "bold"; }
          else if (v === 2) { data.cell.styles.textColor = P.warn; data.cell.styles.fontStyle = "bold"; }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  }

  // Block map
  const blockFacMap = new Map<string, Set<string>>();
  for (const card of cards) {
    for (const fk of card.stat.facilityKeys) {
      const fd = kpis.filteredFacilities[fk];
      if (fd?.block) {
        if (!blockFacMap.has(fd.block)) blockFacMap.set(fd.block, new Set());
        blockFacMap.get(fd.block)!.add(fk);
      }
    }
  }
  const maxCount = blockFacMap.size > 0 ? Math.max(...[...blockFacMap.values()].map(s => s.size)) : 1;

  drawMapSection(doc, y, mapImg, maxCount, GROUP_LABEL[group] ?? group);
}

// ─── Block summary ────────────────────────────────────────────────────────────
function buildBlockSummary(doc: jsPDF, kpis: UwinComputedKpis) {
  let y = 30;

  fill(doc, P.blueXSoft);
  doc.roundedRect(ML, y, CW, 36, 4, 4, "F");
  fill(doc, P.blue);
  doc.rect(ML, y, 5, 36, "F");
  textC(doc, P.blue);
  font(doc, "bold", 13);
  doc.text("Block-Level Summary", ML + 14, y + 23);
  y += 46;

  textC(doc, P.ink500);
  font(doc, "normal", 7);
  doc.text("Unique session sites flagged per block, across all DQA components.", ML, y);
  y += 14;

  const blockMap = new Map<string, Record<string, Set<string>>>();
  for (const g of UWIN_GROUPS) {
    for (const card of kpis.cards.filter(c => c.group === g)) {
      for (const fk of card.stat.facilityKeys) {
        const fd = kpis.filteredFacilities[fk];
        if (!fd) continue;
        const blk = fd.block || "Unknown";
        if (!blockMap.has(blk)) blockMap.set(blk, {});
        const entry = blockMap.get(blk)!;
        if (!entry[g]) entry[g] = new Set();
        entry[g].add(fk);
      }
    }
  }

  const blockFacTotal = new Map<string, Set<string>>();
  for (const [fk, fd] of Object.entries(kpis.filteredFacilities)) {
    const blk = fd.block || "Unknown";
    if (!blockFacTotal.has(blk)) blockFacTotal.set(blk, new Set());
    blockFacTotal.get(blk)!.add(fk);
  }

  const blockRows = [...blockFacTotal.keys()].sort().map(blk => {
    const entry = blockMap.get(blk) ?? {};
    const total = blockFacTotal.get(blk)?.size ?? 0;
    const avail = entry.availability?.size ?? 0;
    const accur = entry.accuracy?.size ?? 0;
    const cons  = entry.consistency?.size ?? 0;
    const anyFlagged = new Set([
      ...(entry.availability ?? []),
      ...(entry.accuracy ?? []),
      ...(entry.consistency ?? []),
    ]).size;
    const pct = total > 0 ? ((anyFlagged / total) * 100).toFixed(0) : "0";
    return [blk, String(total), String(avail), String(accur), String(cons), String(anyFlagged), `${pct}%`];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    tableWidth: CW,
    head: [["Block", "Total Sites", "Availability", "Accuracy", "Consistency", "Any Flagged", "Impact%"]],
    body: blockRows,
    styles: { fontSize: 7, cellPadding: 3.5, font: "helvetica", overflow: "linebreak" },
    headStyles: { fillColor: P.bg100, textColor: P.ink700, fontStyle: "bold", fontSize: 7, lineColor: P.border, lineWidth: 0.4 },
    alternateRowStyles: { fillColor: P.bg50 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 120 },
      1: { halign: "center", cellWidth: 58 },
      2: { halign: "center", cellWidth: 68, textColor: P.avail },
      3: { halign: "center", cellWidth: 58, textColor: P.accur },
      4: { halign: "center", cellWidth: 72, textColor: P.consist },
      5: { halign: "center", cellWidth: 60 },
      6: { halign: "center" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 6) {
        const pct = parseInt(data.cell.text[0]);
        if (pct >= 50) { data.cell.styles.textColor = P.danger; data.cell.styles.fontStyle = "bold"; }
        else if (pct >= 25) { data.cell.styles.textColor = P.warn; data.cell.styles.fontStyle = "bold"; }
        else if (pct > 0)  { data.cell.styles.textColor = P.good; }
      }
      if (data.section === "body" && data.column.index >= 2 && data.column.index <= 4) {
        if (parseInt(data.cell.text[0]) > 0) data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const lastY = (doc as any).lastAutoTable.finalY + 14;
  fill(doc, P.bg50);
  doc.roundedRect(ML, lastY, CW, 28, 4, 4, "F");
  textC(doc, P.ink400);
  font(doc, "normal", 6.5);
  doc.text("Note: A session site may appear under multiple components. 'Any Flagged' counts each site once.", ML + 10, lastY + 10, { maxWidth: CW - 20 });
}

// ─── Per-group block counts ───────────────────────────────────────────────────
function getGroupBlockCounts(group: string, kpis: UwinComputedKpis): Record<string, number> {
  const m = new Map<string, Set<string>>();
  for (const card of kpis.cards.filter(c => c.group === group)) {
    for (const fk of card.stat.facilityKeys) {
      const fd = kpis.filteredFacilities[fk];
      if (!fd?.block || fd.block === "Unknown block") continue;
      if (!m.has(fd.block)) m.set(fd.block, new Set());
      m.get(fd.block)!.add(fk);
    }
  }
  const result: Record<string, number> = {};
  for (const [blk, fkSet] of m) result[blk] = fkSet.size;
  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function downloadUwinDqaReport(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
): Promise<void> {
  const totalFac    = Math.max(1, Object.keys(kpis.filteredFacilities).length);
  const scoreResult = computeOverallScore(kpis as unknown as ComputedKpis, UWIN_GROUPS);
  const genDate     = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const selMonthLabels = Object.values(kpis.selMonthLabels);
  const period = selMonthLabels.length > 0
    ? `${selMonthLabels[0]} – ${selMonthLabels[selMonthLabels.length - 1]}`
    : "All selected months";
  const reportTitle = `${csv.stateName} · ${csv.distName} · U-WIN DQA`;

  const allDataBlocks = [...new Set(
    Object.values(kpis.filteredFacilities)
      .map(r => r.block)
      .filter((b): b is string => Boolean(b) && b !== "Unknown block"),
  )];

  const mapImages: Record<string, string | null> = {};
  await Promise.all(
    UWIN_GROUPS.map(async (g) => {
      const blockCounts = getGroupBlockCounts(g, kpis);
      mapImages[g] = await generateBlockMapDataUrl(csv.stateName, csv.distName, blockCounts, allDataBlocks);
    }),
  );

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  buildCover(doc, csv, kpis, period, genDate, totalFac, scoreResult);

  doc.addPage();
  buildSummary(doc, csv, kpis, period, totalFac, scoreResult);

  for (const g of UWIN_GROUPS) {
    doc.addPage();
    buildComponentSection(doc, kpis, g, totalFac, mapImages[g] ?? null);
  }

  doc.addPage();
  buildBlockSummary(doc, kpis);

  const total = doc.getNumberOfPages();
  for (let i = 2; i <= total; i++) {
    doc.setPage(i);
    addHeaderFooter(doc, i, total, reportTitle, genDate);
  }

  const filename = ["DQA-Report-UWIN", csv.stateName, csv.distName, new Date().toISOString().slice(0, 10)]
    .join("-").replace(/\s+/g, "-") + ".pdf";
  doc.save(filename);
}

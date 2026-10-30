// ============================================================
// DQA analysis report — A4 PDF renderer (portal-neutral)
//
// Lays out the agreed report template ("Data Template for Data Quality
// Assessment (DQA) Analysis", docs/, 2026-10-29) from a plain model, so each
// portal only has to build a `ReportModel`:
//   header · overall + component scores · key findings · issues by area ·
//   one section per component (flagged units by check, worst check by area) ·
//   area table (4+ / 1–3 / 0 issues) · top 3 units to focus per area.
//
// Chart rules (dataviz skill): one colour per chart; in "flagged by check" the
// worst check carries the component colour and the rest are neutral grey;
// thin bars with a rounded data end, a hairline baseline, values at the tips,
// no gridlines; text always in ink colours, never in a series colour.
// ============================================================

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ReportFonts {
  /** Base64 TTF files; without them the report falls back to Helvetica. */
  regular: string;
  semibold: string;
}

export interface TextRun {
  text: string;
  bold?: boolean;
}

export interface ReportCheck {
  id: string;
  label: string;
  flagged: number;
  /** % of all units in scope. */
  pct: number;
  /** false when no unit could be evaluated (e.g. needs two months). */
  canRun: boolean;
  /** Units flagged per area, every area in scope, highest first. */
  byArea: { name: string; count: number }[];
  /** Names of the flagged units — set when the units are the areas themselves. */
  flaggedNames?: string[];
}

export interface ReportComponent {
  key: string;
  name: string;
  /** Hex identity colour of the component. */
  color: string;
  score: number | null;
  checks: ReportCheck[];
  /** The most-flagged check; null when nothing is flagged. */
  worst: ReportCheck | null;
  /** Key-finding sentence after "<name>:". */
  finding: TextRun[];
  /** Shown instead of the charts when the component is not assessed. */
  note?: string;
}

export interface ReportModel {
  /** Small line above the title, e.g. "DQA Desk Review · District report". */
  kicker: string;
  title: string;
  /** Four header facts, shown two per row. */
  meta: { label: string; value: string }[];
  overall: number | null;
  grade: string;
  unit: { one: string; many: string };
  area: { one: string; many: string };
  /**
   * The units are the areas (district-level HMIS-State): the "by area" charts
   * become lists of flagged units and one unit table replaces the area tables.
   */
  unitIsArea: boolean;
  totalUnits: number;
  /** Checks that could run — the "of N" for issue counts. */
  checksAssessed: number;
  components: ReportComponent[];
  issuesByArea: { name: string; issues: number }[];
  areaTable: { name: string; high: number; some: number; none: number; total: number }[];
  topUnits: { area: string; units: { name: string; issues: number }[] }[];
  /** One row per unit (unitIsArea only): distinct checks flagged and their names. */
  unitTable?: { name: string; issues: number; checks: string[] }[];
  /** Left footer text on every page. */
  footer: string;
  /** "How to read" lines at the end. */
  notes: string[];
}

// ---- page & palette ----

const PW = 595.28;
const PH = 841.89;
const ML = 40;
const MR = 40;
const MT = 38;
const FOOT = 40;
const CW = PW - ML - MR;

type RGB = [number, number, number];
const hex = (value: string): RGB => {
  const h = value.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const C = {
  ink: hex("#0f172a"),
  ink2: hex("#334155"),
  muted: hex("#64748b"),
  faint: hex("#94a3b8"),
  hair: hex("#d5dbe3"),
  panel: hex("#f5f7fa"),
  track: hex("#e6eaef"),
  navy: hex("#12355b"),
  neutralBar: hex("#c3cad4"),
  white: hex("#ffffff"),
  headFill: hex("#eef1f5"),
  // Issue bands (status): critical / warning / clear — matches the app's Overall tab.
  high: hex("#d03b3b"),
  some: hex("#fab219"),
  none: hex("#2a78d6"),
};

// ---- text helpers ----

const FAMILY_PLEX = "IBMPlexSans";

/** Helvetica (the fallback) has no arrows, ≥ or long dashes. */
function ascii(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[—–]/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/·/g, "-")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E]/g, "?");
}

class Pen {
  readonly doc: jsPDF;
  private readonly family: string;
  private readonly unicode: boolean;

  constructor(doc: jsPDF, fonts: ReportFonts | null) {
    this.doc = doc;
    if (fonts) {
      doc.addFileToVFS("IBMPlexSans-Regular.ttf", fonts.regular);
      doc.addFileToVFS("IBMPlexSans-SemiBold.ttf", fonts.semibold);
      doc.addFont("IBMPlexSans-Regular.ttf", FAMILY_PLEX, "normal");
      doc.addFont("IBMPlexSans-SemiBold.ttf", FAMILY_PLEX, "bold");
    }
    this.family = fonts ? FAMILY_PLEX : "helvetica";
    this.unicode = Boolean(fonts);
  }

  get fontFamily(): string {
    return this.family;
  }

  t(s: string): string {
    return this.unicode ? s : ascii(s);
  }

  font(size: number, bold = false, color: RGB = C.ink): void {
    this.doc.setFont(this.family, bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
  }

  fill(color: RGB): void {
    this.doc.setFillColor(color[0], color[1], color[2]);
  }

  stroke(color: RGB, width = 0.5): void {
    this.doc.setDrawColor(color[0], color[1], color[2]);
    this.doc.setLineWidth(width);
  }

  width(s: string): number {
    return this.doc.getTextWidth(this.t(s));
  }

  text(s: string, x: number, y: number, options: Parameters<jsPDF["text"]>[3] = {}): void {
    this.doc.text(this.t(s), x, y, options);
  }

  /** Word-wrap with the current font; at most `maxLines`, the last ending in "…". */
  wrap(s: string, width: number, maxLines = Infinity): string[] {
    const words = this.t(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (this.doc.getTextWidth(next) <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    const ell = this.unicode ? "…" : "...";
    while (last.length > 1 && this.doc.getTextWidth(last + ell) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + ell;
    return kept;
  }
}

// ---- marks ----

/** Horizontal bar: square at the baseline (left), rounded data end. */
function hBar(pen: Pen, x: number, y: number, w: number, h: number, color: RGB): void {
  if (w <= 0) return;
  pen.fill(color);
  const r = Math.min(2, w / 2, h / 2);
  pen.doc.roundedRect(x, y, w, h, r, r, "F");
  pen.doc.rect(x, y, Math.min(w, r + 0.5), h, "F");
}

/** Column: square at the baseline (bottom), rounded data end. */
function vBar(pen: Pen, x: number, baseline: number, w: number, h: number, color: RGB): void {
  if (h <= 0) return;
  pen.fill(color);
  const r = Math.min(2, w / 2, h / 2);
  pen.doc.roundedRect(x, baseline - h, w, h, r, r, "F");
  pen.doc.rect(x, baseline - Math.min(h, r + 0.5), w, Math.min(h, r + 0.5), "F");
}

const fmtPct = (value: number) => {
  if (value > 0 && value < 0.1) return "<0.1%";
  return `${value.toFixed(1)}%`;
};
const fmtScore = (value: number | null) => (value === null ? "N/A" : `${value.toFixed(1)}%`);

// ---- charts ----

const LABEL_ANGLE = 40;
const ROTATED_MAX_W = 70;

/** Whether area labels turn 40°, and how deep the label band is. */
function columnLabels(pen: Pen, w: number, items: { name: string }[]): { rotate: boolean; depth: number } {
  const slot = w / Math.max(items.length, 1);
  pen.font(6.6);
  const rotate = items.length > 10
    || items.some((item) => pen.wrap(item.name, slot - 3, 2).some((line) => pen.doc.getTextWidth(line) > slot - 2));
  if (!rotate) return { rotate, depth: 9 + 2 * 7.6 };
  const rad = (LABEL_ANGLE * Math.PI) / 180;
  const widest = Math.max(0, ...items.map((item) => pen.doc.getTextWidth(pen.wrap(item.name, ROTATED_MAX_W, 1)[0] ?? "")));
  return { rotate, depth: 10 + widest * Math.sin(rad) };
}

/** Height `columnChart` will use. */
function columnChartHeight(pen: Pen, w: number, plotH: number, items: { name: string }[]): number {
  return plotH + columnLabels(pen, w, items).depth;
}

/**
 * Columns per area with the value on each cap; single series, no legend.
 * Labels wrap to two lines, or turn 40° when the areas are many.
 */
function columnChart(
  pen: Pen,
  x: number,
  y: number,
  w: number,
  plotH: number,
  items: { name: string; value: number }[],
  color: RGB,
): number {
  const n = Math.max(items.length, 1);
  const slot = w / n;
  const colW = Math.min(20, slot * 0.58);
  const max = Math.max(1, ...items.map((item) => item.value));
  const baseline = y + plotH;
  const { rotate, depth } = columnLabels(pen, w, items);

  items.forEach((item, index) => {
    const cx = x + slot * index + slot / 2;
    const h = (item.value / max) * (plotH - 12);
    vBar(pen, cx - colW / 2, baseline, colW, h, color);
    pen.font(7, true, item.value > 0 ? C.ink : C.faint);
    pen.text(String(item.value), cx, baseline - h - 3, { align: "center" });
  });
  pen.stroke(C.hair, 0.6);
  pen.doc.line(x, baseline, x + w, baseline);

  pen.font(6.6, false, C.ink2);
  if (!rotate) {
    items.forEach((item, index) => {
      const cx = x + slot * index + slot / 2;
      pen.wrap(item.name, slot - 3, 2).forEach((line, li) => {
        pen.doc.text(line, cx, baseline + 9 + li * 7.6, { align: "center" });
      });
    });
    return plotH + depth;
  }
  const rad = (LABEL_ANGLE * Math.PI) / 180;
  items.forEach((item, index) => {
    const cx = x + slot * index + slot / 2;
    const label = pen.wrap(item.name, ROTATED_MAX_W, 1)[0] ?? "";
    const tw = pen.doc.getTextWidth(label);
    // Text runs up-right and ends just under the column.
    pen.doc.text(label, cx - tw * Math.cos(rad) + 2, baseline + 6 + tw * Math.sin(rad), { angle: LABEL_ANGLE });
  });
  return plotH + depth;
}

/** Height a check-bar chart needs. */
function barRowsHeight(pen: Pen, checks: ReportCheck[], labelW: number): number {
  pen.font(6.8);
  return checks.reduce((sum, check) => sum + (pen.wrap(check.label, labelW, 2).length > 1 ? 19 : 14), 0);
}

/** Units flagged per check; the worst check in the component colour, the rest neutral. */
function checkBars(
  pen: Pen,
  x: number,
  y: number,
  w: number,
  checks: ReportCheck[],
  worstId: string | null,
  color: RGB,
): number {
  const labelW = Math.min(132, w * 0.46);
  const axisX = x + labelW + 6;
  const valueW = 50;
  const barMax = w - labelW - 6 - valueW;
  const max = Math.max(1, ...checks.map((check) => check.flagged));
  let cy = y;
  for (const check of checks) {
    pen.font(6.8);
    const lines = pen.wrap(check.label, labelW, 2);
    const rowH = lines.length > 1 ? 19 : 14;
    const mid = cy + rowH / 2;
    const isWorst = check.id === worstId;
    pen.font(6.8, isWorst, isWorst ? C.ink : C.ink2);
    lines.forEach((line, li) => {
      const ly = mid + 2.3 + (li - (lines.length - 1) / 2) * 7.4;
      pen.doc.text(line, x + labelW, ly, { align: "right" });
    });
    if (!check.canRun) {
      pen.font(6.8, false, C.faint);
      pen.text("n/a — cannot run on this selection", axisX + 4, mid + 2.3);
    } else {
      const bw = (check.flagged / max) * barMax;
      hBar(pen, axisX, mid - 4, bw, 8, isWorst ? color : C.neutralBar);
      pen.font(6.8, isWorst, check.flagged > 0 ? C.ink : C.faint);
      pen.text(check.flagged > 0 ? `${check.flagged} (${fmtPct(check.pct)})` : "0", axisX + bw + 4, mid + 2.3);
    }
    cy += rowH;
  }
  pen.stroke(C.hair, 0.6);
  pen.doc.line(axisX, y, axisX, cy);
  return cy - y;
}

// ---- rich text ----

/** Wraps runs of normal/bold text; returns the height used. `draw: false` only measures. */
function richText(
  pen: Pen,
  runs: TextRun[],
  x: number,
  y: number,
  width: number,
  size: number,
  lineH: number,
  draw = true,
): number {
  type Word = { text: string; bold: boolean };
  const words: Word[] = [];
  for (const run of runs) {
    const parts = pen.t(run.text).split(/(\s+)/);
    for (const part of parts) if (part && !/^\s+$/.test(part)) words.push({ text: part, bold: Boolean(run.bold) });
  }
  const measure = (word: Word) => {
    pen.font(size, word.bold);
    return pen.doc.getTextWidth(word.text);
  };
  pen.font(size);
  const space = pen.doc.getTextWidth(" ");
  let cx = x;
  let cy = y;
  for (const word of words) {
    const ww = measure(word);
    if (cx > x && cx + ww > x + width) {
      cx = x;
      cy += lineH;
    }
    if (draw) {
      pen.font(size, word.bold, word.bold ? C.ink : C.ink2);
      pen.doc.text(word.text, cx, cy);
    }
    cx += ww + space;
  }
  return cy - y + lineH;
}

// ---- layout ----

class Layout {
  y = MT;
  constructor(private readonly pen: Pen) {}

  /** Starts a new page when `space` does not fit. */
  ensure(space: number): void {
    if (this.y + space > PH - FOOT - 6) {
      this.pen.doc.addPage();
      this.y = MT;
    }
  }
}

function heading(pen: Pen, layout: Layout, title: string, subtitle?: string): void {
  pen.font(10.5, true, C.ink);
  pen.text(title, ML, layout.y + 10);
  layout.y += 15;
  if (subtitle) {
    pen.font(7.4, false, C.muted);
    pen.text(subtitle, ML, layout.y + 6);
    layout.y += 11;
  }
  layout.y += 4;
}

function drawHeader(pen: Pen, layout: Layout, model: ReportModel): void {
  pen.font(7, true, C.muted);
  pen.text(model.kicker.toUpperCase(), ML, layout.y + 6, { charSpace: 0.9 });
  pen.font(16, true, C.navy);
  pen.text(model.title, ML, layout.y + 25);
  layout.y += 34;
  pen.stroke(C.navy, 1.2);
  pen.doc.line(ML, layout.y, ML + CW, layout.y);
  layout.y += 13;

  const colW = CW / 2;
  model.meta.forEach((item, index) => {
    const cx = ML + (index % 2) * colW;
    const cy = layout.y + Math.floor(index / 2) * 15;
    pen.font(7.6, false, C.muted);
    pen.text(item.label, cx, cy + 6);
    pen.font(9.2, true, C.ink);
    pen.text(item.value, cx + 58, cy + 6);
  });
  layout.y += Math.ceil(model.meta.length / 2) * 15 + 8;
}

function drawScoreBand(pen: Pen, layout: Layout, model: ReportModel): void {
  const h = 60;
  const overallW = 128;
  const gap = 6;
  const compW = (CW - overallW - gap * model.components.length) / Math.max(1, model.components.length);
  const y = layout.y;

  pen.fill(C.navy);
  pen.doc.roundedRect(ML, y, overallW, h, 3, 3, "F");
  pen.font(7.4, false, hex("#c9d6e6"));
  pen.text("Overall DQA score", ML + 12, y + 15);
  pen.font(23, true, C.white);
  pen.text(fmtScore(model.overall), ML + 12, y + 40);
  pen.font(7.4, false, hex("#c9d6e6"));
  pen.text(model.overall === null ? "Not scored" : `Grade ${model.grade}`, ML + 12, y + 52);

  model.components.forEach((component, index) => {
    const cx = ML + overallW + gap + index * (compW + gap);
    const color = hex(component.color);
    pen.stroke(C.hair, 0.6);
    pen.fill(C.white);
    pen.doc.roundedRect(cx, y, compW, h, 3, 3, "FD");
    pen.fill(color);
    pen.doc.rect(cx + 0.3, y + 0.3, compW - 0.6, 3, "F");
    pen.font(7.6, false, C.muted);
    pen.text(component.name, cx + 10, y + 17);
    pen.font(17, true, C.ink);
    pen.text(fmtScore(component.score), cx + 10, y + 38);
    const trackW = compW - 20;
    pen.fill(C.track);
    pen.doc.roundedRect(cx + 10, y + 47, trackW, 3, 1.5, 1.5, "F");
    if (component.score !== null && component.score > 0) {
      pen.fill(color);
      pen.doc.roundedRect(cx + 10, y + 47, Math.max(3, (trackW * component.score) / 100), 3, 1.5, 1.5, "F");
    }
  });
  layout.y += h + 12;
}

function drawFindings(pen: Pen, layout: Layout, model: ReportModel): void {
  const padX = 12;
  const textX = ML + padX + 10;
  const textW = CW - padX * 2 - 10;
  const runsOf = (component: ReportComponent): TextRun[] => [
    { text: `${component.name}:`, bold: true },
    { text: " " },
    ...component.finding,
  ];
  // Measure first so the panel fits its text.
  const textH = model.components.reduce(
    (sum, component) => sum + richText(pen, runsOf(component), textX, 0, textW, 8.4, 11.2, false),
    0,
  );
  const boxH = 30 + textH;
  layout.ensure(boxH);
  const y = layout.y;
  pen.fill(C.panel);
  pen.doc.roundedRect(ML, y, CW, boxH, 3, 3, "F");
  pen.font(9, true, C.ink);
  pen.text("Key findings", ML + padX, y + 15);
  let cy = y + 30;
  model.components.forEach((component) => {
    pen.fill(hex(component.color));
    pen.doc.rect(ML + padX, cy - 5.4, 5, 5, "F");
    cy += richText(pen, runsOf(component), textX, cy, textW, 8.4, 11.2);
  });
  layout.y = y + boxH + 14;
}

function drawIssuesByArea(pen: Pen, layout: Layout, model: ReportModel): void {
  const plotH = 86;
  const items = model.issuesByArea.map((row) => ({ name: row.name, value: row.issues }));
  layout.ensure(34 + columnChartHeight(pen, CW, plotH, items));
  heading(
    pen,
    layout,
    `Number of data quality issues identified, by ${model.area.one}`,
    model.unitIsArea
      ? `Distinct checks flagged for each ${model.unit.one} (of ${model.checksAssessed} checks assessed)`
      : `Distinct checks flagged among each ${model.area.one}'s ${model.unit.many} (of ${model.checksAssessed} checks assessed)`,
  );
  layout.y += columnChart(pen, ML, layout.y, CW, plotH, items, C.navy) + 16;
}

function drawComponent(pen: Pen, layout: Layout, model: ReportModel, component: ReportComponent): void {
  const color = hex(component.color);
  const panelGap = 22;
  const panelW = (CW - panelGap) / 2;
  const labelW = Math.min(132, panelW * 0.46);
  const plotH = 68;
  const areaItems = (component.worst?.byArea ?? []).map((row) => ({ name: row.name, value: row.count }));
  const flaggedList = () => {
    pen.font(7.8);
    return pen.wrap((component.worst?.flaggedNames ?? []).join(", "), panelW);
  };

  if (component.note) {
    layout.ensure(54);
  } else {
    const leftH = 14 + barRowsHeight(pen, component.checks, labelW);
    const rightH = !component.worst
      ? 30
      : model.unitIsArea
        ? 30 + flaggedList().length * 10.4
        : 26 + columnChartHeight(pen, panelW, plotH, areaItems);
    layout.ensure(28 + Math.max(leftH, rightH) + 6);
  }

  // Section heading: identity swatch, name, score.
  const y = layout.y;
  pen.fill(color);
  pen.doc.rect(ML, y + 2, 4, 13, "F");
  pen.font(11.5, true, C.ink);
  pen.text(component.name, ML + 10, y + 12.5);
  const nameW = pen.width(component.name);
  const scoreText = fmtScore(component.score);
  pen.font(11.5, true, C.ink);
  pen.text(scoreText, ML + 10 + nameW + 8, y + 12.5);
  const scoreW = pen.width(scoreText);
  pen.font(7.4, false, C.muted);
  pen.text("component score", ML + 10 + nameW + 8 + scoreW + 6, y + 12.5);
  pen.stroke(C.hair, 0.5);
  pen.doc.line(ML, y + 20, ML + CW, y + 20);
  layout.y = y + 28;

  if (component.note) {
    pen.font(8.2, false, C.muted);
    pen.text(component.note, ML + 10, layout.y + 6);
    layout.y += 26;
    return;
  }

  // Left: units flagged by check.
  pen.font(8, true, C.ink2);
  pen.text(`${capitalize(model.unit.many)} flagged, by check`, ML, layout.y + 6);
  const leftUsed = 14 + checkBars(pen, ML, layout.y + 14, panelW, component.checks, component.worst?.id ?? null, color);

  // Right: the worst check across areas.
  const rx = ML + panelW + panelGap;
  pen.stroke(C.hair, 0.5);
  pen.doc.line(rx - panelGap / 2, layout.y, rx - panelGap / 2, layout.y + Math.max(leftUsed, 110));
  let rightUsed: number;
  if (!component.worst) {
    pen.font(8, true, C.ink2);
    pen.text(`Worst check by ${model.area.one}`, rx, layout.y + 6);
    pen.font(8, false, C.muted);
    pen.text(`No ${model.unit.one} flagged in this component.`, rx, layout.y + 22);
    rightUsed = 30;
  } else if (model.unitIsArea) {
    pen.font(8, true, C.ink2);
    pen.text(`${capitalize(model.unit.many)} flagged for the worst check:`, rx, layout.y + 6);
    pen.font(8, false, C.ink);
    pen.doc.text(pen.wrap(component.worst.label, panelW, 1)[0] ?? "", rx, layout.y + 16.5);
    const lines = flaggedList();
    pen.font(7.8, false, C.ink2);
    lines.forEach((line, index) => pen.doc.text(line, rx, layout.y + 31 + index * 10.4));
    rightUsed = 30 + lines.length * 10.4;
  } else {
    pen.font(8, true, C.ink2);
    pen.text(`Worst check by ${model.area.one}:`, rx, layout.y + 6);
    pen.font(8, false, C.ink);
    const title = pen.wrap(component.worst.label, panelW, 1)[0] ?? "";
    pen.doc.text(title, rx, layout.y + 16.5);
    rightUsed = 26 + columnChart(pen, rx, layout.y + 26, panelW, plotH, areaItems, color);
  }
  layout.y += Math.max(leftUsed, rightUsed) + 18;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function drawAreaTables(pen: Pen, layout: Layout, model: ReportModel): void {
  const family = pen.fontFamily;
  const tableStyles = {
    font: family,
    fontSize: 8.4,
    textColor: C.ink,
    lineColor: C.hair,
    lineWidth: 0.5,
    cellPadding: { top: 3.8, bottom: 3.8, left: 7, right: 7 },
    valign: "middle" as const,
  };
  const headStyles = { fillColor: C.headFill, textColor: C.ink, fontStyle: "bold" as const, fontSize: 8.2 };
  const Area = capitalize(model.area.one);

  if (model.unitIsArea && model.unitTable) {
    const Unit = capitalize(model.unit.one);
    const band = (issues: number): [string, RGB] =>
      issues >= 4 ? ["4+ issues", C.high] : issues > 0 ? ["1–3 issues", C.some] : ["No issues", C.none];
    layout.ensure(40 + 22 * Math.min(6, model.unitTable.length + 1));
    heading(pen, layout, `${Unit}-wise issues identified`, `Distinct checks flagged for each ${model.unit.one}, highest first`);
    autoTable(pen.doc, {
      startY: layout.y,
      margin: { left: ML, right: MR, bottom: FOOT + 6 },
      head: [[Unit, "Issues", "Priority", "Checks flagged"].map((s) => pen.t(s))],
      body: model.unitTable.map((row) => [
        pen.t(row.name),
        row.issues,
        pen.t(band(row.issues)[0]),
        pen.t(row.checks.join(", ") || "—"),
      ]),
      theme: "grid",
      styles: tableStyles,
      headStyles,
      columnStyles: {
        0: { cellWidth: CW * 0.2, fontStyle: "bold" },
        1: { cellWidth: CW * 0.09, halign: "center" },
        2: { cellWidth: CW * 0.15 },
        3: { fontSize: 7.6, textColor: C.ink2 },
      },
      rowPageBreak: "avoid",
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          data.cell.styles.cellPadding = { top: 3.8, bottom: 3.8, left: 16, right: 7 };
        }
      },
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 2) return;
        const row = model.unitTable![data.row.index];
        pen.fill(band(row.issues)[1]);
        pen.doc.circle(data.cell.x + 8.5, data.cell.y + data.cell.height / 2, 3, "F");
      },
    });
    layout.y = (pen.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
    return;
  }

  // Block-wise facility-wise issues.
  layout.ensure(40 + 22 * Math.min(6, model.areaTable.length + 2));
  heading(
    pen,
    layout,
    `${Area}-wise ${model.unit.one}-wise issues identified`,
    `${capitalize(model.unit.many)} by the number of distinct checks flagged`,
  );
  const totals = model.areaTable.reduce(
    (sum, row) => ({ high: sum.high + row.high, some: sum.some + row.some, none: sum.none + row.none, total: sum.total + row.total }),
    { high: 0, some: 0, none: 0, total: 0 },
  );
  const dot: Record<number, RGB> = { 1: C.high, 2: C.some, 3: C.none };
  autoTable(pen.doc, {
    startY: layout.y,
    margin: { left: ML, right: MR, bottom: FOOT + 6 },
    head: [[Area, "4+ issues", "1–3 issues", "No issues", `Total ${model.unit.many}`].map((s) => pen.t(s))],
    body: model.areaTable.map((row) => [pen.t(row.name), row.high, row.some, row.none, row.total]),
    foot: [[pen.t("Overall total"), totals.high, totals.some, totals.none, totals.total]],
    showFoot: "lastPage",
    theme: "grid",
    styles: tableStyles,
    headStyles,
    footStyles: { fillColor: C.panel, textColor: C.ink, fontStyle: "bold", fontSize: 8.4 },
    columnStyles: {
      0: { cellWidth: CW * 0.32 },
      1: { halign: "center" },
      2: { halign: "center" },
      3: { halign: "center" },
      4: { halign: "center", fontStyle: "bold" },
    },
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section === "head" && data.column.index >= 1 && data.column.index <= 3) {
        data.cell.styles.halign = "center";
        data.cell.styles.cellPadding = { top: 3.8, bottom: 3.8, left: 16, right: 7 };
      }
      if (data.section === "head" && data.column.index === 4) data.cell.styles.halign = "center";
      if (data.section === "foot" && data.column.index >= 1) data.cell.styles.halign = "center";
    },
    didDrawCell: (data) => {
      const color = dot[data.column.index];
      if (data.section !== "head" || !color) return;
      pen.font(8.2, true);
      const label = String(data.cell.text.join(" "));
      const tw = pen.doc.getTextWidth(label);
      const cx = data.cell.x + data.cell.width / 2 + 4.5 - tw / 2 - 8;
      pen.fill(color);
      pen.doc.circle(cx, data.cell.y + data.cell.height / 2, 3, "F");
    },
  });
  layout.y = (pen.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 22;

  // Top 3 units to focus in each area.
  layout.ensure(40 + 22 * Math.min(6, model.topUnits.length + 1));
  heading(
    pen,
    layout,
    `Top 3 ${model.unit.many} to focus on in each ${model.area.one}`,
    `Number in brackets = distinct checks flagged for the ${model.unit.one}`,
  );
  autoTable(pen.doc, {
    startY: layout.y,
    margin: { left: ML, right: MR, bottom: FOOT + 6 },
    head: [[Area, "1st highest", "2nd highest", "3rd highest"].map((s) => pen.t(s))],
    body: model.topUnits.map((row) => [
      pen.t(row.area),
      ...[0, 1, 2].map((i) => pen.t(row.units[i] ? `${row.units[i].name} (${row.units[i].issues})` : "—")),
    ]),
    theme: "grid",
    styles: tableStyles,
    headStyles,
    columnStyles: {
      0: { cellWidth: CW * 0.2, fontStyle: "bold", fillColor: C.panel },
    },
    rowPageBreak: "avoid",
  });
  layout.y = (pen.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
}

function drawNotes(pen: Pen, layout: Layout, model: ReportModel): void {
  if (model.notes.length === 0) return;
  pen.font(7.2);
  const lines = model.notes.flatMap((note) => pen.wrap(note, CW - 8));
  layout.ensure(16 + lines.length * 9.6);
  pen.font(7.6, true, C.ink2);
  pen.text("How to read this report", ML, layout.y + 6);
  layout.y += 15;
  pen.font(7.2, false, C.muted);
  for (const line of lines) {
    pen.doc.text(line, ML, layout.y + 4);
    layout.y += 9.6;
  }
}

function drawFooters(pen: Pen, model: ReportModel): void {
  const total = pen.doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    pen.doc.setPage(page);
    const y = PH - FOOT + 14;
    pen.stroke(C.hair, 0.5);
    pen.doc.line(ML, y - 9, ML + CW, y - 9);
    pen.font(7, false, C.muted);
    pen.text(model.footer, ML, y);
    pen.text(`Page ${page} of ${total}`, ML + CW, y, { align: "right" });
  }
}

/** The complete report as a jsPDF document. */
export function renderDqaReport(model: ReportModel, fonts: ReportFonts | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setProperties({ title: model.title, subject: "Data Quality Assessment", creator: "DQA Desk Review" });
  const pen = new Pen(doc, fonts);
  const layout = new Layout(pen);

  drawHeader(pen, layout, model);
  drawScoreBand(pen, layout, model);
  drawFindings(pen, layout, model);
  drawIssuesByArea(pen, layout, model);
  for (const component of model.components) drawComponent(pen, layout, model, component);
  drawAreaTables(pen, layout, model);
  drawNotes(pen, layout, model);
  drawFooters(pen, model);
  return doc;
}

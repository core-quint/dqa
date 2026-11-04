// ============================================================
// DQA brief — A4 PDF renderer (HMIS, U-WIN, PCTS).
//
// Draws the brief template (docs/Report Template/HMIS DQA Brief - Template.pdf)
// from a `DqaBrief` (lib/report/brief.ts). Positions, sizes and colours are
// the template's own, in points from the top-left corner; the design tokens are
// the ones listed in "HMIS DQA Brief - Rules.pdf". Headings are Poppins Bold;
// body text is DQA Brief Text, which has Calibri's metrics, so lines wrap where
// the template wraps them. Lines the template sets ~5% tighter carry `fit`.
//
// Page 1: banner · overall and component scores · "Where the issues are" (one
// tile per check) · "What stands out". Page 2: banner · block table ·
// suggested follow-ups. Units (facilities, sub centers, session sites), areas
// (blocks, districts) and the portal name come from the brief; a portal with
// three scored components spreads them over the score strip. When the units
// are the areas (a district-level state upload) page 2 lists the units with
// the checks flagged for each. A district with many blocks keeps two pages: rows get
// shorter first, then the font smaller (to 7 pt), then the table takes the
// follow-ups' space; only past that does it run on to another page.
// ============================================================

import jsPDF, { GState } from "jspdf";
import type { BriefAreaRow, BriefComponent, BriefNoun, BriefTile, BriefUnitRow, DqaBrief } from "./brief";
import { drawBriefIcon, type BriefIconName } from "./briefIcons";

export interface BriefFonts {
  /** Base64 TTF files; without them the brief falls back to Helvetica. */
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
  /** Poppins Bold. */
  heading: string;
}

// ---- page & tokens ----

const PW = 595.28;
const LEFT = 27;
const RIGHT = 568.5;
const CONTENT_W = RIGHT - LEFT;
const FOOTER_RULE = 812.25;

const TOKEN = {
  banner: "#0071B8",
  navy: "#0B2A4A",
  red: "#D93F3F",
  /** The template's red tile (the rules' #D93F3F at 93% on white). */
  redTile: "#E3686E",
  greyTile: "#F0F2F5",
  ink: "#1B2433",
  ink2: "#3A4352",
  muted: "#6B7585",
  hair: "#E2E6EC",
  dashed: "#CBD2DB",
  green: "#2E9E6B",
  amber: "#F0A43A",
  darkRed: "#9B1C1C",
  white: "#FFFFFF",
  overallCard: "#2770B8",
  scoreKicker: "#A9C0D6",
  bannerKicker: "#CFE4F5",
  bannerText: "#E6F1FA",
  up: "#7EE2B8",
  down: "#FFB4AE",
  onRedDetail: "#FFE1E1",
  iconWell: "#E3F0FA",
  groupRule: "#A9B4C2",
  arrow: "#A9C0D6",
  zebra: "#FAFBFC",
  unmappedRow: "#F6F7F9",
  totalRow: "#E8EEF5",
};

const COMPONENT_COLOR: Record<string, string> = {
  availability: "#3B6FE0",
  completeness: "#5A3FB8",
  accuracy: "#EA6A2F",
  consistency: "#1F9D6B",
};

const COMPONENT_ICON: Record<string, BriefIconName> = {
  availability: "database",
  completeness: "listChecks",
  accuracy: "target",
  consistency: "scale",
};

/** 4+ cell: 0 none; 1 to 2 light red; 3 to 4; 5+. */
function heatOf(high: number): string | null {
  if (high >= 5) return "#F3A39B";
  if (high >= 3) return "#F8C6C0";
  if (high >= 1) return "#FCE5E2";
  return null;
}

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
/** `over` at `alpha` on `base`, as a solid colour. */
const mix = (base: string, over: string, alpha: number): string => {
  const [a, b] = [rgb(base), rgb(over)];
  return `#${a.map((v, i) => Math.round(v * (1 - alpha) + b[i] * alpha).toString(16).padStart(2, "0")).join("")}`;
};

const fmt = (n: number) => n.toLocaleString("en-IN");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const counted = (n: number, noun: BriefNoun) => `${fmt(n)} ${n === 1 ? noun.one : noun.many}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- text ----

type Face = "regular" | "bold" | "italic" | "boldItalic" | "heading";

interface Style {
  face: Face;
  size: number;
  color: string;
  /** Extra space after every character, in points (letter-spaced kickers). */
  track?: number;
  /** Width as a share of the natural width — the template sets some lines ~5% tighter. */
  fit?: number;
}

const FACE_STYLE: Record<Face, string> = {
  regular: "normal",
  bold: "bold",
  italic: "italic",
  boldItalic: "bolditalic",
  heading: "bold",
};

/** Helvetica (the fallback) only has Latin-1. */
function latin1(s: string): string {
  return s
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\xFF]/g, "?");
}

class Pen {
  readonly doc: jsPDF;
  private readonly embedded: boolean;

  constructor(doc: jsPDF, fonts: BriefFonts | null) {
    this.doc = doc;
    this.embedded = Boolean(fonts);
    if (!fonts) return;
    const files: [keyof BriefFonts, string, string, string][] = [
      ["regular", "DQABriefText-Regular.ttf", "BriefText", "normal"],
      ["bold", "DQABriefText-Bold.ttf", "BriefText", "bold"],
      ["italic", "DQABriefText-Italic.ttf", "BriefText", "italic"],
      ["boldItalic", "DQABriefText-BoldItalic.ttf", "BriefText", "bolditalic"],
      ["heading", "Poppins-Bold.ttf", "BriefHeading", "bold"],
    ];
    for (const [key, file, family, style] of files) {
      doc.addFileToVFS(file, fonts[key]);
      doc.addFont(file, family, style);
    }
  }

  t(s: string): string {
    return this.embedded ? s : latin1(s);
  }

  private use(style: Style): void {
    const family = this.embedded ? (style.face === "heading" ? "BriefHeading" : "BriefText") : "helvetica";
    this.doc.setFont(family, FACE_STYLE[style.face]);
    this.doc.setFontSize(style.size);
    const [r, g, b] = rgb(style.color);
    this.doc.setTextColor(r, g, b);
  }

  /** Character spacing that gives `style` its tracking / fit. */
  private spacing(s: string, style: Style): number {
    if (style.track) return style.track;
    if (style.fit && s.length > 0) return ((style.fit - 1) * this.doc.getTextWidth(s)) / s.length;
    return 0;
  }

  width(text: string, style: Style): number {
    const s = this.t(text);
    this.use(style);
    return this.doc.getTextWidth(s) + this.spacing(s, style) * s.length;
  }

  text(text: string, x: number, y: number, style: Style, align: "left" | "center" | "right" = "left"): number {
    const s = this.t(text);
    this.use(style);
    const charSpace = this.spacing(s, style);
    const w = this.doc.getTextWidth(s) + charSpace * s.length;
    const left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
    this.doc.text(s, left, y, charSpace ? { charSpace } : {});
    return w;
  }

  /** Word-wraps to `width`; at most `maxLines`, the last ending in "…" when cut. */
  wrap(text: string, width: number, style: Style, maxLines = Infinity): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || this.width(next, style) <= width) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && this.width(`${last}…`, style) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }

  /** The largest size from `style.size` down to `min` at which `text` fits `width`. */
  fitSize(text: string, width: number, style: Style, min: number): Style {
    let size = style.size;
    while (size > min && this.width(text, { ...style, size }) > width) size -= 0.5;
    return { ...style, size };
  }

  fill(hex: string): void {
    const [r, g, b] = rgb(hex);
    this.doc.setFillColor(r, g, b);
  }

  stroke(hex: string, width: number): void {
    const [r, g, b] = rgb(hex);
    this.doc.setDrawColor(r, g, b);
    this.doc.setLineWidth(width);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.fill(color);
    this.doc.rect(x, y, w, h, "F");
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, color: string): void {
    this.fill(color);
    this.doc.roundedRect(x, y, w, h, r, r, "F");
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
    this.stroke(color, width);
    this.doc.line(x1, y1, x2, y2);
  }

  dashedRoundRect(x: number, y: number, w: number, h: number, r: number, color: string): void {
    this.stroke(color, 0.75);
    this.doc.setLineDashPattern([3, 2.25], 0);
    this.doc.roundedRect(x, y, w, h, r, r, "S");
    this.doc.setLineDashPattern([], 0);
  }

  dot(cx: number, cy: number, r: number, color: string): void {
    this.fill(color);
    this.doc.circle(cx, cy, r, "F");
  }

  icon(name: BriefIconName, x: number, y: number, size: number, color: string): void {
    drawBriefIcon(this.doc, name, x, y, size, rgb(color));
  }
}

// ---- inline runs (table cells) ----

interface Token {
  text: string;
  style: Style;
  /** Space before the token when it does not start a line. */
  gap: number;
}

/** Lays tokens into lines of at most `width`, breaking before any token (as the template does). */
function layoutTokens(pen: Pen, tokens: Token[], width: number): Token[][] {
  const lines: Token[][] = [];
  let line: Token[] = [];
  let used = 0;
  for (const token of tokens) {
    const w = pen.width(token.text, token.style);
    if (line.length > 0 && used + token.gap + w > width) {
      lines.push(line);
      line = [];
      used = 0;
    }
    used += (line.length > 0 ? token.gap : 0) + w;
    line.push(token);
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function drawTokenLine(pen: Pen, line: Token[], x: number, y: number): void {
  let cx = x;
  line.forEach((token, index) => {
    if (index > 0) cx += token.gap;
    cx += pen.text(token.text, cx, y, token.style);
  });
}

/** Words of `text` as breakable tokens. */
function words(pen: Pen, text: string, style: Style, firstGap?: number): Token[] {
  const space = pen.width(" ", style);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ text: word, style, gap: index === 0 && firstGap !== undefined ? firstGap : space }));
}

// ---- page 1 ----

const kicker = (brief: DqaBrief) => `${brief.portal.toUpperCase()} DATA QUALITY BRIEF`;

function drawBannerOne(pen: Pen, brief: DqaBrief): void {
  pen.rect(0, 0, PW, 90, TOKEN.banner);
  pen.text(kicker(brief), LEFT, 26.9, { face: "bold", size: 10, color: TOKEN.bannerKicker, track: 1.9 });

  const meta = [
    ["Review period", brief.period],
    [`${brief.system} data as on`, brief.dataAsOn],
    ["Brief generated", brief.generatedOn],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const labelStyle: Style = { face: "regular", size: 10, color: TOKEN.bannerKicker };
  const valueStyle: Style = { face: "bold", size: 11, color: TOKEN.white, fit: 0.962 };
  const labelW = Math.max(...meta.map(([label]) => pen.width(label, labelStyle)));
  const valueW = Math.max(...meta.map(([, value]) => pen.width(value, valueStyle)));
  const labelX = Math.min(426, 568.7 - valueW - 10 - labelW);
  const baselines = meta.length === 3 ? [31.4, 48.0, 64.6] : [39.7, 56.3, 72.9];
  meta.forEach(([label, value], index) => {
    pen.text(label, labelX, baselines[index], labelStyle);
    pen.text(value, 568.7, baselines[index] + 1, valueStyle, "right");
  });

  const textW = labelX - LEFT - 14;
  const titleStyle = pen.fitSize(brief.place, textW, { face: "heading", size: 28, color: TOKEN.white }, 16);
  pen.text(brief.place, LEFT, 55, titleStyle);

  const unitPart = brief.uploadedUnits
    ? `${fmt(brief.units)} of ${counted(brief.uploadedUnits, brief.unit)}`
    : counted(brief.units, brief.unit);
  const areaPart = `${counted(brief.areas, brief.area)}${
    brief.unmapped > 0 ? ` + ${counted(brief.unmapped, brief.unit)} not mapped to a ${brief.area.one}` : ""
  }`;
  const subtitle = brief.unitIsArea ? unitPart : `${unitPart}   ·   ${areaPart}`;
  pen.text(subtitle, LEFT, 73.9, pen.fitSize(subtitle, textW, { face: "regular", size: 12, color: TOKEN.bannerText }, 8));
}

function drawScores(pen: Pen, brief: DqaBrief): void {
  // Overall card.
  pen.roundRect(27, 105, 147, 78, 6, TOKEN.overallCard);
  pen.text("OVERALL DQA SCORE", 39, 122.4, { face: "bold", size: 8, color: TOKEN.scoreKicker, track: 1.165 });
  const scoreText = brief.overall === null ? "N/A" : brief.overall.toFixed(1);
  const scoreW = pen.text(scoreText, 39, 155, { face: "heading", size: 32, color: TOKEN.white });
  if (brief.overall !== null) {
    const pillX = Math.min(39 + scoreW + 15.5, 174 - 8 - 43.5);
    pen.roundRect(pillX, 135, 43.5, 15, 7.5, mix(TOKEN.overallCard, TOKEN.white, 0.149));
    pen.text(`Grade ${brief.grade}`, pillX + 21.75, 144.7, { face: "bold", size: 8, color: TOKEN.white }, "center");
  }
  if (brief.change) {
    const rounded = Math.round(brief.change.delta * 10) / 10;
    const [icon, color, value]: [BriefIconName, string, string] = rounded > 0
      ? ["trendingUp", TOKEN.up, `+${rounded.toFixed(1)}`]
      : rounded < 0
        ? ["trendingDown", TOKEN.down, rounded.toFixed(1)]
        : ["minus", TOKEN.bannerKicker, "No change"];
    const text = `${value} vs ${brief.change.period} (${brief.change.previous.toFixed(1)})`;
    pen.icon(icon, 39, 164.2, 9, color);
    pen.text(text, 51, 171.4, pen.fitSize(text, 174 - 8 - 51, { face: "bold", size: 8, color }, 6));
  }

  // Component strip: the template's four columns, or an even split of the same width.
  const count = brief.components.length;
  const separatorAt = (index: number) => (count === 4 ? 285 + (index - 1) * 94.5 : 180 + (index * (RIGHT - 180)) / count);
  const trackW = count === 4 ? 79.5 : (RIGHT - 180) / count - 20;
  brief.components.forEach((component, index) => {
    const column = separatorAt(index);
    const x = index === 0 ? 190.5 : column + 10.5;
    const color = COMPONENT_COLOR[component.key];
    if (index > 0) pen.line(column, 112.5, column, 175.5, TOKEN.hair, 0.75);
    pen.dot(x + 3, 117.8, 3, color);
    pen.text(component.name, x + 9.7, 120.5, { face: "bold", size: 9, color: TOKEN.ink2 });
    pen.text(component.score === null ? "N/A" : component.score.toFixed(1), x, 145.9, {
      face: "heading",
      size: 22,
      color: TOKEN.ink,
    });
    pen.roundRect(x, 154.5, trackW, 3.75, 1.875, TOKEN.hair);
    if (component.score !== null && component.score > 0) {
      pen.roundRect(x, 154.5, Math.max(3.75, (trackW * component.score) / 100), 3.75, 1.875, color);
    }
    const flagged = component.scoreNote ?? `${counted(component.flaggedUnits, brief.unit)} flagged`;
    pen.text(flagged, x, 172.1, pen.fitSize(flagged, trackW + 4.5, { face: "regular", size: 8, color: TOKEN.muted }, 6.5));
  });
}

function drawIssuesHeading(pen: Pen, brief: DqaBrief): void {
  pen.text("Where the issues are", LEFT, 212.4, { face: "heading", size: 14, color: TOKEN.ink });
  const subtitle = brief.unitIsArea
    ? `${capitalize(brief.unit.many)} flagged by each check`
    : `${capitalize(brief.unit.many)} flagged and ${brief.area.many} affected`;
  pen.text(subtitle, LEFT, 224.6, {
    face: "regular",
    size: 9,
    color: TOKEN.muted,
  });
  const legend: Style = { face: "regular", size: 8, color: TOKEN.ink2 };
  pen.roundRect(372, 204, 9, 9, 2.25, TOKEN.redTile);
  pen.text("Most concerning indicator in its component", 384.8, 210.7, legend);
  pen.roundRect(372, 216.75, 9, 9, 2.25, TOKEN.greyTile);
  pen.text("Other checks", 384.8, 223.4, legend);
  pen.roundRect(444, 216.75, 9, 9, 2.25, TOKEN.white);
  pen.dashedRoundRect(444, 216.75, 9, 9, 2.25, TOKEN.hair);
  pen.text(`No ${brief.unit.one} flagged`, 456.8, 223.4, legend);
}

const TILE_W = 101.625;
const TILE_H = 63;
const TILE_STEP_X = 109.125;
const TILE_STEP_Y = 70.4;
const TILE_TEXT_W = 88.2;
const titleStyleOf = (color: string): Style => ({ face: "bold", size: 9, color, fit: 0.947 });

function drawTile(pen: Pen, brief: DqaBrief, tile: BriefTile, x: number, y: number, rowTitleLines: number): void {
  const worst = tile.state === "worst";
  const dashed = tile.state === "clear" || tile.state === "notChecked";
  if (worst) pen.roundRect(x, y, TILE_W, TILE_H, 5.25, TOKEN.redTile);
  else if (dashed) {
    pen.roundRect(x, y, TILE_W, TILE_H, 5.25, TOKEN.white);
    pen.dashedRoundRect(x, y, TILE_W, TILE_H, 5.25, TOKEN.dashed);
  } else pen.roundRect(x, y, TILE_W, TILE_H, 5.25, TOKEN.greyTile);

  const titleStyle = titleStyleOf(worst ? TOKEN.white : dashed ? TOKEN.muted : TOKEN.ink);
  const titleLines = pen.wrap(tile.title, TILE_TEXT_W, titleStyle, 2);
  titleLines.forEach((line, index) => pen.text(line, x + 6.7, y + 14 + index * 10.1, titleStyle));

  if (tile.detail) {
    const detailStyle: Style = { face: "regular", size: 7, color: worst ? TOKEN.onRedDetail : TOKEN.muted };
    const first = tile.detailAlign === "title"
      ? y + 14 + (titleLines.length - 1) * 10.1 + 9.4
      : y + 14 + (Math.max(rowTitleLines, titleLines.length) - 1) * 10.1 + 10.6;
    const room = Math.max(1, Math.floor((y + 35 - first) / 8) + 1);
    pen.wrap(tile.detail, TILE_TEXT_W, detailStyle, Math.min(2, room)).forEach((line, index) => {
      pen.text(line, x + 6.7, first + index * 8, detailStyle);
    });
  }

  const boxX = x + 3.75;
  const boxW = TILE_W - 7.5;
  if (dashed) {
    const clear = tile.state === "clear";
    const color = clear ? TOKEN.green : TOKEN.muted;
    const text = clear ? `No ${brief.unit.one} flagged` : "Not checked";
    pen.icon(clear ? "circleCheck" : "circleMinus", x + 9, y + 43.6, 9, color);
    pen.text(text, x + 21, y + 51, pen.fitSize(text, TILE_W - 26, { face: "bold", size: 8, color, fit: 0.945 }, 6));
    return;
  }
  pen.roundRect(boxX, y + 36.75, boxW, 23.25, 3.75, TOKEN.white);
  if (!worst) {
    pen.stroke(TOKEN.hair, 0.75);
    pen.doc.roundedRect(boxX, y + 36.75, boxW, 23.25, 3.75, 3.75, "S");
  }
  const numberStyle: Style = { face: "heading", size: 11, color: worst ? TOKEN.red : TOKEN.ink };
  const labelStyle: Style = { face: "regular", size: 7, color: TOKEN.muted };
  if (brief.unitIsArea) {
    // The units are the areas: one number.
    const centre = boxX + boxW / 2;
    pen.text(fmt(tile.flagged), centre, y + 47.8, numberStyle, "center");
    pen.text(brief.unit.many, centre, y + 57.2, labelStyle, "center");
    return;
  }
  pen.line(x + TILE_W / 2, y + 41.25, x + TILE_W / 2, y + 55.5, TOKEN.hair, 0.75);
  const left = boxX + boxW / 4;
  const right = boxX + (3 * boxW) / 4;
  pen.text(fmt(tile.flagged), left, y + 47.8, numberStyle, "center");
  pen.text(fmt(tile.areas), right, y + 47.8, numberStyle, "center");
  pen.text(brief.unit.many, left, y + 57.2, pen.fitSize(brief.unit.many, boxW / 2 - 4, labelStyle, 5.5), "center");
  pen.text(brief.area.many, right, y + 57.2, pen.fitSize(brief.area.many, boxW / 2 - 4, labelStyle, 5.5), "center");
}

/** Draws one component row from `y` (its top rule); returns the next row's top. */
function drawComponent(pen: Pen, brief: DqaBrief, component: BriefComponent, y: number): number {
  const color = COMPONENT_COLOR[component.key];
  pen.line(LEFT, y, RIGHT, y, TOKEN.hair, 0.75);
  pen.dot(36.75, y + 18.75, 9.75, color);
  pen.icon(COMPONENT_ICON[component.key], 31.5, y + 13.5, 10.5, TOKEN.white);
  pen.text(component.name, 50.8, y + 24.2, { face: "heading", size: 11, color: TOKEN.ink, fit: 0.962 });
  component.description.forEach((line, index) => {
    pen.text(line, LEFT, y + 44.1 + index * 10.8, { face: "italic", size: 9, color: TOKEN.ink2, fit: 0.946 });
  });

  const rows: BriefTile[][] = [];
  for (let i = 0; i < component.tiles.length; i += 4) rows.push(component.tiles.slice(i, i + 4));
  if (rows.length === 0) rows.push([]);
  rows.forEach((row, r) => {
    const top = y + 9.75 + r * TILE_STEP_Y;
    const rowTitleLines = Math.max(
      1,
      ...row.map((tile) => pen.wrap(tile.title, TILE_TEXT_W, titleStyleOf(TOKEN.ink), 2).length),
    );
    row.forEach((tile, c) => drawTile(pen, brief, tile, 139.5 + c * TILE_STEP_X, top, rowTitleLines));
  });
  return y + 9.75 + rows.length * TILE_H + (rows.length - 1) * (TILE_STEP_Y - TILE_H) + 9.75;
}

function drawStandsOut(pen: Pen, brief: DqaBrief, y0: number): void {
  pen.line(LEFT, y0, RIGHT, y0, TOKEN.hair, 0.75);
  const y = y0 - 636; // offsets below are the template's, whose rule sits at 636
  pen.text("What stands out", LEFT, y + 662.4, { face: "heading", size: 14, color: TOKEN.ink });

  // Left: facilities with an issue, and the 4+ / 1 to 3 / none split.
  const big = fmt(brief.withIssue);
  const bigW = pen.text(big, LEFT, y + 700.6, { face: "heading", size: 30, color: TOKEN.ink });
  const leadStyle: Style = { face: "regular", size: 9, color: TOKEN.ink2 };
  const leadX = LEFT + bigW + 2.3;
  const lead = `of ${counted(brief.units, brief.unit)} ${plural(brief.withIssue, "has", "have")} at least one data quality issue flagged.`;
  const leadLines = pen.wrap(lead, 267 - leadX, leadStyle, 3);
  leadLines.forEach((line, index) => pen.text(line, leadX, y + 700.8 - (leadLines.length - 1 - index) * 11, leadStyle));

  const bands = [
    { n: brief.high, color: TOKEN.red, label: "with 4+ issues" },
    { n: brief.some, color: TOKEN.amber, label: "with 1 to 3 issues" },
    { n: brief.none, color: TOKEN.green, label: "with no issue" },
  ];
  const shown = bands.filter((band) => band.n > 0);
  const sum = shown.reduce((total, band) => total + band.n, 0);
  let bx = LEFT;
  if (sum === 0) pen.roundRect(LEFT, y + 712.5, 240, 12, 2.25, TOKEN.hair);
  shown.forEach((band, index) => {
    // Each segment is its share of the bar, less the 1.5 pt gap that follows it.
    const w = Math.max(1, (240 * band.n) / sum - (index < shown.length - 1 ? 1.5 : 0));
    if (index === 0 || index === shown.length - 1) pen.roundRect(bx, y + 712.5, w, 12, Math.min(2.25, w / 2), band.color);
    else pen.rect(bx, y + 712.5, w, 12, band.color);
    bx += w + 1.5;
  });
  bands.forEach((band, index) => {
    const x = LEFT + index * 81;
    pen.dot(x + 3, y + 738, 3, band.color);
    pen.text(fmt(band.n), x + 9.8, y + 741.4, { face: "heading", size: 11, color: TOKEN.ink });
    pen.text(band.label, x + 9.8, y + 751, { face: "regular", size: 8, color: TOKEN.muted });
  });
  const ctaStyle: Style = { face: "bold", size: 9, color: TOKEN.ink2 };
  pen.wrap(brief.callToAction, 240, ctaStyle, 3).forEach((line, index) => {
    pen.text(line, LEFT, y + 770.9 + index * 11, ctaStyle);
  });

  // Right: up to four auto sentences, gaps closed.
  const titleStyle: Style = { face: "bold", size: 10, color: TOKEN.ink };
  const detailStyle: Style = { face: "regular", size: 9, color: TOKEN.ink2 };
  let ty = y + 684;
  for (const highlight of brief.highlights) {
    pen.dot(304.45, ty + 0.75, 9.75, TOKEN.iconWell);
    pen.icon(highlight.icon, 299.2, ty - 4.5, 10.5, TOKEN.banner);
    const titleLines = pen.wrap(highlight.title, RIGHT - 321.7, titleStyle, 2);
    titleLines.forEach((line, index) => pen.text(line, 321.7, ty + index * 12.2, titleStyle));
    let last = ty + (titleLines.length - 1) * 12.2;
    pen.wrap(highlight.detail, RIGHT - 321.7, detailStyle, 2).forEach((line, index) => {
      last = ty + titleLines.length * 12.2 + index * 11;
      pen.text(line, 321.7, last, detailStyle);
    });
    ty = last + 16.3;
  }
}

// ---- page 2 ----

function drawBannerTwo(pen: Pen, brief: DqaBrief): void {
  pen.rect(0, 0, PW, 72, TOKEN.banner);
  pen.fill(TOKEN.white);
  pen.doc.saveGraphicsState();
  pen.doc.setGState(new GState({ opacity: 0.0784 }));
  pen.doc.circle(565.5, 30, 97.5, "F");
  pen.doc.setGState(new GState({ opacity: 0.102 }));
  pen.doc.circle(580.5, 72, 45, "F");
  pen.doc.restoreGraphicsState();

  pen.text(kicker(brief), LEFT, 25, { face: "bold", size: 8, color: TOKEN.bannerKicker, track: 1.68 });
  pen.text(`Where to act, ${brief.area.one} by ${brief.area.one}`, LEFT, 52.1, { face: "heading", size: 24, color: TOKEN.white });
  const placeStyle = pen.fitSize(brief.place, RIGHT - 390, { face: "heading", size: 12, color: TOKEN.white }, 8);
  pen.text(brief.place, RIGHT, 33.6, placeStyle, "right");
  pen.text(brief.period, 568.8, 45.6, { face: "regular", size: 9, color: TOKEN.bannerText, fit: 0.947 }, "right");
}

const CELL_PAD = 6;
const ROW_H = 25.56;
const HEADER_H = 19.5;
/** Space the follow-ups take below the table (heading to last line). */
const FOLLOW_UPS_H = 78;
/** Lowest table bottom that still leaves the follow-ups above the footer. */
const TABLE_BOTTOM_MAX = FOOTER_RULE - 6 - FOLLOW_UPS_H;

interface LaidCell {
  lines: Token[][];
}

function cellStyle(size: number, face: Face = "regular", color = TOKEN.ink): Style {
  return { face, size, color };
}

/** Lines a list cell (most concerning units, checks flagged) may take before names give way to "+k more". */
const LIST_LINES = 3;

/**
 * `lead` then the names separated by "·", whole names only (a line may end or
 * start with "·"). Only when they do not fit in three lines do the last ones
 * become "+k more" — and never "+1 more" or "+2 more": those are listed instead.
 */
function listCell(pen: Pen, lead: Token | null, names: string[], size: number, width: number): LaidCell {
  const ink = cellStyle(size);
  const space = pen.width(" ", ink);
  const build = (shown: number): Token[] => {
    const tokens: Token[] = lead ? [lead] : [];
    names.slice(0, shown).forEach((name, index) => {
      if (index > 0) tokens.push({ text: "·", style: ink, gap: 2 * space });
      tokens.push({ text: name, style: ink, gap: index === 0 ? 3 * space : 2 * space });
    });
    if (shown < names.length) tokens.push({ text: `+${names.length - shown} more`, style: ink, gap: 2 * space });
    return tokens;
  };
  const all = layoutTokens(pen, build(names.length), width);
  if (all.length <= LIST_LINES) return { lines: all };
  for (let shown = names.length - 1; shown >= 1; shown -= 1) {
    const lines = layoutTokens(pen, build(shown), width);
    if (lines.length > LIST_LINES) continue;
    return { lines: names.length - shown <= 2 ? all : lines };
  }
  return { lines: layoutTokens(pen, build(1), width) };
}

/** A page-2 table: its columns, group labels and header, and how a row is laid out and drawn. */
interface TableSpec<T extends { lines: number }> {
  cols: number[];
  drawGroups(tableTop: number): void;
  drawHeader(top: number): void;
  lay(size: number): T[];
  drawRow(row: T, index: number, top: number, h: number, size: number): void;
}

const groupStyle: Style = { face: "bold", size: 6, color: TOKEN.muted, track: 1.17 };
const headerStyle: Style = { face: "bold", size: 9, color: TOKEN.white, fit: 0.955 };

/** Vertical position helpers for a row's text. */
function rowText(top: number, h: number, size: number) {
  const lineH = size * 1.222;
  const centre = top + h / 2 + size * 0.294;
  return { lineH, centre, first: (lines: number) => centre - ((lines - 1) * lineH) / 2 };
}

// -- areas (blocks or districts) with their units --

const COLS = [27, 99, 132, 160.5, 193.5, 229.5, 355.5, 568.5];

interface LaidRow {
  row: BriefAreaRow | null; // null = total row
  block: string[];
  common: LaidCell;
  concerning: LaidCell;
  lines: number;
}

/** "Outliers (17 facilities)" / "Key indicators missing, Outliers +2 (3 facilities each)". */
function commonTokens(pen: Pen, brief: DqaBrief, row: BriefAreaRow, size: number): Token[] {
  if (!row.common) return words(pen, "—", cellStyle(size, "regular", TOKEN.muted));
  const { names, more, count } = row.common;
  const ink = cellStyle(size);
  const muted = cellStyle(size, "regular", TOKEN.muted);
  const space = pen.width(" ", ink);
  const each = names.length + more > 1 ? " each" : "";
  return [
    ...words(pen, names.join(", "), ink),
    ...(more > 0 ? [{ text: `+${more}`, style: ink, gap: space }] : []),
    ...words(pen, `(${counted(count, brief.unit)}${each})`, muted, 2 * space),
  ];
}

/** "5 issues   Dekpura  ·  May Farida": every unit at the top issue count, A to Z. */
function concerningCell(pen: Pen, brief: DqaBrief, row: BriefAreaRow, size: number, width: number): LaidCell {
  if (!row.concerning) {
    return { lines: [words(pen, `No ${brief.unit.one} flagged`, cellStyle(size, "bold", TOKEN.green))] };
  }
  const { issues, names } = row.concerning;
  const lead = { text: `${issues} ${plural(issues, "issue", "issues")}`, style: cellStyle(size, "bold", issues >= 4 ? TOKEN.red : TOKEN.ink2), gap: 0 };
  return listCell(pen, lead, names, size, width);
}

function areaTable(pen: Pen, brief: DqaBrief): TableSpec<LaidRow> {
  const units = brief.unit.many.toUpperCase();
  return {
    cols: COLS,
    drawGroups(tableTop) {
      pen.text(`${units} BY ISSUES`, 164.25, tableTop - 5.9, groupStyle, "center");
      pen.line(100.5, tableTop - 2.25, 228, tableTop - 2.25, TOKEN.groupRule, 0.75);
      pen.text(`ISSUES  ·  ${units} TO FOLLOW UP FIRST`, 355.5, tableTop - 5.9, groupStyle);
      pen.line(357, tableTop - 2.25, 567, tableTop - 2.25, TOKEN.groupRule, 0.75);
    },
    drawHeader(top) {
      pen.rect(LEFT, top, CONTENT_W, HEADER_H, TOKEN.navy);
      const baseline = top + 12.5;
      pen.text(capitalize(brief.area.one), COLS[0] + CELL_PAD, baseline, headerStyle);
      ["Total", "4+", "1 to 3", "None"].forEach((label, index) => {
        pen.text(label, (COLS[index + 1] + COLS[index + 2]) / 2, baseline, headerStyle, "center");
      });
      pen.text("Most common issue", COLS[5] + CELL_PAD, baseline, headerStyle);
      pen.text(`Most concerning ${brief.unit.many}`, COLS[6] + CELL_PAD, baseline, headerStyle);
    },
    lay(size) {
      const blockW = COLS[1] - COLS[0] - 2 * CELL_PAD;
      const commonW = COLS[6] - COLS[5] - 2 * CELL_PAD;
      const concerningW = COLS[7] - COLS[6] - 2 * CELL_PAD;
      const laid: LaidRow[] = brief.rows.map((row) => {
        const block = pen.wrap(row.name, blockW, cellStyle(size, row.unmapped ? "boldItalic" : "bold"), 2);
        const common = { lines: layoutTokens(pen, commonTokens(pen, brief, row, size), commonW).slice(0, 2) };
        const concerning = concerningCell(pen, brief, row, size, concerningW);
        return { row, block, common, concerning, lines: Math.max(1, block.length, common.lines.length, concerning.lines.length) };
      });
      laid.push({ row: null, block: [brief.totalLabel], common: { lines: [] }, concerning: { lines: [] }, lines: 1 });
      return laid;
    },
    drawRow(laid, index, top, h, size) {
      const row = laid.row;
      const fill = !row ? TOKEN.totalRow : row.unmapped ? TOKEN.unmappedRow : index % 2 === 1 ? TOKEN.zebra : TOKEN.white;
      pen.rect(LEFT, top, CONTENT_W, h, fill);
      const heat = row ? heatOf(row.high) : null;
      if (heat) pen.rect(COLS[2], top, COLS[3] - COLS[2], h, heat);
      const { lineH, centre, first } = rowText(top, h, size);

      const blockStyle = cellStyle(size, row?.unmapped ? "boldItalic" : "bold");
      laid.block.forEach((line, i) => pen.text(line, COLS[0] + CELL_PAD, first(laid.block.length) + i * lineH, blockStyle));

      const bold = !row;
      const total = row ? row.total : brief.units;
      const high = row ? row.high : brief.high;
      const some = row ? row.some : brief.some;
      const none = row ? row.none : brief.none;
      const numbers: [number, Style][] = [
        [total, cellStyle(size, bold ? "bold" : "regular")],
        [high, high > 0 ? cellStyle(size, "bold", TOKEN.darkRed) : cellStyle(size, bold ? "bold" : "regular", TOKEN.muted)],
        [some, cellStyle(size, bold ? "bold" : "regular")],
        [none, cellStyle(size, bold ? "bold" : "regular", bold ? TOKEN.ink : TOKEN.muted)],
      ];
      numbers.forEach(([value, style], i) => {
        pen.text(fmt(value), (COLS[i + 1] + COLS[i + 2]) / 2, centre, style, "center");
      });

      for (const [cell, x] of [[laid.common, COLS[5]], [laid.concerning, COLS[6]]] as const) {
        cell.lines.forEach((line, i) => drawTokenLine(pen, line, x + CELL_PAD, first(cell.lines.length) + i * lineH));
      }
    },
  };
}

// -- units that are their own areas (district-level state upload) --

const UNIT_COLS = [27, 160.5, 229.5, 568.5];

interface LaidUnitRow {
  row: BriefUnitRow | null; // null = total row
  name: string[];
  checks: LaidCell;
  lines: number;
}

function unitTable(pen: Pen, brief: DqaBrief): TableSpec<LaidUnitRow> {
  const { unit } = brief;
  return {
    cols: UNIT_COLS,
    drawGroups(tableTop) {
      pen.text(`${unit.many.toUpperCase()} BY ISSUES`, 128.25, tableTop - 5.9, groupStyle, "center");
      pen.line(28.5, tableTop - 2.25, 228, tableTop - 2.25, TOKEN.groupRule, 0.75);
      pen.text(`CHECKS FLAGGED  ·  WHAT TO VERIFY IN EACH ${unit.one.toUpperCase()}`, 229.5, tableTop - 5.9, groupStyle);
      pen.line(231, tableTop - 2.25, 567, tableTop - 2.25, TOKEN.groupRule, 0.75);
    },
    drawHeader(top) {
      pen.rect(LEFT, top, CONTENT_W, HEADER_H, TOKEN.navy);
      const baseline = top + 12.5;
      pen.text(capitalize(unit.one), UNIT_COLS[0] + CELL_PAD, baseline, headerStyle);
      pen.text("Issues", (UNIT_COLS[1] + UNIT_COLS[2]) / 2, baseline, headerStyle, "center");
      pen.text("Checks flagged", UNIT_COLS[2] + CELL_PAD, baseline, headerStyle);
    },
    lay(size) {
      const nameW = UNIT_COLS[1] - UNIT_COLS[0] - 2 * CELL_PAD;
      const checksW = UNIT_COLS[3] - UNIT_COLS[2] - 2 * CELL_PAD;
      const laid: LaidUnitRow[] = brief.unitRows.map((row) => {
        const name = pen.wrap(row.name, nameW, cellStyle(size, "bold"), 2);
        const checks = row.checks.length > 0
          ? listCell(pen, null, row.checks, size, checksW)
          : { lines: [words(pen, "No check flagged", cellStyle(size, "bold", TOKEN.green))] };
        return { row, name, checks, lines: Math.max(1, name.length, checks.lines.length) };
      });
      const summary = `${counted(brief.high, unit)} with 4+ issues  ·  ${fmt(brief.some)} with 1 to 3  ·  ${fmt(brief.none)} with none`;
      const checks = { lines: layoutTokens(pen, words(pen, summary, cellStyle(size, "bold")), checksW) };
      laid.push({ row: null, name: [brief.totalLabel], checks, lines: Math.max(1, checks.lines.length) });
      return laid;
    },
    drawRow(laid, index, top, h, size) {
      const row = laid.row;
      pen.rect(LEFT, top, CONTENT_W, h, !row ? TOKEN.totalRow : index % 2 === 1 ? TOKEN.zebra : TOKEN.white);
      const heat = row ? heatOf(row.issues) : null;
      if (heat) pen.rect(UNIT_COLS[1], top, UNIT_COLS[2] - UNIT_COLS[1], h, heat);
      const { lineH, centre, first } = rowText(top, h, size);
      laid.name.forEach((line, i) => pen.text(line, UNIT_COLS[0] + CELL_PAD, first(laid.name.length) + i * lineH, cellStyle(size, "bold")));
      if (row) {
        const style = row.issues >= 4
          ? cellStyle(size, "bold", TOKEN.darkRed)
          : cellStyle(size, "regular", row.issues > 0 ? TOKEN.ink : TOKEN.muted);
        pen.text(fmt(row.issues), (UNIT_COLS[1] + UNIT_COLS[2]) / 2, centre, style, "center");
      }
      laid.checks.lines.forEach((line, i) => drawTokenLine(pen, line, UNIT_COLS[2] + CELL_PAD, first(laid.checks.lines.length) + i * lineH));
    },
  };
}

// -- fitting and drawing --

interface TablePlan<T> {
  size: number;
  rows: T[];
  heights: number[];
  /** Whether the rows fit the space they were planned for. */
  fits: boolean;
}

/** Font size and row heights: shorter rows first, then a smaller font. */
function planTable<T extends { lines: number }>(spec: TableSpec<T>, available: number): TablePlan<T> {
  let fallback: TablePlan<T> | null = null;
  for (const size of [9, 8.5, 8, 7.5, 7]) {
    const rows = spec.lay(size);
    const lineH = size * 1.222;
    // Each row wants the template's height, or more when its text needs it.
    const minimum = rows.map((row) => row.lines * lineH + 3.5);
    const wanted = minimum.map((h) => Math.max(h, ROW_H));
    const sum = (heights: number[]) => heights.reduce((total, h) => total + h, 0);
    if (sum(wanted) <= available) return { size, rows, heights: wanted, fits: true };
    if (sum(minimum) <= available) {
      const share = (available - sum(minimum)) / (sum(wanted) - sum(minimum));
      return { size, rows, heights: minimum.map((h, i) => h + (wanted[i] - h) * share), fits: true };
    }
    fallback = { size, rows, heights: minimum, fits: false };
  }
  return fallback!;
}

function drawGrid(pen: Pen, cols: number[], top: number, bottom: number, rowEdges: number[]): void {
  for (const edge of [top, ...rowEdges]) pen.line(26.8, edge, 568.8, edge, TOKEN.hair, 0.5);
  for (const x of cols) pen.line(x, top - 0.3, x, bottom, TOKEN.hair, 0.5);
}

/**
 * Draws the table from `tableTop`; returns where it ends and whether the
 * follow-ups still have room. Two pages for any district: the table may take
 * the follow-ups' space before it runs on to another page (at 7 pt, header
 * repeated).
 */
function drawTable<T extends { lines: number }>(pen: Pen, spec: TableSpec<T>, tableTop: number): { y: number; followUps: boolean } {
  spec.drawGroups(tableTop);
  let plan = planTable(spec, TABLE_BOTTOM_MAX - (tableTop + HEADER_H));
  let followUps = true;
  if (!plan.fits) {
    const fullPage = planTable(spec, FOOTER_RULE - 10 - (tableTop + HEADER_H));
    if (fullPage.fits) {
      plan = fullPage;
      followUps = false;
    }
  }
  let pageTop = tableTop;
  spec.drawHeader(pageTop);
  let y = pageTop + HEADER_H;
  let edges: number[] = [y];
  plan.rows.forEach((laid, index) => {
    const h = plan.heights[index];
    if (y + h > FOOTER_RULE - 10 + 0.01) {
      drawGrid(pen, spec.cols, pageTop, y, edges);
      pen.doc.addPage();
      pageTop = 40;
      spec.drawHeader(pageTop);
      y = pageTop + HEADER_H;
      edges = [y];
    }
    spec.drawRow(laid, index, y, h, plan.size);
    y += h;
    edges.push(y);
  });
  drawGrid(pen, spec.cols, pageTop, y, edges);
  return { y, followUps };
}

function drawFollowUps(pen: Pen, brief: DqaBrief, top: number): void {
  pen.text("Suggested follow-ups", LEFT, top + 29.1, { face: "heading", size: 12, color: TOKEN.ink });
  const circleTop = top + 41;
  const { unit, area } = brief;
  const textStyle: Style = { face: "regular", size: 9, color: TOKEN.ink2, fit: 0.951 };
  const fits = (text: string) => pen.wrap(text, 135, textStyle).length <= 2;
  const startText = brief.unitIsArea
    ? `The ${unit.many} at the top of the table, and the checks flagged for them.`
    : `${capitalize(area.many)} with the most 4+ ${unit.many}, and their most concerning ${unit.many}.`;
  const steps: { icon: BriefIconName; title: string; text: string }[] = [
    {
      icon: "clipboardCheck",
      title: "1. Start at the top",
      // Longer unit names ("sub centers") need the shorter wording to stay on two lines.
      text: fits(startText) ? startText : `${capitalize(area.many)} with the most 4+ ${unit.many}, and their most concerning ones.`,
    },
    {
      icon: "users",
      title: `2. Ask the ${brief.unitIsArea ? unit.one : area.one} to verify`,
      text: "Match the flagged entries with registers and session records.",
    },
    {
      icon: "refreshCw",
      title: "3. Correct and re-run",
      text: `Fix in ${brief.system}, then re-run DQA to see the change.`,
    },
  ];
  steps.forEach((step, index) => {
    const x = LEFT + index * 188;
    pen.dot(x + 11.25, circleTop + 11.25, 11.25, TOKEN.banner);
    pen.icon(step.icon, x + 5.25, circleTop + 5.25, 12, TOKEN.white);
    pen.text(step.title, x + 30, circleTop + 8.9, { face: "bold", size: 10, color: TOKEN.ink, fit: 0.951 });
    pen.wrap(step.text, 135, textStyle, 2).forEach((line, i) => pen.text(line, x + 30, circleTop + 20 + i * 11, textStyle));
  });
  for (const ax of [195.5, 375.3]) {
    pen.rect(ax, circleTop + 10.58, 11.5, 1.25, TOKEN.arrow);
    pen.fill(TOKEN.arrow);
    pen.doc.triangle(ax + 10.5, circleTop + 8.21, ax + 16.5, circleTop + 11.21, ax + 10.5, circleTop + 14.21, "F");
  }
}

function drawPageTwo(pen: Pen, brief: DqaBrief): void {
  drawBannerTwo(pen, brief);
  const { unit, area } = brief;
  const introStyle: Style = { face: "regular", size: 9, color: TOKEN.ink2 };
  const intro = pen.wrap(
    brief.unitIsArea
      ? `Each row is one ${unit.one}. ${capitalize(unit.many)} are sorted by the number of checks flagged, out of ${brief.checksRun}; 4 or more marks a priority ${unit.one}.`
      : `All numbers are ${unit.one} counts. ${capitalize(area.many)} are sorted by ${unit.many} with 4+ issues. Most concerning ${unit.many} = the ${unit.many} with the highest number of checks flagged in that ${area.one}, out of ${brief.checksRun}.`,
    CONTENT_W,
    introStyle,
  );
  intro.forEach((line, index) => pen.text(line, LEFT, 90 + index * 12, introStyle));
  const tableTop = 90 + (intro.length - 1) * 12 + 22.5;

  const table = brief.unitIsArea ? drawTable(pen, unitTable(pen, brief), tableTop) : drawTable(pen, areaTable(pen, brief), tableTop);
  if (!table.followUps) return;
  let y = table.y;
  if (y + FOLLOW_UPS_H > FOOTER_RULE - 6 + 0.01) {
    pen.doc.addPage();
    y = 20;
  }
  drawFollowUps(pen, brief, y);
}

// ---- footer ----

function drawFooters(pen: Pen, brief: DqaBrief): void {
  const pages = pen.doc.getNumberOfPages();
  const style: Style = { face: "regular", size: 7, color: TOKEN.muted };
  for (let page = 1; page <= pages; page += 1) {
    pen.doc.setPage(page);
    pen.line(LEFT, FOOTER_RULE, RIGHT, FOOTER_RULE, TOKEN.hair, 0.75);
    pen.text(brief.footer, LEFT, 825.4, style);
    pen.text(`Page ${page} of ${pages}`, RIGHT, 825.4, style, "right");
  }
}

/** The complete brief as a jsPDF document. */
export function renderBrief(brief: DqaBrief, fonts: BriefFonts | null): jsPDF {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setProperties({
    title: `${brief.portal} DQA brief – ${brief.place} – ${brief.period}`,
    subject: `${brief.portal} data quality brief`,
    creator: "DQA Desk Review",
  });
  const pen = new Pen(doc, fonts);

  drawBannerOne(pen, brief);
  drawScores(pen, brief);
  drawIssuesHeading(pen, brief);
  let y = 235.5;
  for (const component of brief.components) y = drawComponent(pen, brief, component, y);
  drawStandsOut(pen, brief, y);

  doc.addPage();
  drawPageTwo(pen, brief);
  drawFooters(pen, brief);
  return doc;
}

// ============================================================
// Vector icons for the HMIS DQA brief PDF.
//
// The outlines are Lucide's (ISC licence — the same icons the app shows via
// lucide-react), on Lucide's 24-unit grid with circles, ellipses and rounded
// rects written as arc paths. They are traced into the PDF with jsPDF's path
// operators, so they stay sharp at any zoom.
// ============================================================

import type jsPDF from "jspdf";

const ICONS = {
  database: ["M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0z", "M3 5V19A9 3 0 0 0 21 19V5", "M3 12A9 3 0 0 0 21 12"],
  listChecks: ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"],
  target: [
    "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z",
    "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0z",
    "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z",
  ],
  scale: [
    "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",
    "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",
    "M7 21h10",
    "M12 3v18",
    "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",
  ],
  search: ["m21 21-4.34-4.34", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0z"],
  layers: [
    "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
    "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
    "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
  ],
  fileX: [
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "m14.5 12.5-5 5",
    "m9.5 12.5 5 5",
  ],
  mapPin: [
    "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",
    "M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z",
  ],
  clipboardCheck: [
    "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z",
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
    "m9 14 2 2 4-4",
  ],
  users: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M16 3.128a4 4 0 0 1 0 7.744",
    "M22 21v-2a4 4 0 0 0-3-3.87",
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0z",
  ],
  refreshCw: [
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
    "M21 3v5h-5",
    "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
    "M8 16H3v5",
  ],
  trendingUp: ["M16 7h6v6", "m22 7-8.5 8.5-5-5L2 17"],
  trendingDown: ["M16 17h6v-6", "m22 17-8.5-8.5-5 5L2 7"],
  minus: ["M5 12h14"],
  circleCheck: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z", "m9 12 2 2 4-4"],
  circleMinus: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z", "M8 12h8"],
} as const;

export type BriefIconName = keyof typeof ICONS;

type Point = [number, number];

/** Cubic segments approximating an SVG elliptical arc (SVG 1.1 implementation notes, F.6.5). */
function arcToCubics(
  from: Point,
  rxIn: number,
  ryIn: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): [Point, Point, Point][] {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [[from, to, to]];
  const phi = (rotation * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const pointAt = (t: number): Point => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const derivAt = (t: number): Point => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const parts = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const curves: [Point, Point, Point][] = [];
  for (let i = 0; i < parts; i += 1) {
    const t1 = theta + i * step;
    const t2 = t1 + step;
    const p1 = pointAt(t1);
    const p2 = i === parts - 1 ? to : pointAt(t2);
    const d1 = derivAt(t1);
    const d2 = derivAt(t2);
    curves.push([[p1[0] + k * d1[0], p1[1] + k * d1[1]], [p2[0] - k * d2[0], p2[1] - k * d2[1]], p2]);
  }
  return curves;
}

const ARG_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Traces one SVG path into the current jsPDF path, mapping (u, v) -> (x + u*s, y + v*s). */
function tracePath(doc: jsPDF, d: string, x: number, y: number, s: number): void {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const at = (p: Point): Point => [x + p[0] * s, y + p[1] * s];
  let i = 0;
  let cmd = "";
  let cur: Point = [0, 0];
  let start: Point = [0, 0];
  let lastCtrl: Point | null = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const base: Point = rel ? cur : [0, 0];
    if (lower === "z") {
      doc.close();
      cur = start;
      lastCtrl = null;
      continue;
    }
    if (i + ARG_COUNT[lower] > tokens.length) break;
    if (lower === "m") {
      cur = [base[0] + num(), base[1] + num()];
      start = cur;
      doc.moveTo(...at(cur));
      cmd = rel ? "l" : "L"; // further pairs are line-tos
      lastCtrl = null;
    } else if (lower === "l") {
      cur = [base[0] + num(), base[1] + num()];
      doc.lineTo(...at(cur));
      lastCtrl = null;
    } else if (lower === "h") {
      cur = [(rel ? cur[0] : 0) + num(), cur[1]];
      doc.lineTo(...at(cur));
      lastCtrl = null;
    } else if (lower === "v") {
      cur = [cur[0], (rel ? cur[1] : 0) + num()];
      doc.lineTo(...at(cur));
      lastCtrl = null;
    } else if (lower === "c" || lower === "s") {
      const c1: Point = lower === "c"
        ? [base[0] + num(), base[1] + num()]
        : lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
      const c2: Point = [base[0] + num(), base[1] + num()];
      const end: Point = [base[0] + num(), base[1] + num()];
      doc.curveTo(...at(c1), ...at(c2), ...at(end));
      lastCtrl = c2;
      cur = end;
    } else if (lower === "a") {
      const rx = num();
      const ry = num();
      const rotation = num();
      const largeArc = num() !== 0;
      const sweep = num() !== 0;
      const end: Point = [base[0] + num(), base[1] + num()];
      for (const [c1, c2, p] of arcToCubics(cur, rx, ry, rotation, largeArc, sweep, end)) {
        doc.curveTo(...at(c1), ...at(c2), ...at(p));
      }
      cur = end;
      lastCtrl = null;
    } else {
      i += ARG_COUNT[lower] ?? 1; // q / t: not used by these icons
    }
  }
}

/** Draws a Lucide icon `size` points square at (x, y) in `color`, stroke 2 on the 24 grid. */
export function drawBriefIcon(
  doc: jsPDF,
  name: BriefIconName,
  x: number,
  y: number,
  size: number,
  color: [number, number, number],
): void {
  const s = size / 24;
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(2 * s);
  doc.setLineCap("round");
  doc.setLineJoin("round");
  for (const d of ICONS[name]) {
    tracePath(doc, d, x, y, s);
    doc.stroke();
  }
  doc.setLineCap("butt");
  doc.setLineJoin("miter");
}

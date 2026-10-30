// ============================================================
// Block-wise Overall Summary aggregation (pure, no React/DOM)
// Rolls every KPI card up the geography hierarchy:
// (district ->) block -> facility -> optional sub-center -> optional session site.
// Each node keeps, per indicator, how many units (the uploaded records: facilities,
// sub-centers or session sites) are flagged and how many the check could run for.
// ============================================================

import type { FacilityRecord, KpiCard } from './types';
import { COMPONENT_LABELS } from './scoring';

export type SummaryLevel = 'total' | 'district' | 'block' | 'facility' | 'subcenter' | 'sessionsite';

export interface SummaryIndicator {
  id: string;
  /** Full card name (tooltips, export). */
  name: string;
  /** Column header label. */
  short: string;
  group: string;
  /** Units flagged in the whole scope. */
  flagged: number;
  /** Units the check could run for in the whole scope; 0 = N/A everywhere. */
  eligible: number;
}

export interface SummaryNode {
  /** Unique path key. */
  key: string;
  label: string;
  level: SummaryLevel;
  /** Units (uploaded records) under this node. */
  units: number;
  /** Indicator id -> units flagged. */
  flagged: Record<string, number>;
  /** Indicator id -> units the check could run for. */
  eligible: Record<string, number>;
  children: Map<string, SummaryNode>;
}

export interface OverallSummary {
  total: SummaryNode;
  /** Top-level rows: districts when the upload has them, otherwise blocks. */
  roots: SummaryNode[];
  indicators: SummaryIndicator[];
  nodeByKey: Map<string, SummaryNode>;
  hasDistricts: boolean;
  hasSubCenters: boolean;
  hasSessionSites: boolean;
  /** What one flagged unit is, e.g. facility / facilities. */
  unitNoun: { one: string; many: string };
}

export const COMPONENT_ORDER = Object.keys(COMPONENT_LABELS);

/** Header label: the card name without its family prefix. */
export function indicatorShortLabel(card: Pick<KpiCard, 'id' | 'name'>): string {
  const name = card.name.trim();
  if (/^co\d+$/i.test(card.id)) return `Co-admin · ${name.split(/\s+[—-]\s+/)[0]}`;
  const prefixed = name.match(/^(Inconsistencies|Dropouts)\s+[—-]\s+(.+)$/u);
  if (prefixed) return prefixed[1] === 'Dropouts' ? `Dropout ${prefixed[2]}` : prefixed[2];
  return name;
}

function newNode(key: string, label: string, level: SummaryLevel): SummaryNode {
  return { key, label, level, units: 0, flagged: {}, eligible: {}, children: new Map() };
}

function childFor(parent: SummaryNode, label: string, level: SummaryLevel, index: Map<string, SummaryNode>): SummaryNode {
  let node = parent.children.get(label);
  if (!node) {
    node = newNode(`${parent.key}||${label}`, label, level);
    parent.children.set(label, node);
    index.set(node.key, node);
  }
  return node;
}

export function buildOverallSummary(
  cards: KpiCard[],
  facilities: Record<string, FacilityRecord>,
): OverallSummary {
  const records = Object.values(facilities);
  const hasDistricts = records.some((rec) => Boolean(rec.district));
  const hasSubCenters = records.some((rec) => Boolean(rec.subcenter));
  const hasSessionSites = records.some((rec) => Boolean(rec.sessionsite));
  const total = newNode('total', hasDistricts ? 'All districts' : 'All blocks', 'total');
  const nodeByKey = new Map<string, SummaryNode>([[total.key, total]]);

  // Every unit in the filtered scope is seeded, so issue-free rows still appear.
  const pathByKey = new Map<string, SummaryNode[]>();
  for (const [key, rec] of Object.entries(facilities)) {
    const path = [total];
    let node = total;
    if (hasDistricts) path.push(node = childFor(node, rec.district || 'Unknown district', 'district', nodeByKey));
    path.push(node = childFor(node, rec.block || 'Unknown block', 'block', nodeByKey));
    path.push(node = childFor(node, rec.facility || 'Unknown facility', 'facility', nodeByKey));
    if (rec.subcenter) path.push(node = childFor(node, rec.subcenter, 'subcenter', nodeByKey));
    if (rec.sessionsite) path.push(childFor(node, rec.sessionsite, 'sessionsite', nodeByKey));
    for (const step of path) step.units += 1;
    pathByKey.set(key, path);
  }

  const groupRank = (group: string) => {
    const rank = COMPONENT_ORDER.indexOf(group);
    return rank < 0 ? COMPONENT_ORDER.length : rank;
  };
  const ordered = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => groupRank(a.card.group) - groupRank(b.card.group) || a.index - b.index)
    .map(({ card }) => card);

  const indicators: SummaryIndicator[] = [];
  for (const card of ordered) {
    let flagged = 0;
    let eligible = 0;
    for (const key of card.stat.facilityKeys) {
      const path = pathByKey.get(key);
      if (!path) continue;
      flagged += 1;
      for (const step of path) step.flagged[card.id] = (step.flagged[card.id] ?? 0) + 1;
    }
    for (const key of card.stat.eligibleKeys ?? []) {
      const path = pathByKey.get(key);
      if (!path) continue;
      eligible += 1;
      for (const step of path) step.eligible[card.id] = (step.eligible[card.id] ?? 0) + 1;
    }
    // Co-administration cards are named by visit only ("6 weeks — OPV1, ...").
    const name = /^co\d+$/i.test(card.id) ? `Co-administration: ${card.name}` : card.name;
    indicators.push({ id: card.id, name, short: indicatorShortLabel(card), group: card.group, flagged, eligible });
  }

  const unitNoun = hasSessionSites
    ? { one: 'session site', many: 'session sites' }
    : hasSubCenters
      ? { one: 'sub center', many: 'sub centers' }
      : { one: 'facility', many: 'facilities' };

  return {
    total,
    roots: [...total.children.values()],
    indicators,
    nodeByKey,
    hasDistricts,
    hasSubCenters,
    hasSessionSites,
    unitNoun,
  };
}

/** Distinct indicators (of `ids`) with at least one flagged unit under the node. */
export function issueCount(node: SummaryNode, ids: string[]): number {
  let count = 0;
  for (const id of ids) if ((node.flagged[id] ?? 0) > 0) count += 1;
  return count;
}

// ---- heat scale ----
// ColorBrewer YlOrRd, the same severity ramp as the block maps (colour-blind safe).
// Bins are the share of the row's units that have the issue.
export const HEAT_BINS: { min: number; label: string; bg: string; fg: string }[] = [
  { min: 0, label: '<10%', bg: '#ffffb2', fg: '#0f172a' },
  { min: 10, label: '10–24%', bg: '#fecc5c', fg: '#0f172a' },
  { min: 25, label: '25–49%', bg: '#fd8d3c', fg: '#0f172a' },
  { min: 50, label: '50–74%', bg: '#f03b20', fg: '#ffffff' },
  { min: 75, label: '75%+', bg: '#bd0026', fg: '#ffffff' },
];
/** Fill for a flagged single unit (leaf row). */
export const LEAF_FLAG = { bg: '#fde3dd', dot: '#bd0026' };

export function heatBin(flagged: number, units: number) {
  if (flagged <= 0 || units <= 0) return null;
  const pct = (flagged / units) * 100;
  let bin = HEAT_BINS[0];
  for (const candidate of HEAT_BINS) if (pct >= candidate.min) bin = candidate;
  return bin;
}

/** The "4 or more indicators is red" rule of the overall summary. */
export function issueTone(count: number): 'high' | 'some' | 'none' {
  if (count >= 4) return 'high';
  return count > 0 ? 'some' : 'none';
}

// ---- Excel export ----

const ISSUE_FILL: Record<ReturnType<typeof issueTone>, string> = {
  high: '#fee2e2',
  some: '#fef3c7',
  none: '#e0f2fe',
};

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The whole hierarchy (every row, expanded) with one column per indicator, as
 * an Excel-readable HTML table. Fills are inline styles + bgcolor: Excel ignores
 * class selectors. `orderChildren` keeps the on-screen sort order.
 */
export function buildOverallExportHTML(
  summary: OverallSummary,
  indicators: SummaryIndicator[],
  orderChildren: (node: SummaryNode) => SummaryNode[],
  colors: Record<string, string>,
  title: string,
): string {
  const { hasDistricts, hasSubCenters, hasSessionSites, unitNoun } = summary;
  const ids = indicators.map((ind) => ind.id);
  const geoLevels: { level: SummaryLevel; title: string }[] = [
    ...(hasDistricts ? [{ level: 'district' as const, title: 'District' }] : []),
    { level: 'block', title: 'Block' },
    { level: 'facility', title: 'Facility' },
    ...(hasSubCenters ? [{ level: 'subcenter' as const, title: 'Sub Center' }] : []),
    ...(hasSessionSites ? [{ level: 'sessionsite' as const, title: 'Session Site' }] : []),
  ];
  const geoCols = geoLevels.map((geo) => geo.title);

  const th = 'border:1px solid #cbd5e1;padding:6px 8px;font-weight:bold;text-align:center;vertical-align:middle;';
  const td = 'border:1px solid #cbd5e1;padding:4px 8px;';
  let html = '<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:11pt;">';
  html += `<div style="font-weight:bold;font-size:14px;margin-bottom:4px;">${esc(title)}</div>`;
  html += `<div style="font-size:10pt;color:#475569;margin-bottom:8px;">Each indicator cell = number of ${esc(unitNoun.many)} with the issue (1 = flagged on a ${esc(unitNoun.one)} row). Fill = share of the row's ${esc(unitNoun.many)}. n/a = the check could not run.</div>`;
  html += '<table style="border-collapse:collapse;">';

  // Header row 1: geography + counts (rowspan 2), then one band per component.
  html += '<tr>';
  for (const col of geoCols) html += `<th rowspan="2" bgcolor="#f1f5f9" style="${th}background:#f1f5f9;">${esc(col)}</th>`;
  html += `<th rowspan="2" bgcolor="#f1f5f9" style="${th}background:#f1f5f9;">No. of ${esc(unitNoun.many)}</th>`;
  html += `<th rowspan="2" bgcolor="#f1f5f9" style="${th}background:#f1f5f9;">No. of Data Quality Issues identified</th>`;
  for (let i = 0; i < indicators.length;) {
    const group = indicators[i].group;
    let span = 0;
    while (i + span < indicators.length && indicators[i + span].group === group) span += 1;
    const color = colors[group] ?? '#475569';
    html += `<th colspan="${span}" bgcolor="${color}" style="${th}background:${color};color:#ffffff;">${esc(COMPONENT_LABELS[group] ?? group)}</th>`;
    i += span;
  }
  html += '</tr><tr>';
  for (const ind of indicators) html += `<th bgcolor="#f8fafc" style="${th}background:#f8fafc;font-weight:normal;">${esc(ind.name)}</th>`;
  html += '</tr>';

  const writeRow = (node: SummaryNode, geo: string[]) => {
    const leaf = node.children.size === 0 && node.level !== 'total';
    const issues = issueCount(node, ids);
    const bold = node.level === 'total' || node.level === 'district' || node.level === 'block' ? 'font-weight:bold;' : '';
    html += '<tr>';
    for (const value of geo) html += `<td style="${td}${bold}">${esc(value)}</td>`;
    html += `<td style="${td}text-align:center;${bold}">${leaf ? '' : node.units}</td>`;
    const fill = ISSUE_FILL[issueTone(issues)];
    html += `<td bgcolor="${fill}" style="${td}text-align:center;font-weight:bold;background:${fill};">${issues}</td>`;
    for (const ind of indicators) {
      const flagged = node.flagged[ind.id] ?? 0;
      const eligible = node.eligible[ind.id] ?? 0;
      if (flagged === 0 && eligible === 0) {
        html += `<td style="${td}text-align:center;color:#94a3b8;">n/a</td>`;
        continue;
      }
      if (flagged === 0) {
        html += `<td style="${td}text-align:center;color:#cbd5e1;">0</td>`;
        continue;
      }
      const bin = leaf ? { bg: LEAF_FLAG.bg, fg: '#7f1d1d' } : heatBin(flagged, node.units)!;
      html += `<td bgcolor="${bin.bg}" style="${td}text-align:center;font-weight:bold;background:${bin.bg};color:${bin.fg};">${flagged}</td>`;
    }
    html += '</tr>';
  };

  const walk = (node: SummaryNode, geo: string[]) => {
    for (const child of orderChildren(node)) {
      const next = [...geo];
      const col = geoLevels.findIndex((g) => g.level === child.level);
      if (col >= 0) next[col] = child.label;
      writeRow(child, next);
      walk(child, next);
    }
  };

  const blank = geoCols.map(() => '');
  writeRow(summary.total, [summary.total.label, ...blank.slice(1)]);
  walk(summary.total, blank);
  html += '</table></body></html>';
  return html;
}

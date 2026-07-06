// ============================================================
// Block-wise Overall Summary aggregation (pure, no React/DOM)
// Rolls every flagged KPI indicator up the geography hierarchy:
// block -> facility -> session site (session sites are U-WIN
// session-site-wise analysis mode only).
// ============================================================

import type { FacilityRecord, KpiCard } from './types';

export interface SummaryNode {
  label: string;
  indicators: Set<string>;
  children: Map<string, SummaryNode>;
}

function nodeFor(map: Map<string, SummaryNode>, label: string): SummaryNode {
  let node = map.get(label);
  if (!node) {
    node = { label, indicators: new Set(), children: new Map() };
    map.set(label, node);
  }
  return node;
}

export function sortNodes(map: Map<string, SummaryNode>): SummaryNode[] {
  return [...map.values()].sort(
    (a, b) =>
      b.indicators.size - a.indicators.size || a.label.localeCompare(b.label),
  );
}

export function buildOverallSummary(
  cards: KpiCard[],
  facilities: Record<string, FacilityRecord>,
): { blocks: SummaryNode[]; hasSessionSites: boolean } {
  const blockMap = new Map<string, SummaryNode>();
  let hasSessionSites = false;

  // Seed every entity in the filtered dataset so issue-free rows still
  // appear (with a zero count) instead of silently disappearing.
  for (const rec of Object.values(facilities)) {
    const block = nodeFor(blockMap, rec.block || 'Unknown block');
    const fac = nodeFor(block.children, rec.facility || 'Unknown facility');
    if (rec.sessionsite) {
      hasSessionSites = true;
      nodeFor(fac.children, rec.sessionsite);
    }
  }

  for (const card of cards) {
    if (card.stat.total === 0) continue;
    for (const key of card.stat.facilityKeys) {
      const rec = facilities[key];
      if (!rec) continue;
      const block = nodeFor(blockMap, rec.block || 'Unknown block');
      block.indicators.add(card.name);
      const fac = nodeFor(block.children, rec.facility || 'Unknown facility');
      fac.indicators.add(card.name);
      if (rec.sessionsite) {
        nodeFor(fac.children, rec.sessionsite).indicators.add(card.name);
      }
    }
  }

  return { blocks: sortNodes(blockMap), hasSessionSites };
}

export function buildOverallExportRows(
  blocks: SummaryNode[],
  hasSessionSites: boolean,
): (string | number | null)[][] {
  const header = hasSessionSites
    ? ['Block', 'Facility', 'Session Site', 'No. of Data Quality Issues identified', 'Indicators identified']
    : ['Block', 'Facility', 'No. of Data Quality Issues identified', 'Indicators identified'];
  const rows: (string | number | null)[][] = [header];

  const pushRow = (
    block: string,
    facility: string,
    session: string,
    node: SummaryNode,
  ) => {
    const para = [...node.indicators].join(', ') || '-';
    rows.push(
      hasSessionSites
        ? [block, facility, session, node.indicators.size, para]
        : [block, facility, node.indicators.size, para],
    );
  };

  for (const block of blocks) {
    pushRow(block.label, '', '', block);
    for (const fac of sortNodes(block.children)) {
      pushRow(block.label, fac.label, '', fac);
      for (const site of sortNodes(fac.children)) {
        pushRow(block.label, fac.label, site.label, site);
      }
    }
  }
  return rows;
}

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
): { blocks: SummaryNode[]; hasSessionSites: boolean; hasDistricts: boolean } {
  const blockMap = new Map<string, SummaryNode>();
  let hasSessionSites = false;
  const hasDistricts = Object.values(facilities).some((rec) => Boolean(rec.district));

  const hierarchy = (rec: FacilityRecord) => {
    const root = hasDistricts
      ? nodeFor(blockMap, rec.district || 'Unknown district')
      : nodeFor(blockMap, rec.block || 'Unknown block');
    const block = hasDistricts
      ? nodeFor(root.children, rec.block || 'Unknown block')
      : root;
    return { root, block };
  };

  // Seed every entity in the filtered dataset so issue-free rows still
  // appear (with a zero count) instead of silently disappearing.
  for (const rec of Object.values(facilities)) {
    const { block } = hierarchy(rec);
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
      const { root, block } = hierarchy(rec);
      root.indicators.add(card.name);
      block.indicators.add(card.name);
      const fac = nodeFor(block.children, rec.facility || 'Unknown facility');
      fac.indicators.add(card.name);
      if (rec.sessionsite) {
        nodeFor(fac.children, rec.sessionsite).indicators.add(card.name);
      }
    }
  }

  return { blocks: sortNodes(blockMap), hasSessionSites, hasDistricts };
}

export function buildOverallExportRows(
  blocks: SummaryNode[],
  hasSessionSites: boolean,
  hasDistricts = false,
): (string | number | null)[][] {
  const header = [
    ...(hasDistricts ? ['District'] : []),
    'Block', 'Facility',
    ...(hasSessionSites ? ['Session Site'] : []),
    'No. of Data Quality Issues identified', 'Indicators identified',
  ];
  const rows: (string | number | null)[][] = [header];

  const pushRow = (
    district: string,
    block: string,
    facility: string,
    session: string,
    node: SummaryNode,
  ) => {
    const para = [...node.indicators].join(', ') || '-';
    rows.push(
      [
        ...(hasDistricts ? [district] : []),
        block, facility,
        ...(hasSessionSites ? [session] : []),
        node.indicators.size, para,
      ],
    );
  };

  for (const root of blocks) {
    const district = hasDistricts ? root.label : '';
    if (hasDistricts) pushRow(district, '', '', '', root);
    const blockNodes = hasDistricts ? sortNodes(root.children) : [root];
    for (const block of blockNodes) {
      pushRow(district, block.label, '', '', block);
      for (const fac of sortNodes(block.children)) {
        pushRow(district, block.label, fac.label, '', fac);
        for (const site of sortNodes(fac.children)) {
          pushRow(district, block.label, fac.label, site.label, site);
        }
      }
    }
  }
  return rows;
}

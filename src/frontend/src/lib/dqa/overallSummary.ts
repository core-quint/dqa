// ============================================================
// Block-wise Overall Summary aggregation (pure, no React/DOM)
// Rolls every flagged KPI indicator up the geography hierarchy:
// block -> facility -> optional sub-center -> optional session site.
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
): { blocks: SummaryNode[]; hasSubCenters: boolean; hasSessionSites: boolean; hasDistricts: boolean } {
  const blockMap = new Map<string, SummaryNode>();
  let hasSubCenters = false;
  let hasSessionSites = false;
  const hasDistricts = Object.values(facilities).some((rec) => Boolean(rec.district));

  const hierarchy = (rec: FacilityRecord) => {
    const root = hasDistricts
      ? nodeFor(blockMap, rec.district || 'Unknown district')
      : nodeFor(blockMap, rec.block || 'Unknown block');
    const block = hasDistricts
      ? nodeFor(root.children, rec.block || 'Unknown block')
      : root;
    const fac = nodeFor(block.children, rec.facility || 'Unknown facility');
    const subcenter = rec.subcenter
      ? nodeFor(fac.children, rec.subcenter)
      : null;
    const sessionsite = rec.sessionsite
      ? nodeFor((subcenter ?? fac).children, rec.sessionsite)
      : null;
    return { root, block, fac, subcenter, sessionsite };
  };

  // Seed every entity in the filtered dataset so issue-free rows still
  // appear (with a zero count) instead of silently disappearing.
  for (const rec of Object.values(facilities)) {
    hierarchy(rec);
    if (rec.subcenter) hasSubCenters = true;
    if (rec.sessionsite) hasSessionSites = true;
  }

  for (const card of cards) {
    if (card.stat.total === 0) continue;
    for (const key of card.stat.facilityKeys) {
      const rec = facilities[key];
      if (!rec) continue;
      const { root, block, fac, subcenter, sessionsite } = hierarchy(rec);
      root.indicators.add(card.name);
      block.indicators.add(card.name);
      fac.indicators.add(card.name);
      subcenter?.indicators.add(card.name);
      sessionsite?.indicators.add(card.name);
    }
  }

  return { blocks: sortNodes(blockMap), hasSubCenters, hasSessionSites, hasDistricts };
}

export function buildOverallExportRows(
  blocks: SummaryNode[],
  hasSubCenters: boolean,
  hasSessionSites: boolean,
  hasDistricts = false,
): (string | number | null)[][] {
  const header = [
    ...(hasDistricts ? ['District'] : []),
    'Block', 'Facility',
    ...(hasSubCenters ? ['Sub Center'] : []),
    ...(hasSessionSites ? ['Session Site'] : []),
    'No. of Data Quality Issues identified', 'Indicators identified',
  ];
  const rows: (string | number | null)[][] = [header];

  const pushRow = (
    district: string,
    block: string,
    facility: string,
    subcenter: string,
    session: string,
    node: SummaryNode,
  ) => {
    const para = [...node.indicators].join(', ') || '-';
    rows.push(
      [
        ...(hasDistricts ? [district] : []),
        block, facility,
        ...(hasSubCenters ? [subcenter] : []),
        ...(hasSessionSites ? [session] : []),
        node.indicators.size, para,
      ],
    );
  };

  for (const root of blocks) {
    const district = hasDistricts ? root.label : '';
    if (hasDistricts) pushRow(district, '', '', '', '', root);
    const blockNodes = hasDistricts ? sortNodes(root.children) : [root];
    for (const block of blockNodes) {
      pushRow(district, block.label, '', '', '', block);
      for (const fac of sortNodes(block.children)) {
        pushRow(district, block.label, fac.label, '', '', fac);
        if (hasSubCenters) {
          for (const subcenter of sortNodes(fac.children)) {
            pushRow(district, block.label, fac.label, subcenter.label, '', subcenter);
            if (hasSessionSites) {
              for (const site of sortNodes(subcenter.children)) {
                pushRow(district, block.label, fac.label, subcenter.label, site.label, site);
              }
            }
          }
        } else if (hasSessionSites) {
          for (const site of sortNodes(fac.children)) {
            pushRow(district, block.label, fac.label, '', site.label, site);
          }
        }
      }
    }
  }
  return rows;
}

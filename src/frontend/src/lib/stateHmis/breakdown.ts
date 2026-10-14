// HMIS State score grid for a saved review (see lib/snapshotBreakdown.ts).
import { DEFAULT_STATE_HMIS_FILTERS, type StateHmisParsed } from './types';
import { computeStateHmisKpis } from './compute';
import { scoreComponents, SCORING_METHOD_VERSION } from '../dqa/scoring';
import { monthLongLabel } from '../dqa/parseUtils';
import { buildBreakdown, cellFromComponents, cellFromScore, type BreakdownRow, type SnapshotBreakdown } from '../snapshotBreakdown';

const GROUPS = ['availability', 'completeness', 'accuracy', 'consistency'];

function countIn(ids: string[], subset: Set<string>): number {
  let count = 0;
  for (const id of ids) if (subset.has(id)) count += 1;
  return count;
}

/** One row per district, scored as a subset of the units of one run. */
function districtRowsOf(data: StateHmisParsed, computed: ReturnType<typeof computeStateHmisKpis>): BreakdownRow[] {
  const byDistrict = new Map<string, Set<string>>();
  for (const id of computed.selectedUnits) {
    const district = data.unitData[id]?.district?.trim() || 'Unknown district';
    if (!byDistrict.has(district)) byDistrict.set(district, new Set());
    byDistrict.get(district)!.add(id);
  }
  // Default settings, so the view cards are the standard score cards. Only the
  // flagged and eligible counts move a score; any/all feed display text only.
  return [...byDistrict.entries()].map(([name, units]) => ({
    name,
    cell: cellFromScore(scoreComponents(
      computed.cards.map((card) => ({
        id: card.id,
        name: card.name,
        group: card.group,
        flagged: countIn(card.affectedUnits, units),
        eligible: countIn(card.eligibleUnits, units),
        any: 0,
        all: 0,
      })),
      computed.selectedMonths.length > 0 ? units.size : 0,
      GROUPS,
    )),
  }));
}

export function buildStateHmisBreakdown(data: StateHmisParsed): Promise<SnapshotBreakdown> {
  // The complete upload with the standard settings, whatever is on screen.
  const run = (months: string[]) => computeStateHmisKpis(data, { ...DEFAULT_STATE_HMIS_FILTERS, months });
  const score = (computed: ReturnType<typeof run>) => {
    const cell = cellFromComponents(computed.overallScore, computed.componentScores, computed.denominator);
    return { cell, cumulative: cell, rows: districtRowsOf(data, computed) };
  };
  return buildBreakdown({
    areaLevel: 'STATE',
    areaName: data.stateName,
    rowLevel: 'DISTRICT',
    unitLabel: data.reportLevel === 'block' ? 'Blocks' : 'Districts',
    periodKind: 'MONTH',
    periodKeys: Object.keys(data.months),
    methodVersion: SCORING_METHOD_VERSION,
    periodInfo: (key) => ({ label: monthLongLabel(key), from: null, to: null }),
    scoreWhole: () => score(run([])),
    scorePeriod: (key) => score(run([key])),
  });
}

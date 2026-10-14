// PCTS score grid for a saved review (see lib/snapshotBreakdown.ts).
import { DEFAULT_PCTS_FILTERS, type PctsParsed } from './types';
import { computePctsKpis } from './computeKpis';
import { SCORING_METHOD_VERSION } from '../dqa/scoring';
import { monthLongLabel } from '../dqa/parseUtils';
import { buildBreakdown, cellFromComponents, type SnapshotBreakdown } from '../snapshotBreakdown';

export function buildPctsBreakdown(data: PctsParsed): Promise<SnapshotBreakdown> {
  // The complete upload with the standard settings, whatever is on screen.
  const run = (months: string[]) => computePctsKpis(data, { ...DEFAULT_PCTS_FILTERS, months });
  return buildBreakdown({
    areaLevel: 'DISTRICT',
    areaName: data.districtName,
    rowLevel: 'BLOCK',
    unitLabel: 'Facilities',
    periodKind: 'MONTH',
    periodKeys: Object.keys(data.months),
    methodVersion: SCORING_METHOD_VERSION,
    periodInfo: (key) => ({ label: monthLongLabel(key), from: null, to: null }),
    scoreWhole: () => {
      const computed = run([]);
      return {
        cumulative: cellFromComponents(computed.overallScore, computed.componentScores, computed.denominator),
        rows: Object.values(computed.blockSummaries).map((summary) => ({
          name: summary.block,
          cell: cellFromComponents(summary.overallScore, summary.componentScores, summary.denominator),
        })),
      };
    },
    scorePeriod: (key) => {
      const computed = run([key]);
      return cellFromComponents(computed.overallScore, computed.componentScores, computed.denominator);
    },
  });
}

// HMIS score grid for a saved review (see lib/snapshotBreakdown.ts).
import type { ParsedCSV } from './types';
import { computeKpis } from './computeKpis';
import { DEFAULT_FILTERS } from './constants';
import { computeOverallScore } from './scoreUtils';
import { SCORING_METHOD_VERSION } from './scoring';
import { displayBlockLabel, monthLongLabel } from './parseUtils';
import { buildBreakdown, cellFromScore, subsetRows, type SnapshotBreakdown } from '../snapshotBreakdown';

const GROUPS = ['availability', 'completeness', 'accuracy', 'consistency'];

export function buildHmisBreakdown(csv: ParsedCSV): Promise<SnapshotBreakdown> {
  // The complete upload with the standard settings, whatever is on screen.
  const run = (months: string[]) => computeKpis(csv, { ...DEFAULT_FILTERS, months, activeGroup: 'availability' });
  return buildBreakdown({
    areaLevel: 'DISTRICT',
    areaName: csv.distName,
    rowLevel: 'BLOCK',
    unitLabel: 'Facilities',
    periodKind: 'MONTH',
    periodKeys: Object.keys(csv.allMonths),
    methodVersion: SCORING_METHOD_VERSION,
    periodInfo: (key) => ({ label: monthLongLabel(key), from: null, to: null }),
    scoreWhole: () => {
      const kpis = run([]);
      return {
        cumulative: cellFromScore(computeOverallScore(kpis, GROUPS)),
        rows: subsetRows(kpis, GROUPS, (unit) => displayBlockLabel(unit.block)),
      };
    },
    scorePeriod: (key) => cellFromScore(computeOverallScore(run([key]), GROUPS)),
  });
}

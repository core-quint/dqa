// U-WIN / U-WIN State score grid for a saved review (see lib/snapshotBreakdown.ts).
import type { UwinParsedCSV } from './types';
import { computeUwinKpis, standardAnalysisMode } from './computeKpis';
import { UWIN_DEFAULT_FILTERS } from '../dqa/constants';
import { computeOverallScore } from '../dqa/scoreUtils';
import { SCORING_METHOD_VERSION } from '../dqa/scoring';
import { displayBlockLabel, monthLongLabel } from '../dqa/parseUtils';
import { buildBreakdown, cellFromScore, subsetRows, type SnapshotBreakdown } from '../snapshotBreakdown';

// The U-WIN framework has no completeness component.
const GROUPS = ['availability', 'accuracy', 'consistency'];

export function buildUwinBreakdown(csv: UwinParsedCSV): Promise<SnapshotBreakdown> {
  const isState = csv.portal === 'UWIN_STATE';
  const analysisMode = standardAnalysisMode(csv);
  // The complete upload at the standard level and settings, whatever is on screen.
  const run = (months: string[]) =>
    computeUwinKpis(csv, { ...UWIN_DEFAULT_FILTERS, analysisMode, months, activeGroup: 'availability' });
  const declared = new Map((csv.reportingPeriods ?? []).map((period) => [period.key, period]));
  return buildBreakdown({
    areaLevel: isState ? 'STATE' : 'DISTRICT',
    areaName: isState ? csv.stateName : csv.distName,
    rowLevel: isState ? 'DISTRICT' : 'BLOCK',
    unitLabel: analysisMode === 'subcenter' ? 'Sub Centers' : 'Facilities',
    periodKind: (csv.reportingPeriods ?? []).some((period) => period.duration === 'WEEKLY') ? 'WEEK' : 'MONTH',
    periodKeys: Object.keys(csv.allMonths),
    methodVersion: SCORING_METHOD_VERSION,
    periodInfo: (key) => ({
      label: monthLongLabel(key),
      from: declared.get(key)?.from ?? null,
      to: declared.get(key)?.to ?? null,
    }),
    scoreWhole: () => {
      const kpis = run([]);
      return {
        cumulative: cellFromScore(computeOverallScore(kpis, GROUPS)),
        rows: subsetRows(kpis, GROUPS, (unit) =>
          isState ? unit.district?.trim() || 'Unknown district' : displayBlockLabel(unit.block)),
      };
    },
    scorePeriod: (key) => cellFromScore(computeOverallScore(run([key]), GROUPS)),
  });
}

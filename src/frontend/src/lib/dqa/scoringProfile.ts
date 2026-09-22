// ============================================================
// Standard scoring profile (method v2)
//
// Scope filters — blocks, months, ownership, rural/urban, districts, analysis
// mode — decide WHAT is reviewed, so they change the score. Method settings —
// outlier bands and vaccines, dropout ranges and pairs, custom inconsistency
// pairs — decide HOW the drill-downs look. The score always uses the standard
// method settings, so two reviewers of the same data get the same score and
// saved reviews stay comparable.
// ============================================================

import type { FilterState } from './types';
import { BASE_VAX } from './constants';

type MethodDefaults = Pick<
  FilterState,
  'outliersVax' | 'outliersInc' | 'outliersDrop' | 'dropRanges' | 'dropPairs'
>;

/** The reviewer's scope with every method setting reset to the standard profile. */
export function standardMethodFilters(filters: FilterState, defaults: MethodDefaults): FilterState {
  return {
    ...filters,
    outliersVax: [...defaults.outliersVax],
    addVax: [],
    outliersInc: [...defaults.outliersInc],
    outliersDrop: [...defaults.outliersDrop],
    dropRanges: [...defaults.dropRanges],
    dropPairs: [...defaults.dropPairs],
    dropFrom: [],
    dropTo: [],
    inconsFrom: [],
    inconsTo: [],
  };
}

function setKey(values: string[]): string {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort().join('|');
}

function pairKeys(from: string[] = [], to: string[] = []): string[] {
  const keys: string[] = [];
  for (let index = 0; index < Math.max(from.length, to.length); index += 1) {
    const left = (from[index] ?? '').trim();
    const right = (to[index] ?? '').trim();
    if (left && right && left !== right) keys.push(`${left}→${right}`);
  }
  return keys;
}

/** Everything about the method settings that can change a KPI result, as one string. */
export function methodSignature(filters: FilterState): string {
  const baseVax = filters.outliersVax.length > 0 ? filters.outliersVax : BASE_VAX;
  return JSON.stringify([
    setKey([...baseVax, ...(filters.addVax ?? [])]),
    setKey(filters.outliersInc),
    setKey(filters.outliersDrop),
    setKey(filters.dropRanges),
    setKey([...filters.dropPairs, ...pairKeys(filters.dropFrom, filters.dropTo)]),
    setKey(pairKeys(filters.inconsFrom, filters.inconsTo)),
  ]);
}

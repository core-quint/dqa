// ============================================================
// DQA Score Utilities — HMIS / U-WIN adapter over lib/dqa/scoring.ts
// ============================================================
import type { ComputedKpis, KpiCard } from './types';
import { scoreComponents, type OverallScoreResult } from './scoring';

export type { ComponentScore, OverallScoreResult } from './scoring';

const DEFAULT_GROUPS = ['availability', 'completeness', 'accuracy', 'consistency'];

/**
 * The score for an HMIS / U-WIN analysis. Always uses `scoreCards` (the standard
 * scoring settings) and the post-filter denominator, so the popup, the score
 * strip, the saved review and the PDF all show the same numbers.
 */
export function computeOverallScore(
  kpis: Pick<ComputedKpis, 'cards' | 'globalDen'> & { scoreCards?: KpiCard[] },
  groups: string[] = DEFAULT_GROUPS,
): OverallScoreResult {
  const cards = kpis.scoreCards ?? kpis.cards;
  return scoreComponents(
    cards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      flagged: card.stat.total,
      eligible: card.stat.eligible,
      any: card.stat.any,
      all: card.stat.all,
    })),
    kpis.globalDen,
    groups,
  );
}

function countIn(keys: Set<string>, subset: Set<string>): number {
  let count = 0;
  for (const key of keys) if (subset.has(key)) count += 1;
  return count;
}

/**
 * The same score restricted to a subset of the analysed units — one district of a
 * state upload, one block of a district. Uses the subset as the denominator and
 * each check's own eligible units within it, exactly like the whole-scope score.
 */
export function computeSubsetScore(
  kpis: Pick<ComputedKpis, 'cards'> & { scoreCards?: KpiCard[] },
  unitKeys: Set<string>,
  groups: string[] = DEFAULT_GROUPS,
): OverallScoreResult {
  const cards = kpis.scoreCards ?? kpis.cards;
  return scoreComponents(
    cards.map((card) => ({
      id: card.id,
      name: card.name,
      group: card.group,
      flagged: countIn(card.stat.facilityKeys, unitKeys),
      eligible: countIn(card.stat.eligibleKeys, unitKeys),
      any: countIn(card.stat.anyFacilityKeys, unitKeys),
      all: countIn(card.stat.allFacilityKeys, unitKeys),
    })),
    unitKeys.size,
    groups,
  );
}

/** Get score color for bg */
export function scoreColorClass(score: number | null): string {
  if (score === null) return '#64748b'; // slate-500 — not assessed
  if (score >= 70) return '#16a34a'; // green-600
  if (score >= 40) return '#d97706'; // amber-600
  return '#dc2626'; // red-600
}

/** Get score bg + text for badge */
export function scoreBadgeStyle(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: '#f1f5f9', text: '#475569' };
  if (score >= 70) return { bg: '#dcfce7', text: '#15803d' };
  if (score >= 40) return { bg: '#fef3c7', text: '#92400e' };
  return { bg: '#fee2e2', text: '#b91c1c' };
}

/** DQ Grade label */
export function scoreGrade(score: number | null): string {
  if (score === null) return 'N/A';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

// ============================================================
// DQA Score Utilities — shared between OverallScore and ResultsPage
// ============================================================
import type { ComputedKpis } from './types';

export interface ComponentScore {
  name: string;
  score: number;
  maxTot: number;
  maxAny: number;
  maxAll: number;
  topKpis: { name: string; total: number; pct: number }[];
}

export interface OverallScoreResult {
  overall: number;
  components: Record<string, ComponentScore>;
}

export function computeOverallScore(
  kpis: ComputedKpis,
  groups: string[] = ['availability', 'completeness', 'accuracy', 'consistency'],
): OverallScoreResult {
  const den = Math.max(1, kpis.globalDen);
  const components: Record<string, ComponentScore> = {};
  const scores: number[] = [];

  for (const g of groups) {
    const kpisInGroup = kpis.cards.filter((c) => c.group === g);
    const kpiData = kpisInGroup.map((c) => ({
      name: c.name,
      total: c.stat.total,
      any: c.stat.any,
      all: c.stat.all,
      pct: (c.stat.total / den) * 100,
      pctAny: (c.stat.any / den) * 100,
      pctAll: (c.stat.all / den) * 100,
    }));

    kpiData.sort((a, b) => b.pct - a.pct);
    const topN = g === 'consistency' ? 7 : 5;
    const topKpis = kpiData.slice(0, topN);

    const maxTot = kpiData.length > 0 ? kpiData[0].pct : 0;
    const maxAny = Math.max(0, ...kpiData.map((k) => k.pctAny));
    const maxAll = Math.max(0, ...kpiData.map((k) => k.pctAll));
    const score = Math.max(0, 100 - maxTot);
    scores.push(score);

    const names: Record<string, string> = {
      availability: 'Availability',
      completeness: 'Completeness',
      accuracy: 'Accuracy',
      consistency: 'Consistency',
    };

    components[g] = {
      name: names[g] ?? g,
      score,
      maxTot,
      maxAny,
      maxAll,
      topKpis: topKpis.map((k) => ({ name: k.name, total: k.total, pct: k.pct })),
    };
  }

  const overall = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return { overall, components };
}

/** Get score color class for bg */
export function scoreColorClass(score: number): string {
  if (score >= 70) return '#16a34a'; // green-600
  if (score >= 40) return '#d97706'; // amber-600
  return '#dc2626'; // red-600
}

/** Get score bg + text for badge */
export function scoreBadgeStyle(score: number): { bg: string; text: string } {
  if (score >= 70) return { bg: '#dcfce7', text: '#15803d' };
  if (score >= 40) return { bg: '#fef3c7', text: '#92400e' };
  return { bg: '#fee2e2', text: '#b91c1c' };
}

/** DQ Grade label */
export function scoreGrade(score: number): string {
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

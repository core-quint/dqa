// ============================================================
// DQA scoring — SINGLE SOURCE OF TRUTH for every portal
//
// HMIS, U-WIN, PCTS and HMIS-State, the score popup, the PDF reports and the
// U-WIN state report all score through `scoreComponents`. Nothing else may
// compute a component or overall score, so the screen, the saved review and
// the report can never disagree.
//
// THE METHOD (version 2, agreed 2026-09-22):
//   - Denominator = the units (facilities / session sites / districts / blocks)
//     left after the scope filters. It is never the whole upload.
//   - KPI % = units flagged / denominator. A KPI that no unit could be
//     evaluated for is N/A, not 0%.
//   - Component score = 100 − the worst available KPI %. A component whose
//     KPIs are all N/A is N/A, not 100.
//   - Overall = mean of the components that could be scored. With no units in
//     scope, everything is N/A ("No data").
// ============================================================

/** Bump when a change makes new scores incomparable with saved ones. */
export const SCORING_METHOD_VERSION = 2;

export const COMPONENT_LABELS: Record<string, string> = {
  availability: 'Availability',
  completeness: 'Completeness',
  accuracy: 'Accuracy',
  consistency: 'Consistency',
};

export interface ScoringCard {
  id: string;
  name: string;
  group: string;
  /** Units flagged by this check. */
  flagged: number;
  /** Units the check could be evaluated for; 0 makes the KPI N/A. */
  eligible: number;
  any: number;
  all: number;
}

export interface ScoredKpi {
  name: string;
  total: number;
  eligible: number;
  pct: number;
}

export interface ComponentScore {
  name: string;
  /** null = N/A: no unit in scope, or no check in this component could run. */
  score: number | null;
  /** Worst KPI %, null when the component is N/A. */
  maxTot: number | null;
  maxAny: number;
  maxAll: number;
  topKpis: ScoredKpi[];
  evaluatedKpis: number;
  totalKpis: number;
}

export interface OverallScoreResult {
  /** Mean of the scored components; null when none could be scored. */
  overall: number | null;
  components: Record<string, ComponentScore>;
  denominator: number;
  scoredComponents: number;
  totalComponents: number;
}

export function scoreComponents(
  cards: ScoringCard[],
  denominator: number,
  groups: string[],
): OverallScoreResult {
  const components: Record<string, ComponentScore> = {};
  const scores: number[] = [];
  const den = denominator > 0 ? denominator : 0;

  for (const group of groups) {
    const inGroup = cards.filter((card) => card.group === group);
    const available = den > 0 ? inGroup.filter((card) => card.eligible > 0) : [];
    const kpis = available
      .map((card) => ({
        name: card.name,
        total: card.flagged,
        eligible: card.eligible,
        pct: (card.flagged / den) * 100,
        pctAny: (card.any / den) * 100,
        pctAll: (card.all / den) * 100,
      }))
      .sort((a, b) => b.pct - a.pct);

    const maxTot = kpis.length > 0 ? kpis[0].pct : null;
    const score = maxTot === null ? null : Math.max(0, 100 - maxTot);
    if (score !== null) scores.push(score);

    components[group] = {
      name: COMPONENT_LABELS[group] ?? group,
      score,
      maxTot,
      maxAny: Math.max(0, ...kpis.map((kpi) => kpi.pctAny)),
      maxAll: Math.max(0, ...kpis.map((kpi) => kpi.pctAll)),
      topKpis: kpis
        .slice(0, group === 'consistency' ? 7 : 5)
        .map(({ name, total, eligible, pct }) => ({ name, total, eligible, pct })),
      evaluatedKpis: kpis.length,
      totalKpis: inGroup.length,
    };
  }

  return {
    overall: scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    components,
    denominator: den,
    scoredComponents: scores.length,
    totalComponents: groups.length,
  };
}

// ---- Severity of a single KPI (the High/Medium/Low badge) ----

export type SeverityLevel = 'High' | 'Medium' | 'Low' | 'None';

/**
 * One severity rule for the cards, the PDFs and the state report, applied to the
 * unrounded share of units flagged: High ≥ 50%, Medium ≥ 25%, Low > 0, None = 0.
 */
export function severityLevel(flagged: number, denominator: number): SeverityLevel {
  if (flagged <= 0 || denominator <= 0) return 'None';
  const ratio = flagged / denominator;
  if (ratio >= 0.5) return 'High';
  if (ratio >= 0.25) return 'Medium';
  return 'Low';
}

// ---- Presentation helpers shared by every score display ----

export function formatScore(score: number | null | undefined, digits = 1): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(digits) : 'N/A';
}

/** "3 of 4 components" note, or null when every component was scored. */
export function componentCoverageNote(result: Pick<OverallScoreResult, 'scoredComponents' | 'totalComponents'>): string | null {
  if (result.scoredComponents === result.totalComponents) return null;
  return `Based on ${result.scoredComponents} of ${result.totalComponents} components`;
}

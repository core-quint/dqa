// ============================================================
// DQA scoring — SINGLE SOURCE OF TRUTH for every portal
//
// HMIS, U-WIN, PCTS and HMIS-State, the score popup, the PDF reports and the
// U-WIN state report all score through `scoreComponents`. Nothing else may
// compute a component or overall score, so the screen, the saved review and
// the report can never disagree.
//
// THE METHOD (version 8, weighted, adopted 2026-10-29):
//   - Denominator = the units (facilities / session sites / districts / blocks)
//     left after the scope filters. It is never the whole upload.
//   - Check % = units flagged / denominator; check score = 100 − check %. A
//     check that no unit could be evaluated for cannot run.
//   - Every standard check has a fixed weight (lib/dqa/weightedScoring.ts),
//     by portal and by period count (1 month or week / 2 or more). A check
//     that cannot run passes its weight on: group, then component, then the
//     other components.
//   - Component score = weighted average of its checks; N/A when none can
//     run or it carries no weight. Overall = Σ weight × check score ÷ 100.
//     With no units in scope, everything is N/A ("No data").
// ============================================================

import {
  COMPONENT_LABELS,
  scoreWeighted,
  type WeightPortal,
  type WeightedScoreResult,
} from './weightedScoring';

export { COMPONENT_LABELS };

/**
 * Bump when a change makes new scores incomparable with saved ones.
 * 3 (2026-10-16): small-count outlier bands (checkRules.ts).
 * 4 (2026-10-16): OPV1 and OPV3 left out of the outlier check; dropout pairs
 *   Penta1→Penta3, MR1→MR2, Penta3→MR1 in every portal; no dropout for a
 *   single-month / single-week analysis; HMIS and HMIS-State score
 *   Sessions Held > Sessions Planned under Consistency, not Accuracy; the
 *   OPV3 > OPV1 consistency check is now MR2 > MR1 (HMIS, U-WIN, HMIS-State);
 *   the OPV Dose Sequence check is removed (PCTS, HMIS-State); co-administration
 *   allows ±25% around the visit's reference count (±50% under 10) in every
 *   portal (lib/dqa/coadmin.ts); a later dose above an earlier one (Penta3 >
 *   Penta1, MR2 > MR1, sequences) is flagged only beyond 25% (50% when both
 *   are under 10). PCTS and HMIS-State use the same two later-dose checks as
 *   HMIS / U-WIN (Penta3 > Penta1, MR2 > MR1) instead of dose sequences;
 *   "Zero Sessions with Vaccination Data" moved from HMIS-State to HMIS
 *   (session vaccines only); HMIS t1 / t0 read M9 items only, t7 is a repeated
 *   M9 profile and t2 skips facilities t1 flagged.
 * 5 (2026-10-17): checks removed — HMIS-State "Missing District / Block
 *   Report" and "AEFI Deaths > Serious AEFI"; PCTS "No Active Immunization
 *   Service" and "Missing Facility-Month Report".
 * 6 (2026-10-19): PCTS "Repeated Complete Profile" removed; HMIS-State
 *   "Partial M9 Reporting" and "Missing Data Items" removed (Completeness is
 *   "Key Missing Indicators" only); "Invalid Counts" removed from PCTS and
 *   HMIS-State. No double flags for one finding: outliers skip month pairs
 *   with an all-zero month (every portal); U-WIN t8 and t0 skip periods t9
 *   flagged; HMIS-State Key Missing skips units All M9 Blank flagged;
 *   repeated profiles need a non-zero value (HMIS-State, PCTS); Abrupt Zero
 *   removed (HMIS-State, PCTS); PCTS "All Indicators Zero" and "Partial
 *   Indicator Reporting" removed; PCTS "Fully Immunized Exceeds
 *   Prerequisites" removed.
 * 7 (2026-10-29): HMIS and HMIS-State "Key Missing Indicators" read every M9
 *   item except JE (all doses), delayed MR 1st dose and Typhoid
 *   (lib/dqa/keyMissing.ts), not the seven key vaccines.
 * 8 (2026-10-29): weighted scoring replaces "100 − worst check per component,
 *   overall = mean of components" (weights in lib/dqa/weightedScoring.ts).
 */
export const SCORING_METHOD_VERSION = 8;

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
  /** Weighted average of the component's checks; null = N/A (no check could run, or no weight). */
  score: number | null;
  /** The most-flagged check's % (the component's top issue); null when no check could run. */
  maxTot: number | null;
  maxAny: number;
  maxAll: number;
  topKpis: ScoredKpi[];
  evaluatedKpis: number;
  totalKpis: number;
}

export interface OverallScoreResult {
  /** Weighted overall; null when nothing could be scored. */
  overall: number | null;
  components: Record<string, ComponentScore>;
  denominator: number;
  scoredComponents: number;
  totalComponents: number;
  /** The check-by-check working (weights used, points). */
  weighted: WeightedScoreResult;
}

/** Which weight table applies: the portal and how many periods are selected. */
export interface ScoringContext {
  portal: WeightPortal;
  periodCount: number;
}

export function scoreComponents(
  cards: ScoringCard[],
  denominator: number,
  groups: string[],
  context: ScoringContext,
): OverallScoreResult {
  const components: Record<string, ComponentScore> = {};
  const den = denominator > 0 ? denominator : 0;
  const weighted = scoreWeighted(
    cards.map((card) => ({ id: card.id, name: card.name, flagged: card.flagged, eligible: card.eligible })),
    den,
    context.portal,
    context.periodCount,
    groups,
  );

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

    components[group] = {
      name: COMPONENT_LABELS[group] ?? group,
      score: weighted.components[group]?.score ?? null,
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
    overall: weighted.overall,
    components,
    denominator: den,
    scoredComponents: weighted.scoredComponents,
    totalComponents: weighted.totalComponents,
    weighted,
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

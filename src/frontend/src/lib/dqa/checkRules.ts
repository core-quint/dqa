// ============================================================
// Check rules shared by every portal's KPI engine (HMIS, U-WIN, PCTS,
// HMIS-State), so a threshold means the same thing everywhere.
//
// Agreed 2026-09-22 (scoring method v2):
//   - Outliers compare only calendar-adjacent months, skip a comparison when
//     both months are below OUTLIER_MIN_VOLUME, and treat a rise from 0 to at
//     least that volume as an extreme increase (a % change from 0 is undefined,
//     which used to hide these completely).
//   - Bands are half-open, so no value can fall between two of them:
//       increase  Low 25 to <50 · Moderate 50–100 · Extreme >100 (or from 0)
//       decrease  Low −25 to >−50 · Moderate −50 to >−75 · Extreme −75 to −100
//   - Dropout ranges: Low 5 to <10 · Moderate 10 to <20 · High ≥20.
//   - Period totals are summed only over months where BOTH compared values
//     were reported; a blank is missing data, never a zero.
// ============================================================

/** Comparisons where both months are below this count are too small to judge. */
export const OUTLIER_MIN_VOLUME = 10;

export interface ChangeResult {
  /** % change; null only for a rise from zero, where it is undefined. */
  pct: number | null;
  fromZero: boolean;
}

/** Guards the band edges against float noise (e.g. 49.99999999 for a true 50). */
function clean(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/** Month-on-month change, or null when the pair cannot be judged. */
export function monthOnMonthChange(previous: number | null | undefined, current: number | null | undefined): ChangeResult | null {
  if (previous === null || previous === undefined || current === null || current === undefined) return null;
  if (Math.max(previous, current) < OUTLIER_MIN_VOLUME) return null;
  if (previous === 0) return { pct: null, fromZero: true };
  if (previous < 0) return null;
  return { pct: clean(((current - previous) / previous) * 100), fromZero: false };
}

export type OutlierBand = 'INC_LOW' | 'INC_MOD' | 'INC_EXT' | 'DROP_LOW' | 'DROP_MOD' | 'DROP_EXT';

export function outlierBand(change: ChangeResult): OutlierBand | null {
  if (change.fromZero) return 'INC_EXT';
  const pct = change.pct;
  if (pct === null) return null;
  if (pct > 100) return 'INC_EXT';
  if (pct >= 50) return 'INC_MOD';
  if (pct >= 25) return 'INC_LOW';
  if (pct <= -75) return 'DROP_EXT';
  if (pct <= -50) return 'DROP_MOD';
  if (pct <= -25) return 'DROP_LOW';
  return null;
}

/**
 * PCTS / HMIS-State pick one minimum severity instead of individual bands:
 * "low" flags every band, "moderate" the moderate and extreme bands, "extreme"
 * only the extreme bands. Same cut-offs as the HMIS / U-WIN bands.
 */
export type ChangeSeverity = 'low' | 'moderate' | 'extreme';

export function passesChangeSeverity(change: ChangeResult, severity: ChangeSeverity): boolean {
  const band = outlierBand(change);
  if (!band) return false;
  if (severity === 'low') return true;
  if (severity === 'moderate') return band !== 'INC_LOW' && band !== 'DROP_LOW';
  return band === 'INC_EXT' || band === 'DROP_EXT';
}

export function formatChange(change: ChangeResult): string {
  if (change.fromZero) return 'from 0';
  const pct = change.pct ?? 0;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ---- Dropouts ----

export type DropoutRange = 'R5_10' | 'R11_20' | 'R20P';

/** Dropout % from an earlier to a later dose; null when it cannot be computed. */
export function dropoutPct(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  return clean(((from - to) / from) * 100);
}

/**
 * Range ids are kept from the original filter ("R11_20" is now 10 to <20) so saved
 * filter state and export keys keep working.
 */
export function dropoutRange(pct: number | null): DropoutRange | null {
  if (pct === null) return null;
  if (pct >= 20) return 'R20P';
  if (pct >= 10) return 'R11_20';
  if (pct >= 5) return 'R5_10';
  return null;
}

// ---- Matched-month totals ----

export interface MatchedTotals {
  a: number;
  b: number;
  /** Months where both values were reported. 0 means nothing comparable. */
  months: number;
}

/** Sum two series over only the months where both were reported. */
export function matchedTotals(pairs: Array<[number | null | undefined, number | null | undefined]>): MatchedTotals {
  let a = 0;
  let b = 0;
  let months = 0;
  for (const [left, right] of pairs) {
    if (left === null || left === undefined || right === null || right === undefined) continue;
    a += left;
    b += right;
    months += 1;
  }
  return { a, b, months };
}

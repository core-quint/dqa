// ============================================================
// Co-administration (co1..co5) consistency rule — SINGLE SOURCE OF TRUTH
//
// Vaccines given at the same visit (e.g. 6 weeks: OPV1, Penta1, RVV1, PCV1,
// IPV1) go to the same children, so their monthly counts should be close. This
// module decides both whether a month is flagged and which cells are marked,
// for every portal (HMIS, U-WIN, PCTS, HMIS-State).
//
// Every consumer MUST use these functions — the engines, the on-screen
// drill-down tables (dqa/DataTables.tsx, used by U-WIN too) *and* the
// highlighted-XLS exports (dqa/exportUtils.ts, uwin/exportUtils.ts) — so the
// card, the table and the spreadsheet can never disagree.
//
// THE RULE (agreed 2026-10-16; until then any difference at all was flagged,
// and HMIS-State used a 5/10/20% max-min spread):
//   1. Fewer than 2 values present -> not checkable.
//   2. Reference ("correct value"):
//        a. the strict mode — one value repeats more often than any other;
//        b. otherwise Penta's value (6 / 10 / 14 weeks);
//        c. otherwise MR's value (MR1 at 9 months, MR2 at 2 years);
//        d. otherwise (no Penta or MR reported) the median of the values.
//   3. Allowed difference: ±50% when the reference is under 10, ±25% when it is
//      10 or more. A value is out of range when it differs from the reference
//      by MORE than that (exactly 25% / 50% is fine).
//   4. Reference 0: a % of 0 is undefined, so a value is out of range only when
//      it is 10 or more (same as a small rise from 0 for outliers).
//   A month is flagged when at least one value is out of range; those values
//   are the cells marked.
// ============================================================

/** References below this count allow the wider difference. */
export const COADMIN_SMALL_REFERENCE = 10;
const COADMIN_ALLOWED_PCT_SMALL = 50;
const COADMIN_ALLOWED_PCT = 25;

/**
 * Normalize a value into a comparison key. Counts are integers in practice, but
 * filtered sums can accumulate float error, and exact `===` on floats would
 * report a spurious disagreement. Mirrors the PHP reference's `%.10F`.
 */
export function coadminValueKey(v: number): string {
  return v.toFixed(10);
}

function isPenta(vx: string): boolean {
  return vx.trim().toLowerCase().startsWith('penta');
}

function isMr(vx: string): boolean {
  return /^mr\s*\d/i.test(vx.trim());
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface CoadminAssessment {
  /** The visit's reference count; null when fewer than 2 values are present. */
  reference: number | null;
  /** Allowed ± % around the reference. */
  allowedPct: number;
  /** Vaccines whose value is out of range. Empty = no violation. */
  outOfRange: Set<string>;
}

/** Reference, allowed difference and out-of-range vaccines for one group at one point in time. */
export function coadminAssess(valsByVx: Record<string, number | null>): CoadminAssessment {
  const outOfRange = new Set<string>();
  const present = Object.entries(valsByVx).filter(
    (entry): entry is [string, number] => entry[1] !== null && entry[1] !== undefined,
  );
  if (present.length < 2) return { reference: null, allowedPct: COADMIN_ALLOWED_PCT, outOfRange };

  const counts = new Map<string, { value: number; count: number }>();
  for (const [, v] of present) {
    const k = coadminValueKey(v);
    const entry = counts.get(k);
    if (entry) entry.count += 1;
    else counts.set(k, { value: v, count: 1 });
  }

  let reference: number;
  let modeValue: number | null = null;
  let modeCount = 0;
  let tie = false;
  for (const { value, count } of counts.values()) {
    if (count > modeCount) { modeCount = count; modeValue = value; tie = false; }
    else if (count === modeCount) { tie = true; }
  }
  const penta = present.find(([vx]) => isPenta(vx));
  const mr = present.find(([vx]) => isMr(vx));
  if (modeValue !== null && !tie && modeCount > 1) reference = modeValue;
  else if (penta) reference = penta[1];
  else if (mr) reference = mr[1];
  else reference = median(present.map(([, v]) => v));

  const allowedPct = reference < COADMIN_SMALL_REFERENCE ? COADMIN_ALLOWED_PCT_SMALL : COADMIN_ALLOWED_PCT;
  for (const [vx, v] of present) {
    const out = reference <= 0
      ? v >= COADMIN_SMALL_REFERENCE
      : Math.abs(v - reference) * 100 > allowedPct * reference;
    if (out) outOfRange.add(vx);
  }
  return { reference, allowedPct, outOfRange };
}

/** Vaccine short-names whose cells are out of range (empty set = no violation). */
export function coadminRedCells(valsByVx: Record<string, number | null>): Set<string> {
  return coadminAssess(valsByVx).outOfRange;
}

/** True when the group breaks the co-administration rule at this point in time. */
export function coadminViolation(valsByVx: Record<string, number | null>): boolean {
  return coadminRedCells(valsByVx).size > 0;
}

/** One-line explanation of the check for the PCTS / HMIS-State drill-downs. */
export function coadminDetail(
  valsByVx: Record<string, number | null>,
  label: (vx: string) => string = (vx) => vx,
): string {
  const { reference, allowedPct, outOfRange } = coadminAssess(valsByVx);
  if (reference === null) return 'Fewer than two comparable values';
  const ref = Number.isInteger(reference) ? String(reference) : reference.toFixed(1);
  if (outOfRange.size === 0) return `All counts within ±${allowedPct}% of ${ref}`;
  const parts = [...outOfRange].map((vx) => {
    const v = valsByVx[vx] as number;
    const diff = reference > 0
      ? `${v > reference ? '+' : ''}${(((v - reference) / reference) * 100).toFixed(1)}%`
      : 'reference 0';
    return `${label(vx)} ${v} (${diff})`;
  });
  return `Reference ${ref}, allowed ±${allowedPct}%: ${parts.join(', ')}`;
}

/**
 * Sum a vaccine's values across the selected months, returning `null` when the
 * vaccine was never reported (no column in the file, or blank in every month).
 *
 * Using 0 there — as the code did before — made a never-reported dose look like
 * a reported zero, so it disagreed with every real value and flagged EVERY
 * facility in the district whenever one co-group column was absent from the
 * upload. `null` keeps the "All months" comparison consistent with the monthly
 * one, which has always ignored blanks. An explicitly reported 0 still counts.
 */
export function coadminTotal(values: (number | null)[]): number | null {
  let sum = 0;
  let seen = false;
  for (const v of values) {
    if (v === null) continue;
    sum += v;
    seen = true;
  }
  return seen ? sum : null;
}

/**
 * The "All months" totals row for one co-admin group, summed only over the
 * months in which every vaccine this facility reported at all is present.
 *
 * Detection is monthly (method v2): a facility is flagged only when some month
 * breaks the rule above. Summing each vaccine over its own months instead
 * would let a single blank month (Penta1 missing in February, OPV1 reported)
 * make the totals disagree and colour a row that has no real violation. Over
 * matched months the totals compare like with like.
 */
export function coadminMatchedTotals(
  valsByMonth: Record<string, Record<string, number | null>>,
  vaccines: string[],
): Record<string, number | null> {
  const months = Object.keys(valsByMonth);
  const reported = vaccines.filter((vx) => months.some((mk) => valsByMonth[mk]?.[vx] != null));
  const totals: Record<string, number | null> = {};
  for (const vx of vaccines) totals[vx] = null;
  if (reported.length < 2) {
    for (const vx of reported) {
      totals[vx] = coadminTotal(months.map((mk) => valsByMonth[mk]?.[vx] ?? null));
    }
    return totals;
  }
  for (const mk of months) {
    const row = valsByMonth[mk] ?? {};
    if (!reported.every((vx) => row[vx] != null)) continue;
    for (const vx of reported) totals[vx] = (totals[vx] ?? 0) + (row[vx] as number);
  }
  return totals;
}

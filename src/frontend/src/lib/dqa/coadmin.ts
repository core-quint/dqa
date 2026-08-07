// ============================================================
// Co-administration (co1..co5) consistency rule — SINGLE SOURCE OF TRUTH
//
// Vaccines given at the same visit (e.g. 6 weeks: OPV1, Penta1, RVV1, PCV1,
// IPV1) go to the same children, so their monthly counts should match. When
// they don't, this module decides which cells to mark.
//
// Every consumer MUST use these functions — the on-screen drill-down tables
// (dqa/DataTables.tsx, uwin/UwinDataTables.tsx) *and* the highlighted-XLS
// exports (dqa/exportUtils.ts, uwin/exportUtils.ts) — so the table and the
// spreadsheet can never disagree about which cell is wrong.
//
// THE RULE ("hybrid"): use the counts where they are decisive, and the
// programme convention where they are not.
//   1. Fewer than 2 values present, or all present values equal -> mark nothing
//      (no violation).
//   2. If exactly one value is the strict mode (it repeats more often than any
//      other) -> mark every cell that differs from it. This is the ~77% case
//      and the counts identify the odd value out.
//   3. Otherwise (two values tie for most frequent, or no value repeats at all)
//      the counts cannot single anything out. If the group contains a Penta
//      dose, treat Penta as the reference: mark every non-Penta cell that
//      differs from it, and never mark Penta itself.
//   4. If there is no Penta in the group either (co4 "9 months", co5 "2 years"),
//      mark every present cell — nothing can be singled out.
//
// Rejected alternatives, for the record:
//  - "mark only values that are UNIQUE in the group" (the original rule): a 3-2
//    or 2-2 split contains no unique value, so a correctly flagged row rendered
//    with zero marked cells. This is the bug this module replaces.
//  - "always anchor on Penta" (the PHP reference / U-WIN through 2026-08): when
//    Penta is itself the lone outlier (measured: 12 cell-groups in a 261-facility
//    district) it marks the 3-4 correct antigens and leaves the wrong number
//    unmarked, pointing the reviewer away from the error.
// ============================================================

/**
 * Normalize a value into a comparison key. Counts are integers in practice, but
 * filtered sums can accumulate float error, and exact `===` on floats would
 * report a spurious disagreement. Mirrors the PHP reference's `%.10F`.
 */
export function coadminValueKey(v: number): string {
  return v.toFixed(10);
}

/** True when the present values disagree at all — i.e. this is a violation. */
export function coadminHasDifference(values: (number | null)[]): boolean {
  const keys = new Set<string>();
  for (const v of values) {
    if (v === null) continue;
    keys.add(coadminValueKey(v));
  }
  return keys.size > 1;
}

function isPenta(vx: string): boolean {
  return vx.toLowerCase().startsWith('penta');
}

/**
 * Vaccine short-names whose cells should be marked for one co-admin group at one
 * point in time (a single month, or the "All months" totals). Returns an empty
 * set when there is no violation.
 */
export function coadminRedCells(valsByVx: Record<string, number | null>): Set<string> {
  const red = new Set<string>();
  const present = Object.entries(valsByVx).filter(
    (entry): entry is [string, number] => entry[1] !== null,
  );
  if (present.length < 2) return red;

  const counts = new Map<string, number>();
  for (const [, v] of present) {
    const k = coadminValueKey(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size <= 1) return red; // all equal — no violation

  // 2. A single strict mode: the counts identify the odd value out.
  let modeKey: string | null = null;
  let modeCount = -1;
  let tie = false;
  for (const [k, c] of counts) {
    if (c > modeCount) { modeCount = c; modeKey = k; tie = false; }
    else if (c === modeCount) { tie = true; }
  }
  if (!tie && modeCount > 1) {
    for (const [vx, v] of present) {
      if (coadminValueKey(v) !== modeKey) red.add(vx);
    }
    return red;
  }

  // 3. Counts inconclusive — fall back to the Penta reference.
  const pentaEntry = present.find(([vx]) => isPenta(vx));
  if (pentaEntry) {
    const pentaKey = coadminValueKey(pentaEntry[1]);
    for (const [vx, v] of present) {
      if (isPenta(vx)) continue; // never mark the reference itself
      if (coadminValueKey(v) !== pentaKey) red.add(vx);
    }
    return red;
  }

  // 4. No reference available — everything is suspect.
  for (const [vx] of present) red.add(vx);
  return red;
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

// ============================================================
// Geography name matching + coverage maths for the map pages.
// Pure — no React, no Firebase — so it stays harness-testable.
// ============================================================

/**
 * Collapses a place name to a comparison key: accents stripped, "&" spelled
 * out, punctuation and spacing dropped. "Agra ", "AGRA" and "agra" all become
 * "agra"; "Jammu & Kashmir" and "Jammu and Kashmir" both become
 * "jammuandkashmir".
 */
export function normalizeGeoName(value?: string | null): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Nearest option within a quarter of the target's length in edits — tight
 * enough that "Bulandshahr"/"Bulandshahar" match while two genuinely different
 * districts do not.
 */
export function fuzzyMatch<T>(target: string, options: T[], getName: (o: T) => string): T | null {
  const norm = normalizeGeoName(target);
  if (!norm) return null;
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const d = levenshtein(norm, normalizeGeoName(getName(option)));
    if (d < bestDist) {
      bestDist = d;
      best = option;
    }
  }
  if (!best) return null;
  return bestDist <= Math.max(1, Math.floor(norm.length * 0.25)) ? best : null;
}

/** Exact normalized match first, then the fuzzy fallback. */
export function resolveOptionValue(
  target: string | null | undefined,
  options: string[],
): string | null {
  if (!target) return null;
  const norm = normalizeGeoName(target);
  return (
    options.find((o) => normalizeGeoName(o) === norm) ??
    fuzzyMatch(target, options, (o) => o) ??
    null
  );
}

export interface DistrictCoverage {
  /** Distinct districts in the roster that at least one review touched. */
  covered: number;
  /** Districts the boundary file knows about for this state. */
  total: number;
  /** covered / total as 0–100; 0 when the roster is empty. */
  percent: number;
  /** Normalized keys of the covered districts, sorted — stable for tests/UI. */
  matched: string[];
  /** Review district names that resolved to nothing in the roster. */
  unmatched: string[];
}

/**
 * How much of a state's district roster a set of reviews reached.
 *
 * Repeat reviews of the same district count once — the question is "how many
 * districts were reached", not "how many reviews happened". A review whose
 * district name resolves to nothing in the roster is reported in `unmatched`
 * rather than silently inflating the numerator.
 */
export function districtCoverage(
  reviewDistrictNames: Array<string | null | undefined>,
  roster: string[],
): DistrictCoverage {
  const matched = new Set<string>();
  const unmatched: string[] = [];
  for (const name of reviewDistrictNames) {
    const resolved = resolveOptionValue(name, roster);
    if (resolved) matched.add(normalizeGeoName(resolved));
    else if ((name ?? "").trim()) unmatched.push(name!.trim());
  }
  const total = new Set(roster.map(normalizeGeoName)).size;
  return {
    covered: matched.size,
    total,
    percent: total > 0 ? (matched.size / total) * 100 : 0,
    matched: [...matched].sort(),
    unmatched: [...new Set(unmatched)].sort(),
  };
}

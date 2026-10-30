// ============================================================
// "Key Missing Indicators" (Completeness) item list — shared by HMIS (t2) and
// HMIS-State (key_missing), the two portals with an M9 section.
//
// Agreed 2026-10-29: the check reads every M9 Child Immunisation item except
// the ones not given everywhere —
//   9.2.3  JE 1st dose (9–11 months)
//   9.3.1  MR / MCV 1st dose (after 12 months, delayed vaccination)
//   9.3.2  JE 1st dose (after 12 months, delayed vaccination)
//   9.3.8  JE Booster after 24 months of age (delayed vaccination)
//   9.4.4  JE 2nd dose (16–24 months)
//   9.5.1  Typhoid
// Items are matched by name, not code: HMIS code numbering has changed across
// template revisions.
// ============================================================

import { hmisAvailabilityColumns, normalizeLooseText } from './parseUtils';

const ITEM_CODE_RE = /^\s*([0-9]+(?:\.[0-9]+)+(?:\.[a-z])?)\.?\s*(?::{1,2}|-|—)?\s*/i;

/** True for an M9 item Key Missing Indicators leaves out (see the list above). */
export function isKeyMissingExcludedItem(name: string): boolean {
  const text = normalizeLooseText(name);
  if (/\btyphoid\b/u.test(text)) return true;
  if (/\bje\b/u.test(text) || /\bjapanese encephalitis\b/u.test(text)) return true;
  return /\bdelayed\b/u.test(text) && /\b(?:measles|mr|mcv)\b/u.test(text);
}

/** Compact item label, e.g. "9.1.2 BCG" for code 9.1.2 "Child immunisation - BCG". */
export function m9ItemLabel(code: string, name: string): string {
  const shortName = name.replace(/\s+/g, ' ').trim().replace(/^child immuni[sz]ation\s*(?:\([^)]*\))?\s*-\s*/i, '');
  return code ? `${code} ${shortName}` : shortName;
}

export interface KeyMissingColumn {
  ci: number;
  label: string;
}

/**
 * HMIS columns Key Missing Indicators reads: the M9 columns the availability
 * checks read (every column after Month for an M9-only template without item
 * codes), minus the excluded items. Labels are unique per column.
 */
export function hmisKeyMissingColumns(header: string[], idxMonth: number): KeyMissingColumn[] {
  const used = new Set<string>();
  const out: KeyMissingColumn[] = [];
  for (const ci of hmisAvailabilityColumns(header, idxMonth)) {
    const text = (header[ci] ?? '').trim();
    if (!text || isKeyMissingExcludedItem(text)) continue;
    const codeMatch = text.match(ITEM_CODE_RE);
    const base = codeMatch ? m9ItemLabel(codeMatch[1], text.slice(codeMatch[0].length)) : m9ItemLabel('', text);
    let label = base;
    for (let n = 2; used.has(label); n++) label = `${base} (${n})`;
    used.add(label);
    out.push({ ci, label });
  }
  return out;
}

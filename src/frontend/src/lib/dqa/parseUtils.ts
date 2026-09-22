// ============================================================
// CSV Parsing and data normalization utilities
// ============================================================

export function stripBOM(s: string): string {
  if (!s) return s;
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}

export function normalizeLooseText(s: string): string {
  let value = stripBOM(String(s ?? ''));
  value = value.replace(/\u00a0/g, ' ');
  value = value.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '');
  value = value.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  value = value.replace(/[\r\n\t]+/g, ' ');
  value = value.trim().replace(/\s+/g, ' ');
  return value.toLowerCase();
}

export function normalizeHeader(s: string): string {
  return normalizeLooseText(s);
}

export function headerCompactKey(s: string): string {
  return normalizeHeader(s).replace(/[^a-z0-9]+/g, '');
}

export function normalizeFacilityKey(s: string): string {
  s = stripBOM(s);
  s = s.replace(/\u00a0/g, ' ');
  s = s.trim();
  return s.toLowerCase();
}

export function normalizeOwnership(v: string): string {
  const s = v.trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('pub') || s.includes('government') || s.includes('govt')) return 'Public';
  if (s.startsWith('pri') || s.includes('pvt') || s.includes('private')) return 'Private';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeRU(v: string): string {
  const s = v.trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('rur')) return 'Rural';
  if (s.startsWith('urb')) return 'Urban';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================
// Reporting periods
// A reporting period is either a whole calendar month ("2026-09") or an explicit
// day range ("2026-09-01..2026-09-07") for an upload that covers part of a month —
// a weekly U-WIN export, for example. Both forms sort chronologically as plain
// strings and both carry a label, so every month-keyed table, filter, chart and
// export keeps working on them unchanged.
// ============================================================

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DAY_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RANGE_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

export function isMonthKey(key: string): boolean {
  return MONTH_KEY_RE.test(key.trim());
}

export function isPeriodRangeKey(key: string): boolean {
  return PERIOD_RANGE_RE.test(key.trim());
}

export function parsePeriodRangeKey(key: string): { from: string; to: string } | null {
  const match = key.trim().match(PERIOD_RANGE_RE);
  if (!match) return null;
  if (!ISO_DAY_RE.test(match[1]) || !ISO_DAY_RE.test(match[2])) return null;
  return { from: match[1], to: match[2] };
}

/** Last calendar day of "YYYY-MM" as "YYYY-MM-DD". Built by hand: toISOString() on a
 *  local-midnight Date rolls back a day in +05:30. */
export function monthEndDay(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  if (!year || !month) return ym;
  return `${ym}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

/**
 * Bucket key for a declared from/to reporting period. A range covering exactly one
 * whole calendar month collapses to that month key, so an ordinary monthly upload
 * keeps scoring, trending and exporting exactly as it always has; anything shorter
 * or longer keeps its own day range. Returns null when the dates are unusable.
 */
export function makePeriodKey(from: string, to: string): string | null {
  const start = from.trim();
  const end = to.trim();
  if (!ISO_DAY_RE.test(start) || !ISO_DAY_RE.test(end)) return null;
  if (start > end) return null;
  const ym = start.slice(0, 7);
  if (end.slice(0, 7) === ym && start.endsWith('-01') && end === monthEndDay(ym)) return ym;
  return `${start}..${end}`;
}

/** First and last calendar day a period key covers, as "YYYY-MM-DD". */
export function periodDayRange(key: string): { from: string; to: string } | null {
  const range = parsePeriodRangeKey(key);
  if (range) return range;
  const ym = key.trim();
  if (!isMonthKey(ym)) return null;
  return { from: `${ym}-01`, to: monthEndDay(ym) };
}

function nextMonth(ym: string): string {
  const [year, month] = ym.split('-').map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Calendar months a period key touches. Snapshots, trend charts and the state
 * report API all live on a month axis, so period keys are mapped back onto it
 * before anything leaves the analysis.
 */
export function periodMonths(key: string): string[] {
  const range = periodDayRange(key);
  if (!range) return [];
  const end = range.to.slice(0, 7);
  const months: string[] = [];
  let cursor = range.from.slice(0, 7);
  for (let guard = 0; cursor <= end && guard < 240; guard += 1) {
    months.push(cursor);
    cursor = nextMonth(cursor);
  }
  return months;
}

/** Earliest and latest calendar month a set of period keys covers. */
export function periodMonthBounds(keys: string[]): { start: string; end: string } | null {
  const months = [...new Set(keys.flatMap(periodMonths))].sort();
  if (months.length === 0) return null;
  return { start: months[0], end: months[months.length - 1] };
}

function utcDay(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * True when period `b` starts the day after period `a` ends — January then
 * February, or one week then the next. Month-on-month checks may only compare
 * such pairs: with February deselected, January -> March is a two-month change,
 * not a monthly one.
 */
export function periodsAreConsecutive(a: string, b: string): boolean {
  const first = periodDayRange(a);
  const second = periodDayRange(b);
  if (!first || !second) return false;
  return utcDay(second.from) - utcDay(first.to) === 86400000;
}

/** Inclusive day count between two "YYYY-MM-DD" dates. */
export function daysSpanInclusive(from: string, to: string): number | null {
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) return null;
  return Math.round((utcDay(to) - utcDay(from)) / 86400000) + 1;
}

/**
 * Human duration covered by a set of period keys — "3 months" when they are all
 * whole months (unchanged from the month-only behaviour), otherwise the real span
 * in weeks or days so a weekly upload is never reported as a month.
 */
export function periodDurationLabel(keys: string[]): string {
  const usable = keys.filter((key) => periodDayRange(key) !== null);
  if (usable.length === 0) return '-';

  if (usable.every(isMonthKey)) {
    const sorted = usable.slice().sort();
    const span = monthsSpanInclusive(sorted[0], sorted[sorted.length - 1]);
    return span ? `${span} month${span > 1 ? 's' : ''}` : '-';
  }

  let from = '';
  let to = '';
  for (const key of usable) {
    const range = periodDayRange(key)!;
    if (!from || range.from < from) from = range.from;
    if (!to || range.to > to) to = range.to;
  }
  const days = daysSpanInclusive(from, to);
  if (days === null) return '-';
  if (days % 7 === 0 && days <= 56) {
    const weeks = days / 7;
    return `${weeks} week${weeks > 1 ? 's' : ''}`;
  }
  return `${days} day${days > 1 ? 's' : ''}`;
}

function dayOfMonth(iso: string): number {
  return parseInt(iso.slice(8, 10), 10);
}

function shortMonthOf(iso: string): string {
  return MONTHS_SHORT[parseInt(iso.slice(5, 7), 10) - 1] ?? iso.slice(5, 7);
}

function rangeShortLabel(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${dayOfMonth(from)}-${dayOfMonth(to)} ${shortMonthOf(from)}`;
  }
  return `${dayOfMonth(from)} ${shortMonthOf(from)}-${dayOfMonth(to)} ${shortMonthOf(to)}`;
}

function rangeYearLabel(from: string, to: string): string {
  const yy = (iso: string) => iso.slice(2, 4);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${dayOfMonth(from)}-${dayOfMonth(to)} ${shortMonthOf(from)} ${yy(from)}`;
  }
  if (from.slice(0, 4) === to.slice(0, 4)) {
    return `${dayOfMonth(from)} ${shortMonthOf(from)} - ${dayOfMonth(to)} ${shortMonthOf(to)} ${yy(to)}`;
  }
  return `${dayOfMonth(from)} ${shortMonthOf(from)} ${yy(from)} - ${dayOfMonth(to)} ${shortMonthOf(to)} ${yy(to)}`;
}

function rangeLongLabel(from: string, to: string): string {
  const longMonthOf = (iso: string) => MONTHS_LONG[parseInt(iso.slice(5, 7), 10) - 1] ?? iso.slice(5, 7);
  const year = (iso: string) => iso.slice(0, 4);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${dayOfMonth(from)}-${dayOfMonth(to)} ${longMonthOf(from)} ${year(from)}`;
  }
  if (year(from) === year(to)) {
    return `${dayOfMonth(from)} ${shortMonthOf(from)} - ${dayOfMonth(to)} ${shortMonthOf(to)} ${year(to)}`;
  }
  return `${dayOfMonth(from)} ${shortMonthOf(from)} ${year(from)} - ${dayOfMonth(to)} ${shortMonthOf(to)} ${year(to)}`;
}

export function monthKey(raw: string): string | null {
  const rawStr = stripBOM(raw).trim();
  if (!rawStr) return null;

  const matchMonYY = rawStr.match(/^([A-Za-z]{3,9})\s*[-/\s]\s*(\d{2}|\d{4})$/);
  if (matchMonYY) {
    const mon = matchMonYY[1];
    const yy = matchMonYY[2];
    const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
    const mon3 = mon.substring(0, 3).toLowerCase();
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mIdx = monthNames.indexOf(mon3);
    if (mIdx >= 0) {
      const mm = String(mIdx + 1).padStart(2, '0');
      return `${year}-${mm}`;
    }
  }

  const matchYYYYMM = rawStr.match(/^(\d{4})-(\d{2})$/);
  if (matchYYYYMM) {
    return `${matchYYYYMM[1]}-${matchYYYYMM[2]}`;
  }

  const d = new Date(rawStr);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  return null;
}

/**
 * Bucket key for a Month-column cell. A cell holding a day range (written there by
 * a declared reporting period) is its own key; anything else falls back to the
 * calendar month it names.
 */
export function periodKey(raw: string): string | null {
  const value = stripBOM(raw ?? '').trim();
  if (isPeriodRangeKey(value)) return value;
  return monthKey(value);
}

export function monthShortLabel(ym: string): string {
  const range = parsePeriodRangeKey(ym);
  if (range) return rangeShortLabel(range.from, range.to);
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const m = parseInt(parts[1], 10) - 1;
  if (m < 0 || m > 11) return ym;
  return MONTHS_SHORT[m];
}

/** Full month name plus 4-digit year, e.g. "2026-01" -> "January 2026". */
export function monthLongLabel(ym: string): string {
  const range = parsePeriodRangeKey(ym);
  if (range) return rangeLongLabel(range.from, range.to);
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[0], 10);
  if (m < 0 || m > 11 || isNaN(y)) return ym;
  return `${MONTHS_LONG[m]} ${y}`;
}

export function monthYearLabel(ym: string): string {
  const range = parsePeriodRangeKey(ym);
  if (range) return rangeYearLabel(range.from, range.to);
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[0], 10) % 100;
  if (m < 0 || m > 11) return ym;
  return `${MONTHS_SHORT[m]}-${String(y).padStart(2, '0')}`;
}

export function monthsSpanInclusive(minYM: string, maxYM: string): number | null {
  const a = minYM.split('-');
  const b = maxYM.split('-');
  if (a.length !== 2 || b.length !== 2) return null;
  const y1 = parseInt(a[0], 10);
  const m1 = parseInt(a[1], 10);
  const y2 = parseInt(b[0], 10);
  const m2 = parseInt(b[1], 10);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

export function asNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;

  let s = stripBOM(String(v)).replace(/\u00a0/g, ' ').trim();
  if (s === '') return null;

  const low = s.toLowerCase();
  if (low === 'na' || low === 'n/a' || low === 'null' || low === '-') return null;

  s = s.replace(/,/g, '');
  s = s.replace(/(?<=\d)\s+(?=\d)/g, '');

  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) return Number(s);

  const match = s.match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  return Number(match[0]);
}

export function pctChange(prev: number | null, curr: number | null): number | null {
  if (prev === null || curr === null) return null;
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

export function safeKey(s: string): string {
  return s
    .replace(/[\u2192\u2014\u2013><:/\\|?*"',;()[\]{}]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'key';
}

export function displayBlockLabel(b: string): string {
  return b.trim() || 'Unknown block';
}

// ============================================================
// Indicator detection
// ============================================================

const INDICATOR_TARGETS: { code: string; short: string }[] = [
  { code: '9.1.2', short: 'BCG' },
  { code: '9.1.3', short: 'Penta1' },
  { code: '9.1.4', short: 'Penta2' },
  { code: '9.1.5', short: 'Penta3' },
  { code: '9.1.7', short: 'OPV1' },
  { code: '9.1.8', short: 'OPV2' },
  { code: '9.1.9', short: 'OPV3' },
  { code: '9.2.2', short: 'MR1' },
  { code: '9.4.1', short: 'MR2' },
  { code: '9.1.13', short: 'RVV1' },
  { code: '9.1.14', short: 'RVV2' },
  { code: '9.1.15', short: 'RVV3' },
  { code: '9.1.11', short: 'IPV1' },
  { code: '9.1.12', short: 'IPV2' },
  { code: '9.2.1', short: 'IPV3' },
  { code: '9.1.16', short: 'PCV1' },
  { code: '9.2.3', short: 'JE1' },
  { code: '9.4.4', short: 'JE2' },
  { code: '9.1.17', short: 'PCV2' },
  { code: '9.2.4', short: 'PCV Booster' },
  { code: '9.1.10', short: 'HepB0' },
  { code: '9.4.2', short: 'DPT 1st Booster' },
];

const TEXTUAL_SHORTS: Record<string, string> = {
  bcg: 'BCG',
  hepb0: 'HepB0',
  hepb: 'HepB0',
  opv0: 'OPV0',
  opv1: 'OPV1',
  opv2: 'OPV2',
  opv3: 'OPV3',
  opvbooster: 'OPV Booster',
  penta1: 'Penta1',
  penta2: 'Penta2',
  penta3: 'Penta3',
  rvv1: 'RVV1',
  rvv2: 'RVV2',
  rvv3: 'RVV3',
  ipv1: 'IPV1',
  ipv2: 'IPV2',
  ipv3: 'IPV3',
  fipv1: 'IPV1',
  fipv2: 'IPV2',
  fipv3: 'IPV3',
  pcv1: 'PCV1',
  pcv2: 'PCV2',
  pcvbooster: 'PCV Booster',
  mr1: 'MR1',
  mr2: 'MR2',
  je1: 'JE1',
  je2: 'JE2',
  dpt1: 'DPT1',
  dpt2: 'DPT2',
  dpt3: 'DPT3',
  dpt1stbooster: 'DPT 1st Booster',
  dptbooster1: 'DPT 1st Booster',
  dptb1: 'DPT 1st Booster',
  dptbooster2: 'DPT Booster 2',
  dptb2: 'DPT Booster 2',
  mmr: 'MMR',
  typhoid: 'Typhoid',
};

function detectTextualIndicatorShort(headerOriginal: string): string | null {
  const original = stripBOM(headerOriginal).trim();
  if (!original) return null;

  for (const segment of original.split(/\s*::\s*/)) {
    const part = normalizeLooseText(segment);
    if (!part) continue;

    const compact = headerCompactKey(part);
    const compactNoPrefix = headerCompactKey(part.replace(/^children vaccinated with\s+/u, ''));
    const direct = TEXTUAL_SHORTS[compact] ?? TEXTUAL_SHORTS[compactNoPrefix];
    if (direct) return direct;

    if (/\bbcg\b/u.test(part)) return 'BCG';

    if (/\bhepb0\b/u.test(part) || /\bhep\s*[- ]?b\s*0\b/u.test(part)) return 'HepB0';
    if (/\bchildren\b.*\bvaccinated\b.*\bhep\s*[- ]?b\b/u.test(part) || /\bhep\s*[- ]?b\b/u.test(part)) return 'HepB0';

    if (/\bopv\b.*\bbooster\b/u.test(part)) return 'OPV Booster';
    if (/\bopv\s*[- ]?\s*0\b/u.test(part)) return 'OPV0';
    if (/\bopv\s*[- ]?\s*1\b/u.test(part)) return 'OPV1';
    if (/\bopv\s*[- ]?\s*2\b/u.test(part)) return 'OPV2';
    if (/\bopv\s*[- ]?\s*3\b/u.test(part)) return 'OPV3';

    if (/\bpenta\s*[- ]?\s*1\b/u.test(part)) return 'Penta1';
    if (/\bpenta\s*[- ]?\s*2\b/u.test(part)) return 'Penta2';
    if (/\bpenta\s*[- ]?\s*3\b/u.test(part)) return 'Penta3';

    if (/\brvv\s*[- ]?\s*1\b/u.test(part)) return 'RVV1';
    if (/\brvv\s*[- ]?\s*2\b/u.test(part)) return 'RVV2';
    if (/\brvv\s*[- ]?\s*3\b/u.test(part)) return 'RVV3';

    if (/\b(?:f?ipv)\s*[- ]?\s*1\b/u.test(part)) return 'IPV1';
    if (/\b(?:f?ipv)\s*[- ]?\s*2\b/u.test(part)) return 'IPV2';
    if (/\b(?:f?ipv)\s*[- ]?\s*3\b/u.test(part)) return 'IPV3';

    if (/\bpcv\b.*\bbooster\b/u.test(part)) return 'PCV Booster';
    if (/\bpcv\s*[- ]?\s*1\b/u.test(part)) return 'PCV1';
    if (/\bpcv\s*[- ]?\s*2\b/u.test(part)) return 'PCV2';

    if (/\bmr\s*[- ]?\s*1\b/u.test(part)) return 'MR1';
    if (/\bmr\s*[- ]?\s*2\b/u.test(part)) return 'MR2';

    if (/\bje\s*[- ]?\s*1(?:st)?\b/u.test(part)) return 'JE1';
    if (/\b(?:je|japanese encephalitis)\b.*\b1st\s+dose\b/u.test(part)) return 'JE1';
    if (/\bje\s*[- ]?\s*2(?:nd)?\b/u.test(part)) return 'JE2';
    if (/\b(?:je|japanese encephalitis)\b.*\b2nd\s+dose\b/u.test(part)) return 'JE2';

    if (/\bdpt\b.*\bbooster\b.*\b1\b/u.test(part)) return 'DPT 1st Booster';
    if (/\bdpt\b.*\bbooster\b.*\b2\b/u.test(part)) return 'DPT Booster 2';
    if (/\bdpt\s*[- ]?\s*1\b/u.test(part)) return 'DPT1';
    if (/\bdpt\s*[- ]?\s*2\b/u.test(part)) return 'DPT2';
    if (/\bdpt\s*[- ]?\s*3\b/u.test(part)) return 'DPT3';

    if (/\bmmr\b/u.test(part)) return 'MMR';
    if (/\btyphoid\b/u.test(part)) return 'Typhoid';
  }

  return null;
}

export function detectTargetIndicator(headerOriginal: string): { code: string; short: string } | null {
  const h = stripBOM(headerOriginal).trim();
  if (!h) return null;

  // HMIS "delayed vaccination" items (9.3.x) are separate data items, never
  // analysis targets — without this guard they masquerade as the regular dose.
  if (/\bdelayed\b/u.test(normalizeLooseText(h))) return null;

  const textShort = detectTextualIndicatorShort(h);
  if (textShort) return { code: '', short: textShort };

  for (const t of INDICATOR_TARGETS) {
    const escaped = t.code.replace(/\./g, '\\.');
    const pattern = new RegExp(`^\\s*${escaped}\\.?\\s*(?::{1,2}|-|\\u2014)?\\s*`, 'ui');
    if (pattern.test(h)) return t;
  }

  return null;
}

// Resolves collisions when several columns claim the same indicator short:
// a column whose own text names the vaccine outranks a code-table match
// (code numbering has changed across HMIS template revisions), and the
// earliest column wins ties (the M9 immunisation section precedes the
// disease/inpatient sections that reuse the same names).
export function buildTargetIndicatorMap(
  header: string[],
  startIdx: number
): { map: Record<string, number>; indices: number[] } {
  const map: Record<string, number> = {};
  const tier: Record<string, number> = {};
  const indices: number[] = [];
  for (let i = startIdx; i < header.length; i++) {
    const det = detectTargetIndicator(header[i]);
    if (!det) continue;
    indices.push(i);
    const t = det.code === '' ? 2 : 1;
    if (map[det.short] === undefined || t > tier[det.short]) {
      map[det.short] = i;
      tier[det.short] = t;
    }
  }
  return { map, indices };
}

export function indicatorShortFromHeader(headerOriginal: string): string {
  const h = stripBOM(headerOriginal.trim());
  const low = normalizeLooseText(h);

  const det = detectTargetIndicator(h);
  if (det) return det.short;

  if (low.includes('fully immuniz') || low.includes('fully immunis')) {
    // 'female' first: "female".includes('male') is true
    if (low.includes('female')) return 'FIC-F';
    if (low.includes('male')) return 'FIC-M';
    if (low.includes('total')) return 'FIC-Total';
  }

  const codeMatch = h.match(/^\s*([0-9]+(?:\.[0-9]+)+(?:\.[a-z])?)\s*/i);
  if (codeMatch) return codeMatch[1].toUpperCase();

  const tok = h.replace(/\s+/g, '').replace(/[^A-Za-z0-9]+/g, '');
  if (tok) return tok.substring(0, 12);

  return 'IND';
}

export function findIndexByCode(headers: string[], code: string): number | null {
  if (/\d+\.\d+/.test(code)) {
    const stripped = code.replace(/\.$/, '');
    const escaped = stripped.replace(/\./g, '\\.');
    const pat = new RegExp(`^\\s*${escaped}\\.?\\s*(?::{1,2}|-|\\u2014)?\\s*`, 'ui');
    for (let i = 0; i < headers.length; i++) {
      if (pat.test(stripBOM(headers[i].trim()))) return i;
    }
    return null;
  }

  const needle = normalizeHeader(code);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]) === needle) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]).includes(needle)) return i;
  }
  return null;
}

export function arraySearchFirst(normHeaders: string[], candidates: string[]): number | null {
  for (const cand of candidates) {
    const cn = normalizeHeader(cand);
    for (let i = 0; i < normHeaders.length; i++) {
      if (normHeaders[i] === cn) return i;
    }
  }
  return null;
}

export function findColIndexContainsAny(rawHeader: string[], needles: string[]): number | null {
  const norm = rawHeader.map((h) => normalizeHeader(h));
  for (const needle of needles) {
    const normalizedNeedle = normalizeHeader(needle);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === normalizedNeedle) return i;
      if (normalizedNeedle && norm[i].includes(normalizedNeedle)) return i;
    }
  }
  return null;
}

export function findBlockColIndex(rawHeader: string[]): number | null {
  const norm = rawHeader.map((h) => normalizeHeader(h));
  const compact = rawHeader.map((h) => headerCompactKey(h));

  for (const candidate of ['lgd block name', 'lgd_block_name', 'lgd block', 'lgdblockname']) {
    const cNorm = normalizeHeader(candidate);
    const cCompact = headerCompactKey(candidate);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === cNorm || compact[i] === cCompact) return i;
    }
  }

  for (let i = 0; i < compact.length; i++) {
    if (compact[i].includes('lgdblockname') || compact[i].includes('lgdblock')) return i;
  }

  for (let i = 0; i < norm.length; i++) {
    if (norm[i].includes('lgd') && norm[i].includes('block')) return i;
  }

  for (const candidate of ['block name', 'health block name', 'block']) {
    const cNorm = normalizeHeader(candidate);
    const cCompact = headerCompactKey(candidate);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === cNorm || compact[i] === cCompact) return i;
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (norm[i].includes('block')) return i;
  }

  return null;
}

export function findFacilityColIndex(rawHeader: string[]): number | null {
  const norm = rawHeader.map((h) => normalizeHeader(h));
  const compact = rawHeader.map((h) => headerCompactKey(h));

  for (const candidate of ['health facility name', 'health_facility_name', 'facility name', 'facility_name']) {
    const cNorm = normalizeHeader(candidate);
    const cCompact = headerCompactKey(candidate);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === cNorm || compact[i] === cCompact) return i;
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (norm[i].includes('facility') && norm[i].includes('name')) return i;
  }

  return null;
}

export function findMonthColIndex(rawHeader: string[]): number | null {
  const norm = rawHeader.map((h) => normalizeHeader(h));
  for (const candidate of ['month', 'reporting month', 'month name']) {
    const cNorm = normalizeHeader(candidate);
    for (let i = 0; i < norm.length; i++) {
      if (norm[i] === cNorm) return i;
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (norm[i].includes('month')) return i;
  }

  return null;
}

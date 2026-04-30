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

export function monthShortLabel(ym: string): string {
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  if (m < 0 || m > 11) return ym;
  return monthNames[m];
}

export function monthYearLabel(ym: string): string {
  const parts = ym.split('-');
  if (parts.length !== 2) return ym;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  const y = parseInt(parts[0], 10) % 100;
  if (m < 0 || m > 11) return ym;
  return `${monthNames[m]}-${String(y).padStart(2, '0')}`;
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
  { code: '9.3.3', short: 'IPV3' },
  { code: '9.1.16', short: 'PCV1' },
  { code: '9.2.3', short: 'PCV1' },
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

    if (/\bje\s*[- ]?\s*1\b/u.test(part)) return 'JE1';
    if (/\bje\s*[- ]?\s*2\b/u.test(part)) return 'JE2';

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

  const textShort = detectTextualIndicatorShort(h);
  if (textShort) return { code: '', short: textShort };

  for (const t of INDICATOR_TARGETS) {
    const escaped = t.code.replace(/\./g, '\\.');
    const pattern = new RegExp(`^\\s*${escaped}\\.?\\s*(?::{1,2}|-|\\u2014)?\\s*`, 'ui');
    if (pattern.test(h)) return t;
  }

  return null;
}

export function indicatorShortFromHeader(headerOriginal: string): string {
  const h = stripBOM(headerOriginal.trim());
  const low = normalizeLooseText(h);

  const det = detectTargetIndicator(h);
  if (det) return det.short;

  if (low.includes('fully immuniz') || low.includes('fully immunis')) {
    if (low.includes('male')) return 'FIC-M';
    if (low.includes('female')) return 'FIC-F';
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

// ============================================================
// UWIN CSV Parser — separate from HMIS parser
// Handles: two-row UWIN headers, beneficiary columns, multi-file merge,
//          synthetic Month injection when Month column is absent
// ============================================================

import Papa from 'papaparse';
import {
  stripBOM,
  normalizeHeader,
  normalizeLooseText,
  headerCompactKey,
  normalizeFacilityKey,
  normalizeOwnership,
  normalizeRU,
  monthKey,
  monthShortLabel,
  monthYearLabel,
  asNumOrNull,
  arraySearchFirst,
  indicatorShortFromHeader,
  detectTargetIndicator,
  findIndexByCode,
  findBlockColIndex,
  findFacilityColIndex,
  findMonthColIndex,
  findColIndexContainsAny,
} from '../dqa/parseUtils';
import type { FacilityRecord } from '../dqa/types';
import type { UwinParsedCSV } from './types';

// ============================================================
// UWIN two-row header detection + merging
// ============================================================

const UWIN_VAX_CODES = new Set(
  [
    'bcg', 'hepb0', 'hep b0', 'hep b', 'opv0', 'opv-0', 'opv1', 'opv-1', 'opv2', 'opv-2', 'opv3', 'opv-3', 'opv booster', 'opv-booster',
    'rvv1', 'rvv2', 'rvv3',
    'penta1', 'penta-1', 'penta2', 'penta-2', 'penta3', 'penta-3',
    'pcv1', 'pcv-1', 'pcv2', 'pcv-2', 'pcv 2', 'pcv booster', 'pcvbooster',
    'ipv1', 'ipv-1', 'fipv1', 'fipv-1', 'ipv2', 'fipv2', 'ipv3', 'fipv3',
    'mr1', 'mr-1', 'mr2', 'mr-2',
    'dpt1', 'dpt 1', 'dpt2', 'dpt 2', 'dpt3', 'dpt 3', 'dpt 1st booster', 'dpt booster 1', 'dptbooster1', 'dptb1',
    'je1', 'je-1', 'je2', 'je-2',
  ].map((token) => headerCompactKey(token))
);

function isProbablyUwinSecondHeaderRow(row1: string[], row2: string[]): boolean {
  if (!row1.length || !row2.length) return false;
  const row1HasVacc = row1.some((cell) => {
    const normalized = normalizeLooseText(cell);
    return normalized.includes('children vaccin') || normalized.includes('vaccinat');
  });
  if (!row1HasVacc) return false;

  let hits = 0;
  let numericCount = 0;
  let nonEmpty = 0;
  let codeLike = 0;
  const lengths: number[] = [];
  for (const cell of row2) {
    const t = normalizeLooseText(cell);
    if (!t) continue;
    nonEmpty++;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(t.replace(/,/g, ''))) {
      numericCount++;
      continue;
    }

    if (UWIN_VAX_CODES.has(headerCompactKey(t))) hits++;

    lengths.push(t.length);
    const words = t.split(/\s+/).filter(Boolean);
    if (t.length <= 14 && words.length <= 3 && /^[a-z0-9 -]+$/u.test(t)) codeLike++;
  }
  if (nonEmpty === 0) return false;
  if (numericCount / nonEmpty >= 0.35) return false;
  if (hits >= 3) return true;

  const codeRatio = codeLike / Math.max(1, nonEmpty - numericCount);
  let medianLen: number | null = null;
  if (lengths.length > 0) {
    lengths.sort((a, b) => a - b);
    medianLen = lengths[Math.floor((lengths.length - 1) / 2)];
  }

  return hits >= 2 && codeRatio >= 0.5 && (medianLen === null || medianLen <= 10);
}

function mergeUwinHeaders(row1: string[], row2: string[]): string[] {
  const maxLen = Math.max(row1.length, row2.length);
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const a = (row1[i] ?? '').trim();
    const b = (row2[i] ?? '').trim();
    const looksLikeCode = /^[a-z]{2,8}\s*\d{0,2}(\s*booster)?(\s*\d+)?$/iu.test(b);
    result.push(b && (UWIN_VAX_CODES.has(headerCompactKey(b)) || looksLikeCode) ? b : (a || b));
  }
  return result;
}

// ============================================================
// Beneficiary column detection
// ============================================================

function findBeneficiaryColumnIndices(headers: string[]): {
  pw: number | null; inf: number | null; child: number | null; adol: number | null;
} {
  return {
    pw: findColIndexContainsAny(headers, ['number of pregnant women vaccinated', 'pregnant women vaccinated', 'pregnant women']),
    inf: findColIndexContainsAny(headers, ['number of infants (0-1 year) vaccinated', 'infants (0-1 year) vaccinated', 'infants 0-1 year vaccinated', 'infants (0-1 year)', 'infants 0-1 year', 'infants']),
    child: findColIndexContainsAny(headers, ['number of children (>1 year) vaccinated', 'children (>1 year) vaccinated', 'children >1 year vaccinated', 'children (>1 year)', 'children >1 year']),
    adol: findColIndexContainsAny(headers, ['number of adolescents vaccinated', 'adolescents vaccinated', 'adolescents']),
  };
}

// ============================================================
// Header extraction helper (two-row aware)
// ============================================================

function extractHeader(rawRows: string[][]): { header: string[]; dataStartIdx: number } {
  const raw0 = rawRows[0].map((h) => stripBOM(h.trim()));
  if (rawRows.length >= 2) {
    const row2 = rawRows[1].map((h) => h.trim());
    if (isProbablyUwinSecondHeaderRow(raw0, row2)) {
      return { header: mergeUwinHeaders(raw0, row2), dataStartIdx: 2 };
    }
  }
  return { header: raw0, dataStartIdx: 1 };
}

// ============================================================
// Column candidates (reused for injection positioning)
// ============================================================

const ULB_CANDIDATES = ['lgd ulb name', 'ulb name', 'lgd ulb'];
const MONTH_CANDIDATES = ['month', 'reporting month', 'month name'];

// ============================================================
// Synthetic Month injection
// Inserts a "Month" column into raw rows when it is absent.
// Placement: after LGD ULB Name if present, otherwise after Facility.
// Row 0 (header) gets 'Month'; second header row (two-row) gets '';
// data rows all receive fileMonth value.
// ============================================================

function injectMonthIfMissing(rawRows: string[][], fileMonth: string): string[][] {
  if (rawRows.length === 0) return rawRows;
  const { header, dataStartIdx } = extractHeader(rawRows);

  if (findMonthColIndex(header) !== null) return rawRows;

  const norm = header.map(normalizeHeader);
  const idxFacTmp = findFacilityColIndex(header);
  const idxULBTmp = findColIndexContainsAny(header, ULB_CANDIDATES) ?? arraySearchFirst(norm, ULB_CANDIDATES);
  const insertAfter = idxULBTmp ?? idxFacTmp ?? (norm.length > 1 ? 1 : 0);
  const insertAt = Math.max(0, insertAfter + 1);

  return rawRows.map((r, ri) => {
    const val = ri === 0 ? 'Month' : ri < dataStartIdx ? '' : fileMonth;
    return [...r.slice(0, insertAt), val, ...r.slice(insertAt)];
  });
}

// ============================================================
// Month extraction from filename (YYYY-MM, or null if not found)
// ============================================================

function extractMonthFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[_\-\s]+/g, ' ').toLowerCase();
  const MONTHS3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const MONTHS_FULL = ['january','february','march','april','may','june','july','august','september','october','november','december'];

  // YYYY MM pattern
  const m1 = base.match(/\b((?:19|20)\d{2})\s+(\d{2})\b/);
  if (m1) {
    const mo = parseInt(m1[2], 10);
    if (mo >= 1 && mo <= 12) return `${m1[1]}-${String(mo).padStart(2, '0')}`;
  }

  // MM YYYY pattern
  const m2 = base.match(/\b(\d{1,2})\s+((?:19|20)\d{2})\b/);
  if (m2) {
    const mo = parseInt(m2[1], 10);
    if (mo >= 1 && mo <= 12) return `${m2[2]}-${String(mo).padStart(2, '0')}`;
  }

  // Extract year (4-digit preferred)
  const yearFull = base.match(/\b((?:19|20)\d{2})\b/);
  const year4 = yearFull ? parseInt(yearFull[1], 10) : null;
  const shortYearM = !yearFull ? base.match(/\b(\d{2})\b/) : null;
  const year = year4 ?? (shortYearM ? 2000 + parseInt(shortYearM[1], 10) : null);
  if (!year) return null;

  // Month name match
  for (let i = 0; i < 12; i++) {
    if (base.includes(MONTHS_FULL[i]) || base.includes(MONTHS3[i])) {
      return `${year}-${String(i + 1).padStart(2, '0')}`;
    }
  }

  return null;
}

// ============================================================
// Pre-check: scan file headers to detect Month column presence
// ============================================================

export interface UwinFilePrecheck {
  file: File;
  hasMonthColumn: boolean;
  detectedMonth: string | null; // YYYY-MM if auto-detected from filename, else null
  isHmisFile: boolean;
}

export function preCheckUwinFiles(files: File[]): Promise<UwinFilePrecheck[]> {
  const parseHeaderRows = (f: File): Promise<string[][]> =>
    new Promise((res, rej) => {
      Papa.parse<string[]>(f, {
        skipEmptyLines: true,
        preview: 3,
        complete: (results) => res(results.data as string[][]),
        error: (err) => rej(err),
      });
    });

  return Promise.all(
    files.map(async (file) => {
      const rows = await parseHeaderRows(file);
      const { header } = extractHeader(rows);
      const hasMonthColumn = findMonthColIndex(header) !== null;
      const detectedMonth = hasMonthColumn ? null : extractMonthFromFilename(file.name);
      const isHmisFile = !header.some((h) => UWIN_VAX_CODES.has(headerCompactKey(h)));
      return { file, hasMonthColumn, detectedMonth, isHmisFile };
    })
  );
}

// ============================================================
// Single UWIN CSV file
// fileMonth: YYYY-MM — required when file has no Month column
// ============================================================

export function parseUwinCSVFile(file: File, fileMonth?: string): Promise<UwinParsedCSV> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rawRows = results.data as string[][];
          const processed = fileMonth ? injectMonthIfMissing(rawRows, fileMonth) : rawRows;
          resolve(processUwinRawRows(processed, file.name));
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}

// ============================================================
// Multi-file UWIN (up to 12 monthly CSVs)
// fileMonths[i]: YYYY-MM — required for files[i] that lack a Month column
// ============================================================

export function parseUwinMultipleCSVFiles(files: File[], fileMonths?: string[]): Promise<UwinParsedCSV> {
  if (files.length === 0) throw new Error('No files provided.');
  if (files.length === 1) return parseUwinCSVFile(files[0], fileMonths?.[0]);

  const parseRaw = (f: File): Promise<string[][]> =>
    new Promise((res, rej) => {
      Papa.parse<string[]>(f, {
        skipEmptyLines: true,
        complete: (results) => res(results.data as string[][]),
        error: (err) => rej(err),
      });
    });

  return Promise.all(files.map(parseRaw)).then((allRaw) => {
    // Inject synthetic Month per-file where needed, before canonical header computation
    const processedRaws = allRaw.map((raw, fi) => {
      const { header } = extractHeader(raw);
      const hasMonth = findMonthColIndex(header) !== null;
      if (hasMonth) return raw;
      const fm = fileMonths?.[fi];
      if (!fm) throw new Error(`File "${files[fi].name}" has no Month column. Please provide the month for each file.`);
      return injectMonthIfMissing(raw, fm);
    });

    const { header: canonicalHeader, dataStartIdx: firstDataIdx0 } = extractHeader(processedRaws[0]);
    const canonNorm = canonicalHeader.map(normalizeHeader);
    const mergedRows: string[][] = [];

    for (let fi = 0; fi < processedRaws.length; fi++) {
      const raw = processedRaws[fi];
      const { header: fileHeader, dataStartIdx } = fi === 0
        ? { header: canonicalHeader, dataStartIdx: firstDataIdx0 }
        : extractHeader(raw);

      const fileNorm = fileHeader.map(normalizeHeader);
      const canonicalNoMonth = canonNorm.filter((hn) => !MONTH_CANDIDATES.includes(hn));
      const fileNoMonth = fileNorm.filter((hn) => !MONTH_CANDIDATES.includes(hn));
      if (
        canonicalNoMonth.length !== fileNoMonth.length ||
        canonicalNoMonth.some((hn, idx) => hn !== fileNoMonth[idx])
      ) {
        throw new Error(`Header mismatch detected in "${files[fi].name}". Please ensure all month-wise files have the same columns (except Month).`);
      }
      const colMap: number[] = canonNorm.map((cn) => fileNorm.indexOf(cn));

      for (let ri = dataStartIdx; ri < raw.length; ri++) {
        const row = raw[ri];
        const mapped: string[] = colMap.map((ci) => ci >= 0 ? (row[ci] ?? '') : '');
        while (mapped.length < canonicalHeader.length) mapped.push('');
        mergedRows.push(mapped);
      }
    }

    return processUwinRawRows(
      [canonicalHeader, ...mergedRows],
      files.map((f) => f.name).join(', ')
    );
  });
}

// ============================================================
// Core processing
// ============================================================

function processUwinRawRows(rawRows: string[][], fileName: string): UwinParsedCSV {
  if (rawRows.length === 0) throw new Error('Empty file or unreadable header.');

  const { header, dataStartIdx } = extractHeader(rawRows);
  const norm = header.map(normalizeHeader);

  const idxBlock = findBlockColIndex(header);
  const idxFac = findFacilityColIndex(header);
  const idxMonth = findMonthColIndex(header);
  const idxOwner = arraySearchFirst(norm, ['ownership', 'ownership status']);
  const idxRU = arraySearchFirst(norm, [
    'rural/urban', 'rural urban', 'rural-urban', 'rural - urban', 'ruralurban',
  ]);
  const idxState = arraySearchFirst(norm, ['state', 'state name', 'state_name']);
  const idxDist = arraySearchFirst(norm, ['district', 'district name', 'district_name']);

  if (idxBlock === null || idxFac === null || idxMonth === null) {
    throw new Error(
      'Could not find required columns: Block Name, Facility Name, Month. ' +
      'If this U-WIN file has no Month column, provide the month during upload.'
    );
  }

  const idxSessPlanned =
    findIndexByCode(header, 'sessions planned') ??
    findColIndexContainsAny(header, ['session planned', 'sessions planned']);
  const idxSessHeld =
    findIndexByCode(header, 'sessions held') ??
    findColIndexContainsAny(header, ['session held', 'sessions held']);
  const benIdx = findBeneficiaryColumnIndices(header);

  // Build indicator map
  const indicatorMap: Record<string, number> = {};
  const allIndicatorShorts: string[] = [];
  const shortCounts: Record<string, number> = {};

  for (let i = idxMonth + 1; i < header.length; i++) {
    let short = indicatorShortFromHeader(header[i]);
    const base = short;
    shortCounts[base] = (shortCounts[base] || 0) + 1;
    if (shortCounts[base] > 1) short = `${base}-${shortCounts[base]}`;
    indicatorMap[short] = i;
    allIndicatorShorts.push(short);
  }
  const targetMap: Record<string, number> = {};
  for (let i = idxMonth + 1; i < header.length; i++) {
    const det = detectTargetIndicator(header[i]);
    if (det) targetMap[det.short] = i;
  }
  Object.assign(indicatorMap, targetMap);

  // Parse data rows
  const rows = rawRows.slice(dataStartIdx).map((r) => {
    if (r.length < header.length) {
      const p = [...r];
      while (p.length < header.length) p.push('');
      return p;
    }
    return r;
  });

  const facilityData: Record<string, FacilityRecord> = {};
  const allMonthsMap: Record<string, string> = {};
  const statesSet = new Set<string>();
  const distsSet = new Set<string>();

  for (const r of rows) {
    const block = r[idxBlock]?.trim() ?? '';
    const fac = r[idxFac]?.trim() ?? '';
    const monRaw = r[idxMonth] ?? '';
    if (!block && !fac) continue;
    if (!monRaw.trim()) continue;
    const mk = monthKey(monRaw);
    if (!mk) continue;

    const mLabel = monthShortLabel(mk);
    const mYearLabel = monthYearLabel(mk);
    const own = idxOwner !== null ? normalizeOwnership(r[idxOwner] ?? '') : '';
    const ru = idxRU !== null ? normalizeRU(r[idxRU] ?? '') : '';

    if (idxState !== null) { const sv = r[idxState]?.trim(); if (sv) statesSet.add(sv); }
    if (idxDist !== null) { const dv = r[idxDist]?.trim(); if (dv) distsSet.add(dv); }

    allMonthsMap[mk] = mLabel;
    const facKey = `${block}||${fac}`;
    if (!facilityData[facKey]) {
      facilityData[facKey] = { block, facility: fac, ownership: '', ru: '', months: {} };
    }
    const fd = facilityData[facKey];
    if (own) { if (!fd.ownership) fd.ownership = own; else if (fd.ownership !== own) fd.ownership = 'Mixed'; }
    if (ru) { if (!fd.ru) fd.ru = ru; else if (fd.ru !== ru) fd.ru = 'Mixed'; }

    if (!fd.months[mk]) {
      const vals: Record<number, number | null> = {};
      for (let ci = idxMonth + 1; ci < header.length; ci++) vals[ci] = null;
      fd.months[mk] = { label: mLabel, yearMonth: mYearLabel, raw: monRaw, vals };
    }
    // SUM values across multiple session-site rows for the same facility+month
    const monthEntry = fd.months[mk];
    for (let ci = idxMonth + 1; ci < header.length; ci++) {
      const v = asNumOrNull(r[ci]);
      if (v !== null) monthEntry.vals[ci] = (monthEntry.vals[ci] ?? 0) + v;
    }
  }

  const globalFacilitySet = new Map<string, { ownership: string; ru: string }>();
  const globalBlockSet = new Set<string>();
  for (const fd of Object.values(facilityData)) {
    const fk = normalizeFacilityKey(fd.facility);
    if (fk && !globalFacilitySet.has(fk)) globalFacilitySet.set(fk, { ownership: fd.ownership, ru: fd.ru });
    if (fd.block.trim()) globalBlockSet.add(fd.block.trim());
  }

  let publicCount = 0, privateCount = 0, ruralCount = 0, urbanCount = 0;
  for (const m of globalFacilitySet.values()) {
    if (m.ownership.toLowerCase() === 'public') publicCount++;
    else if (m.ownership.toLowerCase() === 'private') privateCount++;
    if (m.ru.toLowerCase() === 'rural') ruralCount++;
    else if (m.ru.toLowerCase() === 'urban') urbanCount++;
  }

  return {
    portal: 'UWIN',
    header, rows, idxBlock, idxFac, idxMonth,
    idxOwner, idxRU, idxState, idxDist,
    idxSessPlanned, idxSessHeld,
    idxBenPW: benIdx.pw, idxBenInf: benIdx.inf,
    idxBenChild: benIdx.child, idxBenAdol: benIdx.adol,
    indicatorMap, allIndicatorShorts, facilityData,
    allMonths: allMonthsMap,
    globalFacilityCount: globalFacilitySet.size,
    globalBlockCount: globalBlockSet.size,
    publicCount, privateCount, ruralCount, urbanCount,
    stateName: statesSet.size === 1 ? [...statesSet][0] : statesSet.size > 1 ? 'Multiple' : '—',
    distName: distsSet.size === 1 ? [...distsSet][0] : distsSet.size > 1 ? 'Multiple' : '—',
    fileName,
  };
}

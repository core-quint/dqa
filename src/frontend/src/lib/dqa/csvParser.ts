// ============================================================
// HMIS file parser - converts raw CSV/XLSX input to ParsedCSV
// ============================================================

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  stripBOM,
  normalizeHeader,
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
} from './parseUtils';
import type { ParsedCSV, FacilityRecord } from './types';

const LEGACY_HMIS_GEO_COL_COUNT = 36; // A:AJ

export async function parseCSVFile(file: File): Promise<ParsedCSV> {
  if (isExcelFile(file.name)) {
    const rawRows = await parseExcelRows(file);
    return processRawRows(rawRows, file.name);
  }

  const rawRows = await parseCsvRows(file);
  return processRawRows(rawRows, file.name);
}

function parseCsvRows(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

async function parseExcelRows(file: File): Promise<string[][]> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: 'array',
    raw: false,
    cellText: false,
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The Excel workbook has no readable sheets.');
  }

  const sheet = cloneSheetWithExpandedMerges(workbook.Sheets[firstSheetName]);
  const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  return rows
    .map((row) => row.map((cell) => String(cell ?? '')))
    .filter((row) => row.some((cell) => stripBOM(String(cell ?? '')).trim() !== ''));
}

function cloneSheetWithExpandedMerges(sheet: XLSX.WorkSheet): XLSX.WorkSheet {
  const clone: XLSX.WorkSheet = { ...sheet };
  const mergeRanges = sheet['!merges'] ?? [];

  for (const range of mergeRanges) {
    const startRef = XLSX.utils.encode_cell(range.s);
    const startCell = sheet[startRef];
    if (!startCell) continue;

    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const ref = XLSX.utils.encode_cell({ r: row, c: col });
        clone[ref] = { ...startCell };
      }
    }
  }

  return clone;
}

function isExcelFile(fileName: string): boolean {
  return /\.(xlsx|xls)$/i.test(fileName);
}

function tryNormalizeLegacyHmisRows(rawRows: string[][]): string[][] | null {
  if (rawRows.length < 6) return null;

  const rows = rawRows.map((row) => [...row]);
  const withoutTitle = rows.slice(1);
  if (withoutTitle.length < 5) return null;

  const headerBase = [...withoutTitle[2]];
  const geoSource = withoutTitle[1] ?? [];
  const geoCols = Math.min(LEGACY_HMIS_GEO_COL_COUNT, Math.max(headerBase.length, geoSource.length));

  for (let col = 0; col < geoCols; col++) {
    const geoValue = geoSource[col]?.trim();
    if (geoValue) {
      headerBase[col] = geoSource[col];
    }
  }

  return [headerBase, ...withoutTitle.slice(4)];
}

function hasRequiredHeaders(rawHeader: string[]): boolean {
  const header = rawHeader.map((h) => stripBOM(h.trim()));
  const norm = header.map(normalizeHeader);

  const idxBlock = arraySearchFirst(norm, [
    'block name', 'health block name', 'lgd block name', 'block', 'block_name',
  ]);
  const idxFac = arraySearchFirst(norm, [
    'facility name', 'health facility name', 'facility', 'facility_name',
    'session site name', 'session site', 'session_site_name',
  ]);
  const idxMonth = arraySearchFirst(norm, ['month', 'reporting month', 'month name']);

  return idxBlock !== null && idxFac !== null && idxMonth !== null;
}

function processRawRows(rawRows: string[][], fileName: string): ParsedCSV {
  if (rawRows.length === 0) throw new Error('Empty file or unreadable header.');

  const normalizedRows =
    hasRequiredHeaders(rawRows[0] ?? []) ? rawRows : (tryNormalizeLegacyHmisRows(rawRows) ?? rawRows);
  if (normalizedRows.length === 0) throw new Error('Empty file or unreadable header.');

  // Clean header
  const rawHeader = normalizedRows[0];
  const header: string[] = rawHeader.map((h) => stripBOM(h.trim()));
  const norm: string[] = header.map(normalizeHeader);

  // Find required columns
  const idxBlock = arraySearchFirst(norm, [
    'block name', 'health block name', 'lgd block name', 'block', 'block_name',
  ]);
  const idxFac = arraySearchFirst(norm, [
    'facility name', 'health facility name', 'facility', 'facility_name',
    'session site name', 'session site', 'session_site_name',
  ]);
  const idxMonth = arraySearchFirst(norm, ['month', 'reporting month', 'month name']);
  const idxOwner = arraySearchFirst(norm, ['ownership', 'ownership status']);
  const idxRU = arraySearchFirst(norm, [
    'rural/urban', 'rural urban', 'rural-urban', 'rural - urban', 'ruralurban', 'rural', 'urban',
  ]);
  const idxState = arraySearchFirst(norm, ['state', 'state name', 'state_name']);
  const idxDist = arraySearchFirst(norm, ['district', 'district name', 'district_name']);

  if (idxBlock === null || idxFac === null || idxMonth === null) {
    throw new Error(
      'Please upload a readable HMIS CSV or Excel file with Block Name, Facility Name (or Session Site Name), and Month headers.'
    );
  }

  // Sessions
  const idxSessPlanned = findIndexByCode(header, 'sessions planned');
  const idxSessHeld = findIndexByCode(header, 'sessions held');

  // Build indicator map (all columns after Month)
  const indicatorMap: Record<string, number> = {};
  const allIndicatorShorts: string[] = [];
  const shortCounts: Record<string, number> = {};

  for (let i = idxMonth + 1; i < header.length; i++) {
    let short = indicatorShortFromHeader(header[i]);
    const base = short;
    shortCounts[base] = (shortCounts[base] || 0) + 1;
    if (shortCounts[base] > 1) {
      short = `${base}-${shortCounts[base]}`;
    }
    indicatorMap[short] = i;
    allIndicatorShorts.push(short);
  }

  // Also build a map by code for the target indicators
  const targetIndicatorIdxMap: Record<string, number> = {};
  for (let i = idxMonth + 1; i < header.length; i++) {
    const det = detectTargetIndicator(header[i]);
    if (det) targetIndicatorIdxMap[det.short] = i;
  }
  // Merge target map into indicator map (prefer target detection)
  Object.assign(indicatorMap, targetIndicatorIdxMap);

  // Parse data rows
  const rows = normalizedRows.slice(1).map((r) => {
    if (r.length < header.length) {
      const padded = [...r];
      while (padded.length < header.length) padded.push('');
      return padded;
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

    if (idxState !== null) {
      const sv = r[idxState]?.trim();
      if (sv) statesSet.add(sv);
    }
    if (idxDist !== null) {
      const dv = r[idxDist]?.trim();
      if (dv) distsSet.add(dv);
    }

    allMonthsMap[mk] = mLabel;
    const facKey = `${block}||${fac}`;

    if (!facilityData[facKey]) {
      facilityData[facKey] = {
        block,
        facility: fac,
        ownership: '',
        ru: '',
        months: {},
      };
    }

    const fd = facilityData[facKey];

    if (own) {
      if (!fd.ownership) fd.ownership = own;
      else if (fd.ownership !== own) fd.ownership = 'Mixed';
    }
    if (ru) {
      if (!fd.ru) fd.ru = ru;
      else if (fd.ru !== ru) fd.ru = 'Mixed';
    }

    if (!fd.months[mk]) {
      const vals: Record<number, number | null> = {};
      for (let ci = idxMonth + 1; ci < header.length; ci++) {
        vals[ci] = asNumOrNull(r[ci]);
      }
      fd.months[mk] = { label: mLabel, yearMonth: mYearLabel, raw: monRaw, vals };
    }
  }

  // Global facility count — uses block+facility key to match KPI computation
  const globalFacilitySet = new Map<string, { ownership: string; ru: string }>();
  const globalBlockSet = new Set<string>();

  for (const [facKey, fd] of Object.entries(facilityData)) {
    if (facKey) {
      if (!globalFacilitySet.has(facKey)) {
        globalFacilitySet.set(facKey, { ownership: fd.ownership, ru: fd.ru });
      }
    }
    if (fd.block.trim()) globalBlockSet.add(fd.block.trim());
  }

  let publicCount = 0, privateCount = 0, ruralCount = 0, urbanCount = 0;
  for (const meta of globalFacilitySet.values()) {
    const o = meta.ownership.toLowerCase();
    if (o === 'public') publicCount++;
    else if (o === 'private') privateCount++;
    const r = meta.ru.toLowerCase();
    if (r === 'rural') ruralCount++;
    else if (r === 'urban') urbanCount++;
  }

  const stateName =
    statesSet.size === 1 ? [...statesSet][0] : statesSet.size > 1 ? 'Multiple' : '—';
  const distName =
    distsSet.size === 1 ? [...distsSet][0] : distsSet.size > 1 ? 'Multiple' : '—';

  return {
    portal: 'HMIS',
    header,
    rows,
    idxBlock,
    idxFac,
    idxMonth,
    idxOwner,
    idxRU,
    idxState,
    idxDist,
    idxSessPlanned,
    idxSessHeld,
    indicatorMap,
    allIndicatorShorts,
    facilityData,
    allMonths: allMonthsMap,
    globalFacilityCount: globalFacilitySet.size,
    globalBlockCount: globalBlockSet.size,
    publicCount,
    privateCount,
    ruralCount,
    urbanCount,
    stateName,
    distName,
    fileName,
  };
}

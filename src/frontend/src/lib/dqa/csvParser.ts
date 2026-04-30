// ============================================================
// CSV Parser - converts raw papaparse output to ParsedCSV
// ============================================================

import Papa from 'papaparse';
import {
  stripBOM,
  normalizeHeader,
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
} from './parseUtils';
import type { ParsedCSV, FacilityRecord } from './types';

export function parseCSVFile(file: File): Promise<ParsedCSV> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = processRawRows(results.data, file.name);
          resolve(parsed);
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}

function processRawRows(rawRows: string[][], fileName: string): ParsedCSV {
  if (rawRows.length === 0) throw new Error('Empty file or unreadable header.');

  // Clean header
  const rawHeader = rawRows[0];
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
      'Please upload CSV with required headers: Block Name, Facility Name (or Session Site Name), Month.'
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
  const rows = rawRows.slice(1).map((r) => {
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

  // Global facility count (case-insensitive dedup)
  const globalFacilitySet = new Map<string, { ownership: string; ru: string }>();
  const globalBlockSet = new Set<string>();

  for (const fd of Object.values(facilityData)) {
    const fk = normalizeFacilityKey(fd.facility);
    if (fk) {
      if (!globalFacilitySet.has(fk)) {
        globalFacilitySet.set(fk, { ownership: fd.ownership, ru: fd.ru });
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

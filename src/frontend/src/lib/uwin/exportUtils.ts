// ============================================================
// UWIN Export Utilities
// Extends HMIS exportUtils with t8/t9 highlighting and a corrected
// co-admin highlight rule; rowKey granularity follows kpis.analysisMode.
// ============================================================

import type { UwinParsedCSV, UwinComputedKpis } from './types';
import { monthKey as monthKeyFn, asNumOrNull } from '../dqa/parseUtils';
import { CO_SPECS } from '../dqa/constants';
import { downloadXLS, downloadChartPNG } from '../dqa/exportUtils';

export { downloadXLS, downloadChartPNG };

const TABLE_STYLE = `
<style>
table{border-collapse:collapse;width:100%;background:#fff;font-family:Arial,sans-serif;font-size:11pt;}
th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top;}
th{background:#f9fafb;font-weight:bold;}
.nCell{background:#dcfce7 !important;color:#14532d;font-weight:bold;}
.pinkCell{background:#ffc0cb !important;font-weight:bold;}
.darkPink{background:#ff8fb1 !important;font-weight:bold;}
</style>
`;

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9 _\-]+/g, '').replace(/\s+/g, '_').trim() || 'export';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadHighlightedXLS(
  csv: UwinParsedCSV,
  kpiKey: string,
  kpiLabel: string,
  kpis: UwinComputedKpis
): void {
  const {
    header, rows,
    idxBlock, idxFac, idxMonth, idxSessionSite, idxDist,
    idxSessPlanned, idxSessHeld,
    idxBenPW, idxBenInf, idxBenChild, idxBenAdol,
    idxBenTd1, idxBenTd2, idxBenTdB, idxBenTd10, idxBenTd16,
    targetIndicatorIndices,
    indicatorMap,
  } = csv;

  const pinkFacKeys = new Set(kpis.pinkFacSets[kpiKey] ?? []);
  const selMonthsSet = new Set(kpis.selMonths);
  const sessionSiteWise = kpis.analysisMode === 'sessionsite';

  const fullRows: string[][] = [header, ...rows];
  const styleMap: Record<number, Record<number, string>> = {};
  const PINK = '#ffc0cb';
  const DARK_PINK = '#ff8fb1';

  const idxByShort: Record<string, number> = { ...indicatorMap };
  const inconsPairMap = kpis.inconsPairMap;

  for (let ri = 1; ri < fullRows.length; ri++) {
    const r = fullRows[ri];
    const block = r[idxBlock]?.trim() ?? '';
    const fac = r[idxFac]?.trim() ?? '';
    const district = idxDist !== null ? (r[idxDist]?.trim() ?? '') : '';
    const monRaw = r[idxMonth] ?? '';
    const mKey = monthKeyFn(monRaw);
    // Must match the granularity kpis.pinkFacSets was built at: session-site-wise
    // keys include the raw row's Session Site Name, facility-wise keys don't (so
    // every raw row for that facility is highlighted together).
    const rowKey = sessionSiteWise
      ? `${district}||${block}||${fac}||${idxSessionSite !== null ? (r[idxSessionSite]?.trim() ?? '') : ''}`
      : `${district}||${block}||${fac}`;
    const inSet = pinkFacKeys.has(rowKey);

    let monthOk = true;
    if (selMonthsSet.size > 0 && mKey) monthOk = selMonthsSet.has(mKey);
    if (!inSet || !monthOk) continue;

    const highlightRow = (color: string) => {
      styleMap[ri] = {};
      for (let ci = 0; ci < header.length; ci++) styleMap[ri][ci] = color;
    };

    if (kpiKey === 't0') {
      // Scoped to vaccine-dose "target" columns only — matches the computeKpis
      // scope so a row that's in pinkFacKeys always actually gets highlighted.
      let allZero = true; let hasAny = false;
      for (const ci of targetIndicatorIndices) {
        const v = asNumOrNull(r[ci] ?? '');
        if (v === null) { allZero = false; break; }
        hasAny = true;
        if (v !== 0) { allZero = false; break; }
      }
      if (hasAny && allZero) highlightRow(PINK);
    } else if (kpiKey === 't7') {
      let firstVal: string | null = null; let ok = true; let hasAny = false;
      for (let ci = idxMonth + 1; ci < header.length; ci++) {
        const v = asNumOrNull(r[ci] ?? '');
        if (v === null || v === 0) { ok = false; break; }
        const normalized = v.toFixed(10);
        if (firstVal === null) { firstVal = normalized; hasAny = true; }
        else if (normalized !== firstVal) { ok = false; break; }
      }
      if (hasAny && ok) highlightRow(PINK);
    } else if (kpiKey === 't2') {
      for (const [vx, ci] of Object.entries(idxByShort)) {
        if (kpis.selVaxList.includes(vx)) {
          const v = (r[ci] ?? '').trim();
          if (v === '') {
            if (!styleMap[ri]) styleMap[ri] = {};
            styleMap[ri][ci] = PINK;
          }
        }
      }
    } else if (kpiKey === 't6') {
      if (idxSessPlanned !== null && idxSessHeld !== null) {
        const P = asNumOrNull(r[idxSessPlanned] ?? '');
        const H = asNumOrNull(r[idxSessHeld] ?? '');
        if (P !== null && H !== null && P > 0 && H < P) {
          if (!styleMap[ri]) styleMap[ri] = {};
          styleMap[ri][idxSessPlanned] = PINK;
          styleMap[ri][idxSessHeld] = PINK;
        }
      }
    } else if (kpiKey === 't8') {
      // Highlight sessions held + all beneficiary columns when avg < 5
      if (mKey && kpis.t8HitMap[rowKey]?.[mKey]) {
        if (!styleMap[ri]) styleMap[ri] = {};
        if (idxSessHeld !== null) styleMap[ri][idxSessHeld] = PINK;
        for (const idx of [idxBenPW, idxBenInf, idxBenChild, idxBenAdol]) {
          if (idx !== null) styleMap[ri][idx] = PINK;
        }
      }
    } else if (kpiKey === 't9') {
      // Highlight beneficiary + Td columns when their total is 0 for this month
      if (mKey && kpis.t9HitMap[rowKey]?.[mKey]) {
        if (!styleMap[ri]) styleMap[ri] = {};
        for (const idx of [idxBenPW, idxBenInf, idxBenChild, idxBenAdol, idxBenTd1, idxBenTd2, idxBenTdB, idxBenTd10, idxBenTd16]) {
          if (idx !== null) styleMap[ri][idx] = PINK;
        }
      }
    } else if (kpiKey === 't3') {
      if (mKey && kpis.t3HitMap[rowKey]?.[mKey]) {
        const hitVax = kpis.t3HitMap[rowKey][mKey];
        for (const [vx, hit] of Object.entries(hitVax)) {
          if (hit && idxByShort[vx] !== undefined) {
            if (!styleMap[ri]) styleMap[ri] = {};
            styleMap[ri][idxByShort[vx]] = PINK;
          }
        }
      }
    } else if (kpiKey.startsWith('drop_')) {
      const pm = kpis.dropPairMap[kpiKey];
      if (pm && mKey && kpis.dropHitMap[kpiKey]?.[rowKey]?.[mKey]) {
        const fromCi = idxByShort[pm.from];
        const toCi = idxByShort[pm.to];
        if (!styleMap[ri]) styleMap[ri] = {};
        if (fromCi !== undefined) styleMap[ri][fromCi] = PINK;
        if (toCi !== undefined) styleMap[ri][toCi] = PINK;
      }
    } else if (kpiKey.startsWith('co')) {
      // Highlight rule mirrors UwinDataTables' coadminRedCells(): Penta's value (if
      // present) is the reference — every other cell differing from it is colored,
      // Penta itself never colored; otherwise cells differing from the majority
      // value are colored (or all cells on a tie / no majority). Fixes the "3-2
      // split" case where the old unique-value rule highlighted nothing at all.
      const vaxList = CO_SPECS[kpiKey] ?? [];
      const present: { vx: string; ci: number; v: number }[] = [];
      for (const vx of vaxList) {
        const ci = idxByShort[vx];
        if (ci !== undefined) {
          const v = asNumOrNull(r[ci] ?? '');
          if (v !== null) present.push({ vx, ci, v });
        }
      }
      const counts = new Map<number, number>();
      for (const { v } of present) counts.set(v, (counts.get(v) ?? 0) + 1);
      if (present.length >= 2 && counts.size > 1) {
        const pentaEntry = present.find((p) => p.vx.toLowerCase().startsWith('penta'));
        let redCis: number[];
        if (pentaEntry) {
          redCis = present
            .filter((p) => !p.vx.toLowerCase().startsWith('penta') && p.v !== pentaEntry.v)
            .map((p) => p.ci);
        } else {
          let modeVal: number | null = null; let modeCount = -1; let tie = false;
          for (const [val, c] of counts) {
            if (c > modeCount) { modeCount = c; modeVal = val; tie = false; }
            else if (c === modeCount) { tie = true; }
          }
          redCis = (tie || modeCount <= 1)
            ? present.map((p) => p.ci)
            : present.filter((p) => p.v !== modeVal).map((p) => p.ci);
        }
        if (redCis.length > 0) {
          if (!styleMap[ri]) styleMap[ri] = {};
          for (const ci of redCis) styleMap[ri][ci] = DARK_PINK;
        }
      }
    } else if (kpiKey === 't5_p3gtp1' || kpiKey === 't5_opv3gtopv1') {
      const shortA = kpiKey === 't5_p3gtp1' ? 'Penta3' : 'OPV3';
      const shortB = kpiKey === 't5_p3gtp1' ? 'Penta1' : 'OPV1';
      if (!styleMap[ri]) styleMap[ri] = {};
      if (idxByShort[shortA] !== undefined) styleMap[ri][idxByShort[shortA]] = PINK;
      if (idxByShort[shortB] !== undefined) styleMap[ri][idxByShort[shortB]] = PINK;
    } else if (kpiKey.startsWith('t5_') && inconsPairMap[kpiKey]) {
      const pm = inconsPairMap[kpiKey];
      if (!styleMap[ri]) styleMap[ri] = {};
      if (idxByShort[pm.from] !== undefined) styleMap[ri][idxByShort[pm.from]] = PINK;
      if (idxByShort[pm.to] !== undefined) styleMap[ri][idxByShort[pm.to]] = PINK;
    }
  }

  let html = `<html><head><meta charset="utf-8">${TABLE_STYLE}</head><body>`;
  html += '<table><tr>';
  for (const h of header) html += `<th>${escHtml(h)}</th>`;
  html += '</tr>';

  for (let i = 1; i < fullRows.length; i++) {
    html += '<tr>';
    for (let c = 0; c < header.length; c++) {
      const val = fullRows[i][c] ?? '';
      const color = styleMap[i]?.[c];
      const styleAttr = color ? ` style="background:${color};"` : '';
      html += `<td${styleAttr}>${escHtml(val)}</td>`;
    }
    html += '</tr>';
  }
  html += '</table></body></html>';

  const fname = `${sanitizeFilename(kpiLabel)}_highlighted_fullfile`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  triggerDownload(blob, `${fname}.xls`);
}

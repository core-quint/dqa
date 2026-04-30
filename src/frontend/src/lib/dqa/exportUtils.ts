// ============================================================
// Export Utilities (client-side XLS and highlighted file)
// ============================================================

import type { ParsedCSV, ComputedKpis, FacilityRecord } from './types';
import { monthKey as monthKeyFn } from './parseUtils';
import { CO_SPECS } from './constants';

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

type CellValue = string | number | null;
type TableData = CellValue[][];

export function downloadXLS(rows: TableData, filename: string): void {
  if (!rows.length) return;
  const html = buildTableHTML(rows, filename);
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  triggerDownload(blob, `${sanitizeFilename(filename)}.xls`);
}

export function downloadChartPNG(canvasId: string, filename: string): void {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) return;
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(filename)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9 _\-]+/g, '').replace(/\s+/g, '_').trim() || 'export';
}

function buildTableHTML(rows: TableData, title: string): string {
  let html = `<html><head><meta charset="utf-8">${TABLE_STYLE}</head><body>`;
  html += `<div style="font-weight:bold;font-size:14px;margin-bottom:8px;">${escHtml(title)}</div>`;
  html += '<table><tr>';
  const head = rows[0];
  for (const h of head) {
    html += `<th>${escHtml(String(h ?? ''))}</th>`;
  }
  html += '</tr>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>';
    const row = rows[i];
    for (let c = 0; c < head.length; c++) {
      const val = row[c] ?? '';
      html += `<td>${escHtml(String(val))}</td>`;
    }
    html += '</tr>';
  }
  html += '</table></body></html>';
  return html;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// ============================================================
// Highlighted full-file export
// ============================================================

export function downloadHighlightedXLS(
  csv: ParsedCSV,
  kpiKey: string,
  kpiLabel: string,
  kpis: ComputedKpis
): void {
  const { header, rows, idxBlock, idxFac, idxMonth, idxSessPlanned, idxSessHeld, indicatorMap } = csv;
  const pinkFacKeys = new Set(kpis.pinkFacSets[kpiKey] ?? []);
  const selMonthsSet = new Set(kpis.selMonths);

  // Build full rows array (header + data)
  const fullRows: string[][] = [header, ...rows];

  // style_map[rowIdx][colIdx] = color
  const styleMap: Record<number, Record<number, string>> = {};
  const PINK = '#ffc0cb';
  const DARK_PINK = '#ff8fb1';

  // Build index lookup by short name
  const idxByShort: Record<string, number> = { ...indicatorMap };

  // Incons pair map for t5_ keys
  const inconsPairMap = kpis.inconsPairMap;

  for (let ri = 1; ri < fullRows.length; ri++) {
    const r = fullRows[ri];
    const block = r[idxBlock]?.trim() ?? '';
    const fac = r[idxFac]?.trim() ?? '';
    const monRaw = r[idxMonth] ?? '';

    const mKey = monthKeyFn(monRaw);

    const rowKey = `${block}||${fac}`;
    const inSet = pinkFacKeys.has(rowKey);

    let monthOk = true;
    if (selMonthsSet.size > 0 && mKey) {
      monthOk = selMonthsSet.has(mKey);
    }

    if (!inSet || !monthOk) continue;

    const highlightRow = (color: string) => {
      styleMap[ri] = {};
      for (let ci = 0; ci < header.length; ci++) {
        styleMap[ri][ci] = color;
      }
    };

    if (kpiKey === 't1') {
      // Check all blank
      let allBlank = true;
      for (let ci = idxMonth + 1; ci < header.length; ci++) {
        if ((r[ci] ?? '').trim() !== '') { allBlank = false; break; }
      }
      if (allBlank) highlightRow(PINK);
    } else if (kpiKey === 't0') {
      let allZero = true; let hasAny = false;
      for (let ci = idxMonth + 1; ci < header.length; ci++) {
        const v = (r[ci] ?? '').trim();
        if (v === '') { allZero = false; break; }
        hasAny = true;
        if (isNaN(Number(v)) || Number(v) !== 0) { allZero = false; break; }
      }
      if (hasAny && allZero) highlightRow(PINK);
    } else if (kpiKey === 't7') {
      let firstVal: string | null = null; let ok = true; let hasAny = false;
      for (let ci = idxMonth + 1; ci < header.length; ci++) {
        const v = (r[ci] ?? '').trim();
        if (v === '' || isNaN(Number(v)) || Number(v) === 0) { ok = false; break; }
        if (firstVal === null) { firstVal = v; hasAny = true; }
        else if (v !== firstVal) { ok = false; break; }
      }
      if (hasAny && ok) highlightRow(PINK);
    } else if (kpiKey === 't2') {
      // Highlight blank vaccine columns
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
        const P = Number(r[idxSessPlanned] ?? '');
        const H = Number(r[idxSessHeld] ?? '');
        if (!isNaN(P) && !isNaN(H) && P > 0 && H > P) {
          if (!styleMap[ri]) styleMap[ri] = {};
          styleMap[ri][idxSessPlanned] = PINK;
          styleMap[ri][idxSessHeld] = PINK;
        }
      }
    } else if (kpiKey === 't3') {
      // Outlier hits
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
      // Co-admin: dark pink on unique values
      const vaxList = CO_SPECS[kpiKey] ?? [];
      const vals: number[] = [];
      const ciList: number[] = [];
      for (const vx of vaxList) {
        const ci = idxByShort[vx];
        if (ci !== undefined) {
          const v = Number((r[ci] ?? '').trim());
          if (!isNaN(v)) { vals.push(v); ciList.push(ci); }
        }
      }
      if (vals.length >= 2) {
        const counts: Record<string, number> = {};
        for (const v of vals) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
        for (let idx = 0; idx < vals.length; idx++) {
          if (counts[String(vals[idx])] === 1) {
            if (!styleMap[ri]) styleMap[ri] = {};
            styleMap[ri][ciList[idx]] = DARK_PINK;
          }
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

  // Build output
  let html = `<html><head><meta charset="utf-8">${TABLE_STYLE}</head><body>`;
  html += '<table><tr>';
  for (const h of header) {
    html += `<th>${escHtml(h)}</th>`;
  }
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


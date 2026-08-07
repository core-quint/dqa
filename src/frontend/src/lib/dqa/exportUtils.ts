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
.nCell,.n-cell{background:#dcfce7 !important;color:#14532d;font-weight:bold;}
.pinkCell,.pink-cell{background:#ffc0cb !important;font-weight:bold;}
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

/**
 * Highlight classes used by the on-screen drill-down tables, mapped to the fill
 * Excel should show. Excel's HTML importer ignores class selectors from a <style>
 * block, so every fill has to be written onto the cell itself (inline style +
 * legacy bgcolor attribute) for the export to keep the on-screen highlighting.
 */
const CELL_HIGHLIGHTS: { cls: string; bg: string; color?: string }[] = [
  { cls: 'n-cell', bg: '#dcfce7', color: '#14532d' },
  { cls: 'nCell', bg: '#dcfce7', color: '#14532d' },
  { cls: 'dark-pink', bg: '#ff8fb1' },
  { cls: 'darkPink', bg: '#ff8fb1' },
  { cls: 'pink-cell', bg: '#ffc0cb' },
  { cls: 'pinkCell', bg: '#ffc0cb' },
];

const HEADER_BG = '#f1f5f9';

export function downloadRenderedTableXLS(source: HTMLElement | null, filename: string): boolean {
  if (!source) return false;

  const table = source.tagName === 'TABLE'
    ? source
    : source.querySelector<HTMLTableElement>('table');
  if (!table) return false;

  const clone = table.cloneNode(true) as HTMLTableElement;
  const usedHighlights = new Set<string>();

  clone.querySelectorAll<HTMLTableCellElement>('th, td').forEach((cell) => {
    const highlight = CELL_HIGHLIGHTS.find((entry) => cell.classList.contains(entry.cls));
    const isHeader = cell.tagName === 'TH';
    cell.removeAttribute('class');

    const declarations = [
      'border:1px solid #cbd5e1',
      'padding:4px 6px',
      'font-family:Arial,sans-serif',
      'font-size:10pt',
      'vertical-align:top',
    ];

    if (highlight) {
      usedHighlights.add(highlight.bg);
      declarations.push(`background-color:${highlight.bg}`, 'font-weight:bold');
      if (highlight.color) declarations.push(`color:${highlight.color}`);
      cell.setAttribute('bgcolor', highlight.bg);
    } else if (isHeader) {
      declarations.push(`background-color:${HEADER_BG}`, 'font-weight:bold');
      cell.setAttribute('bgcolor', HEADER_BG);
    }

    cell.setAttribute('style', declarations.join(';'));
  });

  clone.removeAttribute('class');
  clone.setAttribute('border', '1');
  clone.setAttribute('cellspacing', '0');
  clone.setAttribute('cellpadding', '4');
  clone.setAttribute('style', 'border-collapse:collapse;');

  let html = `<html><head><meta charset="utf-8">${TABLE_STYLE}</head><body>`;
  html += `<div style="font-weight:bold;font-size:14px;margin-bottom:8px;">${escHtml(filename)}</div>`;
  const legend = buildHighlightLegend(usedHighlights);
  if (legend) html += legend;
  html += `${clone.outerHTML}</body></html>`;

  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  triggerDownload(blob, `${sanitizeFilename(filename)}.xls`);
  return true;
}

const HIGHLIGHT_LEGEND: Record<string, string> = {
  '#dcfce7': 'Missing / not reported (N)',
  '#ffc0cb': 'Flagged value',
  '#ff8fb1': 'Value differing from co-administered vaccines',
};

/** Small colour key placed above the exported table so fills stay self-explanatory. */
function buildHighlightLegend(colors: Set<string>): string {
  const entries = Object.keys(HIGHLIGHT_LEGEND).filter((bg) => colors.has(bg));
  if (!entries.length) return '';
  const rows = entries
    .map(
      (bg) =>
        `<tr><td bgcolor="${bg}" style="background-color:${bg};border:1px solid #cbd5e1;width:24px;">&nbsp;</td>` +
        `<td style="border:1px solid #cbd5e1;font-family:Arial,sans-serif;font-size:9pt;">${escHtml(HIGHLIGHT_LEGEND[bg])}</td></tr>`
    )
    .join('');
  return `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;margin-bottom:8px;">${rows}</table>`;
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

/** Capture an SVG or HTML/CSS chart region exactly as rendered. */
export async function downloadElementPNG(
  source: HTMLElement | null,
  filename: string,
  backgroundColor = '#ffffff'
): Promise<boolean> {
  if (!source) return false;

  const rect = source.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, source.scrollWidth));
  const height = Math.ceil(Math.max(rect.height, source.scrollHeight));
  if (width <= 0 || height <= 0) return false;

  await document.fonts?.ready;
  const { default: html2canvas } = await import('html2canvas');
  const scale = Math.min(2, 8192 / width, 8192 / height);
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const canvas = await html2canvas(source, {
    backgroundColor,
    width,
    height,
    scale,
    useCORS: true,
    logging: false,
    removeContainer: true,
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;

  triggerDownload(blob, `${sanitizeFilename(filename)}.png`);
  return true;
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

  // Mapping/identifier columns: everything up to and including Month (all
  // indicator columns sit after it). These get the same fill as the flagged
  // cells so the export can be filtered by colour on State/District/Block/etc.
  const mappingCols: number[] = [];
  for (let ci = 0; ci <= idxMonth && ci < header.length; ci++) mappingCols.push(ci);

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

    // Carry the flag across the row's mapping columns (only when the row really
    // did get a data-cell highlight — some branches pre-create an empty entry).
    const rowStyles = styleMap[ri];
    if (rowStyles && Object.keys(rowStyles).length > 0) {
      for (const ci of mappingCols) {
        if (rowStyles[ci] === undefined) rowStyles[ci] = PINK;
      }
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

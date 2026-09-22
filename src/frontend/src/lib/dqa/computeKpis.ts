// ============================================================
// KPI Computation Engine (HMIS)
//
// Scoring method v2 (agreed 2026-09-22) — see lib/dqa/scoring.ts and
// lib/dqa/checkRules.ts for the shared rules. HMIS-specific points:
//   - The denominator is the facilities left after the scope filters.
//   - A facility in the upload with no row for a selected month is treated
//     as an all-blank (missing) report for that month.
//   - "All months" means every month the check could actually be run.
// ============================================================

import type {
  ParsedCSV,
  FilterState,
  ComputedKpis,
  KpiStat,
  TableRows,
  T2Web,
  T2MatrixRow,
  T3Web,
  T3MatrixRow,
  T3Cell,
  DropoutWeb,
  DropoutRow,
  CoAdminWeb,
  CoAdminRow,
  ChartPayload,
  KpiCard,
  SummaryRow,
  PairMeta,
} from './types';
import { FacilityRecord } from './types';
import {
  displayBlockLabel,
  safeKey,
  monthLongLabel,
  periodsAreConsecutive,
} from './parseUtils';
import { coadminHasDifference, coadminMatchedTotals } from './coadmin';
import {
  monthOnMonthChange,
  outlierBand,
  dropoutPct,
  dropoutRange,
  matchedTotals,
} from './checkRules';
import { standardMethodFilters, methodSignature } from './scoringProfile';
import {
  BASE_VAX,
  DEFAULT_FILTERS,
  GROUP_COLORS,
  DROPOUT_COLOR,
  OUTLIER_COLOR,
  INCONS_LIGHT,
  CO_SPECS,
  CO_LABELS,
} from './constants';

// ---- helpers ----

function emptyKpiStat(): KpiStat {
  return {
    total: 0,
    any: 0,
    all: 0,
    eligible: 0,
    eligibleKeys: new Set(),
    facilityKeys: new Set(),
    anyFacilityKeys: new Set(),
    allFacilityKeys: new Set(),
  };
}

function finalizeKpiStat(stat: KpiStat, eligible: Set<string>): void {
  stat.total = stat.facilityKeys.size;
  stat.any = stat.anyFacilityKeys.size;
  stat.all = stat.allFacilityKeys.size;
  stat.eligibleKeys = eligible;
  stat.eligible = eligible.size;
}

/** Record a flagged facility as "all months" when every checkable month was flagged. */
function flag(stat: KpiStat, key: string, hitMonths: number, evaluableMonths: number): void {
  stat.facilityKeys.add(key);
  if (evaluableMonths > 0 && hitMonths === evaluableMonths) stat.allFacilityKeys.add(key);
  else stat.anyFacilityKeys.add(key);
}

function chartCountsByBlock(
  facSet: Set<string>,
  filteredFacilities: Record<string, FacilityRecord>
): ChartPayload {
  const counts: Record<string, number> = {};
  for (const key of facSet) {
    const block = displayBlockLabel(filteredFacilities[key]?.block ?? '');
    counts[block] = (counts[block] ?? 0) + 1;
  }
  const sorted = Object.keys(counts).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  return {
    labels: sorted,
    values: sorted.map((k) => counts[k]),
    color: '#2a78d6',
  };
}

function pctLabel(from: number, to: number): string {
  return from > 0 ? `+${(((to - from) / from) * 100).toFixed(1)}%` : '';
}

// ---- main export ----

/**
 * KPIs for the reviewer's settings, plus the cards the SCORE is computed from.
 * When the reviewer has changed any method setting (outlier bands, dropout pairs,
 * custom pairs...), the score cards are recomputed with the standard settings on
 * the same scope, so the score never depends on exploratory choices.
 */
export function computeKpis(csv: ParsedCSV, filters: FilterState): ComputedKpis {
  const view = computeKpisForSettings(csv, filters);
  const standard = standardMethodFilters(filters, DEFAULT_FILTERS);
  if (methodSignature(filters) === methodSignature(standard)) {
    return { ...view, scoreCards: view.cards, customMethod: false };
  }
  const scored = computeKpisForSettings(csv, standard);
  return { ...view, scoreCards: scored.cards, customMethod: true };
}

function computeKpisForSettings(
  csv: ParsedCSV,
  filters: FilterState,
): Omit<ComputedKpis, 'scoreCards' | 'customMethod'> {
  const { facilityData, allMonths, indicatorMap, idxMonth, header } = csv;

  // ---- resolve selected months ----
  let selMonths = filters.months.length > 0 ? filters.months : Object.keys(allMonths);
  selMonths = selMonths.slice().sort();
  const selMonthLabels: Record<string, string> = {};
  // Labels shown in every drill-down table/chart header — always month + year
  // ("January 2026"), never a bare month name, so multi-year datasets stay unambiguous.
  for (const mk of selMonths) selMonthLabels[mk] = monthLongLabel(mk);

  // ---- resolve selected vaccines (outliers only) ----
  const selVaxBase = filters.outliersVax.length > 0 ? filters.outliersVax : BASE_VAX;
  const selVaxAdd = filters.addVax ?? [];
  const allSelVax = [...new Set([...selVaxBase, ...selVaxAdd])];
  const selVaxList = allSelVax.filter((v) => indicatorMap[v] !== undefined);
  const effectiveVaxList = selVaxList.length > 0 ? selVaxList : BASE_VAX.filter((v) => indicatorMap[v] !== undefined);
  // Completeness always checks the fixed key-indicator list — it must not move
  // when the reviewer changes which vaccines the outlier check looks at.
  const completenessVaxList = BASE_VAX.filter((v) => indicatorMap[v] !== undefined);

  // ---- apply scope filters ----
  const selBlocksSet = new Set(filters.blocks.length > 0 ? filters.blocks : Object.keys(
    Object.values(facilityData).reduce<Record<string, true>>((acc, fd) => {
      if (fd.block) acc[fd.block] = true;
      return acc;
    }, {})
  ));
  const selMonthsSet = new Set(selMonths);
  // No ownership / rural-urban filter means no exclusion at all: a facility whose
  // value is "Mixed", "Trust" or anything else must still be analysed.
  const selOwnerSet = filters.ownership.length > 0 ? new Set(filters.ownership) : null;
  const selRUSet = filters.ru.length > 0 ? new Set(filters.ru) : null;

  const filteredFacilities: Record<string, FacilityRecord> = {};
  for (const [key, fd] of Object.entries(facilityData)) {
    if (fd.block && !selBlocksSet.has(fd.block)) continue;
    if (selOwnerSet && fd.ownership && !selOwnerSet.has(fd.ownership)) continue;
    if (selRUSet && fd.ru && !selRUSet.has(fd.ru)) continue;
    const monthsKeep: FacilityRecord['months'] = {};
    for (const [mk, md] of Object.entries(fd.months)) {
      if (selMonthsSet.has(mk)) monthsKeep[mk] = md;
    }
    // Kept even with no row in the selected months: the facility is in the
    // uploaded roster, so those months are missing reports, not "no facility".
    filteredFacilities[key] = { ...fd, months: monthsKeep };
  }

  const facilityCount = Object.keys(filteredFacilities).length;
  const globalDen = selMonths.length > 0 ? facilityCount : 0;
  const globalBlockCount = new Set(
    Object.values(filteredFacilities).map((fd) => fd.block.trim()).filter(Boolean),
  ).size;

  const totalMonthsSel = selMonths.length;

  // ============================================================
  // AVAILABILITY
  // ============================================================

  // t1: All indicators blank. A month with no row at all counts as blank.
  const t1Stat = emptyKpiStat();
  const t1Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let hitCount = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isBlank = true;
      if (md) {
        for (let ci = idxMonth + 1; ci < header.length; ci++) {
          if (md.vals[ci] !== null) { isBlank = false; break; }
        }
      }
      row.push(isBlank ? 'Y' : 'N');
      if (isBlank) hitCount++;
    }
    if (hitCount > 0) {
      flag(t1Stat, key, hitCount, totalMonthsSel);
      t1Rows.push(row);
    }
  }
  finalizeKpiStat(t1Stat, new Set(totalMonthsSel > 0 ? Object.keys(filteredFacilities) : []));

  // t0: All zero but not blank (only months with a row can be checked)
  const t0Stat = emptyKpiStat();
  const t0Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];
  const t0Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let hitCount = 0;
    let evaluable = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isZero = false;
      if (md) {
        evaluable++;
        let allZero = true; let hasAny = false;
        for (let ci = idxMonth + 1; ci < header.length; ci++) {
          const v = md.vals[ci];
          if (v === null) { allZero = false; break; }
          hasAny = true;
          if (v !== 0) { allZero = false; break; }
        }
        isZero = hasAny && allZero;
      }
      row.push(isZero ? 'Y' : 'N');
      if (isZero) hitCount++;
    }
    if (evaluable > 0) t0Eligible.add(key);
    if (hitCount > 0) {
      flag(t0Stat, key, hitCount, evaluable);
      t0Rows.push(row);
    }
  }
  finalizeKpiStat(t0Stat, t0Eligible);

  // t7: Same repeating values
  const t7Stat = emptyKpiStat();
  const t7Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];
  const t7Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let hitCount = 0;
    let evaluable = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isRepeat = false;
      if (md) {
        evaluable++;
        let firstVal: number | null = null; let ok = true; let hasAny = false;
        for (let ci = idxMonth + 1; ci < header.length; ci++) {
          const v = md.vals[ci];
          if (v === null) { ok = false; break; }
          if (v === 0) { ok = false; break; }
          if (firstVal === null) { firstVal = v; hasAny = true; }
          else if (v !== firstVal) { ok = false; break; }
        }
        isRepeat = hasAny && ok;
      }
      row.push(isRepeat ? 'Y' : 'N');
      if (isRepeat) hitCount++;
    }
    if (evaluable > 0) t7Eligible.add(key);
    if (hitCount > 0) {
      flag(t7Stat, key, hitCount, evaluable);
      t7Rows.push(row);
    }
  }
  finalizeKpiStat(t7Stat, t7Eligible);

  // ============================================================
  // COMPLETENESS
  // ============================================================

  const t2Stat = emptyKpiStat();
  const t2MatrixRows: Record<string, T2MatrixRow> = {};
  const blankCountsByVax: Record<string, number> = {};
  const blankAllCountsByVax: Record<string, number> = {};
  for (const vx of completenessVaxList) { blankCountsByVax[vx] = 0; blankAllCountsByVax[vx] = 0; }

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    let anyBlank = false;
    const cellMap: Record<string, Record<string, string>> = {};

    for (const vx of completenessVaxList) {
      const ci = indicatorMap[vx];
      let hasBlankForVx = false;
      let vxAllBlank = true;
      cellMap[vx] = {};
      for (const mk of selMonths) {
        const md = fd.months[mk];
        // No row for the month = the whole report is missing.
        const isBlank = !md || md.vals[ci] === null;
        cellMap[vx][mk] = isBlank ? 'Y' : 'N';
        if (isBlank) { anyBlank = true; hasBlankForVx = true; } else { vxAllBlank = false; }
      }
      if (hasBlankForVx) blankCountsByVax[vx]++;
      if (vxAllBlank && selMonths.length > 0) blankAllCountsByVax[vx]++;
    }

    if (anyBlank) {
      const blankMonths = selMonths.filter((mk) =>
        completenessVaxList.some((vx) => cellMap[vx]?.[mk] === 'Y'),
      ).length;
      flag(t2Stat, key, blankMonths, totalMonthsSel);
      t2MatrixRows[key] = {
        block: displayBlockLabel(fd.block),
        facility: fd.facility,
        cells: cellMap,
      };
    }
  }
  finalizeKpiStat(t2Stat, new Set(completenessVaxList.length > 0 && totalMonthsSel > 0 ? Object.keys(filteredFacilities) : []));

  const t2Web: T2Web = {
    vaccines: completenessVaxList,
    months: selMonths,
    monthLabels: selMonthLabels,
    rows: t2MatrixRows,
  };

  // ============================================================
  // ACCURACY
  // ============================================================

  // t6: Sessions Held > Planned — including planned 0 with sessions held.
  const t6Stat = emptyKpiStat();
  const t6Rows: TableRows = [['Block Name', 'Facility Name', 'Details (months with Held>Planned)', 'Totals (months with both reported)']];
  const t6Eligible = new Set<string>();

  if (csv.idxSessPlanned !== null && csv.idxSessHeld !== null) {
    const iSP = csv.idxSessPlanned;
    const iSH = csv.idxSessHeld;

    for (const [key, fd] of Object.entries(filteredFacilities)) {
      const parts: string[] = [];
      const pairs: Array<[number | null, number | null]> = [];
      let hitCount = 0;
      let evaluable = 0;
      for (const mk of selMonths) {
        const md = fd.months[mk];
        const P = md?.vals[iSP] ?? null;
        const H = md?.vals[iSH] ?? null;
        pairs.push([P, H]);
        if (P === null || H === null) continue;
        evaluable++;
        if (H > P) {
          hitCount++;
          const detail = P > 0 ? `+${(((H - P) / P) * 100).toFixed(1)}%` : `planned 0, held ${H}`;
          parts.push(`${selMonthLabels[mk] ?? mk} ${detail}`);
        }
      }
      if (evaluable > 0) t6Eligible.add(key);
      if (hitCount > 0) {
        const totals = matchedTotals(pairs);
        const tot = totals.b > totals.a
          ? (totals.a > 0
            ? `All months +${(((totals.b - totals.a) / totals.a) * 100).toFixed(1)}%`
            : `All months: planned 0, held ${totals.b}`)
          : `All months: planned ${totals.a}, held ${totals.b}`;
        flag(t6Stat, key, hitCount, evaluable);
        t6Rows.push([displayBlockLabel(fd.block), fd.facility, parts.join('; '), tot]);
      }
    }
  }
  finalizeKpiStat(t6Stat, t6Eligible);

  // t3: Outliers — calendar-adjacent months only, volume floor, rises from 0.
  const incBucketsSel = new Set(filters.outliersInc);
  const dropBucketsSel = new Set(filters.outliersDrop);

  const pairList: PairMeta[] = [];
  for (let i = 0; i < selMonths.length - 1; i++) {
    const m1 = selMonths[i]; const m2 = selMonths[i + 1];
    if (!periodsAreConsecutive(m1, m2)) continue;
    pairList.push({
      k: `${m1}|${m2}`, m1, m2,
      m1lbl: selMonthLabels[m1] ?? m1,
      m2lbl: selMonthLabels[m2] ?? m2,
    });
  }

  const t3Stat = emptyKpiStat();
  const t3HitMap: Record<string, Record<string, Record<string, boolean>>> = {};
  const t3MatrixRows: Record<string, T3MatrixRow> = {};
  const outAnyCounts: Record<string, number> = {};
  const outAllCounts: Record<string, number> = {};
  for (const vx of effectiveVaxList) { outAnyCounts[vx] = 0; outAllCounts[vx] = 0; }
  const t3Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const cells: Record<string, Record<string, T3Cell>> = {};
    const evaluablePairs = new Set<string>();
    const hitPairs = new Set<string>();

    for (const vx of effectiveVaxList) {
      const ci = indicatorMap[vx];
      if (ci === undefined) continue;
      cells[vx] = {};
      let vxEvaluable = 0;
      let vxHits = 0;
      for (const p of pairList) {
        const v1 = fd.months[p.m1]?.vals[ci] ?? null;
        const v2 = fd.months[p.m2]?.vals[ci] ?? null;
        const change = monthOnMonthChange(v1, v2);
        let hit = false;
        if (change) {
          evaluablePairs.add(p.k);
          vxEvaluable++;
          const band = outlierBand(change);
          if (band && (incBucketsSel.has(band) || dropBucketsSel.has(band))) {
            hit = true;
            vxHits++;
            hitPairs.add(p.k);
            if (!t3HitMap[key]) t3HitMap[key] = {};
            if (!t3HitMap[key][p.m1]) t3HitMap[key][p.m1] = {};
            if (!t3HitMap[key][p.m2]) t3HitMap[key][p.m2] = {};
            t3HitMap[key][p.m1][vx] = true;
            t3HitMap[key][p.m2][vx] = true;
          }
        }
        cells[vx][p.k] = { a: v1, b: v2, pct: change?.pct ?? null, hit, fromZero: change?.fromZero ?? false };
      }
      if (vxHits > 0) outAnyCounts[vx]++;
      if (vxEvaluable > 0 && vxHits === vxEvaluable) outAllCounts[vx]++;
    }

    if (evaluablePairs.size > 0) t3Eligible.add(key);
    if (hitPairs.size > 0) {
      flag(t3Stat, key, hitPairs.size, evaluablePairs.size);
      t3MatrixRows[key] = { block: displayBlockLabel(fd.block), facility: fd.facility, cells };
    }
  }
  finalizeKpiStat(t3Stat, t3Eligible);

  const t3Web: T3Web = { vaccines: effectiveVaxList, pairs: pairList, rows: t3MatrixRows };

  // Dropouts — judged on the cumulative dropout over the selected period
  // (months where both doses were reported). Children take the later dose weeks
  // after the earlier one, so a single month's pair is not the same cohort.
  const selDropRanges = new Set(filters.dropRanges);
  const inRange = (pct: number | null) => {
    const range = dropoutRange(pct);
    return range !== null && selDropRanges.has(range);
  };

  const selectedPairsSet = new Set<string>(filters.dropPairs);
  const fromList = filters.dropFrom ?? [];
  const toList = filters.dropTo ?? [];
  const maxN = Math.max(fromList.length, toList.length);
  for (let ii = 0; ii < maxN; ii++) {
    const f = (fromList[ii] ?? '').trim();
    const t = (toList[ii] ?? '').trim();
    if (f && t && f !== t) selectedPairsSet.add(`${f}→${t}`);
  }

  const dropTables: Record<string, DropoutWeb> = {};
  const dropStats: Record<string, KpiStat> = {};
  const dropPairMap: Record<string, { label: string; from: string; to: string }> = {};
  const dropHitMap: Record<string, Record<string, Record<string, boolean>>> = {};

  for (const pairLabel of selectedPairsSet) {
    const parts = pairLabel.split('→');
    if (parts.length !== 2) continue;
    const from = parts[0].trim(); const to = parts[1].trim();
    if (!from || !to) continue;
    const iFrom = indicatorMap[from]; const iTo = indicatorMap[to];
    if (iFrom === undefined || iTo === undefined) continue;

    const pairKey = `drop_${safeKey(`${from}_${to}`)}`;
    dropPairMap[pairKey] = { label: pairLabel, from, to };

    const dropStat = emptyKpiStat();
    const dropRows: Record<string, DropoutRow> = {};
    const hitSet: Record<string, Record<string, boolean>> = {};
    const eligible = new Set<string>();

    for (const [fkey, fd] of Object.entries(filteredFacilities)) {
      const cells: Record<string, { from: number | null; to: number | null; pct: number | null }> = {};
      const pairs: Array<[number | null, number | null]> = [];
      const matchedMonths: string[] = [];
      let evaluable = 0;
      let monthHits = 0;

      for (const mk of selMonths) {
        const A = fd.months[mk]?.vals[iFrom] ?? null;
        const B = fd.months[mk]?.vals[iTo] ?? null;
        pairs.push([A, B]);
        cells[mk] = { from: null, to: null, pct: null };
        if (A === null || B === null) continue;
        matchedMonths.push(mk);
        const monthPct = dropoutPct(A, B);
        cells[mk] = { from: A, to: B, pct: monthPct };
        if (monthPct !== null) {
          evaluable++;
          if (inRange(monthPct)) monthHits++;
        }
      }

      const totals = matchedTotals(pairs);
      const periodPct = dropoutPct(totals.a, totals.b);
      if (periodPct !== null) eligible.add(fkey);

      if (inRange(periodPct)) {
        dropStat.facilityKeys.add(fkey);
        if (evaluable > 0 && monthHits === evaluable) dropStat.allFacilityKeys.add(fkey);
        else dropStat.anyFacilityKeys.add(fkey);
        // Every matched month is evidence for the period dropout, so all of
        // them are marked in the export.
        hitSet[fkey] = Object.fromEntries(matchedMonths.map((mk) => [mk, true]));
        dropRows[fkey] = {
          block: displayBlockLabel(fd.block),
          facility: fd.facility,
          cells,
          all: { from: totals.a, to: totals.b, pct: periodPct },
        };
      }
    }

    finalizeKpiStat(dropStat, eligible);
    dropTables[pairKey] = {
      pairLabel, from, to,
      months: selMonths,
      monthLabels: selMonthLabels,
      rows: dropRows,
    };
    dropStats[pairKey] = dropStat;
    dropHitMap[pairKey] = hitSet;
  }

  // ============================================================
  // CONSISTENCY
  // ============================================================

  // Later dose > earlier dose (i1, i2, custom pairs) — judged on the period
  // totals over months where both doses were reported. A blank is missing data,
  // never a zero, and a single month is not the same cohort of children.
  function doseOrderCheck(
    iFrom: number,
    iTo: number,
    stat: KpiStat,
    rows: TableRows,
  ): void {
    const eligible = new Set<string>();
    for (const [key, fd] of Object.entries(filteredFacilities)) {
      const pairs: Array<[number | null, number | null]> = [];
      let monthHits = 0;
      for (const mk of selMonths) {
        const A = fd.months[mk]?.vals[iFrom] ?? null;
        const B = fd.months[mk]?.vals[iTo] ?? null;
        pairs.push([A, B]);
        if (A !== null && B !== null && B > A) monthHits++;
      }
      const totals = matchedTotals(pairs);
      if (totals.months === 0) continue;
      eligible.add(key);
      if (totals.b > totals.a) {
        flag(stat, key, monthHits, totals.months);
        rows.push([
          displayBlockLabel(fd.block), fd.facility,
          Math.round(totals.b), Math.round(totals.a),
          pctLabel(totals.a, totals.b),
        ]);
      }
    }
    finalizeKpiStat(stat, eligible);
  }

  const i1Stat = emptyKpiStat();
  const i1Rows: TableRows = [['Block Name', 'Facility Name', 'Penta3 (total)', 'Penta1 (total)', '% change']];
  const iP1 = indicatorMap['Penta1']; const iP3 = indicatorMap['Penta3'];
  if (iP1 !== undefined && iP3 !== undefined) doseOrderCheck(iP1, iP3, i1Stat, i1Rows);

  const i2Stat = emptyKpiStat();
  const i2Rows: TableRows = [['Block Name', 'Facility Name', 'OPV3 (total)', 'OPV1 (total)', '% change']];
  const iO1 = indicatorMap['OPV1']; const iO3 = indicatorMap['OPV3'];
  if (iO1 !== undefined && iO3 !== undefined) doseOrderCheck(iO1, iO3, i2Stat, i2Rows);

  // Dynamic inconsistency pairs
  const inconsTables: Record<string, TableRows> = {};
  const inconsStats: Record<string, KpiStat> = {};
  const inconsPairMap: Record<string, { from: string; to: string; label: string; pid: string }> = {};

  const existingPairSet = new Set(['Penta1→Penta3', 'OPV1→OPV3']);
  const inconsFromList = filters.inconsFrom ?? [];
  const inconsToList = filters.inconsTo ?? [];
  const maxI = Math.max(inconsFromList.length, inconsToList.length);

  for (let ii = 0; ii < maxI; ii++) {
    const f = (inconsFromList[ii] ?? '').trim();
    const t = (inconsToList[ii] ?? '').trim();
    if (!f || !t || f === t) continue;
    if (existingPairSet.has(`${f}→${t}`)) continue;
    const iFrom = indicatorMap[f]; const iTo = indicatorMap[t];
    if (iFrom === undefined || iTo === undefined) continue;

    const pid = `iadd_${safeKey(`${t}_gt_${f}`)}`;
    const downloadKey = `t5_${safeKey(`${t}_gt_${f}`)}`;
    const labelName = `Inconsistencies — ${t}>${f}`;

    const tbl: TableRows = [['Block Name', 'Facility Name', `${t} (total)`, `${f} (total)`, '% change']];
    const stat = emptyKpiStat();
    doseOrderCheck(iFrom, iTo, stat, tbl);

    inconsTables[pid] = tbl;
    inconsStats[pid] = stat;
    inconsPairMap[downloadKey] = { from: f, to: t, label: labelName, pid };
  }

  // Co-admin — monthly only: a facility is flagged when some month's reported
  // values disagree. Blanks are ignored (they are a completeness finding).
  const coTables: Record<string, CoAdminWeb> = {};
  const coStats: Record<string, KpiStat> = {};

  for (const [coKey, vaxList] of Object.entries(CO_SPECS)) {
    const coStat = emptyKpiStat();
    const coRows: Record<string, CoAdminRow> = {};
    const eligible = new Set<string>();

    for (const [fkey, fd] of Object.entries(filteredFacilities)) {
      const rowVals: Record<string, Record<string, number | null>> = {};
      let monthViolCount = 0;
      let evaluable = 0;

      for (const mk of selMonths) {
        rowVals[mk] = {};
        const valsMonth: (number | null)[] = [];
        for (const vx of vaxList) {
          const ci = indicatorMap[vx];
          const val = (ci !== undefined && fd.months[mk]) ? fd.months[mk].vals[ci] ?? null : null;
          rowVals[mk][vx] = val;
          valsMonth.push(val);
        }
        if (valsMonth.filter((v) => v !== null).length >= 2) evaluable++;
        if (coadminHasDifference(valsMonth)) monthViolCount++;
      }

      if (evaluable > 0) eligible.add(fkey);
      if (monthViolCount > 0) {
        flag(coStat, fkey, monthViolCount, evaluable);
        coRows[fkey] = {
          block: displayBlockLabel(fd.block),
          facility: fd.facility,
          vals: rowVals,
          totals: coadminMatchedTotals(rowVals, vaxList),
        };
      }
    }

    finalizeKpiStat(coStat, eligible);
    coTables[coKey] = {
      key: coKey,
      vaccines: vaxList,
      months: selMonths,
      monthLabels: selMonthLabels,
      rows: coRows,
    };
    coStats[coKey] = coStat;
  }

  // ============================================================
  // Charts
  // ============================================================
  function mkChart(facSet: Set<string>, color: string): ChartPayload {
    const c = chartCountsByBlock(facSet, filteredFacilities);
    c.color = color;
    return c;
  }

  const charts: Record<string, ChartPayload> = {
    t1: mkChart(t1Stat.facilityKeys, GROUP_COLORS.availability),
    t0: mkChart(t0Stat.facilityKeys, GROUP_COLORS.availability),
    t7: mkChart(t7Stat.facilityKeys, GROUP_COLORS.availability),
    t2: mkChart(t2Stat.facilityKeys, GROUP_COLORS.completeness),
    t6: mkChart(t6Stat.facilityKeys, GROUP_COLORS.accuracy),
    t3: mkChart(t3Stat.facilityKeys, OUTLIER_COLOR),
    i1: mkChart(i1Stat.facilityKeys, INCONS_LIGHT),
    i2: mkChart(i2Stat.facilityKeys, INCONS_LIGHT),
    co1: mkChart(coStats.co1.facilityKeys, GROUP_COLORS.consistency),
    co2: mkChart(coStats.co2.facilityKeys, GROUP_COLORS.consistency),
    co3: mkChart(coStats.co3.facilityKeys, GROUP_COLORS.consistency),
    co4: mkChart(coStats.co4.facilityKeys, GROUP_COLORS.consistency),
    co5: mkChart(coStats.co5.facilityKeys, GROUP_COLORS.consistency),
  };

  for (const [dk, ds] of Object.entries(dropStats)) {
    charts[dk] = mkChart(ds.facilityKeys, DROPOUT_COLOR);
  }
  for (const meta of Object.values(inconsPairMap)) {
    const stat = inconsStats[meta.pid];
    if (stat) charts[meta.pid] = mkChart(stat.facilityKeys, INCONS_LIGHT);
  }

  // ============================================================
  // KPI Cards
  // ============================================================
  const cards: KpiCard[] = [
    { id: 't1', name: 'All Indicators Blank', stat: t1Stat, group: 'availability', downloadKey: 't1' },
    { id: 't0', name: 'Indicators having 0 values but not blank', stat: t0Stat, group: 'availability', downloadKey: 't0' },
    { id: 't7', name: 'Indicators with same values', stat: t7Stat, group: 'availability', downloadKey: 't7' },
    { id: 't2', name: 'Key Missing Indicators', stat: t2Stat, group: 'completeness', downloadKey: 't2' },
    { id: 't6', name: 'Sessions Held > Sessions Planned', stat: t6Stat, group: 'accuracy', downloadKey: 't6' },
    { id: 't3', name: 'Outliers', stat: t3Stat, group: 'accuracy', downloadKey: 't3' },
  ];

  for (const [dk, pm] of Object.entries(dropPairMap)) {
    cards.push({
      id: dk,
      name: `Dropouts — ${pm.label}`,
      stat: dropStats[dk],
      group: 'accuracy',
      downloadKey: dk,
    });
  }

  cards.push(
    { id: 'i1', name: 'Inconsistencies — Penta3>Penta1', stat: i1Stat, group: 'consistency', downloadKey: 't5_p3gtp1' },
    { id: 'i2', name: 'Inconsistencies — OPV3>OPV1', stat: i2Stat, group: 'consistency', downloadKey: 't5_opv3gtopv1' },
  );

  for (const [dlKey, meta] of Object.entries(inconsPairMap)) {
    const stat = inconsStats[meta.pid];
    if (stat) cards.push({ id: meta.pid, name: meta.label, stat, group: 'consistency', downloadKey: dlKey });
  }

  for (const [coKey, coStat] of Object.entries(coStats)) {
    cards.push({
      id: coKey,
      name: CO_LABELS[coKey] ?? coKey,
      stat: coStat,
      group: 'consistency',
      downloadKey: coKey,
    });
  }

  // ============================================================
  // Pink facility sets (for highlighted export)
  // ============================================================
  const pinkFacSets: Record<string, string[]> = {
    t1: [...t1Stat.facilityKeys],
    t0: [...t0Stat.facilityKeys],
    t7: [...t7Stat.facilityKeys],
    t2: [...t2Stat.facilityKeys],
    t6: [...t6Stat.facilityKeys],
    t3: [...t3Stat.facilityKeys],
    t5_p3gtp1: [...i1Stat.facilityKeys],
    t5_opv3gtopv1: [...i2Stat.facilityKeys],
  };
  for (const [coKey, coStat] of Object.entries(coStats)) {
    pinkFacSets[coKey] = [...coStat.facilityKeys];
  }
  for (const [dk, ds] of Object.entries(dropStats)) {
    pinkFacSets[dk] = [...ds.facilityKeys];
  }
  for (const [dlKey, meta] of Object.entries(inconsPairMap)) {
    const stat = inconsStats[meta.pid];
    if (stat) pinkFacSets[dlKey] = [...stat.facilityKeys];
  }

  // ============================================================
  // Summary by pid (for completeness/accuracy summary view)
  // ============================================================
  const summaryByPid: Record<string, { any: SummaryRow[]; all: SummaryRow[]; overall?: SummaryRow[] }> = {};
  const den = Math.max(1, globalDen);

  function mkRow(name: string, count: number): SummaryRow {
    return { name, count, pct: Math.round((count / den) * 10000) / 100 };
  }

  summaryByPid.t1 = {
    any: [mkRow('All Indicators Blank', t1Stat.any)],
    all: [mkRow('All Indicators Blank', t1Stat.all)],
  };
  summaryByPid.t0 = {
    any: [mkRow('Indicators having 0 values', t0Stat.any)],
    all: [mkRow('Indicators having 0 values', t0Stat.all)],
  };
  summaryByPid.t7 = {
    any: [mkRow('Indicators with same values', t7Stat.any)],
    all: [mkRow('Indicators with same values', t7Stat.all)],
  };

  // t2 by indicator
  {
    const anyRows = completenessVaxList.map((vx) => {
      const allCnt = blankAllCountsByVax[vx] ?? 0;
      const tot = blankCountsByVax[vx] ?? 0;
      return mkRow(vx, Math.max(0, tot - allCnt));
    }).sort((a, b) => b.pct - a.pct);
    const allRows = completenessVaxList.map((vx) => mkRow(vx, blankAllCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    const overallRows = completenessVaxList.map((vx) => mkRow(vx, blankCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    summaryByPid.t2 = { any: anyRows, all: allRows, overall: overallRows };
  }

  // t3 by indicator
  {
    const overallRows = effectiveVaxList.map((vx) => mkRow(vx, outAnyCounts[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    summaryByPid.t3 = { any: [], all: [], overall: overallRows };
  }

  summaryByPid.t6 = {
    any: [mkRow('Sessions Held > Sessions Planned', t6Stat.any)],
    all: [mkRow('Sessions Held > Sessions Planned', t6Stat.all)],
    overall: [mkRow('Sessions Held > Sessions Planned', t6Stat.total)],
  };

  for (const [dk, ds] of Object.entries(dropStats)) {
    const pm = dropPairMap[dk];
    summaryByPid[dk] = {
      any: [mkRow(pm?.label ?? dk, ds.any)],
      all: [mkRow(pm?.label ?? dk, ds.all)],
      overall: [mkRow(pm?.label ?? dk, ds.total)],
    };
  }

  summaryByPid.i1 = { any: [mkRow('Penta3>Penta1', i1Stat.total)], all: [] };
  summaryByPid.i2 = { any: [mkRow('OPV3>OPV1', i2Stat.total)], all: [] };

  return {
    filteredFacilities,
    selMonths,
    selMonthLabels,
    selVaxList: effectiveVaxList,

    t1Rows, t0Rows, t7Rows,
    t1Stat, t0Stat, t7Stat,

    t2Web, t2Stat,
    blankCountsByVax, blankAllCountsByVax,

    t6Rows, t6Stat,
    t3Web, t3Stat, t3HitMap,
    outAnyCounts, outAllCounts,

    dropTables, dropStats, dropPairMap, dropHitMap,

    i1Rows, i2Rows, i1Stat, i2Stat,
    inconsTables, inconsStats, inconsPairMap,
    coTables, coStats,

    charts, cards, pinkFacSets,

    globalDen, globalBlockCount,
    summaryByPid,
  };
}

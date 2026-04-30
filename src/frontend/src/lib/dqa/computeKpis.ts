// ============================================================
// KPI Computation Engine
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
  pctChange,
  safeKey,
  monthShortLabel,
} from './parseUtils';
import {
  BASE_VAX,
  ADD_VAX,
  GROUP_COLORS,
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
    facilityKeys: new Set(),
    anyFacilityKeys: new Set(),
    allFacilityKeys: new Set(),
  };
}

function finalizeKpiStat(stat: KpiStat): void {
  stat.total = stat.facilityKeys.size;
  stat.any = stat.anyFacilityKeys.size;
  stat.all = stat.allFacilityKeys.size;
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
    color: '#0ea5e9',
  };
}

// ---- main export ----

export function computeKpis(csv: ParsedCSV, filters: FilterState): ComputedKpis {
  const { facilityData, allMonths, indicatorMap, idxMonth, header } = csv;

  // ---- resolve selected months ----
  let selMonths = filters.months.length > 0 ? filters.months : Object.keys(allMonths);
  selMonths = selMonths.slice().sort();
  const selMonthLabels: Record<string, string> = {};
  for (const mk of selMonths) selMonthLabels[mk] = allMonths[mk] ?? monthShortLabel(mk);

  // ---- resolve selected vaccines ----
  const selVaxBase = filters.outliersVax.length > 0 ? filters.outliersVax : BASE_VAX;
  const selVaxAdd = filters.addVax ?? [];
  const allSelVax = [...new Set([...selVaxBase, ...selVaxAdd])];
  const selVaxList = allSelVax.filter((v) => indicatorMap[v] !== undefined);
  const effectiveVaxList = selVaxList.length > 0 ? selVaxList : BASE_VAX.filter((v) => indicatorMap[v] !== undefined);

  // ---- global counts for denominator ----
  const globalDen = csv.globalFacilityCount;
  const globalBlockCount = csv.globalBlockCount;

  // ---- apply global filters ----
  const selBlocksSet = new Set(filters.blocks.length > 0 ? filters.blocks : Object.keys(
    Object.values(facilityData).reduce<Record<string, true>>((acc, fd) => {
      if (fd.block) acc[fd.block] = true;
      return acc;
    }, {})
  ));
  const selMonthsSet = new Set(selMonths);
  const selOwnerSet = new Set(filters.ownership.length > 0 ? filters.ownership : ['Public', 'Private']);
  const selRUSet = new Set(filters.ru.length > 0 ? filters.ru : ['Rural', 'Urban']);

  const filteredFacilities: Record<string, FacilityRecord> = {};
  for (const [key, fd] of Object.entries(facilityData)) {
    if (fd.block && !selBlocksSet.has(fd.block)) continue;
    if (fd.ownership && !selOwnerSet.has(fd.ownership)) continue;
    if (fd.ru && !selRUSet.has(fd.ru)) continue;
    const monthsKeep: FacilityRecord['months'] = {};
    for (const [mk, md] of Object.entries(fd.months)) {
      if (selMonthsSet.has(mk)) monthsKeep[mk] = md;
    }
    if (Object.keys(monthsKeep).length === 0) continue;
    filteredFacilities[key] = { ...fd, months: monthsKeep };
  }

  const totalMonthsSel = selMonths.length;

  // ============================================================
  // AVAILABILITY
  // ============================================================

  // t1: All indicators blank
  const t1Stat = emptyKpiStat();
  const t1Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let hitCount = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isBlank = false;
      if (md) {
        isBlank = true;
        for (let ci = idxMonth + 1; ci < header.length; ci++) {
          if (md.vals[ci] !== null) { isBlank = false; break; }
        }
      }
      row.push(isBlank ? 'Y' : 'N');
      if (isBlank) hitCount++;
    }
    if (hitCount > 0) {
      t1Stat.facilityKeys.add(key);
      if (hitCount === totalMonthsSel) t1Stat.allFacilityKeys.add(key);
      else t1Stat.anyFacilityKeys.add(key);
      t1Rows.push(row);
    }
  }
  finalizeKpiStat(t1Stat);

  // t0: All zero but not blank
  const t0Stat = emptyKpiStat();
  const t0Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let hitCount = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isZero = false;
      if (md) {
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
    if (hitCount > 0) {
      t0Stat.facilityKeys.add(key);
      if (hitCount === totalMonthsSel) t0Stat.allFacilityKeys.add(key);
      else t0Stat.anyFacilityKeys.add(key);
      t0Rows.push(row);
    }
  }
  finalizeKpiStat(t0Stat);

  // t7: Same repeating values
  const t7Stat = emptyKpiStat();
  const t7Rows: TableRows = [['Block Name', 'Facility Name', ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = [displayBlockLabel(fd.block), fd.facility];
    let anyY = false; let allY = true;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isRepeat = false;
      if (md) {
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
      if (isRepeat) anyY = true; else allY = false;
    }
    if (anyY) {
      t7Stat.facilityKeys.add(key);
      if (allY) t7Stat.allFacilityKeys.add(key);
      else t7Stat.anyFacilityKeys.add(key);
      t7Rows.push(row);
    }
  }
  finalizeKpiStat(t7Stat);

  // ============================================================
  // COMPLETENESS
  // ============================================================

  const t2Stat = emptyKpiStat();
  const t2MatrixRows: Record<string, T2MatrixRow> = {};
  const blankCountsByVax: Record<string, number> = {};
  const blankAllCountsByVax: Record<string, number> = {};
  for (const vx of effectiveVaxList) { blankCountsByVax[vx] = 0; blankAllCountsByVax[vx] = 0; }

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    let anyBlank = false;
    let allMonthsHaveBlank = true;
    const cellMap: Record<string, Record<string, string>> = {};

    for (const vx of effectiveVaxList) {
      const ci = indicatorMap[vx] ?? null;
      let hasBlankForVx = false;
      let vxAllBlank = true;
      for (const mk of selMonths) {
        const md = fd.months[mk];
        let isBlank = false;
        if (md && ci !== null) {
          isBlank = md.vals[ci] === null;
        }
        if (!cellMap[vx]) cellMap[vx] = {};
        cellMap[vx][mk] = isBlank ? 'Y' : 'N';
        if (isBlank) { anyBlank = true; hasBlankForVx = true; } else { vxAllBlank = false; }
      }
      if (hasBlankForVx) blankCountsByVax[vx]++;
      if (vxAllBlank) blankAllCountsByVax[vx]++;
    }

    if (anyBlank) {
      for (const mk of selMonths) {
        let has = false;
        for (const vx of effectiveVaxList) {
          if (cellMap[vx]?.[mk] === 'Y') { has = true; break; }
        }
        if (!has) { allMonthsHaveBlank = false; break; }
      }
      t2Stat.facilityKeys.add(key);
      if (allMonthsHaveBlank) t2Stat.allFacilityKeys.add(key);
      else t2Stat.anyFacilityKeys.add(key);
      t2MatrixRows[key] = {
        block: displayBlockLabel(fd.block),
        facility: fd.facility,
        cells: cellMap,
      };
    }
  }
  finalizeKpiStat(t2Stat);

  const t2Web: T2Web = {
    vaccines: effectiveVaxList,
    months: selMonths,
    monthLabels: selMonthLabels,
    rows: t2MatrixRows,
  };

  // ============================================================
  // ACCURACY
  // ============================================================

  // t6: Sessions Held > Planned
  const t6Stat = emptyKpiStat();
  const t6Rows: TableRows = [['Block Name', 'Facility Name', 'Details (months with Held>Planned)', 'Totals']];

  if (csv.idxSessPlanned !== null && csv.idxSessHeld !== null) {
    const iSP = csv.idxSessPlanned;
    const iSH = csv.idxSessHeld;

    for (const [key, fd] of Object.entries(filteredFacilities)) {
      const parts: string[] = [];
      let sumP = 0; let sumH = 0; let hitCount = 0;
      for (const mk of selMonths) {
        const md = fd.months[mk];
        const P = md?.vals[iSP] ?? null;
        const H = md?.vals[iSH] ?? null;
        if (P !== null) sumP += P;
        if (H !== null) sumH += H;
        if (P !== null && P > 0 && H !== null && H > P) {
          hitCount++;
          const pct = ((H - P) / P) * 100;
          parts.push(`${selMonthLabels[mk] ?? mk} +${pct.toFixed(1)}%`);
        }
      }
      let tot = '';
      let hasTot = false;
      if (sumP > 0 && sumH > sumP) {
        tot = `All months +${(((sumH - sumP) / sumP) * 100).toFixed(1)}%`;
        hasTot = true;
      }
      if (parts.length > 0 || hasTot) {
        t6Stat.facilityKeys.add(key);
        if (hitCount === totalMonthsSel) t6Stat.allFacilityKeys.add(key);
        else t6Stat.anyFacilityKeys.add(key);
        t6Rows.push([displayBlockLabel(fd.block), fd.facility, parts.join('; '), tot]);
      }
    }
  }
  finalizeKpiStat(t6Stat);

  // t3: Outliers
  const incBucketsSel = new Set(filters.outliersInc);
  const dropBucketsSel = new Set(filters.outliersDrop);

  function bucketHit(p: number): boolean {
    if (p > 0) {
      if (incBucketsSel.has('INC_LOW') && p >= 25 && p <= 50.49) return true;
      if (incBucketsSel.has('INC_MOD') && p >= 50.5 && p <= 100) return true;
      if (incBucketsSel.has('INC_EXT') && p > 100) return true;
    } else if (p < 0) {
      if (dropBucketsSel.has('DROP_LOW') && p <= -25 && p >= -50.49) return true;
      if (dropBucketsSel.has('DROP_MOD') && p <= -50.5 && p >= -100) return true;
      if (dropBucketsSel.has('DROP_EXT') && p < -100) return true;
    }
    return false;
  }

  const pairList: PairMeta[] = [];
  for (let i = 0; i < selMonths.length - 1; i++) {
    const m1 = selMonths[i]; const m2 = selMonths[i + 1];
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

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    let any = false;
    const cells: Record<string, Record<string, T3Cell>> = {};

    for (const vx of effectiveVaxList) {
      const ci = indicatorMap[vx];
      if (ci === undefined) continue;
      cells[vx] = {};
      for (const p of pairList) {
        const v1 = fd.months[p.m1]?.vals[ci] ?? null;
        const v2 = fd.months[p.m2]?.vals[ci] ?? null;
        const pc = pctChange(v1, v2);
        let hit = false;
        let pctVal: number | null = null;
        if (pc !== null) {
          pctVal = pc;
          if (bucketHit(pctVal)) {
            hit = true; any = true;
            if (!t3HitMap[key]) t3HitMap[key] = {};
            if (!t3HitMap[key][p.m1]) t3HitMap[key][p.m1] = {};
            if (!t3HitMap[key][p.m2]) t3HitMap[key][p.m2] = {};
            t3HitMap[key][p.m1][vx] = true;
            t3HitMap[key][p.m2][vx] = true;
          }
        }
        cells[vx][p.k] = { a: v1, b: v2, pct: pctVal, hit };
      }
    }

    if (any) {
      t3Stat.facilityKeys.add(key);
      const pairHits = pairList.filter((p) =>
        effectiveVaxList.some((vx) => cells[vx]?.[p.k]?.hit)
      ).length;
      if (pairList.length > 0 && pairHits === pairList.length) t3Stat.allFacilityKeys.add(key);
      else t3Stat.anyFacilityKeys.add(key);
      t3MatrixRows[key] = { block: displayBlockLabel(fd.block), facility: fd.facility, cells };
    }
  }

  // per-vaccine outlier counts
  for (const row of Object.values(t3MatrixRows)) {
    for (const vx of effectiveVaxList) {
      const anyHit = pairList.some((p) => row.cells[vx]?.[p.k]?.hit);
      const allHit = pairList.length > 0 && pairList.every((p) => row.cells[vx]?.[p.k]?.hit);
      if (anyHit) outAnyCounts[vx]++;
      if (allHit) outAllCounts[vx]++;
    }
  }

  finalizeKpiStat(t3Stat);

  const t3Web: T3Web = { vaccines: effectiveVaxList, pairs: pairList, rows: t3MatrixRows };

  // Dropout pairs
  const selDropRanges = new Set(filters.dropRanges);
  function dropMatch(pct: number): boolean {
    if (selDropRanges.has('R5_10') && pct >= 5 && pct <= 10.99) return true;
    if (selDropRanges.has('R11_20') && pct >= 11 && pct <= 19.99) return true;
    if (selDropRanges.has('R20P') && pct >= 20) return true;
    return false;
  }

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

    for (const [fkey, fd] of Object.entries(filteredFacilities)) {
      const cells: Record<string, { from: number | null; to: number | null; pct: number | null }> = {};
      let sumA = 0; let sumB = 0; let anyHit = false;

      for (const mk of selMonths) {
        const A = fd.months[mk]?.vals[iFrom] ?? null;
        const B = fd.months[mk]?.vals[iTo] ?? null;
        if (A !== null) sumA += A;
        if (B !== null) sumB += B;
        let cell: DropoutRow['cells'][string] = { from: null, to: null, pct: null };
        if (A !== null && B !== null && A > 0 && B < A) {
          const drop = ((A - B) / A) * 100;
          if (dropMatch(drop)) {
            anyHit = true;
            if (!hitSet[fkey]) hitSet[fkey] = {};
            hitSet[fkey][mk] = true;
            cell = { from: A, to: B, pct: drop };
          }
        }
        cells[mk] = cell;
      }

      let all: DropoutRow['all'] = { from: null, to: null, pct: null };
      if (sumA > 0 && sumB < sumA) {
        const dropAll = ((sumA - sumB) / sumA) * 100;
        if (dropMatch(dropAll)) all = { from: sumA, to: sumB, pct: dropAll };
      }

      if (anyHit) {
        dropStat.facilityKeys.add(fkey);
        const hitMonths = selMonths.filter((mk) => hitSet[fkey]?.[mk]).length;
        if (hitMonths === totalMonthsSel) dropStat.allFacilityKeys.add(fkey);
        else dropStat.anyFacilityKeys.add(fkey);
        dropRows[fkey] = {
          block: displayBlockLabel(fd.block),
          facility: fd.facility,
          cells,
          all,
        };
      }
    }

    finalizeKpiStat(dropStat);
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

  // i1: Penta3 > Penta1
  const i1Stat = emptyKpiStat();
  const i1Rows: TableRows = [['Block Name', 'Facility Name', 'Penta3 (total)', 'Penta1 (total)', '% change']];
  const iP1 = indicatorMap['Penta1']; const iP3 = indicatorMap['Penta3'];

  // i2: OPV3 > OPV1
  const i2Stat = emptyKpiStat();
  const i2Rows: TableRows = [['Block Name', 'Facility Name', 'OPV3 (total)', 'OPV1 (total)', '% change']];
  const iO1 = indicatorMap['OPV1']; const iO3 = indicatorMap['OPV3'];

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    let sumP1 = 0; let sumP3 = 0; let sumO1 = 0; let sumO3 = 0;
    for (const md of Object.values(fd.months)) {
      if (iP1 !== undefined) sumP1 += md.vals[iP1] ?? 0;
      if (iP3 !== undefined) sumP3 += md.vals[iP3] ?? 0;
      if (iO1 !== undefined) sumO1 += md.vals[iO1] ?? 0;
      if (iO3 !== undefined) sumO3 += md.vals[iO3] ?? 0;
    }

    if (iP1 !== undefined && iP3 !== undefined && sumP3 > sumP1) {
      i1Stat.facilityKeys.add(key);
      i1Stat.anyFacilityKeys.add(key);
      const pct = sumP1 > 0 ? ((sumP3 - sumP1) / sumP1) * 100 : null;
      i1Rows.push([
        displayBlockLabel(fd.block), fd.facility,
        Math.round(sumP3), Math.round(sumP1),
        pct !== null ? `+${pct.toFixed(1)}%` : '',
      ]);
    }

    if (iO1 !== undefined && iO3 !== undefined && sumO3 > sumO1) {
      i2Stat.facilityKeys.add(key);
      i2Stat.anyFacilityKeys.add(key);
      const pct = sumO1 > 0 ? ((sumO3 - sumO1) / sumO1) * 100 : null;
      i2Rows.push([
        displayBlockLabel(fd.block), fd.facility,
        Math.round(sumO3), Math.round(sumO1),
        pct !== null ? `+${pct.toFixed(1)}%` : '',
      ]);
    }
  }
  finalizeKpiStat(i1Stat);
  finalizeKpiStat(i2Stat);

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
    const facSet = new Set<string>();

    for (const [fkey, fd] of Object.entries(filteredFacilities)) {
      let sumFrom = 0; let sumTo = 0;
      for (const md of Object.values(fd.months)) {
        sumFrom += md.vals[iFrom] ?? 0;
        sumTo += md.vals[iTo] ?? 0;
      }
      if (sumTo > sumFrom) {
        facSet.add(fkey);
        const pct = sumFrom > 0 ? ((sumTo - sumFrom) / sumFrom) * 100 : null;
        tbl.push([
          displayBlockLabel(fd.block), fd.facility,
          Math.round(sumTo), Math.round(sumFrom),
          pct !== null ? `+${pct.toFixed(1)}%` : '',
        ]);
      }
    }

    const stat = emptyKpiStat();
    stat.facilityKeys = facSet;
    stat.anyFacilityKeys = new Set(facSet);
    finalizeKpiStat(stat);

    inconsTables[pid] = tbl;
    inconsStats[pid] = stat;
    inconsPairMap[downloadKey] = { from: f, to: t, label: labelName, pid };
  }

  // Co-admin
  const coTables: Record<string, CoAdminWeb> = {};
  const coStats: Record<string, KpiStat> = {};

  for (const [coKey, vaxList] of Object.entries(CO_SPECS)) {
    const coStat = emptyKpiStat();
    const coRows: Record<string, CoAdminRow> = {};

    for (const [fkey, fd] of Object.entries(filteredFacilities)) {
      const rowVals: Record<string, Record<string, number | null>> = {};
      const totals: Record<string, number> = {};
      for (const vx of vaxList) totals[vx] = 0;
      let viol = false;
      let monthViolCount = 0;

      for (const mk of selMonths) {
        rowVals[mk] = {};
        const valsMonth: number[] = [];
        for (const vx of vaxList) {
          const ci = indicatorMap[vx];
          const val = (ci !== undefined && fd.months[mk]) ? fd.months[mk].vals[ci] ?? null : null;
          rowVals[mk][vx] = val;
          if (val !== null) { totals[vx] += val; valsMonth.push(val); }
        }
        if (valsMonth.length >= 2) {
          if (Math.max(...valsMonth) !== Math.min(...valsMonth)) {
            viol = true; monthViolCount++;
          }
        }
      }

      const totArr = Object.values(totals).filter((v) => v !== null) as number[];
      if (totArr.length >= 2 && Math.max(...totArr) !== Math.min(...totArr)) viol = true;

      if (viol) {
        coStat.facilityKeys.add(fkey);
        if (totalMonthsSel > 0 && monthViolCount === totalMonthsSel) coStat.allFacilityKeys.add(fkey);
        else coStat.anyFacilityKeys.add(fkey);
        coRows[fkey] = {
          block: displayBlockLabel(fd.block),
          facility: fd.facility,
          vals: rowVals,
          totals,
        };
      }
    }

    finalizeKpiStat(coStat);
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
    t3: mkChart(t3Stat.facilityKeys, GROUP_COLORS.accuracy),
    i1: mkChart(i1Stat.facilityKeys, INCONS_LIGHT),
    i2: mkChart(i2Stat.facilityKeys, INCONS_LIGHT),
    co1: mkChart(coStats.co1.facilityKeys, GROUP_COLORS.consistency),
    co2: mkChart(coStats.co2.facilityKeys, GROUP_COLORS.consistency),
    co3: mkChart(coStats.co3.facilityKeys, GROUP_COLORS.consistency),
    co4: mkChart(coStats.co4.facilityKeys, GROUP_COLORS.consistency),
    co5: mkChart(coStats.co5.facilityKeys, GROUP_COLORS.consistency),
  };

  for (const [dk, ds] of Object.entries(dropStats)) {
    charts[dk] = mkChart(ds.facilityKeys, GROUP_COLORS.accuracy);
  }
  for (const [dlKey, meta] of Object.entries(inconsPairMap)) {
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
    return { name, count, pct: den > 0 ? Math.round((count / den) * 10000) / 100 : 0 };
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
    const anyRows = effectiveVaxList.map((vx) => {
      const allCnt = blankAllCountsByVax[vx] ?? 0;
      const tot = blankCountsByVax[vx] ?? 0;
      return mkRow(vx, Math.max(0, tot - allCnt));
    }).sort((a, b) => b.pct - a.pct);
    const allRows = effectiveVaxList.map((vx) => mkRow(vx, blankAllCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    const overallRows = effectiveVaxList.map((vx) => mkRow(vx, blankCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
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

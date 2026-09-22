// ============================================================
// UWIN KPI Computation Engine
// Extends HMIS computeKpis with: t8 (Avg Beneficiaries/Session < 5),
// t9 (Zero coverage session), and facility-, sub-center-, or session-site-wise
// analysis (filters.analysisMode).
// ============================================================

import type {
  FilterState,
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
} from '../dqa/types';
import { FacilityRecord } from '../dqa/types';
import {
  displayBlockLabel,
  safeKey,
  monthShortLabel,
  periodsAreConsecutive,
} from '../dqa/parseUtils';
import { coadminHasDifference, coadminMatchedTotals } from '../dqa/coadmin';
import {
  monthOnMonthChange,
  outlierBand,
  dropoutPct,
  dropoutRange,
  matchedTotals,
} from '../dqa/checkRules';
import { standardMethodFilters, methodSignature } from '../dqa/scoringProfile';
import {
  BASE_VAX,
  UWIN_DEFAULT_FILTERS,
  GROUP_COLORS,
  DROPOUT_COLOR,
  OUTLIER_COLOR,
  INCONS_LIGHT,
  CO_SPECS,
  CO_LABELS,
} from '../dqa/constants';
import type { UwinParsedCSV, UwinComputedKpis, T8MonthData, T8Row, T8Web } from './types';

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

/** Record a flagged unit as "all periods" when every checkable period was flagged. */
function flag(stat: KpiStat, key: string, hitMonths: number, evaluableMonths: number): void {
  stat.facilityKeys.add(key);
  if (evaluableMonths > 0 && hitMonths === evaluableMonths) stat.allFacilityKeys.add(key);
  else stat.anyFacilityKeys.add(key);
}

function pctLabel(from: number, to: number): string {
  return from > 0 ? `+${(((to - from) / from) * 100).toFixed(1)}%` : '';
}

function chartCountsByGeography(
  facSet: Set<string>,
  filteredFacilities: Record<string, FacilityRecord>,
  stateLevel: boolean,
): ChartPayload {
  const counts: Record<string, number> = {};
  for (const key of facSet) {
    const rec = filteredFacilities[key];
    const geography = stateLevel
      ? (rec?.district || 'Unknown district')
      : displayBlockLabel(rec?.block ?? '');
    counts[geography] = (counts[geography] ?? 0) + 1;
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

// Roll the parser's finest grain back up to the selected analysis level.
function aggregateToLevel(
  facilityData: Record<string, FacilityRecord>,
  level: 'facility' | 'subcenter' | 'sessionsite',
): Record<string, FacilityRecord> {
  const out: Record<string, FacilityRecord> = {};
  for (const fd of Object.values(facilityData)) {
    const key = [
      fd.district ?? '', fd.block, fd.facility,
      ...(level === 'subcenter' ? [fd.subcenter ?? 'Unknown SC'] : []),
      ...(level === 'sessionsite' ? [fd.sessionsite ?? ''] : []),
    ].join('||');
    let agg = out[key];
    if (!agg) {
      agg = {
        district: fd.district,
        block: fd.block,
        facility: fd.facility,
        ...(level === 'subcenter' ? { subcenter: fd.subcenter ?? 'Unknown SC' } : {}),
        ...(level === 'sessionsite' ? { sessionsite: fd.sessionsite ?? '' } : {}),
        ownership: '', ru: '', months: {},
      };
      out[key] = agg;
    }
    if (fd.ownership) {
      if (!agg.ownership) agg.ownership = fd.ownership;
      else if (agg.ownership !== fd.ownership) agg.ownership = 'Mixed';
    }
    if (fd.ru) {
      if (!agg.ru) agg.ru = fd.ru;
      else if (agg.ru !== fd.ru) agg.ru = 'Mixed';
    }
    for (const [mk, md] of Object.entries(fd.months)) {
      let am = agg.months[mk];
      if (!am) {
        am = { label: md.label, yearMonth: md.yearMonth, raw: md.raw, vals: {} };
        agg.months[mk] = am;
      }
      for (const [ciStr, v] of Object.entries(md.vals)) {
        if (v === null) {
          if (!(ciStr in am.vals)) am.vals[Number(ciStr)] = null;
          continue;
        }
        const ci = Number(ciStr);
        am.vals[ci] = (am.vals[ci] ?? 0) + v;
      }
    }
  }
  return out;
}

// ---- main export ----

/**
 * KPIs for the reviewer's settings, plus the cards the SCORE is computed from
 * (always the standard scoring settings on the same scope — see
 * lib/dqa/scoringProfile.ts).
 */
export function computeUwinKpis(csv: UwinParsedCSV, filters: FilterState): UwinComputedKpis {
  const view = computeUwinKpisForSettings(csv, filters);
  const standard = standardMethodFilters(filters, UWIN_DEFAULT_FILTERS);
  if (methodSignature(filters) === methodSignature(standard)) {
    return { ...view, scoreCards: view.cards, customMethod: false };
  }
  const scored = computeUwinKpisForSettings(csv, standard);
  return { ...view, scoreCards: scored.cards, customMethod: true };
}

function computeUwinKpisForSettings(
  csv: UwinParsedCSV,
  filters: FilterState,
): Omit<UwinComputedKpis, 'scoreCards' | 'customMethod'> {
  const {
    allMonths, indicatorMap, idxMonth, header,
    idxSessPlanned, idxSessHeld,
    idxBenPW, idxBenInf, idxBenChild, idxBenAdol,
    idxBenTd1, idxBenTd2, idxBenTdB, idxBenTd10, idxBenTd16,
    targetIndicatorIndices,
  } = csv;

  const analysisMode = filters.analysisMode ?? 'facility';
  const facilityData = aggregateToLevel(csv.facilityData, analysisMode);

  // ---- row identity columns for the selected hierarchy level ----
  const stateLevel = csv.portal === 'UWIN_STATE';
  const idHeaderCols: string[] = [
    ...(stateLevel ? ['District'] : []),
    'Block Name',
    'Facility Name',
    ...(analysisMode === 'subcenter' ? ['Sub Center Name'] : []),
    ...(analysisMode === 'sessionsite' ? ['Session Site Name'] : []),
  ];
  const idRowCols = (fd: FacilityRecord): (string | number | null)[] =>
    [
      ...(stateLevel ? [fd.district ?? 'Unknown district'] : []),
      displayBlockLabel(fd.block),
      fd.facility,
      ...(analysisMode === 'subcenter' ? [fd.subcenter ?? 'Unknown SC'] : []),
      ...(analysisMode === 'sessionsite' ? [fd.sessionsite ?? ''] : []),
    ];
  const idObjCols = (fd: FacilityRecord): { district?: string; block: string; facility: string; subcenter?: string; sessionsite?: string } => ({
    ...(stateLevel ? { district: fd.district ?? 'Unknown district' } : {}),
    block: displayBlockLabel(fd.block),
    facility: fd.facility,
    ...(analysisMode === 'subcenter' ? { subcenter: fd.subcenter ?? 'Unknown SC' } : {}),
    ...(analysisMode === 'sessionsite' ? { sessionsite: fd.sessionsite ?? '' } : {}),
  });

  // ---- resolve selected months ----
  let selMonths = filters.months.length > 0 ? filters.months : Object.keys(allMonths);
  selMonths = selMonths.slice().sort();
  const selMonthLabels: Record<string, string> = {};
  for (const mk of selMonths) selMonthLabels[mk] = allMonths[mk] ?? monthShortLabel(mk);

  // ---- resolve selected vaccines ----
  // UWIN completeness uses a fixed applicability set rather than the accuracy indicator filters.
  const accuracyVaxBase = filters.outliersVax.length > 0 ? filters.outliersVax : BASE_VAX;
  const accuracyVaxAdd = filters.addVax ?? [];
  const allAccuracyVax = [...new Set([...accuracyVaxBase, ...accuracyVaxAdd])];
  const accuracyVaxList = allAccuracyVax.filter((v) => indicatorMap[v] !== undefined);
  const effectiveAccuracyVaxList = accuracyVaxList.length > 0
    ? accuracyVaxList
    : BASE_VAX.filter((v) => indicatorMap[v] !== undefined);

  const completenessDefaults = [...BASE_VAX];
  if (indicatorMap['FIC-Total'] !== undefined) completenessDefaults.push('FIC-Total');
  const completenessVaxList = [...new Set(completenessDefaults)].filter((v) => indicatorMap[v] !== undefined);
  const effectiveCompletenessVaxList = completenessVaxList.length > 0
    ? completenessVaxList
    : BASE_VAX.filter((v) => indicatorMap[v] !== undefined);

  // ---- apply global filters ----
  const selBlocksSet = new Set(filters.blocks.length > 0 ? filters.blocks : Object.keys(
    Object.values(facilityData).reduce<Record<string, true>>((acc, fd) => {
      if (fd.block) acc[fd.block] = true;
      return acc;
    }, {})
  ));
  const selDistrictsSet = new Set(
    filters.districts && filters.districts.length > 0 ? filters.districts : csv.districts,
  );
  const selMonthsSet = new Set(selMonths);
  // No ownership / rural-urban filter means no exclusion at all ("Mixed" and
  // other values must still be analysed).
  const selOwnerSet = filters.ownership.length > 0 ? new Set(filters.ownership) : null;
  const selRUSet = filters.ru.length > 0 ? new Set(filters.ru) : null;

  const filteredFacilities: Record<string, FacilityRecord> = {};
  for (const [key, fd] of Object.entries(facilityData)) {
    if (stateLevel && fd.district && !selDistrictsSet.has(fd.district)) continue;
    if (fd.block && !selBlocksSet.has(fd.block)) continue;
    if (selOwnerSet && fd.ownership && !selOwnerSet.has(fd.ownership)) continue;
    if (selRUSet && fd.ru && !selRUSet.has(fd.ru)) continue;
    const monthsKeep: FacilityRecord['months'] = {};
    for (const [mk, md] of Object.entries(fd.months)) {
      if (selMonthsSet.has(mk)) monthsKeep[mk] = md;
    }
    // A session site that ran no session in the selected periods has no row —
    // that is not a missing report, so it is outside the analysis.
    if (Object.keys(monthsKeep).length === 0) continue;
    filteredFacilities[key] = { ...fd, months: monthsKeep };
  }
  const unitCount = Object.keys(filteredFacilities).length;
  const globalDen = unitCount;
  const globalBlockCount = new Set(Object.values(filteredFacilities).map((fd) => `${fd.district ?? ''}||${fd.block}`).filter((key) => !key.endsWith('||'))).size;

  // ============================================================
  // AVAILABILITY
  // ============================================================

  const t0Stat = emptyKpiStat();
  const t0Rows: TableRows = [[...idHeaderCols, ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];
  const t0Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = idRowCols(fd);
    let hitCount = 0;
    let evaluable = 0;
    for (const mk of selMonths) {
      const md = fd.months[mk];
      let isZero = false;
      if (md) {
        evaluable++;
        // Scoped to vaccine-dose "target" indicator columns only — Session
        // Planned/Held and beneficiary/Td columns are excluded (matches PHP's
        // $indicatorIdxTargets), otherwise a real session (which always has a
        // nonzero Session Held) would never be flagged even if every vaccine
        // dose column is explicitly 0.
        let allZero = true; let hasAny = false;
        for (const ci of targetIndicatorIndices) {
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
    if (evaluable > 0 && targetIndicatorIndices.length > 0) t0Eligible.add(key);
    if (hitCount > 0) {
      flag(t0Stat, key, hitCount, evaluable);
      t0Rows.push(row);
    }
  }
  finalizeKpiStat(t0Stat, t0Eligible);

  const t7Stat = emptyKpiStat();
  const t7Rows: TableRows = [[...idHeaderCols, ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];
  const t7Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const row: (string | number | null)[] = idRowCols(fd);
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

  // t9: Zero coverage session — PW + Infants + Children + Adolescents + Td1/Td2/Td-Booster/Td10/Td16 = 0
  // in a period where at least one session was actually held. A session that was
  // not held has nobody to vaccinate; that is "Planned but not held" (t6), not
  // zero coverage. (Departs from the PHP reference, which ignored Sessions Held.)
  const t9Stat = emptyKpiStat();
  const t9Eligible = new Set<string>();
  const t9Rows: TableRows = [[...idHeaderCols, ...selMonths.map((mk) => selMonthLabels[mk] ?? mk)]];
  const t9HitMap: Record<string, Record<string, boolean>> = {};
  const t9BenIdxList = [idxBenPW, idxBenInf, idxBenChild, idxBenAdol, idxBenTd1, idxBenTd2, idxBenTdB, idxBenTd10, idxBenTd16]
    .filter((idx): idx is number => idx !== null);

  if (t9BenIdxList.length > 0) {
    for (const [key, fd] of Object.entries(filteredFacilities)) {
      const row: (string | number | null)[] = idRowCols(fd);
      let hitCount = 0;
      let evaluable = 0;
      for (const mk of selMonths) {
        const md = fd.months[mk];
        let isZero = false;
        const held = md && idxSessHeld !== null ? md.vals[idxSessHeld] ?? null : null;
        const sessionHeld = idxSessHeld === null || (held !== null && held > 0);
        if (md && sessionHeld) {
          let sum = 0; let hasAny = false;
          for (const idx of t9BenIdxList) {
            const v = md.vals[idx];
            if (v !== null) { sum += v; hasAny = true; }
          }
          if (hasAny) evaluable++;
          isZero = hasAny && sum === 0;
        }
        row.push(isZero ? 'Y' : 'N');
        if (isZero) {
          hitCount++;
          if (!t9HitMap[key]) t9HitMap[key] = {};
          t9HitMap[key][mk] = true;
        }
      }
      if (evaluable > 0) t9Eligible.add(key);
      if (hitCount > 0) {
        flag(t9Stat, key, hitCount, evaluable);
        t9Rows.push(row);
      }
    }
  }
  finalizeKpiStat(t9Stat, t9Eligible);

  // ============================================================
  // COMPLETENESS
  // ============================================================

  const t2Stat = emptyKpiStat();
  const t2MatrixRows: Record<string, T2MatrixRow> = {};
  const blankCountsByVax: Record<string, number> = {};
  const blankAllCountsByVax: Record<string, number> = {};
  for (const vx of effectiveCompletenessVaxList) { blankCountsByVax[vx] = 0; blankAllCountsByVax[vx] = 0; }

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    let anyBlank = false;
    const cellMap: Record<string, Record<string, string>> = {};

    for (const vx of effectiveCompletenessVaxList) {
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
      const reportedMonths = selMonths.filter((mk) => fd.months[mk]).length;
      const blankMonths = selMonths.filter((mk) =>
        effectiveCompletenessVaxList.some((vx) => cellMap[vx]?.[mk] === 'Y'),
      ).length;
      flag(t2Stat, key, blankMonths, reportedMonths);
      t2MatrixRows[key] = {
        ...idObjCols(fd),
        cells: cellMap,
      };
    }
  }
  finalizeKpiStat(t2Stat, new Set(effectiveCompletenessVaxList.length > 0 ? Object.keys(filteredFacilities) : []));

  const t2Web: T2Web = {
    vaccines: effectiveCompletenessVaxList,
    months: selMonths,
    monthLabels: selMonthLabels,
    rows: t2MatrixRows,
  };

  // ============================================================
  // ACCURACY
  // ============================================================

  // t6: Planned but not held (Sessions Held < Sessions Planned)
  // Compared only in periods where both Planned and Held were reported; the
  // totals column sums those same periods (a blank is missing, never zero).
  const t6Stat = emptyKpiStat();
  const t6Rows: TableRows = [[...idHeaderCols, 'Details (months with Planned>Held)', 'Totals (months with both reported)']];
  const t6Eligible = new Set<string>();

  if (idxSessPlanned !== null && idxSessHeld !== null) {
    const iSP = idxSessPlanned;
    const iSH = idxSessHeld;

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
        if (P > 0 && H < P) {
          hitCount++;
          const pct = ((P - H) / P) * 100;
          parts.push(`${selMonthLabels[mk] ?? mk} -${pct.toFixed(1)}%`);
        }
      }
      if (evaluable > 0) t6Eligible.add(key);
      if (hitCount > 0) {
        const totals = matchedTotals(pairs);
        const tot = totals.a > 0 && totals.b < totals.a
          ? `All months -${(((totals.a - totals.b) / totals.a) * 100).toFixed(1)}%`
          : `All months: planned ${totals.a}, held ${totals.b}`;
        flag(t6Stat, key, hitCount, evaluable);
        t6Rows.push([...idRowCols(fd), parts.join('; '), tot]);
      }
    }
  }
  finalizeKpiStat(t6Stat, t6Eligible);

  // t8: Avg Beneficiaries per Session < 5
  const t8Stat = emptyKpiStat();
  const t8HitMap: Record<string, Record<string, boolean>> = {};
  const t8WebRows: Record<string, T8Row> = {};
  const t8Eligible = new Set<string>();

  if (idxSessHeld !== null) {
    const iSH = idxSessHeld;

    for (const [key, fd] of Object.entries(filteredFacilities)) {
      const monthData: Record<string, T8MonthData> = {};
      let flaggedMonths = 0;
      let evaluable = 0;
      let totalSess = 0;
      let totalBen = 0;

      for (const mk of selMonths) {
        const md = fd.months[mk];
        const sessHeld = md?.vals[iSH] ?? null;
        let ben: number | null = null;

        if (md) {
          let sum = 0; let hasAny = false;
          for (const idx of [idxBenPW, idxBenInf, idxBenChild, idxBenAdol]) {
            if (idx !== null) {
              const v = md.vals[idx];
              if (v !== null) { sum += v; hasAny = true; }
            }
          }
          if (hasAny) ben = sum;
        }

        let avg: number | null = null;
        if (sessHeld !== null && sessHeld > 0 && ben !== null) {
          avg = ben / sessHeld;
        }

        const lowAvg = avg !== null && avg < 5;
        monthData[mk] = { sessHeld, beneficiaries: ben, avg, flag: lowAvg };
        if (avg !== null) evaluable++;
        if (lowAvg) flaggedMonths++;

        if (sessHeld !== null) totalSess += sessHeld;
        if (ben !== null) totalBen += ben;
      }

      const allAvg = totalSess > 0 ? totalBen / totalSess : null;
      const allFlag2 = allAvg !== null && allAvg < 5;

      if (evaluable > 0) t8Eligible.add(key);
      if (flaggedMonths > 0) {
        flag(t8Stat, key, flaggedMonths, evaluable);

        t8HitMap[key] = {};
        for (const mk of selMonths) {
          if (monthData[mk]?.flag) t8HitMap[key][mk] = true;
        }

        t8WebRows[key] = {
          ...idObjCols(fd),
          months: monthData,
          allMonths: {
            sessHeld: totalSess || null,
            beneficiaries: totalBen || null,
            avg: allAvg,
            flag: allFlag2,
          },
        };
      }
    }
  }
  finalizeKpiStat(t8Stat, t8Eligible);

  const t8Web: T8Web = {
    months: selMonths,
    monthLabels: selMonthLabels,
    rows: t8WebRows,
  };

  // t3: Outliers — calendar-adjacent periods only, volume floor, rises from 0.
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
  for (const vx of effectiveAccuracyVaxList) { outAnyCounts[vx] = 0; outAllCounts[vx] = 0; }
  const t3Eligible = new Set<string>();

  for (const [key, fd] of Object.entries(filteredFacilities)) {
    const cells: Record<string, Record<string, T3Cell>> = {};
    const evaluablePairs = new Set<string>();
    const hitPairs = new Set<string>();

    for (const vx of effectiveAccuracyVaxList) {
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
      t3MatrixRows[key] = { ...idObjCols(fd), cells };
    }
  }
  finalizeKpiStat(t3Stat, t3Eligible);

  const t3Web: T3Web = { vaccines: effectiveAccuracyVaxList, pairs: pairList, rows: t3MatrixRows };

  // Dropouts — judged on the cumulative dropout over the selected periods
  // (periods where both doses were reported).
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
        hitSet[fkey] = Object.fromEntries(matchedMonths.map((mk) => [mk, true]));
        dropRows[fkey] = {
          ...idObjCols(fd),
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

  // Later dose > earlier dose — period totals over periods where both doses
  // were reported (a blank is missing, never zero).
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
          ...idRowCols(fd),
          Math.round(totals.b), Math.round(totals.a),
          pctLabel(totals.a, totals.b),
        ]);
      }
    }
    finalizeKpiStat(stat, eligible);
  }

  const i1Stat = emptyKpiStat();
  const i1Rows: TableRows = [[...idHeaderCols, 'Penta3 (total)', 'Penta1 (total)', '% change']];
  const iP1 = indicatorMap['Penta1']; const iP3 = indicatorMap['Penta3'];
  if (iP1 !== undefined && iP3 !== undefined) doseOrderCheck(iP1, iP3, i1Stat, i1Rows);

  const i2Stat = emptyKpiStat();
  const i2Rows: TableRows = [[...idHeaderCols, 'OPV3 (total)', 'OPV1 (total)', '% change']];
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

    const tbl: TableRows = [[...idHeaderCols, `${t} (total)`, `${f} (total)`, '% change']];
    const stat = emptyKpiStat();
    doseOrderCheck(iFrom, iTo, stat, tbl);

    inconsTables[pid] = tbl;
    inconsStats[pid] = stat;
    inconsPairMap[downloadKey] = { from: f, to: t, label: labelName, pid };
  }

  // Co-admin — monthly only; blanks are ignored (a completeness finding).
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
          ...idObjCols(fd),
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
    const c = chartCountsByGeography(facSet, filteredFacilities, stateLevel);
    c.color = color;
    return c;
  }

  const charts: Record<string, ChartPayload> = {
    t0: mkChart(t0Stat.facilityKeys, GROUP_COLORS.availability),
    t7: mkChart(t7Stat.facilityKeys, GROUP_COLORS.availability),
    t9: mkChart(t9Stat.facilityKeys, GROUP_COLORS.availability),
    t2: mkChart(t2Stat.facilityKeys, GROUP_COLORS.completeness),
    t6: mkChart(t6Stat.facilityKeys, GROUP_COLORS.accuracy),
    t8: mkChart(t8Stat.facilityKeys, GROUP_COLORS.accuracy),
    t3: mkChart(t3Stat.facilityKeys, OUTLIER_COLOR),
    i1: mkChart(i1Stat.facilityKeys, INCONS_LIGHT),
    i2: mkChart(i2Stat.facilityKeys, INCONS_LIGHT),
    co1: mkChart(coStats.co1?.facilityKeys ?? new Set(), GROUP_COLORS.consistency),
    co2: mkChart(coStats.co2?.facilityKeys ?? new Set(), GROUP_COLORS.consistency),
    co3: mkChart(coStats.co3?.facilityKeys ?? new Set(), GROUP_COLORS.consistency),
    co4: mkChart(coStats.co4?.facilityKeys ?? new Set(), GROUP_COLORS.consistency),
    co5: mkChart(coStats.co5?.facilityKeys ?? new Set(), GROUP_COLORS.consistency),
  };

  for (const [dk, ds] of Object.entries(dropStats)) {
    charts[dk] = mkChart(ds.facilityKeys, DROPOUT_COLOR);
  }
  for (const [dlKey, meta] of Object.entries(inconsPairMap)) {
    const stat = inconsStats[meta.pid];
    if (stat) charts[meta.pid] = mkChart(stat.facilityKeys, INCONS_LIGHT);
  }

  // ============================================================
  // KPI Cards
  // ============================================================
  const cards: KpiCard[] = [
    { id: 't0', name: 'Indicators having 0 values but not blank', stat: t0Stat, group: 'availability', downloadKey: 't0' },
    { id: 't7', name: 'Indicators with same values', stat: t7Stat, group: 'availability', downloadKey: 't7' },
    { id: 't9', name: 'Zero coverage session', stat: t9Stat, group: 'availability', downloadKey: 't9' },
    { id: 't2', name: 'Key Missing Indicators', stat: t2Stat, group: 'completeness', downloadKey: 't2' },
    { id: 't6', name: 'Planned but not held', stat: t6Stat, group: 'accuracy', downloadKey: 't6' },
    { id: 't8', name: 'Avg Beneficiaries per Session < 5', stat: t8Stat, group: 'accuracy', downloadKey: 't8' },
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

  // Requested display order for the 7 standard Consistency cards (co1, co3, co2,
  // co4, i1, i2, co5), leaving any dynamically-added inconsistency-pair cards
  // (iadd_*) in their original relative order at the end. Reorders only the
  // consistency-group slots in `cards`, in place — every other group's order
  // (and array indices) is untouched.
  const CONSISTENCY_ORDER: Record<string, number> = { co1: 0, co3: 1, co2: 2, co4: 3, i1: 4, i2: 5, co5: 6 };
  const consistencyIndices = cards
    .map((c, i) => (c.group === 'consistency' ? i : -1))
    .filter((i) => i >= 0);
  const consistencyCardsSorted = consistencyIndices
    .map((i) => cards[i])
    .sort((a, b) => (CONSISTENCY_ORDER[a.id] ?? 99) - (CONSISTENCY_ORDER[b.id] ?? 99));
  consistencyIndices.forEach((idx, j) => { cards[idx] = consistencyCardsSorted[j]; });

  // ============================================================
  // Pink facility sets
  // ============================================================
  const pinkFacSets: Record<string, string[]> = {
    t0: [...t0Stat.facilityKeys],
    t7: [...t7Stat.facilityKeys],
    t9: [...t9Stat.facilityKeys],
    t2: [...t2Stat.facilityKeys],
    t6: [...t6Stat.facilityKeys],
    t8: [...t8Stat.facilityKeys],
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
  // Summary by pid
  // ============================================================
  const summaryByPid: Record<string, { any: SummaryRow[]; all: SummaryRow[]; overall?: SummaryRow[] }> = {};
  const den = Math.max(1, globalDen);

  function mkRow(name: string, count: number): SummaryRow {
    return { name, count, pct: den > 0 ? Math.round((count / den) * 10000) / 100 : 0 };
  }

  summaryByPid.t0 = { any: [mkRow('Indicators having 0 values', t0Stat.any)], all: [mkRow('Indicators having 0 values', t0Stat.all)] };
  summaryByPid.t7 = { any: [mkRow('Indicators with same values', t7Stat.any)], all: [mkRow('Indicators with same values', t7Stat.all)] };
  summaryByPid.t9 = { any: [mkRow('Zero coverage session', t9Stat.any)], all: [mkRow('Zero coverage session', t9Stat.all)] };

  {
    const anyRows = effectiveCompletenessVaxList.map((vx) => {
      const allCnt = blankAllCountsByVax[vx] ?? 0;
      const tot = blankCountsByVax[vx] ?? 0;
      return mkRow(vx, Math.max(0, tot - allCnt));
    }).sort((a, b) => b.pct - a.pct);
    const allRows = effectiveCompletenessVaxList.map((vx) => mkRow(vx, blankAllCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    const overallRows = effectiveCompletenessVaxList.map((vx) => mkRow(vx, blankCountsByVax[vx] ?? 0)).sort((a, b) => b.pct - a.pct);
    summaryByPid.t2 = { any: anyRows, all: allRows, overall: overallRows };
  }

  { summaryByPid.t3 = { any: [], all: [], overall: effectiveAccuracyVaxList.map((vx) => mkRow(vx, outAnyCounts[vx] ?? 0)).sort((a, b) => b.pct - a.pct) }; }

  summaryByPid.t6 = {
    any: [mkRow('Planned but not held', t6Stat.any)],
    all: [mkRow('Planned but not held', t6Stat.all)],
    overall: [mkRow('Planned but not held', t6Stat.total)],
  };

  summaryByPid.t8 = {
    any: [mkRow('Avg Beneficiaries / Session < 5', t8Stat.any)],
    all: [mkRow('Avg Beneficiaries / Session < 5', t8Stat.all)],
    overall: [mkRow('Avg Beneficiaries / Session < 5', t8Stat.total)],
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
    selVaxList: effectiveCompletenessVaxList,
    analysisMode,

    t0Rows, t7Rows, t9Rows,
    t0Stat, t7Stat, t9Stat, t9HitMap,

    t2Web, t2Stat,
    blankCountsByVax, blankAllCountsByVax,

    t6Rows, t6Stat,
    t8Stat, t8Web, t8HitMap,

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

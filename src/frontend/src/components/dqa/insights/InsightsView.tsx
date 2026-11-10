// DQA Insights - the reimagined analytics dashboard (presentational part).
// Takes the saved reviews and their score grids as props, so it can be rendered
// with real data outside the app (see InsightsPage for the data loading).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Download, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import type { SnapshotRecord } from "../../../lib/snapshots";
import type { SnapshotBreakdown } from "../../../lib/snapshotBreakdown";
import { SCORE_FAMILY_LABELS, type ScoreFamily } from "../../../lib/dashboard";
import { SCORING_METHOD_VERSION } from "../../../lib/dqa/scoring";
import { PRIORITY_DISTRICT_TOTAL, priorityDistrictNames } from "../../../lib/maps/priorityDistricts";
import {
  BANDS,
  COMPONENT_KEYS,
  COMPONENT_LABELS,
  DEFAULT_INSIGHT_FILTERS,
  GOOD_LINE,
  PROGRAMME_PURPOSES,
  STALE_DAYS,
  UNIT_NOUN,
  bandOf,
  buildMatrix,
  buildPractice,
  buildTakeaways,
  buildTimeline,
  buildUnits,
  componentProfiles,
  computePulse,
  dominantMethod,
  familySummaries,
  groupUnits,
  inWindow,
  leagueXlsHtml,
  matchesInsightFilters,
  movers,
  reReviewEffect,
  resolveWindow,
  toInsightRecord,
  unitLevelFor,
  type ComponentKey,
  type InsightFilters,
  type InsightPreset,
  type InsightRecord,
  type Unit,
} from "../../../lib/insights";
import {
  BandBar,
  BandLegend,
  ComponentProfileChart,
  CountBars,
  EmptyNote,
  MiniBars,
  MonthMatrix,
  MoversChart,
  PriorityMatrix,
  ReReviewChart,
  ScoreStripPlot,
  Sparkline,
  TrajectoryChart,
  fmt1,
  signed1,
} from "./charts";

export interface InsightsViewProps {
  snapshots: SnapshotRecord[];
  grids: Map<string, SnapshotBreakdown>;
  /** Score grids are still being fetched for the current scope. */
  gridsPending: boolean;
  /** NATIONAL / STATE / DISTRICT / BLOCK - only used for wording and auto-drill. */
  accessLevel: string;
  /** Fixed clock for tests; defaults to now. */
  nowMs?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Tells the loader which grids the page needs. */
  onScopeChange?: (scope: { family: ScoreFamily; stateKey: string }) => void;
  initialFilters?: Partial<InsightFilters>;
}

const PRESETS: Array<{ value: InsightPreset; label: string }> = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "fy", label: "This FY" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const nf = new Intl.NumberFormat("en-IN");

// ---------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------

function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-5 text-slate-950">{title}</h3>
          {subtitle ? <p className="mt-1 text-[12.5px] leading-[18px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionHead({ index, question }: { index: number; question: string }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{index}</span>
      <h2 className="text-[13px] font-bold uppercase tracking-[0.12em] text-slate-700">{question}</h2>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function Pick({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-[200px] rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
      >
        {children}
      </select>
    </label>
  );
}

/** Change against the previous window. `goodWhen` says which direction is good news. */
function Delta({ now, before, unit, goodWhen, vs }: { now: number | null; before: number | null; unit: "pct" | "pts" | "days"; goodWhen: "up" | "down" | "none"; vs: string | null }) {
  if (now === null || before === null || !vs) return null;
  if (unit === "pct" && before === 0) return <span className="text-[11.5px] text-slate-500">none in the {vs}</span>;
  // A tiny previous window makes a percentage meaningless ("+1355%"): say how many times instead.
  if (unit === "pct" && now / before >= 3) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-[11.5px] text-slate-500">
        <span className={`font-semibold ${goodWhen === "up" ? "text-[#006300]" : "text-slate-600"}`}>{(now / before).toFixed(1)}×</span> the {vs}
      </span>
    );
  }
  const diff = unit === "pct" ? ((now - before) / before) * 100 : now - before;
  const flat = Math.abs(diff) < (unit === "pct" ? 1 : 0.5);
  const good = goodWhen === "none" || flat ? null : (diff > 0) === (goodWhen === "up");
  const tone = good === null ? "text-slate-600" : good ? "text-[#006300]" : "text-[#b3292e]";
  const text = unit === "pct" ? `${Math.abs(Math.round(diff))}%` : unit === "pts" ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(Math.round(diff))} d`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11.5px] text-slate-500">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${tone}`}>
        {flat ? "No change" : (<>{diff > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{text}</>)}
      </span>
      vs {vs}
    </span>
  );
}

function Tile({ label, value, unit, sub, extra, delta }: { label: string; value: string; unit?: string; sub?: ReactNode; extra?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="flex min-h-[132px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-[30px] font-semibold leading-none tracking-tight text-slate-950">
          {value}
          {unit ? <span className="ml-1 text-[14px] font-medium text-slate-500">{unit}</span> : null}
        </div>
        {extra}
      </div>
      {sub ? <div className="mt-2 text-[12px] leading-4 text-slate-600">{sub}</div> : null}
      <div className="mt-auto pt-2">{delta}</div>
    </div>
  );
}

type SortKey = "score" | "name" | "change" | "reviews" | "daysSince" | ComponentKey;

function ScoreCell({ value }: { value: number | null }) {
  const band = bandOf(value);
  if (!band) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-block min-w-[42px] rounded-[5px] px-1.5 py-[3px] text-center text-[11.5px] font-semibold tabular-nums" style={{ background: band.color, color: band.ink }}>
      {value!.toFixed(0)}
    </span>
  );
}

// ---------------------------------------------------------------
// The page
// ---------------------------------------------------------------

export function InsightsView({ snapshots, grids, gridsPending, accessLevel, nowMs, onRefresh, refreshing, onScopeChange, initialFilters }: InsightsViewProps) {
  const now = useMemo(() => nowMs ?? Date.now(), [nowMs]);

  const records = useMemo(
    () => snapshots.map((s) => toInsightRecord(s, grids.get(s.id))).filter((r): r is InsightRecord => r !== null),
    [snapshots, grids],
  );

  const familiesPresent = useMemo(() => {
    const counts: Record<ScoreFamily, number> = { HMIS: 0, UWIN: 0, PCTS: 0, HMIS_STATE: 0 };
    for (const r of records) counts[r.scoreFamily] += 1;
    return (Object.keys(counts) as ScoreFamily[]).filter((f) => counts[f] > 0).sort((a, b) => counts[b] - counts[a]);
  }, [records]);

  const [filters, setFilters] = useState<InsightFilters>(() => ({
    ...DEFAULT_INSIGHT_FILTERS,
    family: "HMIS",
    ...initialFilters,
  }));
  const [familyTouched, setFamilyTouched] = useState(Boolean(initialFilters?.family));
  // Until the reader picks a system, show the one with the most reviews.
  const family = familyTouched || familiesPresent.length === 0 || familiesPresent.includes(filters.family) ? filters.family : familiesPresent[0];
  const set = (patch: Partial<InsightFilters>) => setFilters((current) => ({ ...current, ...patch }));

  // Options come from the whole family (not the time window), so a filter never
  // empties its own list.
  const stateOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) if (r.scoreFamily === family && r.stateKey) map.set(r.stateKey, r.state);
    return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records, family]);
  const stateKey = filters.state && stateOptions.some((s) => s.key === filters.state) ? filters.state : stateOptions.length === 1 ? stateOptions[0].key : "";
  const districtOptions = useMemo(() => {
    const map = new Map<string, string>();
    if (!stateKey || family === "HMIS_STATE") return [];
    for (const r of records) {
      if (r.scoreFamily === family && r.stateKey === stateKey && r.districtKey && r.dqaLevel !== "STATE" && !["multiple", "all districts", "all"].includes(r.districtKey)) {
        map.set(r.districtKey, r.district);
      }
    }
    return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [records, family, stateKey]);
  const autoDistrict = (accessLevel === "DISTRICT" || accessLevel === "BLOCK") && districtOptions.length === 1 ? districtOptions[0].key : "";
  const districtKey = filters.district && districtOptions.some((d) => d.key === filters.district) ? filters.district : autoDistrict;

  const eff: InsightFilters = useMemo(() => ({ ...filters, family, state: stateKey, district: districtKey }), [filters, family, stateKey, districtKey]);
  const level = unitLevelFor(eff);
  const noun = UNIT_NOUN[level];
  const win = useMemo(() => resolveWindow(eff, now), [eff, now]);

  useEffect(() => {
    onScopeChange?.({ family, stateKey });
  }, [family, stateKey, onScopeChange]);

  const purposeOptions = useMemo(() => {
    const setOf = new Set<string>();
    for (const r of records) if (r.scoreFamily === family) setOf.add(r.purpose);
    return [...setOf].sort();
  }, [records, family]);

  const matching = useMemo(() => records.filter((r) => matchesInsightFilters(r, eff)), [records, eff]);
  const current = useMemo(() => matching.filter((r) => inWindow(r, win.fromMs, win.toMs)), [matching, win]);
  const previous = useMemo(
    () => (win.prevFromMs !== null ? matching.filter((r) => inWindow(r, win.prevFromMs, win.prevToMs)) : null),
    [matching, win],
  );
  const refMs = Math.min(now, win.toMs);
  const units = useMemo(() => buildUnits(current, level, refMs), [current, level, refMs]);
  const prevUnits = useMemo(() => (previous ? buildUnits(previous, level, win.prevToMs ?? refMs) : null), [previous, level, win, refMs]);
  // The score delta compares like with like: previous-window reviews made with the
  // scoring method the current window is (mostly) scored with.
  const prevScoreUnits = useMemo(() => {
    if (!previous) return null;
    const method = dominantMethod(units);
    return buildUnits(previous.filter((r) => r.methodVersion === method), level, win.prevToMs ?? refMs);
  }, [previous, units, level, win, refMs]);
  const pulse = useMemo(() => computePulse(current, previous, units, prevUnits, prevScoreUnits), [current, previous, units, prevUnits, prevScoreUnits]);
  const groups = useMemo(() => groupUnits(units, level), [units, level]);
  const profiles = useMemo(() => componentProfiles(units), [units]);
  const timeline = useMemo(() => buildTimeline(current, level, win), [current, level, win]);
  const moved = useMemo(() => movers(units, 7), [units]);
  const rereview = useMemo(() => reReviewEffect(units), [units]);
  const matrix = useMemo(() => buildMatrix(units, level, !stateKey, now), [units, level, stateKey, now]);
  const practice = useMemo(() => buildPractice(current), [current]);
  const takeaways = useMemo(() => buildTakeaways(pulse, units, profiles, rereview, level), [pulse, units, profiles, rereview, level]);
  const summaries = useMemo(() => {
    const { family: _ignored, ...rest } = eff;
    void _ignored;
    return familySummaries(records, rest, win);
  }, [records, eff, win]);

  const stateName = stateOptions.find((s) => s.key === stateKey)?.name ?? "";
  const districtName = districtOptions.find((d) => d.key === districtKey)?.name ?? "";
  const placeName = districtName || stateName || (accessLevel === "NATIONAL" ? "India" : "All areas");
  const canPickState = stateOptions.length > 1;
  const canPickDistrict = districtOptions.length > 1 || (districtOptions.length === 1 && !autoDistrict);

  const priorityTotal =
    eff.scope === "PRIORITY" && level === "district"
      ? stateKey
        ? priorityDistrictNames(stateName).length
        : PRIORITY_DISTRICT_TOTAL
      : null;

  const pickUnit = (u: Unit) => {
    if (level === "district") set({ state: u.stateKey, district: u.districtKey });
    else if (level === "state") set({ state: u.stateKey });
  };
  const canDrillUnit = level === "district";

  const filtersChanged =
    filters.preset !== DEFAULT_INSIGHT_FILTERS.preset || filters.scope !== "ALL" || filters.purpose !== "" || filters.method !== "all" || Boolean(filters.state) || Boolean(filters.district);

  // League table state
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: 1 });
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [matrixAll, setMatrixAll] = useState(false);
  const componentKeys = COMPONENT_KEYS.filter((k) => profiles.some((p) => p.key === k));
  const league = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? units.filter((u) => u.name.toLowerCase().includes(q) || u.parent.toLowerCase().includes(q)) : [...units];
    const value = (u: Unit): number | string => {
      switch (sort.key) {
        case "name": return u.name.toLowerCase();
        case "score": return u.score;
        case "change": return u.change ?? -Infinity;
        case "reviews": return u.reviews.length;
        case "daysSince": return u.daysSince;
        default: return u.latest[sort.key] ?? -Infinity;
      }
    };
    return list.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [units, query, sort]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "score" ? 1 : -1 }));
  const Th = ({ k, children, right }: { k: SortKey; children: ReactNode; right?: boolean }) => (
    <th className={`whitespace-nowrap px-2.5 py-2 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.1em] transition hover:text-slate-900 ${sort.key === k ? "text-slate-900" : "text-slate-500"}`}>
        {children}
        {sort.key === k ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
      </button>
    </th>
  );

  const downloadLeague = () => {
    const html = leagueXlsHtml(
      units,
      level,
      [
        `DQA Insights - ${SCORE_FAMILY_LABELS[family]} - ${placeName}`,
        `Period: ${win.label} (review date)${eff.scope === "PRIORITY" ? " | Gavi priority districts" : ""}${eff.method === "current" ? ` | scoring method v${SCORING_METHOD_VERSION} only` : ""}`,
        `Each ${noun.one} is described by its latest whole-${noun.one} review in the period.`,
      ],
      componentKeys,
    );
    const blob = new Blob([`<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DQA_Insights_${SCORE_FAMILY_LABELS[family].replace(/\W+/g, "_")}_${placeName.replace(/\W+/g, "_")}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const weeklyCounts = timeline.buckets.map((b) => b.reviews);
  const reShare = rereview.groups > 0 ? Math.round((rereview.improved / rereview.groups) * 100) : null;
  const actNowCount = units.filter((u) => u.daysSince > STALE_DAYS && u.score < GOOD_LINE).length;
  const visibleLeague = showAll ? league : league.slice(0, 15);
  const matrixLimit = matrixAll ? matrix.rows.length : 18;
  const hasUnits = units.length > 0;
  const blockNote = level === "block" && !hasUnits;

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-4 px-4 py-6 md:px-6">
      {/* ── Header ───────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            DQA Insights
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] tracking-[0.08em] text-blue-700 ring-1 ring-blue-200">New dashboard · preview</span>
          </div>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-8 tracking-tight text-slate-950">
            {placeName} <span className="text-slate-400">·</span> {SCORE_FAMILY_LABELS[family]} data quality
          </h1>
          <p className="mt-1 text-[13px] text-slate-600">
            {win.label} · {nf.format(pulse.reviews)} saved review{pulse.reviews === 1 ? "" : "s"} by {nf.format(pulse.reviewers)} reviewer{pulse.reviewers === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh ? (
            <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          ) : null}
          <button type="button" onClick={downloadLeague} disabled={!hasUnits} className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50">
            <Download className="h-4 w-4" /> Download table
          </button>
        </div>
      </header>

      {/* ── System selector: one scoring framework at a time ───────── */}
      {familiesPresent.length > 1 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${familiesPresent.length}, minmax(0, 1fr))` }}>
          {familiesPresent.map((f) => {
            const s = summaries.find((x) => x.family === f)!;
            const on = f === family;
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setFamilyTouched(true);
                  set({ family: f, district: f === "HMIS_STATE" ? "" : filters.district });
                }}
                aria-pressed={on}
                className={`rounded-2xl border px-4 py-3 text-left transition ${on ? "border-slate-900 bg-slate-900 text-white shadow-[0_8px_24px_rgba(15,23,42,0.18)]" : "border-slate-200 bg-white text-slate-900 hover:border-slate-400"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold">{SCORE_FAMILY_LABELS[f]}</span>
                  {s.medianScore !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tabular-nums">
                      <span className="inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: bandOf(s.medianScore)!.color }} />
                      {fmt1(s.medianScore)}
                    </span>
                  ) : null}
                </div>
                <div className={`mt-0.5 text-[12px] ${on ? "text-slate-300" : "text-slate-500"}`}>
                  {nf.format(s.reviews)} reviews · {nf.format(s.units)} {s.units === 1 ? UNIT_NOUN[s.level].one : UNIT_NOUN[s.level].many}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* ── Filters ──────────────────────────────── */}
      <div className="sticky top-0 z-20 -mx-1 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Reviews saved in</span>
            <div className="inline-flex h-9 rounded-lg border border-slate-300 bg-slate-50 p-0.5">
              {PRESETS.map((p) => (
                <button key={p.value} type="button" onClick={() => set({ preset: p.value })} aria-pressed={filters.preset === p.value} className={`rounded-md px-2.5 text-[12.5px] font-medium transition ${filters.preset === p.value ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {filters.preset === "custom" ? (
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">From</span>
                <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">To</span>
                <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className="h-9 rounded-lg border border-slate-300 px-2 text-[13px]" />
              </label>
            </div>
          ) : null}
          {canPickState ? (
            <Pick label="State" value={stateKey} onChange={(v) => set({ state: v, district: "" })}>
              <option value="">All states</option>
              {stateOptions.map((s) => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </Pick>
          ) : null}
          {family !== "HMIS_STATE" && canPickDistrict ? (
            <Pick label="District" value={districtKey} onChange={(v) => set({ state: stateKey, district: v })} disabled={!stateKey}>
              <option value="">{stateKey ? "All districts" : "Pick a state first"}</option>
              {districtOptions.map((d) => (
                <option key={d.key} value={d.key}>{d.name}</option>
              ))}
            </Pick>
          ) : null}
          {family !== "HMIS_STATE" ? (
            <Pick label="District group" value={filters.scope} onChange={(v) => set({ scope: v as InsightFilters["scope"] })}>
              <option value="ALL">All districts</option>
              <option value="PRIORITY">Gavi priority only</option>
            </Pick>
          ) : null}
          <Pick label="Review purpose" value={filters.purpose} onChange={(v) => set({ purpose: v })}>
            <option value="">All purposes</option>
            <option value={PROGRAMME_PURPOSES}>Programme reviews only</option>
            {purposeOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Pick>
          <Pick label="Scoring method" value={filters.method} onChange={(v) => set({ method: v as InsightFilters["method"] })}>
            <option value="all">All saved scores</option>
            <option value="current">Current method (v{SCORING_METHOD_VERSION}) only</option>
          </Pick>
          {filtersChanged ? (
            <button type="button" onClick={() => setFilters((c) => ({ ...DEFAULT_INSIGHT_FILTERS, family: c.family }))} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          ) : null}
        </div>
        {(stateKey && canPickState) || districtKey ? (
          <nav className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2.5 text-[12.5px]" aria-label="Drill path">
            <button type="button" className="font-medium text-blue-700 hover:underline disabled:text-slate-500 disabled:no-underline" disabled={!canPickState} onClick={() => set({ state: "", district: "" })}>
              {canPickState ? "All states" : stateName}
            </button>
            {canPickState ? (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                {districtKey && !autoDistrict ? (
                  <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => set({ district: "" })}>{stateName}</button>
                ) : (
                  <span className="font-semibold text-slate-900">{stateName}</span>
                )}
              </>
            ) : null}
            {districtKey ? (
              <>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-slate-900">{districtName}</span>
                <span className="ml-1 text-slate-500">· comparing its blocks</span>
              </>
            ) : (
              <span className="ml-1 text-slate-500">· comparing its districts</span>
            )}
          </nav>
        ) : null}
      </div>

      {current.length === 0 ? (
        <EmptyNote>No {SCORE_FAMILY_LABELS[family]} reviews match these filters. Widen the period or reset the filters.</EmptyNote>
      ) : (
        <>
          {/* ── Pulse ────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile
              label={`${noun.many} reviewed`}
              value={nf.format(pulse.units)}
              unit={priorityTotal ? `of ${priorityTotal}` : undefined}
              sub={priorityTotal ? `${Math.round((pulse.units / priorityTotal) * 100)}% of Gavi priority districts` : level === "district" && !stateKey ? `across ${pulse.states} state${pulse.states === 1 ? "" : "s"}` : `with a whole-${noun.one} review`}
              delta={<Delta now={pulse.units} before={pulse.prevUnits} unit="pct" goodWhen="up" vs={win.prevLabel} />}
            />
            <Tile
              label="Reviews saved"
              value={nf.format(pulse.reviews)}
              extra={<MiniBars values={weeklyCounts.slice(-16)} />}
              sub={`${nf.format(pulse.reviewers)} active reviewer${pulse.reviewers === 1 ? "" : "s"}`}
              delta={<Delta now={pulse.reviews} before={pulse.prevReviews} unit="pct" goodWhen="up" vs={win.prevLabel} />}
            />
            <Tile
              label={`Typical ${noun.one} score`}
              value={fmt1(pulse.medianScore)}
              sub={
                hasUnits ? (
                  <div className="space-y-1.5">
                    <BandBar counts={pulse.bandCounts} />
                    <div>Middle half {fmt1(pulse.p25)} – {fmt1(pulse.p75)}</div>
                  </div>
                ) : `No whole-${noun.one} review yet`
              }
              delta={<Delta now={pulse.medianScore} before={pulse.prevMedianScore} unit="pts" goodWhen="up" vs={win.prevLabel ? `${win.prevLabel}, same method` : null} />}
            />
            <Tile
              label="Below the Good line"
              value={nf.format(pulse.belowGood)}
              unit={hasUnits ? `of ${pulse.units}` : undefined}
              sub={hasUnits ? `${Math.round((pulse.belowGood / pulse.units) * 100)}% score under ${GOOD_LINE} · ${pulse.attention} under 50` : undefined}
            />
            <Tile
              label="Improved over time"
              value={pulse.repeatUnits > 0 ? nf.format(pulse.improved) : "—"}
              unit={pulse.repeatUnits > 0 ? `of ${pulse.repeatUnits}` : undefined}
              sub={pulse.repeatUnits > 0 ? `${pulse.declined} dropped · median change ${pulse.medianChange !== null ? signed1(pulse.medianChange) : "—"} · same scoring method` : `No ${noun.one} reviewed twice with one method yet`}
            />
            <Tile
              label="Review lag"
              value={pulse.medianLag !== null ? String(Math.round(pulse.medianLag)) : "—"}
              unit="days"
              sub="from the end of the data month to its review (median)"
              delta={<Delta now={pulse.medianLag} before={pulse.prevMedianLag} unit="days" goodWhen="down" vs={win.prevLabel} />}
            />
          </div>

          {/* ── Takeaways ────────────────────────────── */}
          {takeaways.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {takeaways.map((t) => (
                <div key={t.title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${t.tone === "good" ? "bg-[#184f95]" : t.tone === "watch" ? "bg-[#b3292e]" : "bg-slate-400"}`} />
                    <div>
                      <div className="text-[13.5px] font-semibold leading-5 text-slate-950">{t.title}</div>
                      <p className="mt-1 text-[12.5px] leading-[18px] text-slate-600">{t.text}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {blockNote ? (
            <EmptyNote>
              {gridsPending
                ? "Loading block scores…"
                : `No block scores for ${districtName} in this period. Block scores come from block reviews and from district reviews saved with a score grid (since 14 Oct 2026).`}
            </EmptyNote>
          ) : null}

          {hasUnits ? (
            <>
              {/* ── 1. How good is the data? ─────────────── */}
              <SectionHead index={1} question="How good is the data, and where is quality lost?" />
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
                <Card
                  title={`Where every ${noun.one} stands`}
                  subtitle={
                    <>
                      One dot per {noun.one}, placed at the score of its latest review. The black tick is the median
                      {groups.length > 1 ? " of each state; states are ordered best to weakest" : ""}.
                      {canDrillUnit ? " Click a dot to open its blocks." : ""}
                    </>
                  }
                >
                  <ScoreStripPlot groups={groups} level={level} onPick={canDrillUnit || level === "state" ? pickUnit : undefined} onPickGroup={level === "district" && groups.length > 1 ? (g) => set({ state: g.key, district: "" }) : undefined} />
                  <BandLegend className="mt-2" />
                </Card>
                <Card title="Where quality is lost" subtitle={`Spread of each score component across ${noun.many}: bar = middle half, line = 10th to 90th percentile, tick = median.`}>
                  {profiles.length > 0 ? (
                    <>
                      <ComponentProfileChart profiles={profiles} noun={noun.many} />
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <div className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                          {noun.many} under {GOOD_LINE} on each component
                        </div>
                        <div className="space-y-[7px]">
                          {[...profiles].sort((a, b) => b.belowGood / b.values.length - a.belowGood / a.values.length).map((p) => (
                            <div key={p.key} className="grid grid-cols-[104px_1fr_auto] items-center gap-2.5 text-[12.5px]">
                              <span className="text-slate-700">{p.label}</span>
                              <span className="block h-[10px] rounded-r-[4px] bg-slate-100">
                                <span className="block h-full rounded-r-[4px]" style={{ width: `${(p.belowGood / p.values.length) * 100}%`, minWidth: p.belowGood > 0 ? 2 : 0, background: BANDS[1].color }} />
                              </span>
                              <span className="min-w-[78px] text-right tabular-nums text-slate-900">
                                <span className="font-semibold">{p.belowGood}</span>
                                <span className="text-slate-500"> of {p.values.length}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-[11.5px] leading-[17px] text-slate-500">
                          A component is counted only where the latest review could score it.
                        </p>
                      </div>
                    </>
                  ) : (
                    <EmptyNote>No component scores saved.</EmptyNote>
                  )}
                </Card>
              </div>

              {/* ── 2. Where to act first ────────────────── */}
              <SectionHead index={2} question="Where should we act first?" />
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Card
                  title={`${actNowCount} ${actNowCount === 1 ? `${noun.one} needs` : `${noun.many} need`} follow-up now`}
                  subtitle={`Each ${noun.one} by its latest score and how long ago it was last reviewed. Red: under ${GOOD_LINE} and no review for more than ${STALE_DAYS} days.${units.some((u) => u.facilities) ? " Larger dot = more facilities." : ""}`}
                >
                  <PriorityMatrix units={units} level={level} onPick={canDrillUnit || level === "state" ? pickUnit : undefined} />
                </Card>
                <Card title="Biggest movers" subtitle={`Earliest and latest review in this period that share a scoring method, for ${noun.many} reviewed more than once.`}>
                  <MoversChart improved={moved.improved} declined={moved.declined} level={level} onPick={canDrillUnit || level === "state" ? pickUnit : undefined} />
                </Card>
              </div>

              {/* ── 3. Is it improving? ──────────────────── */}
              <SectionHead index={3} question="Is DQA being done regularly, and is it working?" />
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <Card
                  title="Score and review rhythm"
                  subtitle={`Blue line: median score of the ${noun.many} reviewed that ${timeline.grain}; shaded band: their middle half. Bars: reviews saved.`}
                >
                  <TrajectoryChart timeline={timeline} noun={noun.many} methodLabel={`scoring method v${SCORING_METHOD_VERSION}`} />
                </Card>
                <Card
                  title={reShare !== null ? `${reShare}% of re-checked data scored higher` : "Does a second review find better data?"}
                  subtitle={`When the same ${noun.one} and the same data months were reviewed again with the same scoring method (${nf.format(rereview.groups)} cases).`}
                >
                  {rereview.groups > 0 ? (
                    <>
                      <ReReviewChart data={rereview} />
                      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                        {[
                          { label: "Scored higher", value: rereview.improved },
                          { label: "No change", value: rereview.unchanged },
                          { label: "Scored lower", value: rereview.declined },
                        ].map((item) => (
                          <div key={item.label} className="rounded-xl bg-slate-50 px-2 py-2">
                            <div className="text-[17px] font-semibold tabular-nums text-slate-950">{item.value}</div>
                            <div className="text-[11px] text-slate-500">{item.label}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <EmptyNote>No data period has been reviewed twice in this selection.</EmptyNote>
                  )}
                </Card>
              </div>

              {/* ── 4. Coverage of data months ───────────── */}
              <SectionHead index={4} question="Which months of data have been checked?" />
              <Card
                title="Data months reviewed, and how they scored"
                subtitle="Each cell is one month of data: its score from the latest review that covered it. An empty cell means that month's data was never reviewed."
                action={gridsPending ? <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading month scores</span> : undefined}
              >
                {matrix.months.length > 0 ? (
                  <>
                    <MonthMatrix
                      matrix={matrix}
                      limit={matrixLimit}
                      onPickRow={matrix.rowLevel === "state" ? (row) => set({ state: row.stateKey, district: "" }) : matrix.rowLevel === "district" ? (row) => set({ state: row.stateKey, district: row.districtKey }) : undefined}
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <BandLegend />
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                          <span className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: `${BANDS[2].color}66` }} /> faded = whole-period score of a multi-month review
                        </span>
                      </div>
                      {matrix.rows.length > 18 ? (
                        <button type="button" onClick={() => setMatrixAll((v) => !v)} className="text-[12.5px] font-medium text-blue-700 hover:underline">
                          {matrixAll ? "Show fewer" : `Show all ${matrix.rows.length}`}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <EmptyNote>No usable data period was saved with these reviews.</EmptyNote>
                )}
              </Card>

              {/* ── 5. League table ──────────────────────── */}
              <SectionHead index={5} question={`Every ${noun.one}, side by side`} />
              <Card
                title={`${nf.format(units.length)} ${units.length === 1 ? noun.one : noun.many}`}
                subtitle="Latest whole-area review of each. Click a column to sort."
                action={
                  <label className="relative shrink-0">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find a ${noun.one}`} className="h-9 w-[190px] rounded-lg border border-slate-300 pl-8 pr-2 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  </label>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <Th k="name">{noun.one}</Th>
                        <Th k="score">Latest score</Th>
                        <th className="px-2.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">Review history</th>
                        <Th k="change" right>Change</Th>
                        {componentKeys.map((k) => (
                          <Th key={k} k={k} right>{COMPONENT_LABELS[k]}</Th>
                        ))}
                        <Th k="reviews" right>Reviews</Th>
                        <Th k="daysSince" right>Last review</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLeague.map((u) => {
                        const band = bandOf(u.score)!;
                        return (
                          <tr key={u.key} className={`border-b border-slate-100 transition hover:bg-slate-50 ${canDrillUnit ? "cursor-pointer" : ""}`} onClick={canDrillUnit ? () => pickUnit(u) : undefined}>
                            <td className="px-2.5 py-2">
                              <div className="font-medium text-slate-900">{u.name}</div>
                              {u.parent && (level === "block" || !stateKey) ? <div className="text-[11.5px] text-slate-500">{u.parent}</div> : null}
                            </td>
                            <td className="px-2.5 py-2">
                              <div className="flex items-center gap-2.5">
                                <span className="w-9 text-right font-semibold tabular-nums text-slate-950">{u.score.toFixed(1)}</span>
                                <span className="relative block h-[10px] w-[120px] rounded-r-[4px] bg-slate-100">
                                  <span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${u.score}%`, background: band.color }} />
                                  <span className="absolute inset-y-[-3px] w-px bg-slate-400" style={{ left: `${GOOD_LINE}%` }} />
                                </span>
                              </div>
                            </td>
                            <td className="px-2.5 py-1"><Sparkline values={u.reviews.map((r) => r.overall!)} /></td>
                            <td className="px-2.5 py-2 text-right tabular-nums">
                              {u.change === null ? (
                                <span className="text-slate-300">—</span>
                              ) : Math.abs(u.change) < 0.05 ? (
                                <span className="text-slate-500">0.0</span>
                              ) : (
                                <span className="font-medium text-slate-900">
                                  <span style={{ color: u.change > 0 ? "#2a78d6" : "#b3292e" }}>{u.change > 0 ? "▲" : "▼"}</span> {Math.abs(u.change).toFixed(1)}
                                </span>
                              )}
                            </td>
                            {componentKeys.map((k) => (
                              <td key={k} className="px-2.5 py-2 text-right"><ScoreCell value={u.latest[k]} /></td>
                            ))}
                            <td className="px-2.5 py-2 text-right tabular-nums text-slate-700">{u.reviews.length}</td>
                            <td className="px-2.5 py-2 text-right tabular-nums">
                              <span className={u.daysSince > STALE_DAYS ? "font-semibold text-[#b3292e]" : "text-slate-700"}>
                                {u.daysSince === 0 ? "today" : `${u.daysSince} d ago`}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {league.length === 0 ? <div className="py-6 text-center text-sm text-slate-500">Nothing matches “{query}”.</div> : null}
                {league.length > 15 ? (
                  <div className="pt-3 text-center">
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12.5px] font-medium text-blue-700 hover:underline">
                      {showAll ? "Show the first 15" : `Show all ${league.length}`}
                    </button>
                  </div>
                ) : null}
              </Card>
            </>
          ) : null}

          {/* ── 6. Practice ──────────────────────────── */}
          <SectionHead index={hasUnits ? 6 : 1} question="How are reviews being done?" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Why reviews are run" subtitle="Purpose recorded by the reviewer.">
              <CountBars rows={practice.purposes} total={current.length} />
            </Card>
            <Card title="How much data each review covers" subtitle="Months of data analysed in one review.">
              <CountBars rows={practice.depth} total={practice.lagKnown} />
            </Card>
            <Card title="How soon data is reviewed" subtitle="Days from the end of the data period to the review.">
              <CountBars rows={practice.lag} total={practice.lagKnown} />
            </Card>
          </div>

          <p className="px-1 pb-4 text-[11.5px] leading-[18px] text-slate-500">
            Scores are shown as saved{eff.method === "all" ? "; reviews saved under earlier scoring methods are included, so part of any change over time can come from the method change (switch Scoring method to compare like with like)" : ""}.
            {" "}A {noun.one}’s score always comes from a review of the whole {noun.one}
            {pulse.partialReviews > 0 ? `; ${nf.format(pulse.partialReviews)} partial-scope review${pulse.partialReviews === 1 ? " counts" : "s count"} as activity only` : ""}.
            {pulse.oddPeriods > 0 ? ` ${nf.format(pulse.oddPeriods)} review${pulse.oddPeriods === 1 ? " has" : "s have"} an implausible data period and ${pulse.oddPeriods === 1 ? "is" : "are"} left out of month-based views.` : ""}
          </p>
        </>
      )}
    </div>
  );
}

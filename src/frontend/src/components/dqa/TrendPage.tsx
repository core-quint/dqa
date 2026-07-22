import { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  Download,
  History,
  MapPin,
  RefreshCw,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { apiFetch } from "../../api";
import { canUseHmis, canUsePcts } from "../../lib/pcts/access";
import type { SnapshotDqaLevel, SnapshotRecord } from "../../lib/snapshots";
import { getSnapshotBlock, getSnapshotDqaLevel, normalizePortal } from "../../lib/snapshots";
import { GlassPanel } from "../branding/GlassPanel";
import type { AuthState } from "./LoginPage";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface Props {
  auth: AuthState;
  onBack: () => void;
  backLabel?: string;
  initialPortal?: TrendPortal;
}

type TrendPortal = "ALL" | "HMIS" | "UWIN" | "UWIN_STATE" | "HMIS_STATE" | "PCTS";
type Metric = "overall" | "availability" | "completeness" | "accuracy" | "consistency";
type Granularity = "ALL" | "DISTRICT" | "BLOCK";

interface TrendFilters {
  portal: TrendPortal;
  level: "ALL" | SnapshotDqaLevel;
  granularity: Granularity;
  state: string;
  district: string;
  block: string;
  dateFrom: string;
  dateTo: string;
}

const PORTALS = ["HMIS", "HMIS_STATE", "UWIN", "UWIN_STATE", "PCTS"] as const;
const PORTAL_META: Record<(typeof PORTALS)[number], { label: string; color: string; chip: string }> = {
  HMIS: { label: "HMIS", color: "#2563eb", chip: "bg-blue-100 text-blue-700" },
  HMIS_STATE: { label: "State DQA", color: "#059669", chip: "bg-emerald-100 text-emerald-700" },
  UWIN: { label: "U-WIN", color: "#a21caf", chip: "bg-fuchsia-100 text-fuchsia-700" },
  UWIN_STATE: { label: "U-WIN State", color: "#0891b2", chip: "bg-cyan-100 text-cyan-700" },
  PCTS: { label: "PCTS", color: "#e11d48", chip: "bg-rose-100 text-rose-700" },
};
const METRICS: Array<{ value: Metric; label: string }> = [
  { value: "overall", label: "Overall" },
  { value: "availability", label: "Availability" },
  { value: "completeness", label: "Completeness" },
  { value: "accuracy", label: "Accuracy" },
  { value: "consistency", label: "Consistency" },
];
const EMPTY_FILTERS: TrendFilters = {
  portal: "ALL",
  level: "ALL",
  granularity: "ALL",
  state: "",
  district: "",
  block: "",
  dateFrom: "",
  dateTo: "",
};
const selectClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200/70 disabled:bg-slate-50 disabled:text-slate-400";
const nf = new Intl.NumberFormat("en-IN");

function norm(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function titleGeo(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function monthKey(date: string) {
  const parsed = new Date(date);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

function nextMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextValue = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextValue).padStart(2, "0")}`;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function metricValue(snapshot: SnapshotRecord, metric: Metric): number | null {
  if (metric === "overall") return Number.isFinite(snapshot.overallScore) ? snapshot.overallScore : null;
  if (metric === "availability") return snapshot.kpiData?.availabilityScore ?? null;
  if (metric === "completeness") {
    if (["UWIN", "UWIN_STATE"].includes(normalizePortal(snapshot.portal))) return null;
    return snapshot.kpiData?.completenessScore ?? null;
  }
  if (metric === "accuracy") return snapshot.kpiData?.accuracyScore ?? null;
  return snapshot.kpiData?.consistencyScore ?? null;
}

function grade(score: number | null) {
  if (score === null) return { label: "No data", chip: "bg-slate-100 text-slate-500" };
  if (score >= 85) return { label: "Excellent", chip: "bg-emerald-100 text-emerald-700" };
  if (score >= 70) return { label: "Good", chip: "bg-sky-100 text-sky-700" };
  if (score >= 50) return { label: "Moderate", chip: "bg-amber-100 text-amber-700" };
  return { label: "Critical", chip: "bg-red-100 text-red-700" };
}

function portalBadge(snapshot: SnapshotRecord) {
  const portal = normalizePortal(snapshot.portal);
  const meta = PORTAL_META[portal];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${meta.chip}`}>{meta.label}</span>;
}

function levelLabel(snapshot: SnapshotRecord) {
  const level = getSnapshotDqaLevel(snapshot);
  if (level === "STATE") {
    const grain = snapshot.kpiData?.analysisGranularity;
    return grain ? `State · ${grain.toLowerCase()}-wise` : "State";
  }
  return level.charAt(0) + level.slice(1).toLowerCase();
}

function reviewUnit(snapshot: SnapshotRecord) {
  const level = getSnapshotDqaLevel(snapshot);
  const block = getSnapshotBlock(snapshot);
  if (level === "STATE") return titleGeo(snapshot.state) || "State-wide";
  if (level === "BLOCK") return block ? `${titleGeo(snapshot.district)} · ${titleGeo(block)}` : titleGeo(snapshot.district);
  return titleGeo(snapshot.district) || titleGeo(snapshot.state);
}

function comparisonKey(snapshot: SnapshotRecord) {
  return [
    normalizePortal(snapshot.portal),
    getSnapshotDqaLevel(snapshot),
    norm(snapshot.state),
    norm(snapshot.district),
    norm(getSnapshotBlock(snapshot)),
    snapshot.kpiData?.analysisGranularity ?? "",
  ].join("|");
}

function periodRange(days: number | "fy" | "all") {
  if (days === "all") return { from: "", to: "" };
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (days === "fy") {
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: `${year}-04-01`, to };
  }
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to };
}

function StatCard({ label, value, sub, tone = "slate" }: { label: string; value: string; sub: string; tone?: "slate" | "green" | "red" | "amber" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return <GlassPanel className="p-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div><div className={`mt-2 inline-flex rounded-xl px-2 py-1 text-3xl font-extrabold tabular-nums ${tones[tone]}`}>{value}</div><div className="mt-2 text-[11px] font-medium text-slate-500">{sub}</div></GlassPanel>;
}

export function TrendPage({ auth, onBack, backLabel = "Back", initialPortal = "ALL" }: Props) {
  const hasHmisAccess = canUseHmis(auth);
  const hasPctsAccess = canUsePcts(auth);
  const safeInitialPortal = (initialPortal === "HMIS" && !hasHmisAccess) || (initialPortal === "PCTS" && !hasPctsAccess) ? "ALL" : initialPortal;
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("overall");
  const [filters, setFilters] = useState<TrendFilters>({ ...EMPTY_FILTERS, portal: safeInitialPortal });
  const [activePreset, setActivePreset] = useState<"90" | "180" | "fy" | "all" | null>("all");

  async function fetchSnapshots() {
    try {
      setLoading(true);
      setLoadError("");
      const data: SnapshotRecord[] = await apiFetch("/api/snapshots");
      setSnapshots(data.filter((snapshot) => snapshot.createdAt).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    } catch {
      setLoadError("Trend history could not be loaded. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSnapshots(); }, []);

  const accessible = useMemo(() => snapshots.filter((snapshot) => {
    const portal = normalizePortal(snapshot.portal);
    return (hasHmisAccess || portal !== "HMIS") && (hasPctsAccess || portal !== "PCTS");
  }), [snapshots, hasHmisAccess, hasPctsAccess]);

  const stateOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const snapshot of accessible) if (snapshot.state) map.set(norm(snapshot.state), titleGeo(snapshot.state));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [accessible]);
  const districtOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const snapshot of accessible) {
      if (filters.state && norm(snapshot.state) !== filters.state) continue;
      if (getSnapshotDqaLevel(snapshot) === "STATE") continue;
      if (snapshot.district) map.set(norm(snapshot.district), titleGeo(snapshot.district));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [accessible, filters.state]);
  const blockOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const snapshot of accessible) {
      if (filters.state && norm(snapshot.state) !== filters.state) continue;
      if (filters.district && norm(snapshot.district) !== filters.district) continue;
      const block = getSnapshotBlock(snapshot);
      if (block) map.set(norm(block), titleGeo(block));
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [accessible, filters.state, filters.district]);

  const filtered = useMemo(() => accessible.filter((snapshot) => {
    const portal = normalizePortal(snapshot.portal);
    const level = getSnapshotDqaLevel(snapshot);
    if (filters.portal !== "ALL" && portal !== filters.portal) return false;
    if (filters.level !== "ALL" && level !== filters.level) return false;
    if (filters.granularity !== "ALL" && snapshot.kpiData?.analysisGranularity !== filters.granularity) return false;
    if (filters.state && norm(snapshot.state) !== filters.state) return false;
    if (filters.district && norm(snapshot.district) !== filters.district) return false;
    if (filters.block && norm(getSnapshotBlock(snapshot)) !== filters.block) return false;
    const time = new Date(snapshot.createdAt).getTime();
    if (filters.dateFrom && time < new Date(`${filters.dateFrom}T00:00:00`).getTime()) return false;
    if (filters.dateTo && time > new Date(`${filters.dateTo}T23:59:59.999`).getTime()) return false;
    return true;
  }), [accessible, filters]);

  const months = useMemo(() => {
    const observed = [...new Set(filtered.map((snapshot) => monthKey(snapshot.createdAt)))].sort();
    if (!observed.length) return [];
    const result: string[] = [];
    let cursor = observed[0];
    let guard = 0;
    while (cursor <= observed.at(-1)! && guard < 240) {
      result.push(cursor);
      cursor = nextMonth(cursor);
      guard += 1;
    }
    return result;
  }, [filtered]);
  const seriesPortals = filters.portal === "ALL" ? PORTALS.filter((portal) => filtered.some((snapshot) => normalizePortal(snapshot.portal) === portal)) : [filters.portal] as Exclude<TrendPortal, "ALL">[];
  const chartData = useMemo(() => ({
    labels: months.map(monthLabel),
    datasets: seriesPortals.map((portal) => {
      const meta = PORTAL_META[portal];
      return {
        label: meta.label,
        data: months.map((month) => mean(filtered.filter((snapshot) => normalizePortal(snapshot.portal) === portal && monthKey(snapshot.createdAt) === month).map((snapshot) => metricValue(snapshot, metric)).filter((value): value is number => value !== null))),
        borderColor: meta.color,
        backgroundColor: `${meta.color}18`,
        pointBackgroundColor: meta.color,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        borderWidth: 2.5,
        tension: 0.3,
        spanGaps: false,
        fill: seriesPortals.length === 1,
      };
    }),
  }), [filtered, metric, months, seriesPortals]);

  const chartOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    scales: {
      y: { min: 0, max: 100, grid: { color: "#e2e8f0" }, ticks: { stepSize: 20, color: "#64748b" } },
      x: { grid: { display: false }, ticks: { color: "#64748b", maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
    },
    plugins: {
      legend: { display: seriesPortals.length > 1, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: "#475569", font: { weight: 600 } } },
      tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.parsed.y?.toFixed(1) ?? "N/A"}` } },
    },
  };

  const periodComparison = useMemo(() => {
    const availableMonths = [...months].reverse().filter((month) => filtered.some((snapshot) => monthKey(snapshot.createdAt) === month && metricValue(snapshot, metric) !== null));
    const latestMonth = availableMonths[0] ?? null;
    const previousMonth = availableMonths[1] ?? null;
    const values = (month: string | null, component: Metric) => month ? filtered.filter((snapshot) => monthKey(snapshot.createdAt) === month).map((snapshot) => metricValue(snapshot, component)).filter((value): value is number => value !== null) : [];
    const current = mean(values(latestMonth, metric));
    const previous = mean(values(previousMonth, metric));
    const componentRows = METRICS.slice(1).map((component) => ({
      label: component.label,
      current: mean(values(latestMonth, component.value)),
      previous: mean(values(previousMonth, component.value)),
    }));
    return { latestMonth, previousMonth, current, previous, delta: current !== null && previous !== null ? current - previous : null, componentRows };
  }, [filtered, metric, months]);

  const regressions = useMemo(() => {
    const groups = new Map<string, SnapshotRecord[]>();
    for (const snapshot of filtered) {
      const list = groups.get(comparisonKey(snapshot)) ?? [];
      list.push(snapshot);
      groups.set(comparisonKey(snapshot), list);
    }
    return [...groups.values()].flatMap((list) => {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      const latest = list.at(-1);
      const previous = list.at(-2);
      const current = latest ? metricValue(latest, metric) : null;
      const before = previous ? metricValue(previous, metric) : null;
      if (!latest || !previous || current === null || before === null) return [];
      return [{ latest, previous, current, before, delta: current - before }];
    }).sort((a, b) => a.delta - b.delta);
  }, [filtered, metric]);

  const scores = filtered.map((snapshot) => metricValue(snapshot, metric)).filter((value): value is number => value !== null);
  const average = mean(scores);
  const critical = scores.filter((score) => score < 50).length;
  const improving = regressions.filter((row) => row.delta > 0).length;
  const declining = regressions.filter((row) => row.delta < 0).length;
  const latestAt = filtered.length ? Math.max(...filtered.map((snapshot) => new Date(snapshot.createdAt).getTime())) : null;
  const currentGrade = grade(periodComparison.current);
  const activeFilters = JSON.stringify(filters) !== JSON.stringify({ ...EMPTY_FILTERS, portal: safeInitialPortal });

  async function handleDelete(id: string) {
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;
    try {
      setDeletingId(id);
      await apiFetch(`/api/snapshots/${id}`, { method: "DELETE" });
      setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id));
    } catch {
      alert("Failed to delete snapshot.");
    } finally {
      setDeletingId(null);
    }
  }

  function downloadExcel() {
    const esc = (value: unknown) => String(value ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const headers = ["Date", "Portal", "DQA level", "State", "District / unit", "Period", "Designation", "Overall", "Availability", "Completeness", "Accuracy", "Consistency", "Saved by"];
    const rows = [...filtered].reverse().map((snapshot) => [
      formatDate(snapshot.createdAt), PORTAL_META[normalizePortal(snapshot.portal)].label, levelLabel(snapshot), titleGeo(snapshot.state), reviewUnit(snapshot), snapshot.reportingMonth, snapshot.kpiData?.designation ?? "-", snapshot.overallScore.toFixed(1), snapshot.kpiData?.availabilityScore?.toFixed(1) ?? "-", normalizePortal(snapshot.portal) === "UWIN" ? "N/A" : snapshot.kpiData?.completenessScore?.toFixed(1) ?? "-", snapshot.kpiData?.accuracyScore?.toFixed(1) ?? "-", snapshot.kpiData?.consistencyScore?.toFixed(1) ?? "-", snapshot.createdBy?.email ?? "-",
    ]);
    const html = `<table><tr><td colspan="${headers.length}">DQA Trend History · ${METRICS.find((item) => item.value === metric)?.label} · exported ${new Date().toLocaleString("en-IN")}</td></tr><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const url = URL.createObjectURL(new Blob([`<html><head><meta charset="UTF-8"></head><body>${html}</body></html>`], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DQA_Trend_${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5">
        <div className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#0f172a_0%,#172554_58%,#14532d_100%)] px-6 py-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15"><History className="h-5 w-5" /></div><div><div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">National monitoring workspace</div><h1 className="mt-1 text-2xl font-bold">DQA Trend History</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-white/65">Monthly quality movement, like-for-like review comparisons, and follow-up priorities across every accessible programme and geography.</p></div></div>
            <div className="flex gap-2"><button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold transition hover:bg-white/15"><ArrowLeft className="h-3.5 w-3.5" />{backLabel}</button><button onClick={fetchSnapshots} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold transition hover:bg-white/15 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button><button onClick={downloadExcel} disabled={!filtered.length} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-100 disabled:opacity-50"><Download className="h-3.5 w-3.5" />Excel</button></div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-4 text-[11px] font-semibold text-white/65"><span>{nf.format(filtered.length)} reviews in view</span><span>{nf.format(new Set(filtered.map((snapshot) => norm(snapshot.state))).size)} states</span><span>{nf.format(regressions.length)} like-for-like comparisons</span><span>Latest activity: {latestAt ? formatDate(new Date(latestAt).toISOString()) : "—"}</span></div>
        </div>

        <GlassPanel className="p-4">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Analysis controls</div><div className="mt-1 text-sm font-bold text-slate-900">Every visual and comparison follows this scope</div></div><div className="flex flex-wrap gap-1.5">{([{ id: "90", label: "90 days", value: 90 }, { id: "180", label: "6 months", value: 180 }, { id: "fy", label: "This FY", value: "fy" }, { id: "all", label: "All time", value: "all" }] as const).map((preset) => <button key={preset.id} type="button" onClick={() => { const range = periodRange(preset.value); setActivePreset(preset.id); setFilters((current) => ({ ...current, dateFrom: range.from, dateTo: range.to })); }} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${activePreset === preset.id ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{preset.label}</button>)}</div></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Metric</span><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)} className={selectClass}>{METRICS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Data source</span><select value={filters.portal} onChange={(event) => { const portal = event.target.value as TrendPortal; const statePortal = portal === "HMIS_STATE" || portal === "UWIN_STATE"; setFilters((current) => ({ ...current, portal, district: statePortal ? "" : current.district, block: statePortal ? "" : current.block })); }} className={selectClass}><option value="ALL">All sources</option>{hasHmisAccess ? <option value="HMIS">HMIS</option> : null}<option value="HMIS_STATE">State DQA</option><option value="UWIN">U-WIN</option><option value="UWIN_STATE">U-WIN State</option>{hasPctsAccess ? <option value="PCTS">PCTS</option> : null}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">DQA level</span><select value={filters.level} onChange={(event) => { const level = event.target.value as TrendFilters["level"]; setFilters((current) => ({ ...current, level, district: level === "STATE" ? "" : current.district, block: level === "STATE" ? "" : current.block })); }} className={selectClass}><option value="ALL">All levels</option><option value="STATE">State DQA</option><option value="DISTRICT">District DQA</option><option value="BLOCK">Block DQA</option></select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">State file grain</span><select value={filters.granularity} onChange={(event) => setFilters((current) => ({ ...current, granularity: event.target.value as Granularity }))} className={selectClass}><option value="ALL">District & block-wise</option><option value="DISTRICT">District-wise</option><option value="BLOCK">Block-wise</option></select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">State</span><select value={filters.state} onChange={(event) => setFilters((current) => ({ ...current, state: event.target.value, district: "", block: "" }))} className={selectClass}><option value="">All states</option>{stateOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">District</span><select value={filters.district} disabled={filters.level === "STATE" || filters.portal === "HMIS_STATE"} onChange={(event) => setFilters((current) => ({ ...current, district: event.target.value, block: "" }))} className={selectClass}><option value="">All districts</option>{districtOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Block</span><select value={filters.block} disabled={filters.level === "STATE" || filters.portal === "HMIS_STATE"} onChange={(event) => setFilters((current) => ({ ...current, block: event.target.value }))} className={selectClass}><option value="">All blocks</option>{blockOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <div className="flex items-end">{activeFilters || activePreset !== "all" ? <button type="button" onClick={() => { setFilters({ ...EMPTY_FILTERS, portal: safeInitialPortal }); setActivePreset("all"); }} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Clear filters</button> : <div className="pb-2.5 text-[11px] font-medium text-slate-400">Full accessible history</div>}</div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">From review date</span><input type="date" value={filters.dateFrom} onChange={(event) => { setActivePreset(null); setFilters((current) => ({ ...current, dateFrom: event.target.value })); }} className={selectClass} /></label><label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">To review date</span><input type="date" value={filters.dateTo} onChange={(event) => { setActivePreset(null); setFilters((current) => ({ ...current, dateTo: event.target.value })); }} className={selectClass} /></label></div>
        </GlassPanel>

        {loading ? <GlassPanel className="p-12 text-center text-sm font-bold uppercase tracking-[0.18em] text-slate-500">Loading trend history…</GlassPanel> : null}
        {!loading && loadError ? <GlassPanel className="p-10 text-center"><div className="font-bold text-red-600">{loadError}</div><button onClick={fetchSnapshots} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">Retry</button></GlassPanel> : null}

        {!loading && !loadError && filtered.length > 0 ? <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label={`Latest monthly ${METRICS.find((item) => item.value === metric)?.label}`} value={periodComparison.current?.toFixed(1) ?? "—"} sub={periodComparison.latestMonth ? monthLabel(periodComparison.latestMonth) : "No scored month"} tone={periodComparison.current !== null && periodComparison.current >= 70 ? "green" : "amber"} />
            <StatCard label="Change vs prior month" value={periodComparison.delta === null ? "—" : `${periodComparison.delta > 0 ? "+" : ""}${periodComparison.delta.toFixed(1)}`} sub={periodComparison.previousMonth ? `Compared with ${monthLabel(periodComparison.previousMonth)}` : "No earlier scored month"} tone={periodComparison.delta === null ? "slate" : periodComparison.delta < 0 ? "red" : "green"} />
            <StatCard label="Period average" value={average?.toFixed(1) ?? "—"} sub={`${nf.format(scores.length)} scored reviews`} />
            <StatCard label="Critical reviews" value={nf.format(critical)} sub="Scores below 50" tone={critical > 0 ? "red" : "green"} />
            <StatCard label="Comparable units" value={nf.format(regressions.length)} sub={`${improving} improving · ${declining} declining`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <GlassPanel className="p-5 lg:col-span-2">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Monthly movement</div><div className="mt-1 text-lg font-bold text-slate-950">Average {METRICS.find((item) => item.value === metric)?.label.toLowerCase()} score</div><p className="mt-1 text-[11px] text-slate-500">Separate source lines prevent unlike programmes from being blended into one trend.</p></div><span className={`rounded-full px-3 py-1 text-[11px] font-bold ${currentGrade.chip}`}>{currentGrade.label}</span></div>
              <div className="h-[330px]">{scores.length ? <Line data={chartData} options={chartOptions} /> : <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 px-6 text-center text-sm font-semibold text-slate-500">{metric === "completeness" && filters.portal === "UWIN" ? "Completeness is not part of the U-WIN DQA framework and is shown as unavailable—not zero." : "No scored values are available for this metric and scope."}</div>}</div>
            </GlassPanel>

            <GlassPanel className="p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Quality drivers</div><div className="mt-1 text-lg font-bold text-slate-950">Latest vs previous month</div><div className="mt-5 space-y-5">{periodComparison.componentRows.map((row) => {
                const delta = row.current !== null && row.previous !== null ? row.current - row.previous : null;
                return <div key={row.label}><div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-bold text-slate-700">{row.label}</span><span className={`text-xs font-extrabold tabular-nums ${delta === null ? "text-slate-400" : delta < 0 ? "text-red-600" : "text-emerald-600"}`}>{row.current?.toFixed(1) ?? "N/A"}{delta !== null ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(1)})` : ""}</span></div><div className="relative h-3 overflow-hidden rounded-full bg-slate-100">{row.previous !== null ? <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: `${Math.max(1, row.previous)}%` }} /> : null}{row.current !== null ? <div className="absolute inset-y-0 left-0 rounded-full bg-slate-900/80" style={{ width: `${Math.max(1, row.current)}%`, height: "55%", top: "22.5%" }} /> : null}</div></div>;
              })}</div><div className="mt-5 flex items-center gap-4 border-t border-slate-100 pt-3 text-[10px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-slate-900/80" />Latest</span><span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-slate-300" />Previous</span></div>
            </GlassPanel>
          </div>

          <GlassPanel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4"><div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Follow-up queue</div><div className="mt-1 text-lg font-bold text-slate-950">Largest like-for-like declines</div><p className="mt-1 text-[11px] text-slate-500">Only compares the same portal, DQA level, geography and State DQA file grain.</p></div><TrendingDown className="h-5 w-5 text-red-500" /></div>
            {regressions.filter((row) => row.delta < 0).length ? <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">{regressions.filter((row) => row.delta < 0).slice(0, 4).map((row) => <div key={row.latest.id} className="p-4"><div className="flex items-start justify-between gap-2">{portalBadge(row.latest)}<span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-extrabold tabular-nums text-red-700"><TrendingDown className="h-3 w-3" />{row.delta.toFixed(1)}</span></div><div className="mt-3 truncate text-sm font-bold text-slate-900" title={reviewUnit(row.latest)}>{reviewUnit(row.latest)}</div><div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3" />{titleGeo(row.latest.state)} · {levelLabel(row.latest)}</div><div className="mt-3 text-xs text-slate-600"><span className="font-bold tabular-nums text-slate-900">{row.before.toFixed(1)}</span><ChevronRight className="mx-1 inline h-3 w-3" /><span className="font-bold tabular-nums text-red-700">{row.current.toFixed(1)}</span></div><div className="mt-1 text-[10px] text-slate-400">{formatDate(row.previous.createdAt)} to {formatDate(row.latest.createdAt)}</div></div>)}</div> : regressions.length ? <div className="flex items-center gap-2 px-5 py-6 text-sm font-semibold text-emerald-700"><TrendingUp className="h-4 w-4" />No comparable unit declined in this filtered view.</div> : <div className="flex items-center gap-2 px-5 py-6 text-sm font-semibold text-slate-500"><CalendarClock className="h-4 w-4" />At least two scored reviews of the same unit are required for a like-for-like comparison.</div>}
          </GlassPanel>

          <GlassPanel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4"><div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Audit trail</div><div className="mt-1 text-lg font-bold text-slate-950">Saved review history</div></div><div className="text-xs font-semibold text-slate-500">{nf.format(filtered.length)} of {nf.format(accessible.length)} accessible records</div></div>
            <div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[1180px] text-sm"><thead className="sticky top-0 z-10"><tr className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500"><th className="px-4 py-3">Review date</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Level</th><th className="px-4 py-3">Geography</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Reviewed by</th>{METRICS.map((item) => <th key={item.value} className={`px-3 py-3 text-right ${metric === item.value ? "bg-slate-100 text-slate-900" : ""}`}>{item.label}</th>)}<th className="px-4 py-3">Saved by</th><th className="px-4 py-3 text-center">Action</th></tr></thead><tbody>{[...filtered].reverse().map((snapshot) => <tr key={snapshot.id} className="border-t border-slate-100 bg-white/50 transition hover:bg-white"><td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-700">{formatDate(snapshot.createdAt)}</td><td className="px-4 py-3">{portalBadge(snapshot)}</td><td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-600">{levelLabel(snapshot)}</td><td className="px-4 py-3"><div className="font-semibold text-slate-800">{reviewUnit(snapshot)}</div><div className="text-[10px] text-slate-400">{titleGeo(snapshot.state)}</div></td><td className="px-4 py-3 text-xs text-slate-500">{snapshot.reportingMonth}</td><td className="px-4 py-3 text-xs font-medium text-slate-600">{snapshot.kpiData?.designation ?? "—"}</td>{METRICS.map((item) => { const value = metricValue(snapshot, item.value); return <td key={item.value} className={`px-3 py-3 text-right font-bold tabular-nums ${metric === item.value ? "bg-slate-50 text-slate-950" : "text-slate-600"}`}>{value === null ? "N/A" : value.toFixed(1)}</td>; })}<td className="max-w-[180px] truncate px-4 py-3 text-xs text-slate-500" title={snapshot.createdBy?.email ?? ""}>{snapshot.createdBy?.email ?? "—"}</td><td className="px-4 py-3 text-center">{snapshot.canDelete ? <button type="button" onClick={() => handleDelete(snapshot.id)} disabled={deletingId === snapshot.id} className="rounded-xl p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50" title="Delete snapshot"><Trash2 className="h-4 w-4" /></button> : <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Read only</span>}</td></tr>)}</tbody></table></div>
          </GlassPanel>
        </> : null}

        {!loading && !loadError && filtered.length === 0 ? <GlassPanel className="p-12 text-center"><AlertTriangle className="mx-auto h-7 w-7 text-amber-500" /><div className="mt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">No matching history</div><div className="mt-2 text-2xl font-extrabold text-slate-950">{accessible.length ? "Adjust the filters to restore a trend." : "Save a DQA snapshot to begin trend monitoring."}</div><div className="mx-auto mt-2 max-w-xl text-sm text-slate-500">Trend lines require scored reviews. U-WIN completeness is treated as unavailable, never as zero.</div></GlassPanel> : null}
      </div>
    </div>
  );
}

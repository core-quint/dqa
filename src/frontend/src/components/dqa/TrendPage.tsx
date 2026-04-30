import { useEffect, useState, useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  type ChartOptions,
} from "chart.js";
import { ArrowLeft, Download, Trash2, TrendingUp } from "lucide-react";
import { API_BASE } from "../../config";
import { GlassPanel } from "../branding/GlassPanel";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

interface Snapshot {
  id: string;
  state: string;
  district: string;
  reportingMonth: string;
  overallScore: number;
  createdAt: string;
  portal?: string;
  canDelete?: boolean;
  createdBy?: {
    id: string;
    email: string;
    level: string;
    geoState: string | null;
    geoDistrict: string | null;
    geoBlock: string | null;
  } | null;
  kpiData: {
    availabilityScore: number;
    completenessScore?: number;
    accuracyScore: number;
    consistencyScore: number;
  };
}

interface Props {
  onBack: () => void;
  backLabel?: string;
  authEmail?: string;
  initialPortal?: "ALL" | "HMIS" | "UWIN";
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getGrade(score: number) {
  if (score >= 85) return { label: "Excellent", color: "bg-emerald-100 text-emerald-700" };
  if (score >= 70) return { label: "Good", color: "bg-sky-100 text-sky-700" };
  if (score >= 50) return { label: "Moderate", color: "bg-amber-100 text-amber-700" };
  return { label: "Needs attention", color: "bg-red-100 text-red-700" };
}

function getComponentScore(snapshot: Snapshot | undefined, filter: string): number {
  if (!snapshot) return 0;
  if (filter === "overall") return snapshot.overallScore ?? 0;
  return (snapshot.kpiData as any)?.[`${filter}Score`] ?? 0;
}

function portalBadge(portal?: string) {
  const normalized = portal?.toUpperCase() ?? "HMIS";
  const isUwin = normalized === "UWIN";
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
        isUwin ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"
      }`}
    >
      {isUwin ? "U-WIN" : "HMIS"}
    </span>
  );
}

export function TrendPage({
  onBack,
  backLabel = "Back",
  initialPortal = "ALL",
}: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [componentFilter, setComponentFilter] = useState<
    "overall" | "availability" | "completeness" | "accuracy" | "consistency"
  >("overall");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [portalFilter, setPortalFilter] = useState<"ALL" | "HMIS" | "UWIN">(
    initialPortal,
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetchSnapshots();
  }, []);

  async function fetchSnapshots() {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/snapshots`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data: Snapshot[] = await response.json();
      setSnapshots(
        data.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
    } catch {
      console.error("Failed to fetch snapshots");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const response = await fetch(`${API_BASE}/api/snapshots/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!response.ok) throw new Error();
      setSnapshots((prev) => prev.filter((snapshot) => snapshot.id !== id));
    } catch {
      alert("Failed to delete snapshot.");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    return snapshots.filter((snapshot) => {
      if (portalFilter !== "ALL") {
        const currentPortal = snapshot.portal?.toUpperCase() ?? "HMIS";
        if (currentPortal !== portalFilter) return false;
      }
      const timeValue = new Date(snapshot.createdAt).getTime();
      if (dateFrom && timeValue < new Date(dateFrom).getTime()) return false;
      if (dateTo) {
        const toEnd = new Date(dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (timeValue > toEnd.getTime()) return false;
      }
      return true;
    });
  }, [snapshots, portalFilter, dateFrom, dateTo]);

  function handleDownloadExcel() {
    const headers = [
      "Date",
      "Saved By",
      "State",
      "District",
      "Duration",
      "Portal",
      "Overall",
      "Availability",
      "Completeness",
      "Accuracy",
      "Consistency",
    ];

    const rows = [...filtered].reverse().map((snapshot) => [
      formatDate(snapshot.createdAt),
      snapshot.createdBy?.email ?? "-",
      snapshot.state,
      snapshot.district,
      snapshot.reportingMonth,
      (snapshot.portal?.toUpperCase() ?? "HMIS") === "UWIN" ? "U-WIN" : "HMIS",
      snapshot.overallScore.toFixed(1),
      snapshot.kpiData?.availabilityScore?.toFixed(1) ?? "-",
      snapshot.kpiData?.completenessScore !== undefined
        ? snapshot.kpiData.completenessScore.toFixed(1)
        : "-",
      snapshot.kpiData?.accuracyScore?.toFixed(1) ?? "-",
      snapshot.kpiData?.consistencyScore?.toFixed(1) ?? "-",
    ]);

    const tableHtml = `
      <table>
        <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
        <tbody>${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
          .join("")}</tbody>
      </table>`;

    const blob = new Blob(
      [`<html><head><meta charset="UTF-8"></head><body>${tableHtml}</body></html>`],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DQA_Trend_${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const chartDataValues = useMemo(
    () => filtered.map((snapshot) => getComponentScore(snapshot, componentFilter)),
    [filtered, componentFilter],
  );

  const labels = filtered.map((snapshot) => formatDate(snapshot.createdAt));
  const latest = filtered.at(-1);
  const previous = filtered.at(-2);
  const latestScore = getComponentScore(latest, componentFilter);
  const delta = latestScore - getComponentScore(previous, componentFilter);
  const grade = getGrade(latestScore);

  const chartData = {
    labels,
    datasets: [
      {
        label: componentFilter.charAt(0).toUpperCase() + componentFilter.slice(1),
        data: chartDataValues,
        borderColor: "#0f172a",
        backgroundColor: "rgba(15,23,42,0.08)",
        tension: 0.35,
        fill: true,
        pointBackgroundColor: "#14532d",
        pointRadius: 4,
      },
    ],
  };

  const chartOptions: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        max: 100,
      },
    },
    plugins: {
      legend: {
        display: false,
      },
    },
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">Trend History</h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {backLabel}
              </button>
              <button
                onClick={handleDownloadExcel}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download Excel
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-xs text-slate-500">
              Records: <strong className="font-semibold text-slate-700">{filtered.length}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Metric: <strong className="font-semibold text-slate-700 capitalize">{componentFilter}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Latest score: <strong className="font-semibold text-slate-700">{filtered.length > 0 ? latestScore.toFixed(1) : "—"}</strong>
            </span>
            <span className={`text-[11px] font-semibold ${grade.color} rounded-full px-2 py-0.5`}>
              {grade.label}
            </span>
          </div>
        </div>

        <GlassPanel className="p-5">
          <div className="grid gap-4 md:grid-cols-5">
            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Component
              </span>
              <select
                value={componentFilter}
                onChange={(event) =>
                  setComponentFilter(event.target.value as typeof componentFilter)
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              >
                <option value="overall">Overall</option>
                <option value="availability">Availability</option>
                <option value="completeness">Completeness</option>
                <option value="accuracy">Accuracy</option>
                <option value="consistency">Consistency</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Portal
              </span>
              <select
                value={portalFilter}
                onChange={(event) =>
                  setPortalFilter(event.target.value as typeof portalFilter)
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              >
                <option value="ALL">All portals</option>
                <option value="HMIS">HMIS</option>
                <option value="UWIN">U-WIN</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                From
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                To
              </span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
              />
            </label>

            <div className="flex items-end">
              {(portalFilter !== "ALL" || dateFrom || dateTo) ? (
                <button
                  onClick={() => {
                    setPortalFilter("ALL");
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
                >
                  Clear filters
                </button>
              ) : (
                <div className="text-sm font-medium text-slate-500">
                  Narrow the history with portal and date filters.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-slate-50/90 px-4 py-3 text-sm font-medium text-slate-600">
            Records follow your geographic access. You can delete only the snapshots you created.
          </div>
        </GlassPanel>

        {loading ? (
          <GlassPanel className="p-10 text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Loading analytics...
            </div>
          </GlassPanel>
        ) : null}

        {!loading && filtered.length > 0 ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <GlassPanel className="p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Latest score
                </div>
                <div className="mt-2 text-4xl font-extrabold text-slate-950">
                  {latestScore.toFixed(1)}
                </div>
              </GlassPanel>

              <GlassPanel className="p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Change from previous
                </div>
                <div
                  className={`mt-2 text-4xl font-extrabold ${
                    delta > 0
                      ? "text-emerald-600"
                      : delta < 0
                        ? "text-red-600"
                        : "text-slate-400"
                  }`}
                >
                  {delta > 0 ? "+" : delta < 0 ? "-" : ""}
                  {Math.abs(delta).toFixed(1)}
                </div>
              </GlassPanel>

              <GlassPanel className="p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Performance grade
                </div>
                <div
                  className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold uppercase tracking-[0.14em] ${grade.color}`}
                >
                  {grade.label}
                </div>
              </GlassPanel>
            </div>

            <GlassPanel className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-slate-500" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Trend line
                </div>
              </div>
              <div style={{ height: 320 }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            </GlassPanel>

            <GlassPanel className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-5 py-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Snapshot history
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-950">
                    Saved review runs
                  </div>
                </div>
                <div className="text-sm font-medium text-slate-500">
                  {filtered.length} record{filtered.length !== 1 ? "s" : ""}
                  {filtered.length !== snapshots.length
                    ? ` (${snapshots.length} total)`
                    : ""}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/60 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Portal</th>
                      <th className="px-4 py-3">Saved by</th>
                      <th className="px-4 py-3">State</th>
                      <th className="px-4 py-3">District</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3 text-right">Overall</th>
                      <th className="px-4 py-3 text-right">Avail.</th>
                      <th className="px-4 py-3 text-right">Compl.</th>
                      <th className="px-4 py-3 text-right">Accur.</th>
                      <th className="px-4 py-3 text-right">Consis.</th>
                      <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...filtered].reverse().map((snapshot) => (
                      <tr
                        key={snapshot.id}
                        className="border-t border-white/80 bg-white/50 transition hover:bg-white/80"
                      >
                        <td className="px-4 py-3 font-medium text-slate-700">
                          {formatDate(snapshot.createdAt)}
                        </td>
                        <td className="px-4 py-3">{portalBadge(snapshot.portal)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-700">
                            {snapshot.createdBy?.email ?? "-"}
                          </div>
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                            {snapshot.createdBy?.level ?? ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{snapshot.state}</td>
                        <td className="px-4 py-3 text-slate-700">{snapshot.district}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {snapshot.reportingMonth}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">
                          {snapshot.overallScore.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right text-sky-700">
                          {snapshot.kpiData?.availabilityScore?.toFixed(1) ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-indigo-700">
                          {snapshot.kpiData?.completenessScore !== undefined
                            ? snapshot.kpiData.completenessScore.toFixed(1)
                            : "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-amber-700">
                          {snapshot.kpiData?.accuracyScore?.toFixed(1) ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-700">
                          {snapshot.kpiData?.consistencyScore?.toFixed(1) ?? "-"}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {snapshot.canDelete ? (
                            <button
                              onClick={() => handleDelete(snapshot.id)}
                              disabled={deletingId === snapshot.id}
                              className="rounded-2xl p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Delete snapshot"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                              Read only
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          </>
        ) : null}

        {!loading && filtered.length === 0 ? (
          <GlassPanel className="p-12 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              No matching records
            </div>
            <div className="mt-2 font-display text-3xl font-extrabold text-slate-950">
              {snapshots.length === 0
                ? "No snapshots have been saved yet."
                : "No snapshots match the selected filters."}
            </div>
          </GlassPanel>
        ) : null}
      </div>
    </div>
  );
}

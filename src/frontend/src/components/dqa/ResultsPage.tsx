import { useState, useMemo, useCallback, useEffect } from "react";
import { Award, Save, TrendingUp, RefreshCw } from "lucide-react";
import type {
  ParsedCSV,
  FilterState,
  ComputedKpis,
  KpiCard,
  ActiveGroup,
} from "../../lib/dqa/types";
import { computeKpis } from "../../lib/dqa/computeKpis";
import { monthsSpanInclusive } from "../../lib/dqa/parseUtils";
import { DEFAULT_FILTERS } from "../../lib/dqa/constants";
import { FilterPanel } from "./FilterPanel";
import { KpiCard as KpiCardCmp } from "./KpiCard";
import { KpiPanel } from "./KpiPanel";
import { CollapsibleFilterRail } from "./CollapsibleFilterRail";
import { OverallScore } from "./OverallScore";
import { API_BASE } from "../../config";
import { computeOverallScore, scoreBadgeStyle } from "../../lib/dqa/scoreUtils";
import { buildSnapshotSaveMeta } from "../../lib/snapshots";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { GlassPanel } from "../branding/GlassPanel";
import type { AuthState } from "./LoginPage";

interface Props {
  csv: ParsedCSV;
  onReset: () => void;
  onTrend: () => void;
  auth: AuthState;
  activeGroup: ActiveGroup | "";
  onGroupChange: (g: ActiveGroup) => void;
}

const GROUP_META: Record<
  Exclude<ActiveGroup, "">,
  {
    label: string;
    color: string;
    surface: string;
    soft: string;
    chip: string;
    text: string;
    bar: string;
    ring: string;
  }
> = {
  availability: {
    label: "Availability",
    color: "#ef4444",
    surface: "#fff1f2",
    soft: "#fef2f2",
    chip: "bg-red-100",
    text: "text-red-700",
    bar: "bg-red-500",
    ring: "ring-red-200",
  },
  completeness: {
    label: "Completeness",
    color: "#6366f1",
    surface: "#eef2ff",
    soft: "#eef2ff",
    chip: "bg-indigo-100",
    text: "text-indigo-700",
    bar: "bg-indigo-500",
    ring: "ring-indigo-200",
  },
  accuracy: {
    label: "Accuracy",
    color: "#f59e0b",
    surface: "#fffbeb",
    soft: "#fff7ed",
    chip: "bg-amber-100",
    text: "text-amber-700",
    bar: "bg-amber-500",
    ring: "ring-amber-200",
  },
  consistency: {
    label: "Consistency",
    color: "#22c55e",
    surface: "#f0fdf4",
    soft: "#f0fdf4",
    chip: "bg-emerald-100",
    text: "text-emerald-700",
    bar: "bg-emerald-500",
    ring: "ring-emerald-200",
  },
};

const TABS: Exclude<ActiveGroup, "">[] = [
  "availability",
  "completeness",
  "accuracy",
  "consistency",
];

const primaryActionClass =
  "inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800";

const secondaryActionClass =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";

export function ResultsPage({
  csv,
  onReset,
  onTrend,
  auth,
  activeGroup,
  onGroupChange,
}: Props) {
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [kpis, setKpis] = useState<ComputedKpis | null>(() =>
    activeGroup
      ? computeKpis(csv, { ...DEFAULT_FILTERS, activeGroup })
      : null,
  );
  const [showOverall, setShowOverall] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drawerCard, setDrawerCard] = useState<KpiCard | null>(null);
  const [lastSnapshot, setLastSnapshot] = useState<{
    createdAt: string;
    availabilityScore: number;
    completenessScore: number;
    accuracyScore: number;
    consistencyScore: number;
    overallScore: number;
  } | null>(null);

  const durationStr = useMemo(() => {
    const months = Object.keys(csv.allMonths).sort();
    if (!months.length) return "-";
    const min = months[0];
    const max = months[months.length - 1];
    const span = monthsSpanInclusive(min, max);
    if (!span) return "-";
    return `${span} month${span > 1 ? "s" : ""}`;
  }, [csv]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    fetch(`${API_BASE}/api/snapshots`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((snapshots: any[]) => {
        const match = snapshots.find(
          (snapshot) =>
            (snapshot.portal?.toUpperCase() ?? "HMIS") === "HMIS" &&
            snapshot.state === csv.stateName &&
            snapshot.district === csv.distName &&
            snapshot.reportingMonth === durationStr,
        );
        if (match) {
          setLastSnapshot({
            createdAt: match.createdAt,
            overallScore: match.overallScore,
            availabilityScore: match.kpiData?.availabilityScore ?? 0,
            completenessScore: match.kpiData?.completenessScore ?? 0,
            accuracyScore: match.kpiData?.accuracyScore ?? 0,
            consistencyScore: match.kpiData?.consistencyScore ?? 0,
          });
        }
      })
      .catch(() => {});
  }, [csv.stateName, csv.distName, durationStr]);

  useEffect(() => {
    if (!activeGroup) {
      setKpis(null);
      return;
    }

    const result = computeKpis(csv, { ...filters, activeGroup });
    setKpis(result);
    setSaved(false);
  }, [activeGroup, csv, filters]);

  const handleApply = useCallback(
    (nextFilters: FilterState) => {
      setFilters(nextFilters);
    },
    [],
  );

  const handleSave = async () => {
    if (!kpis) return;
    try {
      setSaving(true);
      const token = localStorage.getItem("token");
      const { overall, components } = computeOverallScore(kpis);
      const snapshotMeta = buildSnapshotSaveMeta(auth, filters, csv.allMonths);
      const response = await fetch(`${API_BASE}/api/snapshots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          portal: "HMIS",
          state: csv.stateName,
          district: csv.distName,
          duration: durationStr,
          overallScore: overall,
          availabilityScore: components.availability?.score ?? 0,
          completenessScore: components.completeness?.score ?? 0,
          accuracyScore: components.accuracy?.score ?? 0,
          consistencyScore: components.consistency?.score ?? 0,
          dqaLevel: snapshotMeta.dqaLevel,
          block: snapshotMeta.block,
          periodStart: snapshotMeta.periodStart,
          periodEnd: snapshotMeta.periodEnd,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Save failed");
      }
      const savedSnapshot = await response.json();
      setLastSnapshot({
        createdAt: savedSnapshot.createdAt,
        overallScore: savedSnapshot.overallScore,
        availabilityScore: savedSnapshot.kpiData?.availabilityScore ?? 0,
        completenessScore: savedSnapshot.kpiData?.completenessScore ?? 0,
        accuracyScore: savedSnapshot.kpiData?.accuracyScore ?? 0,
        consistencyScore: savedSnapshot.kpiData?.consistencyScore ?? 0,
      });
      setSaved(true);
    } catch {
      alert("Failed to save snapshot");
    } finally {
      setSaving(false);
    }
  };

  const meta = activeGroup ? GROUP_META[activeGroup] : null;
  const groupCards =
    kpis && activeGroup
      ? kpis.cards.filter((card) => card.group === activeGroup)
      : [];
  const totalFacilities = kpis
    ? Math.max(1, Object.keys(kpis.filteredFacilities).length)
    : 0;

  function severityBadge(pct: number) {
    if (pct >= 50) {
      return { bg: "bg-red-100", text: "text-red-700", label: "High" };
    }
    if (pct >= 25) {
      return { bg: "bg-amber-100", text: "text-amber-700", label: "Medium" };
    }
    return { bg: "bg-emerald-100", text: "text-emerald-700", label: "Low" };
  }

  const contextStats = [
    { label: "Program", value: "HMIS" },
    { label: "State", value: csv.stateName || "-" },
    { label: "District", value: csv.distName || "-" },
    { label: "Duration", value: durationStr },
    { label: "Blocks", value: String(csv.globalBlockCount) },
    { label: "Facilities", value: String(csv.globalFacilityCount) },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      {showOverall && kpis ? (
        <OverallScore
          kpis={kpis}
          csv={csv}
          onClose={() => setShowOverall(false)}
        />
      ) : null}

      <Sheet
        open={Boolean(drawerCard)}
        onOpenChange={(open) => !open && setDrawerCard(null)}
      >
        <SheetContent
          side="right"
          className="flex w-[min(760px,94vw)] flex-col overflow-hidden border-l border-white/70 bg-[linear-gradient(180deg,rgba(246,242,233,0.98),rgba(255,255,255,0.96))] p-0 backdrop-blur-xl sm:max-w-[760px]"
        >
          <SheetHeader className="border-b border-white/70 px-5 py-4">
            <SheetTitle className="text-left text-base font-bold text-slate-950">
              {drawerCard?.name}
            </SheetTitle>
            {drawerCard && meta ? (
              <span
                className="mt-2 inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{ background: meta.surface, color: meta.color }}
              >
                {meta.label}
              </span>
            ) : null}
          </SheetHeader>
          {drawerCard && kpis ? (
            <div className="flex-1 overflow-hidden p-4">
              <KpiPanel card={drawerCard} kpis={kpis} csv={csv} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <div className="space-y-5">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">HMIS Analysis</h1>
            <div className="flex flex-wrap items-center gap-2">
              {kpis ? (
                <button onClick={() => setShowOverall(true)} className={primaryActionClass}>
                  <Award className="h-3.5 w-3.5" />
                  Overall score
                </button>
              ) : null}
              {kpis ? (
                <button
                  onClick={handleSave}
                  disabled={saving || saved}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving…" : saved ? "Saved" : "Save snapshot"}
                </button>
              ) : null}
              <button onClick={onTrend} className={secondaryActionClass}>
                <TrendingUp className="h-3.5 w-3.5" />
                Trends
              </button>
              <button onClick={onReset} className={secondaryActionClass}>
                <RefreshCw className="h-3.5 w-3.5" />
                Reset
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            {contextStats.map((stat) => (
              <span key={stat.label} className="text-xs text-slate-500">
                {stat.label}: <strong className="font-semibold text-slate-700">{stat.value}</strong>
              </span>
            ))}
            <span className="text-xs text-slate-500">
              Public/Private: <strong className="font-semibold text-slate-700">{csv.publicCount}/{csv.privateCount}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Rural/Urban: <strong className="font-semibold text-slate-700">{csv.ruralCount}/{csv.urbanCount}</strong>
            </span>
            {lastSnapshot ? (
              <>
                <span className="text-xs text-slate-500">
                  Last saved: <strong className="font-semibold text-slate-700">{new Date(lastSnapshot.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</strong>
                </span>
                {([
                  { label: "Overall", score: lastSnapshot.overallScore, style: scoreBadgeStyle(lastSnapshot.overallScore) },
                  { label: "Avail", score: lastSnapshot.availabilityScore, style: { bg: "#fff1f2", text: "#b91c1c" } },
                  { label: "Compl", score: lastSnapshot.completenessScore, style: { bg: "#eef2ff", text: "#4338ca" } },
                  { label: "Accur", score: lastSnapshot.accuracyScore, style: { bg: "#fffbeb", text: "#92400e" } },
                  { label: "Consis", score: lastSnapshot.consistencyScore, style: { bg: "#f0fdf4", text: "#15803d" } },
                ] as const).map(({ label, score, style }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: style.bg, color: style.text }}
                  >
                    {label}: {Math.round(score)}
                  </span>
                ))}
              </>
            ) : null}
          </div>
        </div>

        <GlassPanel className="p-2">
          <div className="flex flex-wrap gap-2">
            {TABS.map((group) => {
              const groupMeta = GROUP_META[group];
              const isActive = activeGroup === group;

              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => onGroupChange(group)}
                  className={[
                    "inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition",
                    isActive
                      ? "bg-slate-950 text-white shadow-[0_18px_30px_rgba(15,23,42,0.18)]"
                      : "bg-white/70 text-slate-600 hover:bg-white hover:text-slate-950",
                  ].join(" ")}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: groupMeta.color }}
                  />
                  {groupMeta.label}
                </button>
              );
            })}
          </div>
        </GlassPanel>

        {activeGroup ? (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <CollapsibleFilterRail>
              <FilterPanel
                csv={csv}
                filters={filters}
                activeGroup={activeGroup}
                onApply={handleApply}
                layout="rail"
              />
            </CollapsibleFilterRail>

            <div className="min-w-0 flex-1 space-y-5">
              {kpis && meta
                ? (() => {
                    const sortedCards = [...groupCards].sort(
                      (a, b) => b.stat.total - a.stat.total,
                    );
                    const maxAffected = sortedCards[0]?.stat.total ?? 0;
                    const worstPct = Math.round(
                      (maxAffected / totalFacilities) * 100,
                    );
                    const affectedUnique = new Set(
                      sortedCards.flatMap((card) => [...card.stat.facilityKeys]),
                    ).size;

                    return (
                      <div
                        className={`overflow-hidden rounded-[30px] ring-1 ${meta.ring}`}
                        style={{
                          background: `linear-gradient(140deg, ${meta.surface}, rgba(255,255,255,0.82))`,
                        }}
                      >
                        <div
                          className="flex flex-wrap items-center gap-3 px-5 py-4 text-white"
                          style={{ background: meta.color }}
                        >
                          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/72">
                            Indicator summary
                          </span>
                          <span className="text-sm font-bold">{meta.label}</span>
                          <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                            {Object.keys(csv.allMonths).length} months /{" "}
                            {totalFacilities} facilities
                          </span>
                        </div>

                        <div className="grid gap-px bg-white/50 sm:grid-cols-3">
                          {[
                            {
                              label: "Worst impact",
                              value: `${worstPct}%`,
                              sub: "facilities affected",
                            },
                            {
                              label: "Unique affected",
                              value: String(affectedUnique),
                              sub: `of ${totalFacilities} facilities`,
                            },
                            {
                              label: "Indicators",
                              value: String(sortedCards.length),
                              sub: "in this component",
                            },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="bg-white/72 px-5 py-4 text-center"
                            >
                              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {item.label}
                              </div>
                              <div className="mt-2 text-3xl font-extrabold text-slate-950">
                                {item.value}
                              </div>
                              <div className="mt-1 text-xs font-medium text-slate-500">
                                {item.sub}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="p-4 md:p-5">
                          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                            Indicators ranked by impact
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            {sortedCards.map((card, index) => {
                              const pct = Math.round(
                                (card.stat.total / totalFacilities) * 100,
                              );
                              const anyPct = Math.round(
                                (card.stat.any / totalFacilities) * 100,
                              );
                              const allPct = Math.round(
                                (card.stat.all / totalFacilities) * 100,
                              );
                              const severity = severityBadge(pct);

                              return (
                                <div
                                  key={card.id}
                                  className="rounded-[24px] border border-white/70 bg-white/78 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.08)]"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                        Indicator {index + 1}
                                      </div>
                                      <div className="mt-1 text-sm font-bold text-slate-950">
                                        {card.name}
                                      </div>
                                    </div>
                                    <span
                                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${severity.bg} ${severity.text}`}
                                    >
                                      {severity.label}
                                    </span>
                                  </div>

                                  <div className="mt-4">
                                    <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                                      <span>Affected facilities</span>
                                      <span className="font-bold text-slate-800">
                                        {card.stat.total} / {pct}%
                                      </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-100">
                                      <div
                                        className={`h-2 rounded-full ${meta.bar}`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="mt-4 grid grid-cols-2 gap-3">
                                    <div className="rounded-2xl bg-slate-50/80 px-3 py-3 text-center">
                                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                        Any month
                                      </div>
                                      <div className="mt-1 text-lg font-bold text-slate-900">
                                        {card.stat.any}
                                      </div>
                                      <div className="text-xs text-slate-500">
                                        {anyPct}% of facilities
                                      </div>
                                    </div>
                                    <div className="rounded-2xl bg-slate-50/80 px-3 py-3 text-center">
                                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                        All months
                                      </div>
                                      <div className="mt-1 text-lg font-bold text-slate-900">
                                        {card.stat.all}
                                      </div>
                                      <div className="text-xs text-slate-500">
                                        {allPct}% of facilities
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()
                : null}

              {kpis && activeGroup ? (
                <div>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                        Drill-down cards
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-600">
                        Open any indicator to inspect charts, tables, and summaries.
                      </div>
                    </div>
                    {meta ? (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${meta.chip} ${meta.text}`}
                      >
                        {meta.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {groupCards.map((card) => (
                      <KpiCardCmp
                        key={card.id}
                        card={card}
                        onClick={() => setDrawerCard(card)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

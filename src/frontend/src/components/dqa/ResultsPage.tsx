import { useState, useMemo, useCallback, useEffect } from "react";
import { Award, Save, TrendingUp, RefreshCw, FileDown } from "lucide-react";
import { downloadHmisDqaReport } from "../../lib/dqa/pdfReport";
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
import { IndicatorSummaryPanel } from "./IndicatorSummaryPanel";
import { KpiPanel } from "./KpiPanel";
import { CollapsibleFilterRail } from "./CollapsibleFilterRail";
import { OverallScore } from "./OverallScore";
import { OverallSummaryTable } from "./OverallSummaryTable";
import { apiFetch } from "../../api";
import { computeOverallScore, scoreBadgeStyle } from "../../lib/dqa/scoreUtils";
import { buildSnapshotSaveMeta } from "../../lib/snapshots";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { GlassPanel } from "../branding/GlassPanel";
import type { AuthState } from "./LoginPage";
import type { PreUploadInfo } from "../../lib/dqa/preUploadOptions";

interface Props {
  csv: ParsedCSV;
  onReset: () => void;
  onTrend: () => void;
  auth: AuthState;
  activeGroup: ActiveGroup | "";
  onGroupChange: (g: ActiveGroup) => void;
  snapshotSaved: boolean;
  onSnapshotSaved: () => void;
  reviewInfo: PreUploadInfo | null;
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
    color: "#2a78d6",
    surface: "#e8f1fb",
    soft: "#e8f1fb",
    chip: "bg-[#e8f1fb]",
    text: "text-[#1c5cab]",
    bar: "bg-[#2a78d6]",
    ring: "ring-[#c9ddf5]",
  },
  completeness: {
    label: "Completeness",
    color: "#4a3aa7",
    surface: "#eceafa",
    soft: "#eceafa",
    chip: "bg-[#eceafa]",
    text: "text-[#3a2d85]",
    bar: "bg-[#4a3aa7]",
    ring: "ring-[#d6d1f1]",
  },
  accuracy: {
    label: "Accuracy",
    color: "#eb6834",
    surface: "#fdeee7",
    soft: "#fdeee7",
    chip: "bg-[#fdeee7]",
    text: "text-[#b04516]",
    bar: "bg-[#eb6834]",
    ring: "ring-[#f8d3c2]",
  },
  consistency: {
    label: "Consistency",
    color: "#199e70",
    surface: "#e5f6ef",
    soft: "#e5f6ef",
    chip: "bg-[#e5f6ef]",
    text: "text-[#0d7a54]",
    bar: "bg-[#199e70]",
    ring: "ring-[#c2e9d9]",
  },
  overall: {
    label: "Overall",
    color: "#334155",
    surface: "#f1f5f9",
    soft: "#f1f5f9",
    chip: "bg-slate-100",
    text: "text-slate-700",
    bar: "bg-slate-600",
    ring: "ring-slate-200",
  },
};

const TABS: Exclude<ActiveGroup, "">[] = [
  "availability",
  "completeness",
  "accuracy",
  "consistency",
  "overall",
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
  snapshotSaved,
  onSnapshotSaved,
  reviewInfo,
}: Props) {
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [kpis, setKpis] = useState<ComputedKpis | null>(() =>
    activeGroup
      ? computeKpis(csv, { ...DEFAULT_FILTERS, activeGroup })
      : null,
  );
  const [showOverall, setShowOverall] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
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
    apiFetch("/api/snapshots")
      .then((snapshots: any[]) => {
        const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
        const matches = snapshots.filter(
          (snapshot) =>
            (snapshot.portal?.toUpperCase() ?? "HMIS") === "HMIS" &&
            norm(snapshot.state) === norm(csv.stateName) &&
            norm(snapshot.district) === norm(csv.distName),
        );
        const match = matches.sort((a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )[0];
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
  }, [csv.stateName, csv.distName]);

  useEffect(() => {
    if (!activeGroup) {
      setKpis(null);
      return;
    }

    const result = computeKpis(csv, { ...filters, activeGroup });
    setKpis(result);
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
      const { overall, components } = computeOverallScore(kpis);
      const snapshotMeta = buildSnapshotSaveMeta(auth, filters, csv.allMonths);
      const savedSnapshot = await apiFetch("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({
          portal: "HMIS",
          state: csv.stateName,
          district: csv.distName,
          duration: durationStr,
          designation: reviewInfo?.designation || null,
          purpose: reviewInfo?.purpose || null,
          purposeDetail:
            reviewInfo?.purposeSubOption || reviewInfo?.purposeOtherText || null,
          overallScore: overall,
          availabilityScore: components.availability?.score ?? 0,
          completenessScore: components.completeness?.score ?? 0,
          accuracyScore: components.accuracy?.score ?? 0,
          consistencyScore: components.consistency?.score ?? 0,
          dqaLevel: snapshotMeta.dqaLevel,
          block: snapshotMeta.block,
          periodStart: snapshotMeta.periodStart,
          periodEnd: snapshotMeta.periodEnd,
          blockCount: csv.globalBlockCount,
          facilityCount: csv.globalFacilityCount,
        }),
      });
      setLastSnapshot({
        createdAt: savedSnapshot.createdAt,
        overallScore: savedSnapshot.overallScore,
        availabilityScore: savedSnapshot.kpiData?.availabilityScore ?? 0,
        completenessScore: savedSnapshot.kpiData?.completenessScore ?? 0,
        accuracyScore: savedSnapshot.kpiData?.accuracyScore ?? 0,
        consistencyScore: savedSnapshot.kpiData?.consistencyScore ?? 0,
      });
      onSnapshotSaved();
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
          className="flex w-[min(760px,94vw)] flex-col overflow-hidden border-l border-slate-200/70 bg-[linear-gradient(180deg,rgba(246,242,233,0.98),rgba(255,255,255,0.96))] p-0 backdrop-blur-xl sm:max-w-[760px]"
        >
          <SheetHeader className="border-b border-slate-200/70 px-5 py-4">
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
                  disabled={generatingReport}
                  onClick={async () => {
                    setGeneratingReport(true);
                    try { await downloadHmisDqaReport(csv, kpis); }
                    finally { setGeneratingReport(false); }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {generatingReport ? "Generating…" : "Download Report"}
                </button>
              ) : null}
              {kpis ? (
                <button
                  onClick={handleSave}
                  disabled={saving || snapshotSaved}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving…" : snapshotSaved ? "Saved" : "Save snapshot"}
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
                  { label: "Availability", score: lastSnapshot.availabilityScore, style: { bg: "#e8f1fb", text: "#1c5cab" } },
                  { label: "Completeness", score: lastSnapshot.completenessScore, style: { bg: "#eceafa", text: "#3a2d85" } },
                  { label: "Accuracy", score: lastSnapshot.accuracyScore, style: { bg: "#fdeee7", text: "#b04516" } },
                  { label: "Consistency", score: lastSnapshot.consistencyScore, style: { bg: "#e5f6ef", text: "#0d7a54" } },
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
              {kpis && activeGroup === "overall" ? (
                <OverallSummaryTable
                  cards={kpis.cards}
                  facilities={kpis.filteredFacilities}
                  exportName={`Blockwise-Overall-Summary-HMIS-${csv.distName || "district"}`}
                />
              ) : null}

              {kpis && meta && activeGroup !== "overall" ? (
                <IndicatorSummaryPanel
                  meta={meta}
                  monthsCount={Object.keys(csv.allMonths).length}
                  totalUnits={totalFacilities}
                  unitLabel="facilities"
                  affectedUnique={
                    new Set(
                      groupCards.flatMap((card) => [...card.stat.facilityKeys]),
                    ).size
                  }
                  cards={groupCards.map((card) => ({
                    id: card.id,
                    name: card.name,
                    total: card.stat.total,
                    any: card.stat.any,
                    all: card.stat.all,
                  }))}
                  onOpenCard={(id) => {
                    const card = groupCards.find((c) => c.id === id);
                    if (card && card.stat.total > 0) setDrawerCard(card);
                  }}
                />
              ) : null}

            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

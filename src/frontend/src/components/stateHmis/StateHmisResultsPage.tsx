import { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  Download,
  FileDown,
  FileSpreadsheet,
  Map,
  RefreshCw,
  Save,
  Table2,
} from "lucide-react";
import type { AuthState } from "../dqa/LoginPage";
import type { PreUploadInfo } from "../../lib/dqa/preUploadOptions";
import { apiFetch } from "../../api";
import { monthsSpanInclusive } from "../../lib/dqa/parseUtils";
import { scoreBadgeStyle } from "../../lib/dqa/scoreUtils";
import { computeStateHmisKpis } from "../../lib/stateHmis/compute";
import {
  DEFAULT_STATE_HMIS_FILTERS,
  type StateHmisCard,
  type StateHmisComputed,
  type StateHmisFilters,
  type StateHmisGroup,
  type StateHmisParsed,
} from "../../lib/stateHmis/types";
import {
  downloadStateCard,
  downloadStateHmisPdf,
  downloadStateOverall,
} from "../../lib/stateHmis/exportUtils";
import { CollapsibleFilterRail } from "../dqa/CollapsibleFilterRail";
import { IndicatorSummaryPanel } from "../dqa/IndicatorSummaryPanel";
import { GlassPanel } from "../branding/GlassPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { StateDistrictMap } from "./StateDistrictMap";
import { StateHmisFilterPanel } from "./StateHmisFilterPanel";

interface Props {
  data: StateHmisParsed;
  auth: AuthState;
  reviewInfo: PreUploadInfo | null;
  snapshotSaved: boolean;
  onSnapshotSaved: () => void;
  onReset: () => void;
}

type ActiveGroup = StateHmisGroup | "overall";

const GROUP_META: Record<
  ActiveGroup,
  {
    label: string;
    color: string;
    surface: string;
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
    chip: "bg-[#e8f1fb]",
    text: "text-[#1c5cab]",
    bar: "bg-[#2a78d6]",
    ring: "ring-[#c9ddf5]",
  },
  completeness: {
    label: "Completeness",
    color: "#4a3aa7",
    surface: "#eceafa",
    chip: "bg-[#eceafa]",
    text: "text-[#3a2d85]",
    bar: "bg-[#4a3aa7]",
    ring: "ring-[#d6d1f1]",
  },
  accuracy: {
    label: "Accuracy",
    color: "#eb6834",
    surface: "#fdeee7",
    chip: "bg-[#fdeee7]",
    text: "text-[#b04516]",
    bar: "bg-[#eb6834]",
    ring: "ring-[#f8d3c2]",
  },
  consistency: {
    label: "Consistency",
    color: "#199e70",
    surface: "#e5f6ef",
    chip: "bg-[#e5f6ef]",
    text: "text-[#0d7a54]",
    bar: "bg-[#199e70]",
    ring: "ring-[#c2e9d9]",
  },
  overall: {
    label: "Overall",
    color: "#334155",
    surface: "#f1f5f9",
    chip: "bg-slate-100",
    text: "text-slate-700",
    bar: "bg-slate-600",
    ring: "ring-slate-200",
  },
};

const TABS: ActiveGroup[] = [
  "availability",
  "completeness",
  "accuracy",
  "consistency",
  "overall",
];

const secondaryActionClass =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";

export function StateHmisResultsPage({
  data,
  auth: _auth,
  reviewInfo,
  snapshotSaved,
  onSnapshotSaved,
  onReset,
}: Props) {
  const [filters, setFilters] = useState<StateHmisFilters>({
    ...DEFAULT_STATE_HMIS_FILTERS,
  });
  const [activeGroup, setActiveGroup] = useState<ActiveGroup>("availability");
  const [drawerCard, setDrawerCard] = useState<StateHmisCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [lastSnapshot, setLastSnapshot] = useState<{
    createdAt: string;
    availabilityScore: number;
    completenessScore: number;
    accuracyScore: number;
    consistencyScore: number;
    overallScore: number;
  } | null>(null);

  const computed = useMemo(
    () => computeStateHmisKpis(data, filters),
    [data, filters],
  );

  const indicatorShorts = useMemo(
    () => [
      ...new Set(
        data.orderedItemCodes
          .map((code) => data.items[code].short)
          .filter((short) => !/^\d/.test(short)),
      ),
    ],
    [data],
  );

  const durationStr = useMemo(() => {
    const months = Object.keys(data.months).sort();
    if (!months.length) return "-";
    const span = monthsSpanInclusive(months[0], months[months.length - 1]);
    if (!span) return "-";
    return `${span} month${span > 1 ? "s" : ""}`;
  }, [data]);

  useEffect(() => {
    apiFetch("/api/snapshots")
      .then((snapshots: any[]) => {
        const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();
        const matches = snapshots.filter(
          (snapshot) =>
            (snapshot.portal?.toUpperCase() ?? "HMIS") === "HMIS_STATE" &&
            norm(snapshot.state) === norm(data.stateName),
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
  }, [data.stateName]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const period = computed.selectedMonths;
      const savedSnapshot = await apiFetch("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({
          portal: "HMIS_STATE",
          state: data.stateName,
          district: "All Districts",
          duration: `${period.length} month${period.length === 1 ? "" : "s"}`,
          designation: reviewInfo?.designation || null,
          purpose: reviewInfo?.purpose || null,
          purposeDetail:
            reviewInfo?.purposeSubOption || reviewInfo?.purposeOtherText || null,
          overallScore: computed.overallScore,
          availabilityScore: computed.componentScores.availability.score,
          completenessScore: computed.componentScores.completeness.score,
          accuracyScore: computed.componentScores.accuracy.score,
          consistencyScore: computed.componentScores.consistency.score,
          dqaLevel: "STATE",
          periodStart: period[0],
          periodEnd: period[period.length - 1],
          districtCount: computed.selectedDistricts.length,
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

  const meta = GROUP_META[activeGroup];
  const groupCards =
    activeGroup !== "overall"
      ? computed.cards.filter((card) => card.group === activeGroup)
      : [];
  const totalDistricts = Math.max(1, computed.denominator);

  const contextStats = [
    { label: "Program", value: "HMIS State" },
    { label: "State", value: data.stateName || "-" },
    { label: "Duration", value: durationStr },
    { label: "Districts", value: String(data.districts.length) },
    { label: "Files", value: String(data.fileNames.length) },
    {
      label: "M9 items",
      value: String(
        Object.values(data.items).filter((item) => /^M9\b/.test(item.category))
          .length,
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
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
            {drawerCard ? (
              <span
                className="mt-2 inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{
                  background: GROUP_META[drawerCard.group].surface,
                  color: GROUP_META[drawerCard.group].color,
                }}
              >
                {GROUP_META[drawerCard.group].label}
              </span>
            ) : null}
          </SheetHeader>
          {drawerCard ? (
            <div className="flex-1 overflow-hidden p-4">
              <StateKpiPanel
                card={drawerCard}
                computed={computed}
                stateName={data.stateName}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <div className="space-y-5">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">
              HMIS State Analysis
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={generatingReport}
                onClick={() => {
                  setGeneratingReport(true);
                  try {
                    downloadStateHmisPdf(data, computed);
                  } finally {
                    setGeneratingReport(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileDown className="h-3.5 w-3.5" />
                {generatingReport ? "Generating…" : "Download Report"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || snapshotSaved}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving…" : snapshotSaved ? "Saved" : "Save snapshot"}
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
          {data.validationIssues.length ? (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {data.validationIssues.map((issue) => issue.message).join(" ")}
            </div>
          ) : null}
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
                  onClick={() => setActiveGroup(group)}
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

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <CollapsibleFilterRail>
            <StateHmisFilterPanel
              data={data}
              filters={filters}
              onApply={setFilters}
              indicatorShorts={indicatorShorts}
            />
          </CollapsibleFilterRail>

          <div className="min-w-0 flex-1 space-y-5">
            {activeGroup === "overall" ? (
              <OverallDistrictSummary
                data={data}
                computed={computed}
                onExport={() => downloadStateOverall(data, computed)}
              />
            ) : null}

            {activeGroup !== "overall" ? (
              <IndicatorSummaryPanel
                meta={meta}
                monthsCount={computed.selectedMonths.length}
                totalUnits={totalDistricts}
                unitLabel="districts"
                affectedUnique={
                  new Set(
                    groupCards.flatMap((card) => card.affectedDistricts),
                  ).size
                }
                cards={groupCards.map((card) => ({
                  id: card.id,
                  name: card.name,
                  total: card.total,
                  any: card.any,
                  all: card.all,
                }))}
                onOpenCard={(id) => {
                  const card = groupCards.find((c) => c.id === id);
                  if (card && card.total > 0) setDrawerCard(card);
                }}
                subtitle="Open any indicator to inspect charts, tables, and maps."
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveDetailStyle(group: StateHmisGroup) {
  const meta = GROUP_META[group];
  return {
    badgeBg: meta.surface,
    badgeText: meta.color,
    accent: meta.color,
    panel: `linear-gradient(180deg, ${meta.surface}99, rgba(255,255,255,1))`,
  };
}

type DetailView = "chart" | "table" | "map";

function StateKpiPanel({
  card,
  computed,
  stateName,
}: {
  card: StateHmisCard;
  computed: StateHmisComputed;
  stateName: string;
}) {
  const [view, setView] = useState<DetailView>("chart");
  const style = resolveDetailStyle(card.group);
  const meta = GROUP_META[card.group];

  const mapCounts = Object.fromEntries(
    computed.selectedDistricts.map((district) => [
      district,
      computed.selectedMonths.filter((month) => card.hits[district]?.[month]?.flag)
        .length,
    ]),
  );

  return (
    <div className="panel-enter flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0.70))] shadow-[0_22px_48px_rgba(15,23,42,0.12)]">
      <div className="border-b border-slate-200/70 p-5" style={{ background: style.panel }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{ background: style.badgeBg, color: style.badgeText }}
              >
                {meta.label}
              </span>
              <span className="rounded-full border border-slate-200/80 bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                KPI detail
              </span>
            </div>

            <h2 className="mt-3 text-2xl font-extrabold leading-tight text-slate-950">
              {card.name}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              {card.description}
            </p>
          </div>

          <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Flagged
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {card.total}
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Any month
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {card.any}
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                All months
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {card.all}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["chart", "table", "map"] as DetailView[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-white hover:text-slate-950"
                style={
                  view === option
                    ? {
                        background: style.accent,
                        borderColor: style.accent,
                        color: "#ffffff",
                        boxShadow: "0 16px 28px rgba(15,23,42,0.14)",
                      }
                    : undefined
                }
              >
                {option === "chart" && <BarChart2 className="h-3.5 w-3.5" />}
                {option === "table" && <Table2 className="h-3.5 w-3.5" />}
                {option === "map" && <Map className="h-3.5 w-3.5" />}
                {option}
              </button>
            ))}
          </div>

          {view !== "map" ? (
            <button
              type="button"
              onClick={() => downloadStateCard(card, computed.selectedMonths)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              Export current
            </button>
          ) : null}
        </div>

        <div
          className={`min-h-0 rounded-[26px] border border-slate-200/80 bg-white/86 ${view === "map" ? "overflow-auto thin-scroll p-4" : "flex-1 overflow-hidden"}`}
        >
          {view === "chart" ? (
            <div className="h-full overflow-auto thin-scroll p-4">
              <CardChart
                card={card}
                months={computed.selectedMonths}
                accent={style.accent}
              />
            </div>
          ) : null}

          {view === "table" ? (
            <div className="h-full overflow-auto thin-scroll">
              <CardTable card={card} months={computed.selectedMonths} />
            </div>
          ) : null}

          {view === "map" ? (
            <StateDistrictMap
              stateName={stateName}
              districts={computed.selectedDistricts}
              counts={mapCounts}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardChart({
  card,
  months,
  accent,
}: {
  card: StateHmisCard;
  months: string[];
  accent: string;
}) {
  const rows = Object.keys(card.hits)
    .map((district) => ({
      district,
      count: months.filter((month) => card.hits[district]?.[month]?.flag).length,
    }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((row) => row.count));

  if (!rows.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No chart data available.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.district}
          className="grid grid-cols-[140px_1fr_36px] items-center gap-2 text-xs"
        >
          <span className="truncate font-medium text-slate-700">{row.district}</span>
          <div className="h-6 rounded-md bg-slate-100">
            <div
              className="h-full rounded-md"
              style={{ width: `${(row.count / max) * 100}%`, background: accent }}
            />
          </div>
          <span className="font-bold text-slate-800">{row.count}</span>
        </div>
      ))}
    </div>
  );
}

function CardTable({ card, months }: { card: StateHmisCard; months: string[] }) {
  const districts = Object.keys(card.hits).sort();
  if (!districts.length) {
    return <div className="p-4 text-sm text-slate-500">No records.</div>;
  }
  return (
    <table className="w-full min-w-[700px] text-sm">
      <thead className="sticky top-0 z-10 bg-slate-50">
        <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          <th className="px-4 py-3">District</th>
          {months.map((month) => (
            <th key={month} className="px-4 py-3">
              {month}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-white">
        {districts.map((district) => (
          <tr key={district} className="border-t border-slate-100">
            <td className="px-4 py-2.5 font-semibold text-slate-900">{district}</td>
            {months.map((month) => {
              const hit = card.hits[district]?.[month];
              return (
                <td
                  key={month}
                  className={`px-4 py-2.5 text-xs ${hit?.flag ? "bg-red-100 text-red-800" : "text-slate-600"}`}
                >
                  {hit?.detail ?? "Not evaluated"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Colour coding matches the HMIS Overall summary: >= 4 flagged indicators is red.
function overallSeverity(count: number) {
  if (count >= 4)
    return { row: "bg-red-50/70", badge: "bg-red-100 text-red-700" };
  if (count > 0) return { row: "", badge: "bg-amber-100 text-amber-700" };
  return { row: "", badge: "bg-emerald-100 text-emerald-700" };
}

function OverallDistrictSummary({
  data,
  computed,
  onExport,
}: {
  data: StateHmisParsed;
  computed: StateHmisComputed;
  onExport: () => void;
}) {
  const districts = [...computed.selectedDistricts].sort(
    (a, b) =>
      computed.issueCountByDistrict[b] - computed.issueCountByDistrict[a] ||
      a.localeCompare(b),
  );

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Overall
          </div>
          <div className="mt-1 text-lg font-bold text-slate-950">
            District wise Overall Summary
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Distinct indicators flagged across all data quality components for
            each district of {data.stateName}.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {([
              {
                label: "Overall",
                score: computed.overallScore,
                style: scoreBadgeStyle(computed.overallScore),
              },
              {
                label: "Availability",
                score: computed.componentScores.availability.score,
                style: { bg: "#e8f1fb", text: "#1c5cab" },
              },
              {
                label: "Completeness",
                score: computed.componentScores.completeness.score,
                style: { bg: "#eceafa", text: "#3a2d85" },
              },
              {
                label: "Accuracy",
                score: computed.componentScores.accuracy.score,
                style: { bg: "#fdeee7", text: "#b04516" },
              },
              {
                label: "Consistency",
                score: computed.componentScores.consistency.score,
                style: { bg: "#e5f6ef", text: "#0d7a54" },
              },
            ] as const).map(({ label, score, style }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ background: style.bg, color: style.text }}
              >
                {label}: {Math.round(score)}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Download Excel
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">
          4+ indicators
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
          1-3 indicators
        </span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
          No issues
        </span>
      </div>

      {districts.length === 0 ? (
        <div className="p-8 text-center text-sm font-medium text-slate-500">
          No data available for the current filters.
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-x-auto overflow-y-auto thin-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-3">District</th>
                <th className="px-4 py-3 text-center">
                  No. of Data Quality Issues identified
                </th>
                <th className="min-w-[320px] px-4 py-3">Indicators identified</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {districts.map((district) => {
                const count = computed.issueCountByDistrict[district] ?? 0;
                const tone = overallSeverity(count);
                const para = (computed.issueNamesByDistrict[district] ?? []).join(", ");
                return (
                  <tr key={district} className={`border-t border-slate-100 ${tone.row}`}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">
                      {district}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}
                      >
                        {count}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs leading-6 text-slate-600">
                      {para || (
                        <span className="text-slate-400">No issues identified</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}

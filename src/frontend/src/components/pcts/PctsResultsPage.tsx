import { useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  Download,
  FileDown,
  FileSpreadsheet,
  History,
  Map as MapIcon,
  RefreshCw,
  Save,
  Table2,
} from "lucide-react";
import { apiFetch } from "../../api";
import type { AuthState } from "../dqa/LoginPage";
import type { PreUploadInfo } from "../../lib/dqa/preUploadOptions";
import { monthsSpanInclusive, periodDurationLabel } from "../../lib/dqa/parseUtils";
import { scoreBadgeStyle } from "../../lib/dqa/scoreUtils";
import { componentCoverageNote, formatScore, SCORING_METHOD_VERSION } from "../../lib/dqa/scoring";
import { ScoreStrip, type ScoreStripRow } from "../dqa/ScoreStrip";
import {
  pickReviewBaselines,
  type ReviewBaseline,
  type SnapshotRecord,
  type SnapshotScope,
} from "../../lib/snapshots";
import { computePctsKpis } from "../../lib/pcts/computeKpis";
import {
  DEFAULT_PCTS_FILTERS,
  type PctsCard,
  type PctsComputed,
  type PctsFilters,
  type PctsGroup,
  type PctsParsed,
} from "../../lib/pcts/types";
import {
  downloadPctsCard,
  downloadPctsOverall,
  downloadPctsPdf,
} from "../../lib/pcts/exportUtils";
import { GlassPanel } from "../branding/GlassPanel";
import { FilterBar } from "../dqa/FilterBar";
import { IndicatorSummaryPanel } from "../dqa/IndicatorSummaryPanel";
import { KpiBlockMap } from "../dqa/KpiBlockMap";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { PctsFilterPanel } from "./PctsFilterPanel";

interface Props {
  data: PctsParsed;
  auth: AuthState;
  reviewInfo: PreUploadInfo | null;
  snapshotSaved: boolean;
  onSnapshotSaved: () => void;
  onReset: () => void;
  onTrend?: () => void;
  onOpenTrends?: () => void;
  activeGroup?: PctsGroup | "overall" | "";
  onGroupChange?: (group: PctsGroup | "overall") => void;
}

type ActiveGroup = PctsGroup | "overall";

const GROUP_META: Record<
  ActiveGroup,
  { label: string; color: string; surface: string; text: string; bar: string; ring: string }
> = {
  availability: {
    label: "Availability",
    color: "#2a78d6",
    surface: "#e8f1fb",
    text: "#1c5cab",
    bar: "bg-[#2a78d6]",
    ring: "ring-[#c9ddf5]",
  },
  completeness: {
    label: "Completeness",
    color: "#4a3aa7",
    surface: "#eceafa",
    text: "#3a2d85",
    bar: "bg-[#4a3aa7]",
    ring: "ring-[#d6d1f1]",
  },
  accuracy: {
    label: "Accuracy",
    color: "#eb6834",
    surface: "#fdeee7",
    text: "#b04516",
    bar: "bg-[#eb6834]",
    ring: "ring-[#f8d3c2]",
  },
  consistency: {
    label: "Consistency",
    color: "#199e70",
    surface: "#e5f6ef",
    text: "#0d7a54",
    bar: "bg-[#199e70]",
    ring: "ring-[#c2e9d9]",
  },
  overall: {
    label: "Overall",
    color: "#334155",
    surface: "#f1f5f9",
    text: "#334155",
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

/** Components that make up the overall score for this portal. */
const SCORED_GROUPS: Exclude<ActiveGroup, "overall">[] = [
  "availability",
  "completeness",
  "accuracy",
  "consistency",
];

const secondaryActionClass =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";

export function PctsResultsPage({
  data,
  auth: _auth,
  reviewInfo,
  snapshotSaved,
  onSnapshotSaved,
  onReset,
  onTrend,
  onOpenTrends,
  activeGroup: controlledActiveGroup,
  onGroupChange,
}: Props) {
  const [filters, setFilters] = useState<PctsFilters>({ ...DEFAULT_PCTS_FILTERS });
  const [localActiveGroup, setLocalActiveGroup] = useState<ActiveGroup>("availability");
  const [drawerCard, setDrawerCard] = useState<PctsCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  // Every saved review of this geography, kept so a re-upload of months already
  // reviewed can be measured against that same-period review rather than only
  // against whatever happened to be saved most recently.
  const [savedReviews, setSavedReviews] = useState<SnapshotRecord[]>([]);

  const computed = useMemo(() => computePctsKpis(data, filters), [data, filters]);
  const activeGroup: ActiveGroup = controlledActiveGroup || localActiveGroup;
  const changeActiveGroup = (group: ActiveGroup) => {
    setLocalActiveGroup(group);
    onGroupChange?.(group);
  };
  const months = useMemo(() => Object.keys(data.months).sort(), [data.months]);
  const duration = useMemo(() => {
    if (!months.length) return "-";
    const span = monthsSpanInclusive(months[0], months[months.length - 1]);
    return span ? `${span} month${span === 1 ? "" : "s"}` : `${months.length} file(s)`;
  }, [months]);

  useEffect(() => {
    apiFetch("/api/snapshots")
      .then((snapshots: unknown) => {
        if (!Array.isArray(snapshots)) return;
        const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
        setSavedReviews(
          (snapshots as SnapshotRecord[]).filter(
            (snapshot) =>
              normalize(snapshot.portal) === "pcts" &&
              normalize(snapshot.state) === normalize(data.stateName) &&
              normalize(snapshot.district) === normalize(data.districtName),
          ),
        );
      })
      .catch(() => {});
  }, [data.districtName, data.stateName]);

  // Exactly what this review scored. PCTS reviews are always saved at DISTRICT
  // level (backend policy), so a narrowed selection is recorded as a partial scope.
  const selectedBlockCount = new Set(
    computed.selectedFacilityKeys.map((facilityKey) => data.facilities[facilityKey]?.block),
  ).size;
  const narrowedBlocks = filters.blocks.length > 0 && filters.blocks.length < data.blocks.length;
  const savedScope: SnapshotScope = {
    blocks: narrowedBlocks ? [...filters.blocks].sort() : [],
    districts: [],
    months: [...computed.selectedMonths],
    ownership: [...filters.ownership].sort(),
    ruralUrban: [...filters.ruralUrban].sort(),
    facilityTypes: [...filters.facilityTypes].sort(),
    analysisMode: null,
    // Anything that leaves out part of the district's facility roster.
    partial: computed.selectedFacilityKeys.length < Object.keys(data.facilities).length,
  };
  const canSave = computed.selectedMonths.length > 0 && computed.overallScore !== null;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const saved: any = await apiFetch("/api/snapshots", {
        method: "POST",
        body: JSON.stringify({
          portal: "PCTS",
          state: data.stateName,
          district: data.districtName,
          duration: periodDurationLabel(computed.selectedMonths),
          designation: reviewInfo?.designation || null,
          purpose: reviewInfo?.purpose || null,
          purposeDetail:
            reviewInfo?.purposeSubOption || reviewInfo?.purposeOtherText || null,
          overallScore: computed.overallScore,
          availabilityScore: computed.componentScores.availability.score,
          completenessScore: computed.componentScores.completeness.score,
          accuracyScore: computed.componentScores.accuracy.score,
          consistencyScore: computed.componentScores.consistency.score,
          scoredComponents: computed.scoredComponents,
          methodVersion: SCORING_METHOD_VERSION,
          scope: savedScope,
          dqaLevel: "DISTRICT",
          periodStart: computed.selectedMonths[0],
          periodEnd: computed.selectedMonths[computed.selectedMonths.length - 1],
          // What was analysed, then the upload totals for context.
          blockCount: selectedBlockCount,
          facilityCount: computed.denominator,
          uploadBlockCount: data.globalBlockCount,
          uploadFacilityCount: data.globalFacilityCount,
        }),
      });
      setSavedReviews((current) => [saved as SnapshotRecord, ...current]);
      onSnapshotSaved();
    } catch {
      alert("Failed to save the PCTS snapshot.");
    } finally {
      setSaving(false);
    }
  };

  const groupCards =
    activeGroup === "overall"
      ? []
      : computed.cards.filter((card) => card.group === activeGroup);
  const affectedUnique = new Set(groupCards.flatMap((card) => card.affectedFacilities)).size;
  const scoreRows: ScoreStripRow[] = SCORED_GROUPS.map((group) => ({
    key: group,
    label: GROUP_META[group].label,
    color: GROUP_META[group].color,
    current: computed.componentScores[group]?.score ?? null,
  }));

  // The months this upload covers, derived exactly as the save path records them
  // so a same-period match is an equality test, not a guess.
  const currentPeriod = computed.selectedMonths.length
    ? {
        start: computed.selectedMonths[0],
        end: computed.selectedMonths[computed.selectedMonths.length - 1],
      }
    : null;
  const baselines: ReviewBaseline[] = pickReviewBaselines(savedReviews, currentPeriod, {
    kpiData: { dqaLevel: "DISTRICT", block: null, scope: savedScope },
  });

  const currentMeta = GROUP_META[activeGroup];
  const trendHandler = onOpenTrends ?? onTrend;

  const contextStats = [
    { label: "Program", value: "PCTS" },
    { label: "State", value: data.stateName },
    { label: "District", value: data.districtName },
    { label: "Duration", value: duration },
    { label: "Groups", value: String(data.globalBlockCount) },
    { label: "Facilities", value: String(data.globalFacilityCount) },
    { label: "Rural / Urban", value: `${data.ruralCount} / ${data.urbanCount}` },
    { label: "Public / Private", value: `${data.publicCount} / ${data.privateCount}` },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <Sheet open={Boolean(drawerCard)} onOpenChange={(open) => !open && setDrawerCard(null)}>
        <SheetContent
          side="right"
          className="flex w-[min(860px,96vw)] flex-col overflow-hidden border-l border-slate-200/70 bg-[linear-gradient(180deg,rgba(246,242,233,0.98),rgba(255,255,255,0.96))] p-0 backdrop-blur-xl sm:max-w-[860px]"
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
              <PctsKpiPanel data={data} card={drawerCard} computed={computed} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <div className="space-y-5">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-slate-900">PCTS Analysis</h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={generatingReport}
                onClick={() => {
                  setGeneratingReport(true);
                  try {
                    downloadPctsPdf(data, computed);
                  } finally {
                    setGeneratingReport(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                <FileDown className="h-3.5 w-3.5" />
                {generatingReport ? "Generating…" : "Download Report"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || snapshotSaved || !canSave}
                title={canSave ? undefined : "Nothing in the current selection can be scored"}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving…" : snapshotSaved ? "Saved" : "Save snapshot"}
              </button>
              {trendHandler ? (
                <button type="button" onClick={trendHandler} className={secondaryActionClass}>
                  <History className="h-3.5 w-3.5" />
                  Trends
                </button>
              ) : null}
              <button type="button" onClick={onReset} className={secondaryActionClass}>
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
          </div>

          {data.validationIssues.length ? (
            <div className="mt-3 space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {data.validationIssues.map((issue, index) => (
                <div key={`${issue.code}-${index}`}>{issue.message}</div>
              ))}
            </div>
          ) : null}
        </div>

        <ScoreStrip
          overall={computed.overallScore}
          rows={scoreRows}
          coverageNote={componentCoverageNote(computed)}
          customSettings={computed.customMethod}
          baselines={baselines}
          saved={snapshotSaved}
          onOpenDetail={() => changeActiveGroup("overall")}
          detailLabel="Overall tab"
        />

        <GlassPanel className="p-2">
          <div className="flex flex-wrap gap-2">
            {TABS.map((group) => (
              <button
                key={group}
                type="button"
                onClick={() => changeActiveGroup(group)}
                className={[
                  "inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition",
                  activeGroup === group
                    ? "bg-slate-950 text-white shadow-[0_18px_30px_rgba(15,23,42,0.18)]"
                    : "bg-white/70 text-slate-600 hover:bg-white hover:text-slate-950",
                ].join(" ")}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_META[group].color }} />
                {GROUP_META[group].label}
              </button>
            ))}
          </div>
        </GlassPanel>

        <div className="space-y-5">
          <FilterBar>
            <PctsFilterPanel data={data} filters={filters} onApply={setFilters} layout="inline" />
          </FilterBar>
          <div className="min-w-0 space-y-5">
            {activeGroup === "overall" ? (
              <PctsOverallSummary
                data={data}
                computed={computed}
                onExport={() => downloadPctsOverall(data, computed)}
              />
            ) : (
              <IndicatorSummaryPanel
                meta={{
                  label: currentMeta.label,
                  color: currentMeta.color,
                  surface: currentMeta.surface,
                  bar: currentMeta.bar,
                  ring: currentMeta.ring,
                }}
                monthsCount={computed.selectedMonths.length}
                totalUnits={computed.denominator}
                unitLabel="facilities"
                affectedUnique={affectedUnique}
                cards={groupCards.map((card) => ({
                  id: card.id,
                  name: card.name,
                  total: card.total,
                  any: card.any,
                  all: card.all,
                  eligible: card.eligible,
                }))}
                onOpenCard={(id) => {
                  const card = groupCards.find((candidate) => candidate.id === id);
                  if (card && card.total > 0) setDrawerCard(card);
                }}
                subtitle="Open an indicator to inspect block, facility, month, and source values."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type DetailView = "chart" | "table" | "map";

const PCTS_BLOCK_MAP_ALIASES: Record<string, string> = {
  "Ajmer Rural": "Ajmer",
  Bhinai: "Bhinay",
  Pisangan: "Peesangan",
};

function PctsKpiPanel({
  data,
  card,
  computed,
}: {
  data: PctsParsed;
  card: PctsCard;
  computed: PctsComputed;
}) {
  const [view, setView] = useState<DetailView>("chart");
  const meta = GROUP_META[card.group];
  const rawBlockCounts: Record<string, number> = {};
  for (const facilityKey of card.affectedFacilities) {
    const block = data.facilities[facilityKey]?.block ?? "Unknown";
    rawBlockCounts[block] = (rawBlockCounts[block] ?? 0) + 1;
  }
  const mapBlockCounts: Record<string, number> = {};
  for (const [block, count] of Object.entries(rawBlockCounts)) {
    const mapped = PCTS_BLOCK_MAP_ALIASES[block] ?? block;
    mapBlockCounts[mapped] = (mapBlockCounts[mapped] ?? 0) + count;
  }
  const mapBlocks = data.blocks.map((block) => PCTS_BLOCK_MAP_ALIASES[block] ?? block);
  const maxMapCount = Math.max(0, ...Object.values(mapBlockCounts));
  return (
    <div className="panel-enter flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/80 shadow-[0_22px_48px_rgba(15,23,42,0.12)]">
      <div className="border-b border-slate-200/70 p-5" style={{ background: `linear-gradient(180deg,${meta.surface},#fff)` }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <span className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ background: meta.surface, color: meta.text }}>
              {meta.label}
            </span>
            <h2 className="mt-3 text-2xl font-extrabold text-slate-950">{card.name}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
          </div>
          <div className="grid min-w-[230px] grid-cols-3 gap-2">
            {[
              ["Flagged", card.total],
              ["Any month", card.any],
              ["All months", card.all],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[22px] border border-slate-200/80 bg-white/80 px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-950">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(["chart", "table", "map"] as DetailView[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600"
                style={view === option ? { background: meta.color, borderColor: meta.color, color: "white" } : undefined}
              >
                {option === "chart" ? <BarChart2 className="h-3.5 w-3.5" /> : option === "table" ? <Table2 className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => downloadPctsCard(
              data,
              card,
              computed.selectedMonths,
              computed.visibleFacilityKeys,
            )}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Export current
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-[26px] border border-slate-200/80 bg-white thin-scroll">
          {view === "chart" ? (
            <PctsCardChart data={data} card={card} months={computed.selectedMonths} accent={meta.color} />
          ) : view === "table" ? (
            <PctsCardTable data={data} card={card} months={computed.selectedMonths} />
          ) : (
            <div className="p-4">
              <KpiBlockMap
                stateName={data.stateName}
                districtName={data.districtName}
                blockCounts={mapBlockCounts}
                allDataBlocks={mapBlocks}
                maxCount={maxMapCount}
              />
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Rajasthan PCTS aliases are applied for Ajmer Rural, Bhinai, and Pisangan.
                Urban Units and administrative health groups without a matching boundary remain
                visible in the tables and unmatched list.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PctsCardChart({
  data,
  card,
  months,
  accent,
}: {
  data: PctsParsed;
  card: PctsCard;
  months: string[];
  accent: string;
}) {
  const blockCounts = new Map<string, number>();
  for (const facilityKey of card.affectedFacilities) {
    const block = data.facilities[facilityKey]?.block ?? "Unknown";
    blockCounts.set(block, (blockCounts.get(block) ?? 0) + 1);
  }
  const rows = [...blockCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maximum = Math.max(1, ...rows.map(([, count]) => count));
  if (!rows.length) return <div className="p-8 text-center text-sm text-slate-500">No flagged facilities.</div>;
  return (
    <div className="space-y-2 p-5">
      {rows.map(([block, count]) => (
        <div key={block} className="grid grid-cols-[150px_1fr_44px] items-center gap-3 text-xs">
          <span className="truncate font-medium text-slate-700">{block}</span>
          <div className="h-7 rounded-lg bg-slate-100">
            <div className="h-full rounded-lg" style={{ width: `${(count / maximum) * 100}%`, background: accent }} />
          </div>
          <span className="font-bold text-slate-800">{count}</span>
        </div>
      ))}
    </div>
  );
}

function PctsCardTable({ data, card, months }: { data: PctsParsed; card: PctsCard; months: string[] }) {
  const facilityKeys = [...card.affectedFacilities].sort((left, right) => {
    const a = data.facilities[left];
    const b = data.facilities[right];
    return (a?.block ?? "").localeCompare(b?.block ?? "") || (a?.facility ?? "").localeCompare(b?.facility ?? "");
  });
  return (
    <table className="w-full min-w-[900px] text-sm">
      <thead className="sticky top-0 z-10 bg-slate-50">
        <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          <th className="px-4 py-3">Block / group</th>
          <th className="px-4 py-3">Facility</th>
          <th className="px-4 py-3">Type</th>
          {months.map((month) => <th key={month} className="min-w-[180px] px-4 py-3">{month}</th>)}
          {card.basis === "period" ? (
            <th className="min-w-[200px] px-4 py-3">Selected period (decides the flag)</th>
          ) : null}
        </tr>
      </thead>
      <tbody className="bg-white">
        {facilityKeys.map((facilityKey) => {
          const facility = data.facilities[facilityKey];
          return (
            <tr key={facilityKey} className="border-t border-slate-100 align-top">
              <td className="px-4 py-2.5 font-semibold text-slate-800">{facility?.block}</td>
              <td className="px-4 py-2.5 text-slate-800">{facility?.facility}</td>
              <td className="px-4 py-2.5 text-xs text-slate-500">{facility?.facilityType}</td>
              {months.map((month) => {
                const hit = card.hits[facilityKey]?.[month];
                return (
                  <td key={month} className={`px-4 py-2.5 text-xs leading-5 ${hit?.flag ? "bg-red-50 text-red-800" : "text-slate-500"}`}>
                    {hit?.detail ?? "Not evaluated"}
                  </td>
                );
              })}
              {card.basis === "period" ? (
                <td className={`px-4 py-2.5 text-xs font-semibold leading-5 ${card.periodHits?.[facilityKey]?.flag ? "bg-red-50 text-red-800" : "text-slate-600"}`}>
                  {card.periodHits?.[facilityKey]?.detail ?? "Not evaluated"}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function severity(count: number) {
  if (count >= 4) return { row: "bg-red-50/70", badge: "bg-red-100 text-red-700" };
  if (count > 0) return { row: "", badge: "bg-amber-100 text-amber-700" };
  return { row: "", badge: "bg-emerald-100 text-emerald-700" };
}

function PctsOverallSummary({
  data,
  computed,
  onExport,
}: {
  data: PctsParsed;
  computed: PctsComputed;
  onExport: () => void;
}) {
  const facilityKeys = [...(computed.visibleFacilityKeys ?? computed.selectedFacilityKeys)].sort(
    (left, right) =>
      (computed.issueCountByFacility[right] ?? 0) - (computed.issueCountByFacility[left] ?? 0) ||
      (data.facilities[left]?.block ?? "").localeCompare(data.facilities[right]?.block ?? "") ||
      (data.facilities[left]?.facility ?? "").localeCompare(data.facilities[right]?.facility ?? ""),
  );
  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Overall</div>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Block and facility-wise overall summary</h2>
          <p className="mt-1 text-sm text-slate-600">Distinct DQA indicators identified for each facility in {data.districtName}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              ["Overall", computed.overallScore, scoreBadgeStyle(computed.overallScore)],
              ["Availability", computed.componentScores.availability.score, { bg: "#e8f1fb", text: "#1c5cab" }],
              ["Completeness", computed.componentScores.completeness.score, { bg: "#eceafa", text: "#3a2d85" }],
              ["Accuracy", computed.componentScores.accuracy.score, { bg: "#fdeee7", text: "#b04516" }],
              ["Consistency", computed.componentScores.consistency.score, { bg: "#e5f6ef", text: "#0d7a54" }],
            ] as const).map(([label, score, style]) => (
              <span key={label} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: style.bg, color: style.text }}>
                {label}: {formatScore(score, 0)}
              </span>
            ))}
          </div>
        </div>
        <button type="button" onClick={onExport} className={secondaryActionClass}>
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Download Excel
        </button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-200/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em]">
        <span className="rounded-full bg-red-100 px-3 py-1 text-red-700">4+ indicators</span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">1–3 indicators</span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">No issues</span>
      </div>
      <div className="max-h-[34rem] overflow-auto thin-scroll">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <th className="px-4 py-3">Block / group</th>
              <th className="px-4 py-3">Facility</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3 text-center">Issues</th>
              <th className="min-w-[360px] px-4 py-3">Indicators identified</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {facilityKeys.map((facilityKey) => {
              const facility = data.facilities[facilityKey];
              const count = computed.issueCountByFacility[facilityKey] ?? 0;
              const tone = severity(count);
              return (
                <tr key={facilityKey} className={`border-t border-slate-100 ${tone.row}`}>
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{facility?.block}</td>
                  <td className="px-4 py-2.5 text-slate-800">{facility?.facility}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{facility?.facilityType}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}>{count}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs leading-6 text-slate-600">
                    {computed.issueNamesByFacility[facilityKey]?.join(", ") || <span className="text-slate-400">No issues identified</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}

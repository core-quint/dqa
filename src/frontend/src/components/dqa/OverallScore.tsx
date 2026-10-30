import { useEffect } from "react";
import { X } from "lucide-react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import type { ComputedKpis, ParsedCSV } from "../../lib/dqa/types";
import { monthYearLabel, periodDurationLabel } from "../../lib/dqa/parseUtils";
import { GROUP_COLORS } from "../../lib/dqa/constants";
import { computeOverallScore } from "../../lib/dqa/scoreUtils";
import { componentCoverageNote, formatScore } from "../../lib/dqa/scoring";
import type { WeightPortal } from "../../lib/dqa/weightedScoring";
import { WeightedScoreBreakdown } from "./WeightedScoreBreakdown";
import { BrandMark } from "../branding/BrandMark";
import { GlassPanel } from "../branding/GlassPanel";
import { PageBackdrop } from "../branding/PageBackdrop";

ChartJS.register(ArcElement, Tooltip, Legend);

interface Props {
  kpis: ComputedKpis;
  csv: ParsedCSV;
  onClose: () => void;
  groups?: string[];
  unitLabel?: string;
  /** Picks the weight table. */
  portal: Extract<WeightPortal, "HMIS" | "UWIN">;
}

const ALL_GROUPS = [
  "availability",
  "completeness",
  "accuracy",
  "consistency",
] as const;

export function OverallScore({
  kpis,
  csv,
  onClose,
  groups = [...ALL_GROUPS],
  unitLabel = "Facilities",
  portal,
}: Props) {
  // The shared scoring function — the same numbers as the score strip, the saved
  // review and the PDF (lib/dqa/scoring.ts).
  const result = computeOverallScore(kpis, portal, groups);
  const { overall, components, weighted } = result;
  const overallRound = overall === null ? null : Math.round(overall);
  const coverageNote = componentCoverageNote(result);

  // The months actually analysed, not every month in the upload.
  const months = [...kpis.selMonths].sort();
  let durationStr = "-";
  if (months.length > 0) {
    const min = months[0];
    const max = months[months.length - 1];
    const label = periodDurationLabel(months);
    if (label !== "-") {
      durationStr =
        min === max
          ? `${label} (${monthYearLabel(min)})`
          : `${label} (${monthYearLabel(min)} - ${monthYearLabel(max)})`;
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const componentColors: Record<string, string> = GROUP_COLORS;

  return (
    <PageBackdrop className="fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-6 md:py-6">
        <GlassPanel tone="warm" className="mb-5 overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/70 p-5 md:p-6">
            <div className="max-w-2xl">
              <BrandMark
                size="md"
                title="Overall Score"
                subtitle="Component score summary"
                caption="Score review"
              />
              <p className="mt-4 text-sm leading-7 text-slate-600 md:text-base">
                {csv.stateName} / {csv.distName} / {durationStr}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
            >
              <X className="h-4 w-4" />
              Back
            </button>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-4 md:p-6">
            {[
              { label: "Blocks", value: String(kpis.globalBlockCount) },
              { label: unitLabel, value: String(kpis.globalDen) },
              {
                label: "Public / Private",
                value: `${csv.publicCount} / ${csv.privateCount}`,
              },
              {
                label: "Rural / Urban",
                value: `${csv.ruralCount} / ${csv.urbanCount}`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-[24px] border border-slate-200/70 bg-white/72 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.08)]"
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {card.label}
                </div>
                <div className="mt-2 text-2xl font-extrabold text-slate-950">
                  {card.value}
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <GlassPanel className="p-5">
            <div className="relative h-64">
              <Doughnut
                data={{
                  datasets: [
                    {
                      data: [overallRound ?? 0, 100 - (overallRound ?? 0)],
                      backgroundColor: [GROUP_COLORS.availability, "#e5e7eb"],
                      borderWidth: 0,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: "72%",
                  plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                  },
                }}
              />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-6xl font-extrabold text-slate-950">
                  {overallRound ?? "N/A"}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Overall score
                </span>
              </div>
            </div>

            <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/90 px-4 py-4 text-sm leading-7 text-slate-600">
              Denominator: {kpis.globalDen} {unitLabel.toLowerCase()} in this selection.
              {" Every check has a fixed weight; component score = weighted average of its checks; overall = sum of weight × check score. A check that can't run passes its weight on."}
              {coverageNote ? ` ${coverageNote}.` : ""}
              {kpis.customMethod
                ? " Scores use the standard scoring settings; your analysis settings only change the indicator tables."
                : ""}
            </div>
          </GlassPanel>

          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((group) => {
              const component = components[group];
              const weightedComponent = weighted.components[group] ?? null;
              const topIssue = component.topKpis[0];
              return (
                <GlassPanel key={group} className="p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {component.name}
                  </div>
                  <div className="mt-2 flex items-end gap-2">
                    <span
                      className="font-display text-4xl font-extrabold"
                      style={{ color: componentColors[group] }}
                    >
                      {component.score === null ? "N/A" : Math.round(component.score)}
                    </span>
                    <span className="pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      score
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {!weightedComponent || weightedComponent.baseWeight === 0
                      ? "No weight with one period selected."
                      : weightedComponent.score === null
                        ? "No check in this component could be run on this selection."
                        : `Weight used: ${weightedComponent.effectiveWeight.toFixed(2)}% of the overall`}
                  </div>
                  {topIssue && topIssue.total > 0 ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Top issue: {topIssue.name} · {topIssue.total} {unitLabel.toLowerCase()} ({formatScore(topIssue.pct)}%)
                    </div>
                  ) : null}
                </GlassPanel>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <WeightedScoreBreakdown
            result={weighted}
            groups={groups}
            unitLabel={unitLabel.toLowerCase()}
          />
        </div>
      </div>
    </PageBackdrop>
  );
}

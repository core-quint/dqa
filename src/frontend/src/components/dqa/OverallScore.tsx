import { useEffect } from "react";
import { X } from "lucide-react";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  type ChartOptions,
  type Plugin,
} from "chart.js";
import type { ComputedKpis, ParsedCSV } from "../../lib/dqa/types";
import { monthYearLabel, periodDurationLabel } from "../../lib/dqa/parseUtils";
import { GROUP_COLORS } from "../../lib/dqa/constants";
import { computeOverallScore } from "../../lib/dqa/scoreUtils";
import { componentCoverageNote, formatScore } from "../../lib/dqa/scoring";
import { BrandMark } from "../branding/BrandMark";
import { GlassPanel } from "../branding/GlassPanel";
import { PageBackdrop } from "../branding/PageBackdrop";

ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
);

interface Props {
  kpis: ComputedKpis;
  csv: ParsedCSV;
  onClose: () => void;
  groups?: string[];
  unitLabel?: string;
}

const barValuePlugin: Plugin<"bar"> = {
  id: "barValuePlugin",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data) return;
    ctx.save();
    ctx.fillStyle = "#0f172a";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.font = "bold 11px IBM Plex Sans, Arial";
    meta.data.forEach((bar, index) => {
      const value = (chart.data.datasets[0].data[index] ?? 0) as number;
      const label = `${(Math.round(value * 10) / 10).toFixed(1)}%`;
      const position = bar.tooltipPosition(false);
      if (position.x === null || position.y === null) return;
      ctx.fillText(label, position.x as number, (position.y as number) - 4);
    });
    ctx.restore();
  },
};

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
}: Props) {
  // The shared scoring function — the same numbers as the score strip, the saved
  // review and the PDF (lib/dqa/scoring.ts).
  const result = computeOverallScore(kpis, groups);
  const { overall, components } = result;
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

  const barOptions = (maxValue: number): ChartOptions<"bar"> => {
    const dynamicMax = maxValue <= 0 ? 10 : Math.min(100, Math.ceil(maxValue * 1.3 + 1));
    return {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 20, bottom: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 11 },
            color: "#64748b",
            maxRotation: 0,
            minRotation: 0,
            callback(val) {
              const label = String(this.getLabelForValue(Number(val)));
              if (label.length <= 14) return label;
              const words = label.split(" ");
              const lines: string[] = [];
              let line = "";
              for (const word of words) {
                if (!line) {
                  line = word;
                  continue;
                }
                if ((line + " " + word).length <= 14) line += " " + word;
                else {
                  lines.push(line);
                  line = word;
                }
              }
              if (line) lines.push(line);
              return lines;
            },
          },
          grid: { display: false },
          border: { color: "#cbd5e1" },
        },
        y: {
          beginAtZero: true,
          suggestedMax: dynamicMax,
          max: dynamicMax,
          ticks: {
            callback: (value) => `${value}%`,
            font: { size: 11 },
            color: "#64748b",
          },
          grid: { color: "#eef1f6" },
          border: { display: false },
        },
      },
    };
  };

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
              Component score = 100 - worst KPI percentage (a component with no
              check that could be run is N/A). Overall score = average of the
              components that could be scored.
              {coverageNote ? ` ${coverageNote}.` : ""}
              {kpis.customMethod
                ? " Scores use the standard scoring settings; your analysis settings only change the indicator tables."
                : ""}
            </div>
          </GlassPanel>

          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map((group) => {
              const component = components[group];
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
                    {component.maxTot === null
                      ? "No check in this component could be run on this selection."
                      : `Worst KPI exposure: ${formatScore(component.maxTot)}%`}
                  </div>
                </GlassPanel>
              );
            })}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {groups.map((group) => {
            const component = components[group];
            const topValues = component.topKpis.map(
              (kpi) => Math.round(kpi.pct * 10) / 10,
            );
            const maxValue = topValues.length > 0 ? Math.max(...topValues) : 0;

            return (
              <GlassPanel key={group} className="overflow-hidden">
                <div className="border-b border-slate-200/70 px-5 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {component.name}
                  </div>
                  <div className="mt-1 text-lg font-bold text-slate-950">
                    Indicators contributing most to the score
                  </div>
                </div>

                <div className="grid gap-4 p-5 lg:grid-cols-[240px_1fr]">
                  <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
                    <div className="text-sm font-bold text-slate-900">
                      Impact range
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, component.maxAny)}%`,
                          background: "#2a78d6",
                        }}
                      />
                    </div>
                    <div className="mt-4 space-y-2 text-sm font-semibold text-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#2a78d6]" />
                        Any month
                        <span className="ml-auto text-slate-900">
                          {component.maxAny.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#199e70]" />
                        All months
                        <span className="ml-auto text-slate-900">
                          {component.maxAll.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
                    <div className="mb-3 text-sm font-bold text-slate-900">
                      Top KPIs
                    </div>
                    <div className="max-h-44 overflow-auto thin-scroll">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-left font-semibold uppercase tracking-[0.14em] text-slate-500">
                            <th className="border border-slate-100 px-2 py-2">KPI</th>
                            <th className="border border-slate-100 px-2 py-2 text-right">
                              {unitLabel}
                            </th>
                            <th className="border border-slate-100 px-2 py-2 text-right">
                              %
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {component.topKpis.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3}
                                className="px-2 py-3 text-center text-slate-500"
                              >
                                No KPI highlights
                              </td>
                            </tr>
                          ) : (
                            component.topKpis.map((kpi) => (
                              <tr key={kpi.name}>
                                <td className="border border-slate-100 px-2 py-2 text-slate-700">
                                  {kpi.name}
                                </td>
                                <td className="border border-slate-100 px-2 py-2 text-right text-slate-700">
                                  {kpi.total}
                                </td>
                                <td className="border border-slate-100 px-2 py-2 text-right text-slate-700">
                                  {kpi.pct.toFixed(1)}%
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {component.topKpis.length > 0 ? (
                  <div className="px-5 pb-5">
                    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
                      <div className="mb-3 text-sm font-bold text-slate-900">
                        Highlight chart
                      </div>
                      <div style={{ height: 280 }}>
                        <Bar
                          data={{
                            labels: component.topKpis.map((kpi) => kpi.name),
                            datasets: [
                              {
                                data: topValues,
                                backgroundColor: componentColors[group],
                                borderRadius: 6,
                                borderWidth: 0,
                                maxBarThickness: 44,
                              },
                            ],
                          }}
                          options={barOptions(maxValue)}
                          plugins={[barValuePlugin]}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </GlassPanel>
            );
          })}
        </div>
      </div>
    </PageBackdrop>
  );
}

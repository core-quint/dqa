import { useMemo, useRef, useState } from "react";
import {
  Download,
  BarChart2,
  Table2,
  FileSpreadsheet,
  Map,
} from "lucide-react";
import type { KpiCard } from "../../lib/dqa/types";
import type { UwinComputedKpis, UwinParsedCSV } from "../../lib/uwin/types";
import { KpiChart } from "../dqa/KpiChart";
import {
  FlatTable,
  T2Table,
  T3Table,
  DropoutTable,
  CoAdminTable,
  SummaryTable,
  T8Table,
} from "./UwinDataTables";
import {
  downloadXLS,
  downloadChartPNG,
  downloadHighlightedXLS,
} from "../../lib/uwin/exportUtils";
import { downloadRenderedTableXLS } from "../../lib/dqa/exportUtils";
import { KpiBlockMap } from "../dqa/KpiBlockMap";
import { StateDistrictMap } from "../stateHmis/StateDistrictMap";

type View = "chart" | "table" | "summary" | "map";

interface Props {
  card: KpiCard;
  kpis: UwinComputedKpis;
  csv: UwinParsedCSV;
}

const GROUP_LABELS: Record<string, string> = {
  availability: "Availability",
  completeness: "Completeness",
  accuracy: "Accuracy",
  consistency: "Consistency",
};

function resolveStyle(group: string, id: string) {
  if (id.startsWith("drop_")) {
    return {
      badgeBg: "#fbecf2",
      badgeText: "#a63762",
      accent: "#d55181",
      panel: "linear-gradient(180deg, rgba(251,236,242,0.6), rgba(255,255,255,1))",
    };
  }
  if (id === "t3" || id.startsWith("t3")) {
    return {
      badgeBg: "#fbf3e2",
      badgeText: "#8a5c00",
      accent: "#c98500",
      panel: "linear-gradient(180deg, rgba(251,243,226,0.6), rgba(255,255,255,1))",
    };
  }
  if (id.startsWith("iadd_")) {
    return {
      badgeBg: "#e5f6ef",
      badgeText: "#0d7a54",
      accent: "#3fae85",
      panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
    };
  }
  if (id.startsWith("co")) {
    return {
      badgeBg: "#0e7a54",
      badgeText: "#ffffff",
      accent: "#199e70",
      panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
    };
  }

  const groupStyles: Record<
    string,
    { badgeBg: string; badgeText: string; accent: string; panel: string }
  > = {
    availability: {
      badgeBg: "#e8f1fb",
      badgeText: "#1c5cab",
      accent: "#2a78d6",
      panel: "linear-gradient(180deg, rgba(232,241,251,0.6), rgba(255,255,255,1))",
    },
    completeness: {
      badgeBg: "#eceafa",
      badgeText: "#3a2d85",
      accent: "#4a3aa7",
      panel: "linear-gradient(180deg, rgba(236,234,250,0.6), rgba(255,255,255,1))",
    },
    accuracy: {
      badgeBg: "#fdeee7",
      badgeText: "#b04516",
      accent: "#eb6834",
      panel: "linear-gradient(180deg, rgba(253,238,231,0.6), rgba(255,255,255,1))",
    },
    consistency: {
      badgeBg: "#e5f6ef",
      badgeText: "#0d7a54",
      accent: "#199e70",
      panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
    },
  };

  return (
    groupStyles[group] ?? {
      badgeBg: "#f1f5f9",
      badgeText: "#475569",
      accent: "#64748b",
      panel: "linear-gradient(180deg, rgba(248,250,252,0.6), rgba(255,255,255,1))",
    }
  );
}

export function UwinKpiPanel({ card, kpis, csv }: Props) {
  const [view, setView] = useState<View>("chart");
  const [exportError, setExportError] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const { id, name, group, downloadKey, stat } = card;
  const canvasId = `canvas-${id}`;
  const showSummary = group === "completeness" || group === "accuracy";
  const style = resolveStyle(group, id);
  const isStateUwin = csv.portal === "UWIN_STATE";
  const selectedDistricts = useMemo(
    () => [...new Set(Object.values(kpis.filteredFacilities).map((row) => row.district).filter((value): value is string => Boolean(value)))],
    [kpis.filteredFacilities],
  );
  const stateDrillBlockCounts = useMemo(() => {
    const result: Record<string, number> = {};
    if (!isStateUwin || selectedDistricts.length !== 1) return result;
    for (const key of card.stat.facilityKeys) {
      const row = kpis.filteredFacilities[key];
      if (!row?.block) continue;
      result[row.block] = (result[row.block] ?? 0) + 1;
    }
    return result;
  }, [card.stat.facilityKeys, isStateUwin, kpis.filteredFacilities, selectedDistricts.length]);

  // Block-level map data
  const blockCounts = useMemo(() => {
    const chart = kpis.charts[id];
    if (!chart) return {};
    const result: Record<string, number> = {};
    chart.labels.forEach((label, i) => {
      if (label && label !== "Unknown block") result[label] = chart.values[i] ?? 0;
    });
    return result;
  }, [kpis.charts, id]);

  const allDataBlocks = useMemo(
    () => [
      ...new Set(
        Object.values(kpis.filteredFacilities)
          .map((r) => r.block)
          .filter((b): b is string => Boolean(b) && b !== "Unknown block"),
      ),
    ],
    [kpis.filteredFacilities],
  );

  const maxCount = useMemo(() => {
    const vals = Object.values(isStateUwin && selectedDistricts.length === 1 ? stateDrillBlockCounts : blockCounts);
    return vals.length > 0 ? Math.max(...vals) : 1;
  }, [blockCounts, isStateUwin, selectedDistricts.length, stateDrillBlockCounts]);

  const handleDownload = () => {
    setExportError(null);

    if (view === "chart") {
      downloadChartPNG(canvasId, name);
      return;
    }

    if (view === "map") {
      // Map view — no spreadsheet export available
      return;
    }

    if (view === "table") {
      if (!downloadRenderedTableXLS(tableContainerRef.current, name)) {
        setExportError("No table data available to export.");
      }
      return;
    }

    const summary = kpis.summaryByPid[id];
    if (!summary) return;

    const rows: (string | number | null)[][] = [["Indicator", "Facilities", "%"]];
    const allSumRows = [
      ...(summary.any ?? []),
      ...(summary.all ?? []),
      ...(summary.overall ?? []),
    ];
    for (const row of allSumRows) {
      rows.push([row.name, row.count, row.pct]);
    }
    downloadXLS(rows, `${name}-Summary`);
  };

  const handleHighlightedDownload = () => {
    setExportError(null);
    downloadHighlightedXLS(csv, downloadKey, name, kpis);
  };

  const renderTable = () => {
    if (id === "t0") return <FlatTable rows={kpis.t0Rows} highlightN />;
    if (id === "t7") return <FlatTable rows={kpis.t7Rows} highlightN />;
    if (id === "t9") return <FlatTable rows={kpis.t9Rows} highlightN />;
    if (id === "t2") return <T2Table web={kpis.t2Web} />;
    if (id === "t6") return <FlatTable rows={kpis.t6Rows} />;
    if (id === "t8") return <T8Table web={kpis.t8Web} />;
    if (id === "t3") return <T3Table web={kpis.t3Web} />;
    if (id.startsWith("drop_") && kpis.dropTables[id]) {
      return <DropoutTable web={kpis.dropTables[id]} />;
    }
    if (id === "i1") return <FlatTable rows={kpis.i1Rows} />;
    if (id === "i2") return <FlatTable rows={kpis.i2Rows} />;
    if (id.startsWith("iadd_") && kpis.inconsTables[id]) {
      return <FlatTable rows={kpis.inconsTables[id]} />;
    }
    if (id.startsWith("co") && kpis.coTables[id]) {
      return <CoAdminTable web={kpis.coTables[id]} />;
    }
    return <div className="p-4 text-sm text-slate-500">No records.</div>;
  };

  const renderSummary = () => {
    const summary = kpis.summaryByPid[id];
    if (!summary) {
      return <div className="p-4 text-sm text-slate-500">No summary data.</div>;
    }

    return (
      <div className="p-2">
        {summary.any && summary.any.length > 0 ? (
          <SummaryTable rows={summary.any} label="Any month" />
        ) : null}
        {summary.all && summary.all.length > 0 ? (
          <SummaryTable rows={summary.all} label="All months" />
        ) : null}
        {summary.overall && summary.overall.length > 0 ? (
          <SummaryTable rows={summary.overall} label="Overall" />
        ) : null}
      </div>
    );
  };

  const chart = kpis.charts[id];
  const viewOptions = (["chart", "table"] as View[])
    .concat(showSummary ? (["summary"] as View[]) : [])
    .concat(["map"] as View[]);

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
                {GROUP_LABELS[group] ?? group}
              </span>
              <span className="rounded-full border border-slate-200/80 bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                KPI detail
              </span>
            </div>

            <h2 className="mt-3 text-2xl font-extrabold leading-tight text-slate-950">
              {name}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review the chart, table, and exportable evidence for this KPI.
            </p>
          </div>

          <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Flagged
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {stat.total}
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Any month
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {stat.any}
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-white/72 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                All months
              </div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">
                {stat.all}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {viewOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setExportError(null);
                  setView(option);
                }}
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
                {option === "summary" && <FileSpreadsheet className="h-3.5 w-3.5" />}
                {option === "map" && <Map className="h-3.5 w-3.5" />}
                {option}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleHighlightedDownload}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Highlighted XLS
              </button>
              {view !== "map" && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export current
                </button>
              )}
            </div>
            {exportError ? (
              <p role="status" className="text-xs font-medium text-red-600">
                {exportError}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={`min-h-0 rounded-[26px] border border-slate-200/80 bg-white/86 ${view === "map" ? "overflow-auto thin-scroll p-4" : "flex-1 overflow-hidden"}`}
        >
          {view === "chart" ? (
            <div className="h-full p-3">
              {chart && chart.labels.length > 0 ? (
                <KpiChart payload={chart} canvasId={canvasId} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  No chart data available.
                </div>
              )}
            </div>
          ) : null}

          {view === "table" ? (
            <div ref={tableContainerRef} className="h-full overflow-auto thin-scroll">
              {renderTable()}
            </div>
          ) : null}

          {view === "summary" ? (
            <div className="h-full overflow-auto thin-scroll">{renderSummary()}</div>
          ) : null}

          {view === "map" ? (
            isStateUwin && selectedDistricts.length !== 1 ? (
              <StateDistrictMap
                stateName={csv.stateName}
                counts={blockCounts}
                districts={csv.districts}
              />
            ) : (
              <KpiBlockMap
              stateName={csv.stateName}
              districtName={isStateUwin ? selectedDistricts[0] : csv.distName}
              blockCounts={isStateUwin ? stateDrillBlockCounts : blockCounts}
              allDataBlocks={allDataBlocks}
              maxCount={maxCount}
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

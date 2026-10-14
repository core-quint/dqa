import { useEffect, useState } from "react";
import { Download, Info, Loader2 } from "lucide-react";
import { loadBreakdown } from "../../lib/breakdownStore";
import type { SnapshotRecord } from "../../lib/snapshots";
import {
  BREAKDOWN_COMPONENTS,
  breakdownWorkbookHtml,
  periodDisplayLabel,
  resolveBreakdown,
  type BreakdownCell,
  type BreakdownComponent,
  type ResolvedBreakdown,
} from "../../lib/snapshotBreakdown";
import { scoreColorClass } from "../../lib/dqa/scoreUtils";

const COMPONENT_SHORT: Record<BreakdownComponent, string> = {
  availability: "Avail.",
  completeness: "Compl.",
  accuracy: "Acc.",
  consistency: "Cons.",
};

function ScoreCellText({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value === null) return <span className="text-slate-400">N/A</span>;
  return (
    <span className={strong ? "font-bold" : "font-semibold"} style={strong ? { color: scoreColorClass(value) } : undefined}>
      {value.toFixed(1)}
    </span>
  );
}

function GridTable({
  firstHeader,
  rows,
  columns,
  unitLabel,
}: {
  firstHeader: string;
  rows: { label: string; cell: BreakdownCell | null; emphasis?: boolean }[];
  columns: BreakdownComponent[];
  unitLabel: string;
}) {
  return (
    <div className="max-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">{firstHeader}</th>
            <th className="px-2 py-2 text-right">Overall</th>
            {columns.map((group) => (
              <th key={group} className="px-2 py-2 text-right">{COMPONENT_SHORT[group]}</th>
            ))}
            <th className="px-3 py-2 text-right">{unitLabel || "Units"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={`border-t border-slate-100 ${row.emphasis ? "bg-slate-50/70" : ""}`}>
              <td className={`px-3 py-1.5 text-slate-700 ${row.emphasis ? "font-bold" : "font-medium"}`}>{row.label}</td>
              {row.cell ? (
                <>
                  <td className="px-2 py-1.5 text-right tabular-nums"><ScoreCellText value={row.cell.overall} strong /></td>
                  {columns.map((group) => (
                    <td key={group} className="px-2 py-1.5 text-right tabular-nums text-slate-600"><ScoreCellText value={row.cell![group]} /></td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{row.cell.units ?? ""}</td>
                </>
              ) : (
                <td colSpan={columns.length + 2} className="px-3 py-1.5 text-slate-400">Not recorded</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The score grid of one saved review: the area by month (or week) and each block
 * (or district) over the whole upload. Reviews saved before grids existed show the
 * one cell their score represents.
 */
export function ReviewBreakdownPanel({ snapshot, contextLines }: { snapshot: SnapshotRecord; contextLines: string[] }) {
  const [grid, setGrid] = useState<ResolvedBreakdown | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setGrid(undefined);
    loadBreakdown(snapshot)
      .then((saved) => {
        if (!cancelled) setGrid(resolveBreakdown(snapshot, saved));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the score grid.");
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot]);

  if (error) return <div className="px-5 py-4 text-xs font-semibold text-red-600">{error}</div>;
  if (grid === undefined) {
    return (
      <div className="flex items-center gap-2 px-5 py-4 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading score grid...
      </div>
    );
  }
  if (grid === null) {
    return (
      <div className="flex items-start gap-2 px-5 py-4 text-xs text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
        This review covered part of the area (some blocks, or an ownership / rural-urban / facility-type filter) and was
        saved before score grids were recorded, so its score is not a cell of the standard grid. Only its main score exists.
      </div>
    );
  }

  const cells = [grid.cumulative, ...grid.periods.map((period) => period.cell), ...grid.rows.map((row) => row.cell)];
  const columns = BREAKDOWN_COMPONENTS.filter(
    (group) => group !== "completeness" || cells.some((cell) => cell && cell.completeness !== null),
  );
  const area = grid.areaLevel === "STATE" ? "State" : "District";
  const periodWord = grid.periodKind === "WEEK" ? "week" : "month";
  const rowWord = grid.rowLevel === "BLOCK" ? "Block" : "District";

  const download = () => {
    const html = breakdownWorkbookHtml(snapshot, grid, contextLines);
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DQA_score_grid_${(grid.areaName || area).replace(/[^\w-]+/g, "_")}_${snapshot.createdAt.slice(0, 10)}.xls`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-3 bg-slate-50/60 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          {grid.source === "saved"
            ? "Score grid for the complete upload with the standard scoring settings; on-screen filters were not applied. Single-period scores cannot run the period-to-period checks."
            : "Saved before score grids were recorded: only the cell this review's score represents is filled."}
        </p>
        <button
          type="button"
          onClick={download}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" /> Download grid
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{area} by {periodWord}</div>
          <GridTable
            firstHeader={periodWord === "week" ? "Week" : "Month"}
            columns={columns}
            unitLabel={grid.unitLabel}
            rows={[
              { label: `All ${periodWord}s (cumulative)`, cell: grid.cumulative, emphasis: true },
              ...grid.periods.map((period) => ({ label: periodDisplayLabel(period), cell: period.cell })),
            ]}
          />
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{rowWord} - cumulative</div>
          {grid.rows.length > 0 ? (
            <GridTable
              firstHeader={rowWord}
              columns={columns}
              unitLabel={grid.unitLabel}
              rows={grid.rows.map((row) => ({ label: row.name, cell: row.cell }))}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">Not recorded</div>
          )}
        </div>
      </div>
    </div>
  );
}

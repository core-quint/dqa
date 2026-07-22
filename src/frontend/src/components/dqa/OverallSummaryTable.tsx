import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet } from "lucide-react";
import type { FacilityRecord, KpiCard } from "../../lib/dqa/types";
import {
  buildOverallSummary,
  buildOverallExportRows,
  sortNodes,
  type SummaryNode,
} from "../../lib/dqa/overallSummary";
import { downloadXLS } from "../../lib/dqa/exportUtils";
import { GlassPanel } from "../branding/GlassPanel";

interface Props {
  cards: KpiCard[];
  facilities: Record<string, FacilityRecord>;
  exportName: string;
}

// Colour coding per spec: >= 4 flagged indicators is red.
function severity(count: number) {
  if (count >= 4)
    return { row: "bg-red-50/70", badge: "bg-red-100 text-red-700" };
  if (count > 0) return { row: "", badge: "bg-amber-100 text-amber-700" };
  return { row: "", badge: "bg-emerald-100 text-emerald-700" };
}

export function OverallSummaryTable({ cards, facilities, exportName }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { blocks, hasSessionSites, hasDistricts } = useMemo(
    () => buildOverallSummary(cards, facilities),
    [cards, facilities],
  );

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = () => {
    downloadXLS(buildOverallExportRows(blocks, hasSessionSites, hasDistricts), exportName);
  };

  const renderRow = (
    node: SummaryNode,
    depth: number,
    rowKey: string,
  ): React.ReactNode[] => {
    const canExpand = node.children.size > 0;
    const isOpen = expanded.has(rowKey);
    const tone = severity(node.indicators.size);
    const para = [...node.indicators].join(", ");
    const rows: React.ReactNode[] = [
      <tr key={rowKey} className={`border-t border-slate-100 ${tone.row}`}>
        <td className="px-4 py-2.5">
          <div
            className="flex items-center gap-1.5"
            style={{ paddingLeft: depth * 24 }}
          >
            {canExpand ? (
              <button
                type="button"
                onClick={() => toggle(rowKey)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label={isOpen ? "Collapse" : "Expand"}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" />
            )}
            <span
              className={
                depth === 0
                  ? "font-semibold text-slate-900"
                  : depth === 1
                    ? "font-medium text-slate-700"
                    : "text-slate-600"
              }
            >
              {node.label}
            </span>
            {depth === (hasDistricts ? 3 : 2) ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Session site
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-2.5 text-center">
          <span
            className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold ${tone.badge}`}
          >
            {node.indicators.size}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs leading-6 text-slate-600">
          {para || <span className="text-slate-400">No issues identified</span>}
        </td>
      </tr>,
    ];
    if (canExpand && isOpen) {
      for (const child of sortNodes(node.children)) {
        rows.push(
          ...renderRow(child, depth + 1, `${rowKey}||${child.label}`),
        );
      }
    }
    return rows;
  };

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Overall
          </div>
          <div className="mt-1 text-lg font-bold text-slate-950">
            {hasDistricts ? "District wise Overall Summary" : "Block wise Overall Summary"}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Distinct indicators flagged across all data quality components.
            Expand {hasDistricts ? "a district to see blocks and facilities" : "a block to see facilities"}
            {hasSessionSites ? ", and a facility to see session sites" : ""}.
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
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

      {blocks.length === 0 ? (
        <div className="p-8 text-center text-sm font-medium text-slate-500">
          No data available for the current filters.
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-x-auto overflow-y-auto thin-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-3">
                  {hasDistricts ? "District / " : ""}Block{hasSessionSites ? " / Facility / Session Site" : " / Facility"}
                </th>
                <th className="px-4 py-3 text-center">
                  No. of Data Quality Issues identified
                </th>
                <th className="min-w-[320px] px-4 py-3">Indicators identified</th>
              </tr>
            </thead>
            <tbody className="bg-white">
              {blocks.flatMap((block) => renderRow(block, 0, block.label))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileSpreadsheet,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import type { FacilityRecord, KpiCard } from "../../lib/dqa/types";
import {
  buildOverallSummary,
  buildOverallExportHTML,
  heatBin,
  issueCount,
  issueTone,
  HEAT_BINS,
  LEAF_FLAG,
  type SummaryIndicator,
  type SummaryLevel,
  type SummaryNode,
} from "../../lib/dqa/overallSummary";
import { COMPONENT_LABELS } from "../../lib/dqa/scoring";
import { GROUP_COLORS } from "../../lib/dqa/constants";
import { downloadHtmlXLS } from "../../lib/dqa/exportUtils";
import { GlassPanel } from "../branding/GlassPanel";
import { useIsMobile } from "../../hooks/use-mobile";
import { CheckAll, CheckItem, Dropdown, selectionBadge } from "./FilterPanel";

interface Props {
  cards: KpiCard[];
  facilities: Record<string, FacilityRecord>;
  exportName: string;
}

// Fixed widths: the first three columns are sticky, so their left offsets must be
// known. They shrink on narrow screens so the indicator columns keep some room.
const WIDE = { name: 280, units: 92, issues: 92, indent: 18 };
const COMPACT = { name: 190, units: 70, issues: 70, indent: 12 };
const IND_W = 112;
const HEAD1_H = 40;

const HATCH = "repeating-linear-gradient(135deg, #f1f5f9 0 4px, #ffffff 4px 8px)";

const LEVEL_LABEL: Record<SummaryLevel, string> = {
  total: "Scope",
  district: "District",
  block: "Block",
  facility: "Facility",
  subcenter: "Sub Center",
  sessionsite: "Session site",
};

// Issues column: the overall summary's "4 or more indicators is red" rule.
// "None" is light blue, not green: pale green beside amber is unreadable for deutan viewers.
const TONE = {
  high: { badge: "bg-red-100 text-red-700 ring-red-200", accent: "#dc2626" },
  some: { badge: "bg-amber-100 text-amber-800 ring-amber-200", accent: "#f59e0b" },
  none: { badge: "bg-sky-50 text-sky-700 ring-sky-100", accent: "transparent" },
} as const;

type SortState = { key: string; dir: "asc" | "desc" };
const DEFAULT_SORT: SortState = { key: "issues", dir: "desc" };

interface FlatRow {
  node: SummaryNode;
  depth: number;
  expandable: boolean;
  open: boolean;
}

interface TipData {
  x: number;
  y: number;
  below: boolean;
  color: string;
  kicker: string;
  title: string;
  lines: string[];
}
type TipSetter = (tip: TipData | null) => void;

const groupColor = (group: string) => GROUP_COLORS[group] ?? "#475569";
const groupLabel = (group: string) => COMPONENT_LABELS[group] ?? group;
const capitalize = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** Whole-number %, but "<1" rather than "0" for a non-zero share. */
const pctText = (part: number, whole: number) => {
  const value = pct(part, whole);
  return part > 0 && value === 0 ? "<1" : String(value);
};

/** One floating tooltip for the whole table; owns its state so hovering never re-renders the grid. */
function FloatingTip({ register }: { register: (setter: TipSetter) => void }) {
  const [tip, setTip] = useState<TipData | null>(null);
  useEffect(() => register(setTip), [register]);
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[10000] w-max max-w-[280px] rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 py-2.5 text-xs shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.below ? "translate(-50%, 10px)" : "translate(-50%, calc(-100% - 10px))",
      }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: tip.color }}>
        <span className="h-2 w-2 rounded-full" style={{ background: tip.color }} />
        {tip.kicker}
      </div>
      <div className="mt-1 font-semibold leading-snug text-slate-950">{tip.title}</div>
      {tip.lines.map((line, index) => (
        <div key={index} className={index === 0 ? "mt-1 text-slate-700" : "mt-0.5 text-slate-500"}>
          {line}
        </div>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[2.25rem] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className={`relative h-4 w-7 rounded-full transition ${checked ? "bg-slate-900" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${checked ? "left-3.5" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-yellow-200/80 px-0.5 text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

function StatTile({ label, value, sub, children }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-xl font-bold tabular-nums text-slate-950">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div> : null}
      {children}
    </div>
  );
}

export function OverallSummaryTable({ cards, facilities, exportName }: Props) {
  const summary = useMemo(() => buildOverallSummary(cards, facilities), [cards, facilities]);
  const compact = useIsMobile(1024);
  const { name: NAME_W, units: UNITS_W, issues: ISSUES_W, indent: INDENT } = compact ? COMPACT : WIDE;
  const { total, roots, indicators, unitNoun, hasDistricts, hasSubCenters, hasSessionSites } = summary;

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hideClean, setHideClean] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [valueMode, setValueMode] = useState<"count" | "pct">("count");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tipSetter = useRef<TipSetter | null>(null);
  const lastTipCell = useRef<HTMLElement | null>(null);
  const registerTip = useCallback((setter: TipSetter) => {
    tipSetter.current = setter;
  }, []);

  const rootNoun = hasDistricts ? { one: "district", many: "districts" } : { one: "block", many: "blocks" };

  const visible = useMemo(
    () => indicators.filter((ind) => !hidden.has(ind.id) && (!hideClean || ind.flagged > 0)),
    [indicators, hidden, hideClean],
  );
  const visibleIds = useMemo(() => visible.map((ind) => ind.id), [visible]);
  const indicatorById = useMemo(() => new Map(indicators.map((ind) => [ind.id, ind])), [indicators]);

  const groups = useMemo(() => {
    const out: { group: string; items: SummaryIndicator[] }[] = [];
    for (const ind of visible) {
      const last = out[out.length - 1];
      if (last && last.group === ind.group) last.items.push(ind);
      else out.push({ group: ind.group, items: [ind] });
    }
    return out;
  }, [visible]);

  const allGroups = useMemo(() => {
    const out: { group: string; items: SummaryIndicator[] }[] = [];
    for (const ind of indicators) {
      const last = out[out.length - 1];
      if (last && last.group === ind.group) last.items.push(ind);
      else out.push({ group: ind.group, items: [ind] });
    }
    return out;
  }, [indicators]);

  // ---- sorting (siblings only; the hierarchy is kept) ----
  const orderChildren = useMemo(() => {
    const cache = new Map<string, SummaryNode[]>();
    const value = (node: SummaryNode): number | string => {
      if (sort.key === "name") return node.label;
      if (sort.key === "units") return node.units;
      if (sort.key === "issues") return issueCount(node, visibleIds);
      return node.flagged[sort.key] ?? 0;
    };
    const share = (node: SummaryNode) => (node.flagged[sort.key] ?? 0) / Math.max(node.units, 1);
    return (node: SummaryNode): SummaryNode[] => {
      const hit = cache.get(node.key);
      if (hit) return hit;
      const list = [...node.children.values()].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        let d = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
        if (d === 0 && indicatorById.has(sort.key)) d = share(a) - share(b);
        if (sort.dir === "desc") d = -d;
        return d || issueCount(b, visibleIds) - issueCount(a, visibleIds) || a.label.localeCompare(b.label);
      });
      cache.set(node.key, list);
      return list;
    };
  }, [sort, visibleIds, indicatorById]);

  const sortBy = (key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  };

  // ---- visible rows: search, "only rows with issues", expand state ----
  const q = query.trim().toLowerCase();
  const flatRows = useMemo(() => {
    const matches = new Map<string, boolean>();
    const selfMatch = (node: SummaryNode) => node.label.toLowerCase().includes(q);
    const mark = (node: SummaryNode): boolean => {
      let any = selfMatch(node);
      for (const child of node.children.values()) if (mark(child)) any = true;
      matches.set(node.key, any);
      return any;
    };
    if (q) for (const root of roots) mark(root);

    const out: FlatRow[] = [];
    const visit = (node: SummaryNode, depth: number, ancestorMatched: boolean) => {
      if (q && !ancestorMatched && !matches.get(node.key)) return;
      if (onlyIssues && issueCount(node, visibleIds) === 0) return;
      const expandable = node.children.size > 0;
      const childMatches = Boolean(q) && !ancestorMatched
        && [...node.children.values()].some((child) => matches.get(child.key));
      const open = expandable && (expanded.has(node.key) || childMatches);
      out.push({ node, depth, expandable, open });
      if (open) {
        const matched = ancestorMatched || (Boolean(q) && selfMatch(node));
        for (const child of orderChildren(node)) visit(child, depth + 1, matched);
      }
    };
    for (const root of orderChildren(total)) visit(root, 0, false);
    return out;
  }, [q, roots, total, onlyIssues, visibleIds, expanded, orderChildren]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // "Expand all" opens districts and blocks (facility rows appear); deeper U-WIN
  // levels stay one click away so the table cannot explode into thousands of rows.
  const expandAll = () => {
    const next = new Set<string>();
    for (const node of summary.nodeByKey.values()) {
      if ((node.level === "district" || node.level === "block") && node.children.size > 0) next.add(node.key);
    }
    setExpanded(next);
  };
  const anyExpanded = expanded.size > 0;

  // ---- component chips / indicator picker ----
  const toggleGroup = (group: string) => {
    setHidden((prev) => {
      const ids = indicators.filter((ind) => ind.group === group).map((ind) => ind.id);
      const allShown = ids.every((id) => !prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allShown) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const setIndicator = (id: string, on: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const resetView = () => {
    setHidden(new Set());
    setHideClean(false);
    setOnlyIssues(false);
    setValueMode("count");
    setQuery("");
    setSort(DEFAULT_SORT);
  };
  const viewChanged = hidden.size > 0 || hideClean || onlyIssues || valueMode !== "count" || query !== ""
    || sort.key !== DEFAULT_SORT.key || sort.dir !== DEFAULT_SORT.dir;

  // ---- headline numbers (follow the indicators shown) ----
  const stats = useMemo(() => {
    const ids = new Set(visibleIds);
    const flaggedUnits = new Set<string>();
    for (const card of cards) {
      if (!ids.has(card.id)) continue;
      for (const key of card.stat.facilityKeys) if (facilities[key]) flaggedUnits.add(key);
    }
    let top: SummaryIndicator | null = null;
    for (const ind of visible) if (ind.flagged > 0 && (!top || ind.flagged > top.flagged)) top = ind;
    const hotRoots = roots.filter((root) => issueCount(root, visibleIds) >= 4).length;
    return { flaggedUnits: flaggedUnits.size, top, hotRoots };
  }, [cards, facilities, visible, visibleIds, roots]);

  // ---- tooltip (event delegation; the grid itself never re-renders on hover) ----
  const describeCell = (node: SummaryNode, ind: SummaryIndicator): string[] => {
    const where = node.level === "total" ? node.label : `${LEVEL_LABEL[node.level]}: ${node.label}`;
    const flagged = node.flagged[ind.id] ?? 0;
    const eligible = node.eligible[ind.id] ?? 0;
    const leaf = node.children.size === 0 && node.level !== "total";
    if (flagged === 0 && eligible === 0) return [where, "Not checkable here: the check could not run (for example it needs two adjacent months)."];
    if (leaf) return [where, flagged > 0 ? "Flagged for this indicator" : "No issue"];
    if (flagged === 0) return [where, `No ${unitNoun.one} flagged (of ${node.units})`];
    return [
      where,
      `${flagged} of ${node.units} ${node.units === 1 ? unitNoun.one : unitNoun.many} flagged (${pctText(flagged, node.units)}%)`,
      eligible < node.units ? `${eligible} could be checked` : "",
    ].filter(Boolean);
  };

  const onGridOver = (event: React.MouseEvent<HTMLElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-tip]");
    if (cell === lastTipCell.current) return;
    lastTipCell.current = cell;
    if (!cell) {
      tipSetter.current?.(null);
      return;
    }
    const ind = indicatorById.get(cell.dataset.ind ?? "");
    if (!ind) {
      tipSetter.current?.(null);
      return;
    }
    const rect = cell.getBoundingClientRect();
    const below = rect.top < 150;
    const x = Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150);
    const base = { x, y: below ? rect.bottom : rect.top, below, color: groupColor(ind.group), kicker: groupLabel(ind.group), title: ind.name };
    if (cell.dataset.row) {
      const node = summary.nodeByKey.get(cell.dataset.row);
      if (node) tipSetter.current?.({ ...base, lines: describeCell(node, ind) });
      return;
    }
    tipSetter.current?.({
      ...base,
      lines: [
        ind.eligible === 0
          ? "Not checkable for the current selection"
          : `${ind.flagged} of ${total.units} ${unitNoun.many} flagged (${pctText(ind.flagged, total.units)}%)`,
        "Click to sort by this indicator",
      ],
    });
  };
  const onGridLeave = () => {
    lastTipCell.current = null;
    tipSetter.current?.(null);
  };

  const handleExport = () => {
    const title = `${hasDistricts ? "District" : "Block"} wise Overall Summary`;
    downloadHtmlXLS(buildOverallExportHTML(summary, visible, orderChildren, GROUP_COLORS, title), exportName);
  };

  // ---- cells ----
  const groupStarts = useMemo(() => {
    const starts = new Set<string>();
    for (const g of groups) starts.add(g.items[0].id);
    return starts;
  }, [groups]);

  const renderCell = (node: SummaryNode, ind: SummaryIndicator, leaf: boolean) => {
    const flagged = node.flagged[ind.id] ?? 0;
    const eligible = node.eligible[ind.id] ?? 0;
    if (flagged === 0 && eligible === 0) {
      return (
        <div className="flex h-8 items-center justify-center rounded-lg text-[10px] font-semibold italic text-slate-400" style={{ backgroundImage: HATCH }}>
          n/a
        </div>
      );
    }
    if (flagged === 0) return <div className="flex h-8 items-center justify-center text-slate-300">–</div>;
    if (leaf) {
      return (
        <div className="flex h-8 items-center justify-center rounded-lg" style={{ background: LEAF_FLAG.bg }}>
          <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: LEAF_FLAG.dot }} />
        </div>
      );
    }
    const bin = heatBin(flagged, node.units)!;
    return (
      <div
        className="flex h-8 items-center justify-center rounded-lg text-xs font-bold tabular-nums shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] transition group-hover/cell:scale-[1.06]"
        style={{ background: bin.bg, color: bin.fg }}
      >
        {valueMode === "pct" ? `${pctText(flagged, node.units)}%` : flagged}
      </div>
    );
  };

  const renderRow = ({ node, depth, expandable, open }: FlatRow, isTotal = false) => {
    const leaf = !isTotal && node.children.size === 0;
    const issues = issueCount(node, visibleIds);
    const tone = TONE[issueTone(issues)];
    const rowBg = isTotal ? "bg-slate-100" : node.level === "district" ? "bg-slate-50" : "bg-white";
    const cellBase = `${rowBg} group-hover:bg-sky-50 border-b border-slate-100`;
    const nameWeight = isTotal || node.level === "district"
      ? "font-bold text-slate-950"
      : node.level === "block"
        ? "font-semibold text-slate-900"
        : node.level === "facility"
          ? "font-medium text-slate-700"
          : "text-slate-600";
    const levelTag = node.level === "subcenter" || node.level === "sessionsite"
      ? LEVEL_LABEL[node.level]
      : null;
    return (
      <tr key={node.key} className="group">
        <td
          className={`sticky left-0 z-[5] px-3 py-1.5 ${cellBase}`}
          style={{ width: NAME_W, minWidth: NAME_W, maxWidth: NAME_W, boxShadow: `inset 3px 0 0 ${isTotal ? "#0f172a" : tone.accent}` }}
        >
          <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * INDENT }}>
            {expandable ? (
              <button
                type="button"
                onClick={() => toggle(node.key)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-sm"
                aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            ) : (
              <span className="h-6 w-6 shrink-0" />
            )}
            <span className={`min-w-0 truncate text-[13px] ${nameWeight}`} title={node.label}>
              <Highlight text={node.label} query={query} />
            </span>
            {levelTag ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {levelTag}
              </span>
            ) : null}
          </div>
        </td>
        <td
          className={`sticky z-[5] px-2 py-1.5 text-center text-[13px] tabular-nums text-slate-600 ${cellBase}`}
          style={{ left: NAME_W, width: UNITS_W, minWidth: UNITS_W }}
        >
          {leaf ? <span className="text-slate-300">·</span> : node.units}
        </td>
        <td
          className={`sticky z-[5] px-2 py-1.5 text-center shadow-[6px_0_8px_-6px_rgba(15,23,42,0.18)] ${cellBase}`}
          style={{ left: NAME_W + UNITS_W, width: ISSUES_W, minWidth: ISSUES_W }}
        >
          <span className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ring-1 ${tone.badge}`}>
            {issues}
          </span>
        </td>
        {visible.map((ind) => (
          <td
            key={ind.id}
            data-tip=""
            data-row={node.key}
            data-ind={ind.id}
            className={`group/cell p-1 ${cellBase} ${groupStarts.has(ind.id) ? "border-l border-l-slate-200" : ""}`}
            style={{ width: IND_W, minWidth: IND_W }}
          >
            {renderCell(node, ind, leaf)}
          </td>
        ))}
      </tr>
    );
  };

  const sortIcon = (key: string) => {
    if (sort.key !== key) return null;
    return sort.dir === "desc"
      ? <ArrowDownWideNarrow className="h-3.5 w-3.5 shrink-0 text-slate-900" />
      : <ArrowUpNarrowWide className="h-3.5 w-3.5 shrink-0 text-slate-900" />;
  };
  const ariaSort = (key: string) => (sort.key === key ? (sort.dir === "desc" ? "descending" : "ascending") : "none");

  const headCell = "sticky top-0 z-30 border-b border-slate-200 bg-slate-50 px-3 text-left align-bottom";
  const nameHeader = `${hasDistricts ? "District / " : ""}Block / Facility${hasSubCenters ? " / Sub Center" : ""}${hasSessionSites ? " / Session Site" : ""}`;

  return (
    <GlassPanel>
      <FloatingTip register={registerTip} />

      {/* ---- title ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Overall</div>
          <div className="mt-1 text-lg font-bold text-slate-950">
            {hasDistricts ? "District wise Overall Summary" : "Block wise Overall Summary"}
          </div>
          <div className="mt-1 max-w-3xl text-sm text-slate-600">
            Each cell shows how many {unitNoun.many} in that row have the issue; the darker the cell, the larger the share of
            the row's {unitNoun.many}. Click a column to sort, use the component chips to focus, and expand{" "}
            {hasDistricts ? "a district to see blocks and facilities" : "a block to see its facilities"}.
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          title="Every row, with the indicators currently shown"
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-slate-50"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Download Excel
        </button>
      </div>

      {/* ---- headline tiles ---- */}
      <div className="grid gap-3 border-b border-slate-200/70 bg-slate-50/60 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="In scope"
          value={`${total.units.toLocaleString()} ${unitNoun.many}`}
          sub={`${roots.length} ${roots.length === 1 ? rootNoun.one : rootNoun.many}`}
        />
        <StatTile
          label="With at least one issue"
          value={
            <>
              {stats.flaggedUnits.toLocaleString()}
              <span className="ml-1.5 text-sm font-semibold text-slate-500">{pctText(stats.flaggedUnits, total.units)}%</span>
            </>
          }
        >
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#f03b20]" style={{ width: `${pct(stats.flaggedUnits, total.units)}%` }} />
          </div>
        </StatTile>
        <StatTile
          label="Most widespread issue"
          value={<span className="text-base" title={stats.top?.name}>{stats.top ? stats.top.short : "None"}</span>}
          sub={stats.top ? `${stats.top.flagged} ${stats.top.flagged === 1 ? unitNoun.one : unitNoun.many} · ${groupLabel(stats.top.group)}` : "No indicator flagged"}
        />
        <StatTile
          label={`${capitalize(rootNoun.many)} with 4+ issues`}
          value={
            <>
              {stats.hotRoots}
              <span className="ml-1.5 text-sm font-semibold text-slate-500">of {roots.length}</span>
            </>
          }
          sub={stats.hotRoots > 0 ? "Red rows in the table" : "No red rows"}
        />
      </div>

      {/* ---- toolbar ---- */}
      <div className="space-y-3 border-b border-slate-200/70 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Components</span>
          {allGroups.map(({ group, items }) => {
            const shown = items.filter((ind) => !hidden.has(ind.id)).length;
            const on = shown > 0;
            const color = groupColor(group);
            const flagged = items.filter((ind) => ind.flagged > 0).length;
            return (
              <button
                key={group}
                type="button"
                onClick={() => toggleGroup(group)}
                aria-pressed={on}
                title={`${on ? "Hide" : "Show"} ${groupLabel(group)} indicators · ${flagged} of ${items.length} with issues`}
                className="inline-flex min-h-[2.25rem] items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] font-semibold transition"
                style={on
                  ? { background: color, borderColor: color, color: "#ffffff", boxShadow: `0 6px 16px -8px ${color}` }
                  : { background: "#ffffff", borderColor: "#e2e8f0", color: "#64748b" }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? "#ffffff" : color }} />
                {groupLabel(group)}
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums"
                  style={on ? { background: "rgba(255,255,255,0.25)" } : { background: "#f1f5f9" }}
                >
                  {shown === items.length ? items.length : `${shown}/${items.length}`}
                </span>
              </button>
            );
          })}
          <Dropdown label="Indicators" badge={selectionBadge(indicators.length - hidden.size, indicators.length)}>
            <CheckAll
              label="Select All"
              checked={hidden.size === 0}
              onChange={(value) => setHidden(value ? new Set() : new Set(indicators.map((ind) => ind.id)))}
            />
            {allGroups.map(({ group, items }) => (
              <div key={group} className="mt-2 border-t border-slate-200/80 pt-2">
                <div className="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: groupColor(group) }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: groupColor(group) }} />
                  {groupLabel(group)}
                </div>
                {items.map((ind) => (
                  <CheckItem
                    key={ind.id}
                    label={`${ind.short} (${ind.eligible === 0 ? "n/a" : ind.flagged})`}
                    checked={!hidden.has(ind.id)}
                    onChange={(on) => setIndicator(ind.id, on)}
                  />
                ))}
              </div>
            ))}
          </Dropdown>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${hasDistricts ? "district, " : ""}block or ${unitNoun.one}`}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-8 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          <Toggle checked={onlyIssues} onChange={setOnlyIssues} label="Only rows with issues" />
          <Toggle checked={hideClean} onChange={setHideClean} label="Hide indicators with no issues" />
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5 text-[12px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)]" role="group" aria-label="Cell values">
            {(["count", "pct"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setValueMode(mode)}
                aria-pressed={valueMode === mode}
                className={`rounded-[10px] px-2.5 py-1.5 transition ${valueMode === mode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {mode === "count" ? `No. of ${unitNoun.many}` : "% of row"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={anyExpanded ? () => setExpanded(new Set()) : expandAll}
            className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-slate-50"
          >
            {anyExpanded ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            {anyExpanded ? "Collapse all" : "Expand all"}
          </button>
          {viewChanged ? (
            <button
              type="button"
              onClick={resetView}
              className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[13px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset view
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- grid ---- */}
      {roots.length === 0 ? (
        <div className="p-8 text-center text-sm font-medium text-slate-500">No data available for the current filters.</div>
      ) : visible.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">
          No indicator is shown.{" "}
          <button type="button" onClick={resetView} className="font-semibold text-slate-900 underline underline-offset-2">
            Show all indicators
          </button>
        </div>
      ) : (
        <>
        {/* ---- key, attached to the table: the left part sits over the fixed
             columns and explains Issues, the right part sits over the indicator columns ---- */}
        <div className="flex flex-wrap items-stretch border-b border-slate-200 bg-slate-50/80 text-[11px] text-slate-600">
          <div
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 ${compact ? "w-full border-b border-slate-200" : "justify-end border-r border-slate-200"}`}
            style={compact ? undefined : { width: NAME_W + UNITS_W + ISSUES_W }}
          >
            <span className="font-semibold text-slate-700">Issues column</span>
            <span>= indicators flagged in the row</span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-bold text-red-700 ring-1 ring-red-200">4+</span>
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800 ring-1 ring-amber-200">1–3</span>
              <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700 ring-1 ring-sky-100">0</span>
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700">Indicator cells</span>
              <span>= share of the row's {unitNoun.many} with the issue</span>
              <span className="inline-flex items-start gap-0.5">
                {HEAT_BINS.map((bin) => (
                  <span key={bin.label} className="flex flex-col items-center gap-0.5">
                    <span className="h-3 w-11 rounded-sm" style={{ background: bin.bg, boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)" }} />
                    <span className="text-[10px] leading-none text-slate-500">{bin.label}</span>
                  </span>
                ))}
              </span>
            </div>
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-4 w-7 items-center justify-center rounded" style={{ background: LEAF_FLAG.bg }}>
                <span className="h-2 w-2 rounded-full" style={{ background: LEAF_FLAG.dot }} />
              </span>
              {capitalize(unitNoun.one)} row flagged
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="flex h-4 w-7 items-center justify-center text-slate-300">–</span>
              No issue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-4 w-7 rounded" style={{ backgroundImage: HATCH, boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)" }} />
              n/a = could not be checked
            </span>
          </div>
        </div>
        <div
          className="thin-scroll max-h-[70vh] overflow-auto"
          onMouseOver={onGridOver}
          onMouseLeave={onGridLeave}
        >
          <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                <th rowSpan={2} className={`${headCell} left-0 z-40 py-3`} style={{ width: NAME_W, minWidth: NAME_W }} aria-sort={ariaSort("name")}>
                  <button type="button" onClick={() => sortBy("name")} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 hover:text-slate-950">
                    {nameHeader}
                    {sortIcon("name")}
                  </button>
                </th>
                <th rowSpan={2} className={`${headCell} z-40 py-3 text-center`} style={{ left: NAME_W, width: UNITS_W, minWidth: UNITS_W }} aria-sort={ariaSort("units")}>
                  <button type="button" onClick={() => sortBy("units")} className="mx-auto flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-950" title={`Number of ${unitNoun.many} in the row`}>
                    {capitalize(unitNoun.many)}
                    {sortIcon("units")}
                  </button>
                </th>
                <th
                  rowSpan={2}
                  className={`${headCell} z-40 py-3 text-center shadow-[6px_0_8px_-6px_rgba(15,23,42,0.18)]`}
                  style={{ left: NAME_W + UNITS_W, width: ISSUES_W, minWidth: ISSUES_W }}
                  aria-sort={ariaSort("issues")}
                >
                  <button type="button" onClick={() => sortBy("issues")} className="mx-auto flex flex-col items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 hover:text-slate-950" title="Number of distinct indicators flagged in the row (of those shown); 4 or more is red">
                    <span className="flex items-center gap-1">Issues{sortIcon("issues")}</span>
                    <span className="mt-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-400">of {visible.length} shown</span>
                  </button>
                </th>
                {groups.map(({ group, items }) => (
                  <th
                    key={group}
                    colSpan={items.length}
                    className="sticky top-0 z-20 overflow-hidden whitespace-nowrap border-l-2 border-white px-2 text-center text-[11px] font-bold uppercase text-white"
                    style={{ height: HEAD1_H, background: groupColor(group), letterSpacing: items.length === 1 ? "0.04em" : "0.14em" }}
                    title={`${groupLabel(group)} · ${items.length} indicator${items.length === 1 ? "" : "s"}`}
                  >
                    {groupLabel(group)}
                    {items.length > 1 ? (
                      <span className="ml-1.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] tracking-normal">{items.length}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
              <tr>
                {visible.map((ind) => (
                  <th
                    key={ind.id}
                    className={`sticky z-20 border-b border-slate-200 bg-white p-0 align-bottom ${groupStarts.has(ind.id) ? "border-l border-l-slate-200" : ""}`}
                    style={{ top: HEAD1_H, width: IND_W, minWidth: IND_W, maxWidth: IND_W, boxShadow: `inset 0 3px 0 ${groupColor(ind.group)}` }}
                    aria-sort={ariaSort(ind.id)}
                  >
                    <button
                      type="button"
                      data-tip=""
                      data-ind={ind.id}
                      onClick={() => sortBy(ind.id)}
                      className={`flex w-full flex-col items-center justify-end gap-1 px-1.5 pb-2 pt-3 text-center transition hover:bg-slate-50 ${sort.key === ind.id ? "bg-slate-50" : ""}`}
                    >
                      <span className="line-clamp-3 text-[11px] font-semibold leading-tight text-slate-700">{ind.short}</span>
                      {ind.eligible === 0 ? (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">n/a</span>
                      ) : (
                        <span className="flex h-3.5 items-center">{sortIcon(ind.id)}</span>
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderRow({ node: total, depth: 0, expandable: false, open: false }, true)}
              {flatRows.map((row) => renderRow(row))}
              {flatRows.length === 0 ? (
                <tr>
                  <td colSpan={3 + visible.length} className="px-4 py-8 text-center text-sm text-slate-500">
                    {q ? `Nothing matches "${query.trim()}".` : `No ${rootNoun.one} has an issue in the indicators shown.`}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </>
      )}
      {roots.length > 0 && visible.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 px-5 py-2.5 text-[11px] text-slate-500">
          <span>
            {flatRows.length} row{flatRows.length === 1 ? "" : "s"} · {visible.length} of {indicators.length} indicators shown
          </span>
          <span>Hover a cell for details · click a column heading to sort</span>
        </div>
      ) : null}
    </GlassPanel>
  );
}

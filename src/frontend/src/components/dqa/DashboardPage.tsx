import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  ChevronRight,
  ClipboardList,
  Download,
  Landmark,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  Syringe,
  Users,
} from "lucide-react";
import { apiFetch } from "../../api";
import { GlassPanel } from "../branding/GlassPanel";
import type { AuthState } from "./LoginPage";
import type { SnapshotRecord } from "../../lib/snapshots";
import {
  applyDashboardFilters,
  computeDashboardStats,
  EMPTY_DASHBOARD_FILTERS,
  groupByCategory,
  groupByGeo,
  groupByMonth,
  presetRange,
  toDashboardRecord,
  type CategoryRow,
  type DashboardFilters,
  type DashboardRecord,
  type DatePreset,
  type GeoLevel,
  type MonthBucket,
} from "../../lib/dashboard";

// Chart series colors. HMIS keeps the app's portal blue; the U-WIN mark is
// shifted from the app's violet (#8b5cf6) to fuchsia because blue+violet is
// indistinguishable under deuteranopia (validated pair: ΔE 22.7, both ≥3:1
// on white). Legends/labels always accompany color.
const HMIS_COLOR = "#3b82f6";
const UWIN_COLOR = "#a21caf";
const INK = "#0f172a";
const GRID = "#e2e8f0";
const AXIS_TEXT = "#64748b";

interface Props {
  auth: AuthState;
}

const nf = new Intl.NumberFormat("en-IN");

function fmtCount(n: number): string {
  return nf.format(n);
}

function fmtScore(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function gradeOf(score: number) {
  if (score >= 85) return { label: "Excellent", chip: "bg-emerald-100 text-emerald-700" };
  if (score >= 70) return { label: "Good", chip: "bg-sky-100 text-sky-700" };
  if (score >= 50) return { label: "Moderate", chip: "bg-amber-100 text-amber-700" };
  return { label: "Needs attention", chip: "bg-red-100 text-red-700" };
}

function ScoreChip({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="inline-flex min-w-[44px] justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">—</span>;
  }
  const grade = gradeOf(score);
  return (
    <span
      className={`inline-flex min-w-[44px] justify-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${grade.chip}`}
      title={`Average overall score: ${score.toFixed(1)} (${grade.label})`}
    >
      {score.toFixed(1)}
    </span>
  );
}

// ---------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <GlassPanel className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-1.5 truncate text-3xl font-extrabold text-slate-950">
            {value}
          </div>
          {sub ? (
            <div className="mt-1 truncate text-[11px] font-medium text-slate-500">{sub}</div>
          ) : null}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
          {icon}
        </div>
      </div>
    </GlassPanel>
  );
}

// ---------------------------------------------------------------
// Legend (shared by every 2-series chart)
// ---------------------------------------------------------------

function PortalLegend({ hmis, uwin }: { hmis: boolean; uwin: boolean }) {
  return (
    <div className="flex items-center gap-4">
      {hmis ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: HMIS_COLOR }} />
          HMIS
        </span>
      ) : null}
      {uwin ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: UWIN_COLOR }} />
          U-WIN
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------
// Monthly activity — stacked columns (SVG)
// ---------------------------------------------------------------

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (n <= m * pow) return Math.ceil(m * pow);
  }
  return n;
}

function MonthlyActivityChart({ months }: { months: MonthBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const PAD_L = 36;
  const PAD_R = 8;
  const PAD_T = 14;
  const PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const maxTotal = niceMax(Math.max(1, ...months.map((m) => m.total)));
  const band = plotW / Math.max(1, months.length);
  const barW = Math.min(24, Math.max(6, band * 0.55));
  const y = (v: number) => PAD_T + plotH - (v / maxTotal) * plotH;
  const ticks = [0, maxTotal / 4, maxTotal / 2, (3 * maxTotal) / 4, maxTotal].map((t) => Math.round(t));
  const labelEvery = Math.max(1, Math.ceil(months.length / 12));
  const hovered = hover !== null ? months[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="DQA reviews per month, stacked by data source">
        {[...new Set(ticks)].map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT} style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtCount(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = PAD_L + band * i + band / 2;
          const x0 = cx - barW / 2;
          const hmisH = (m.hmis / maxTotal) * plotH;
          const uwinH = (m.uwin / maxTotal) * plotH;
          const gap = m.hmis > 0 && m.uwin > 0 ? 2 : 0;
          const hmisY = PAD_T + plotH - hmisH;
          const uwinY = hmisY - gap - uwinH;
          const capR = 4;
          return (
            <g key={m.key}>
              {/* HMIS segment — square at baseline; rounded cap only when topmost */}
              {m.hmis > 0 ? (
                m.uwin > 0 ? (
                  <rect x={x0} y={hmisY} width={barW} height={hmisH} fill={HMIS_COLOR} />
                ) : (
                  <path d={roundedTopBar(x0, hmisY, barW, hmisH, capR)} fill={HMIS_COLOR} />
                )
              ) : null}
              {m.uwin > 0 ? (
                <path d={roundedTopBar(x0, uwinY, barW, uwinH, capR)} fill={UWIN_COLOR} />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
                  {m.label}
                </text>
              ) : null}
              {/* Hit target: the whole column band, far bigger than the mark */}
              <rect
                x={PAD_L + band * i}
                y={PAD_T}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${m.label}: ${m.total} reviews (${m.hmis} HMIS, ${m.uwin} U-WIN)`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {hover === i ? (
                <rect
                  x={x0 - 2}
                  y={Math.min(hmisY, m.uwin > 0 ? uwinY : hmisY) - 2}
                  width={barW + 4}
                  height={4 + hmisH + uwinH + gap}
                  fill="none"
                  stroke={INK}
                  strokeOpacity={0.25}
                  strokeWidth={1}
                  rx={5}
                />
              ) : null}
            </g>
          );
        })}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="#cbd5e1" strokeWidth={1} />
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[150px] rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"
          style={{
            left: `${(((PAD_L + band * (hover as number) + band / 2) / W) * 100).toFixed(2)}%`,
            top: 0,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{hovered.label}</div>
          <div className="mt-1 space-y-0.5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-0.5 w-3 rounded" style={{ background: HMIS_COLOR }} /> HMIS
              </span>
              <span className="font-bold tabular-nums text-slate-900">{fmtCount(hovered.hmis)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-0.5 w-3 rounded" style={{ background: UWIN_COLOR }} /> U-WIN
              </span>
              <span className="font-bold tabular-nums text-slate-900">{fmtCount(hovered.uwin)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-0.5 text-sm">
              <span className="text-xs text-slate-500">Total</span>
              <span className="font-bold tabular-nums text-slate-900">{fmtCount(hovered.total)}</span>
            </div>
            {hovered.avgOverall !== null ? (
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-xs text-slate-500">Avg score</span>
                <span className="font-bold tabular-nums text-slate-900">{hovered.avgOverall.toFixed(1)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Bar path: 4px rounded data-end (top), square at the baseline. */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`;
}

// ---------------------------------------------------------------
// Average score trend — line (SVG)
// ---------------------------------------------------------------

function ScoreTrendChart({ months }: { months: MonthBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 360;
  const H = 240;
  const PAD_L = 30;
  const PAD_R = 12;
  const PAD_T = 14;
  const PAD_B = 26;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const scored = months.filter((m) => m.avgOverall !== null);
  const band = plotW / Math.max(1, months.length);
  const cx = (i: number) => PAD_L + band * i + band / 2;
  const cy = (v: number) => PAD_T + plotH - (v / 100) * plotH;
  const points = months
    .map((m, i) => (m.avgOverall !== null ? { i, x: cx(i), y: cy(m.avgOverall), v: m.avgOverall, label: m.label } : null))
    .filter((p): p is { i: number; x: number; y: number; v: number; label: string } => p !== null);
  const path = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const labelEvery = Math.max(1, Math.ceil(months.length / 6));
  const hoveredPoint = hover !== null ? points.find((p) => p.i === hover) ?? null : null;

  if (scored.length === 0) {
    return <div className="flex h-[200px] items-center justify-center text-sm font-medium text-slate-400">No scored reviews in this slice.</div>;
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average overall DQA score per month">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={cy(t)} y2={cy(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L - 5} y={cy(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT} style={{ fontVariantNumeric: "tabular-nums" }}>
              {t}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          i % labelEvery === 0 ? (
            <text key={m.key} x={cx(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>
              {m.label}
            </text>
          ) : null,
        )}
        {hoveredPoint ? (
          <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={PAD_T} y2={PAD_T + plotH} stroke="#94a3b8" strokeWidth={1} />
        ) : null}
        <path d={path} fill="none" stroke={INK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p) => (
          <g key={p.i}>
            {/* 2px surface ring keeps markers legible where they cross the line */}
            <circle cx={p.x} cy={p.y} r={5.5} fill="#ffffff" />
            <circle cx={p.x} cy={p.y} r={3.5} fill={INK} />
          </g>
        ))}
        {last ? (
          <text x={Math.min(last.x + 8, W - PAD_R)} y={last.y - 8} fontSize={11} fontWeight={700} fill={INK} textAnchor={last.x > W - 60 ? "end" : "start"} style={{ fontVariantNumeric: "tabular-nums" }}>
            {last.v.toFixed(1)}
          </text>
        ) : null}
        {/* Hit bands: aim at a month, not at a 2px line */}
        {months.map((m, i) => (
          <rect
            key={m.key}
            x={PAD_L + band * i}
            y={PAD_T}
            width={band}
            height={plotH}
            fill="transparent"
            tabIndex={m.avgOverall !== null ? 0 : -1}
            aria-label={m.avgOverall !== null ? `${m.label}: average score ${m.avgOverall.toFixed(1)}` : undefined}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      {hoveredPoint ? (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-lg"
          style={{ left: `${((hoveredPoint.x / W) * 100).toFixed(2)}%`, top: 0, transform: "translateX(-50%)" }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{hoveredPoint.label}</div>
          <div className="text-sm font-bold tabular-nums text-slate-900">{hoveredPoint.v.toFixed(1)}</div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------
// Horizontal stacked bar list (geo drill / designation / purpose)
// ---------------------------------------------------------------

interface BarListRow {
  key: string;
  label: string;
  hmis: number;
  uwin: number;
  total: number;
  avgOverall: number | null;
  details?: { label: string; count: number }[];
}

function StackedBarList({
  rows,
  onRowClick,
  activeKey,
  clickHint,
  initialLimit = 12,
}: {
  rows: BarListRow[];
  onRowClick?: (row: BarListRow) => void;
  activeKey?: string;
  clickHint?: string;
  initialLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const visible = expanded ? rows : rows.slice(0, initialLimit);

  if (rows.length === 0) {
    return <div className="flex h-24 items-center justify-center text-sm font-medium text-slate-400">No reviews in this slice.</div>;
  }

  return (
    <div className="space-y-1">
      {visible.map((row) => {
        const hmisPct = (row.hmis / max) * 100;
        const uwinPct = (row.uwin / max) * 100;
        const isActive = activeKey === row.key;
        const clickable = !!onRowClick;
        return (
          <div key={row.key} className="group relative">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onRowClick?.(row)}
              title={clickable && clickHint ? clickHint : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition ${
                clickable ? "hover:bg-slate-50" : "cursor-default"
              } ${isActive ? "bg-slate-100" : ""}`}
            >
              <span className="w-44 shrink-0 truncate text-xs font-semibold text-slate-700" title={row.label}>
                {row.label}
              </span>
              <span className="relative h-4 min-w-0 flex-1">
                {/* 2px surface gap separates the two portal segments */}
                {row.hmis > 0 ? (
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-[4px]"
                    style={{ width: `max(${hmisPct.toFixed(2)}%, 3px)`, background: HMIS_COLOR }}
                  />
                ) : null}
                {row.uwin > 0 ? (
                  <span
                    className="absolute inset-y-0 rounded-r-[4px]"
                    style={{
                      left: row.hmis > 0 ? `calc(max(${hmisPct.toFixed(2)}%, 3px) + 2px)` : 0,
                      width: `max(${uwinPct.toFixed(2)}%, 3px)`,
                      background: UWIN_COLOR,
                    }}
                  />
                ) : null}
              </span>
              <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-slate-900">
                {fmtCount(row.total)}
              </span>
              <span className="shrink-0">
                <ScoreChip score={row.avgOverall} />
              </span>
              {clickable ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:text-slate-500" />
              ) : null}
            </button>
            {/* Hover detail card (values are also visible inline — this only enhances) */}
            <div className="pointer-events-none absolute left-44 top-full z-10 hidden min-w-[170px] rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg group-hover:block">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="h-0.5 w-3 rounded" style={{ background: HMIS_COLOR }} /> HMIS
                </span>
                <span className="font-bold tabular-nums text-slate-900">{fmtCount(row.hmis)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="h-0.5 w-3 rounded" style={{ background: UWIN_COLOR }} /> U-WIN
                </span>
                <span className="font-bold tabular-nums text-slate-900">{fmtCount(row.uwin)}</span>
              </div>
              {row.details && row.details.length > 0 ? (
                <div className="mt-1.5 border-t border-slate-100 pt-1.5">
                  {row.details.slice(0, 5).map((d) => (
                    <div key={d.label} className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                      <span className="max-w-[180px] truncate" title={d.label}>{d.label}</span>
                      <span className="font-bold tabular-nums text-slate-700">{fmtCount(d.count)}</span>
                    </div>
                  ))}
                  {row.details.length > 5 ? (
                    <div className="text-[11px] font-medium text-slate-400">+{row.details.length - 5} more</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {rows.length > initialLimit ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-white"
        >
          {expanded ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------
// Component score profile (grouped horizontal bars, 0–100)
// ---------------------------------------------------------------

function ComponentProfile({
  records,
  showHmis,
  showUwin,
}: {
  records: DashboardRecord[];
  showHmis: boolean;
  showUwin: boolean;
}) {
  const rows = useMemo(() => {
    const hmisRecords = records.filter((r) => r.portal !== "UWIN");
    const uwinRecords = records.filter((r) => r.portal === "UWIN");
    const avg = (list: DashboardRecord[], pick: (r: DashboardRecord) => number | null): number | null => {
      const values = list.map(pick).filter((v): v is number => v !== null);
      if (values.length === 0) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    return [
      { label: "Availability", hmis: avg(hmisRecords, (r) => r.availability), uwin: avg(uwinRecords, (r) => r.availability) },
      { label: "Completeness", hmis: avg(hmisRecords, (r) => r.completeness), uwin: null, uwinNa: true },
      { label: "Accuracy", hmis: avg(hmisRecords, (r) => r.accuracy), uwin: avg(uwinRecords, (r) => r.accuracy) },
      { label: "Consistency", hmis: avg(hmisRecords, (r) => r.consistency), uwin: avg(uwinRecords, (r) => r.consistency) },
    ];
  }, [records]);

  const bar = (value: number | null, color: string, seriesLabel: string, na?: boolean) => (
    <div className="flex items-center gap-2">
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-r-[4px] bg-slate-100">
        {value !== null ? (
          <div
            className="absolute inset-y-0 left-0 rounded-r-[4px]"
            style={{ width: `${Math.max(1, Math.min(100, value)).toFixed(1)}%`, background: color }}
            title={`${seriesLabel}: ${value.toFixed(1)}`}
          />
        ) : null}
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums text-slate-900">
        {na ? <span className="font-medium text-slate-400" title="U-WIN reviews have no completeness component">N/A</span> : fmtScore(value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 text-xs font-semibold text-slate-600">{row.label}</div>
          <div className="space-y-1">
            {showHmis ? bar(row.hmis, HMIS_COLOR, "HMIS") : null}
            {showUwin ? bar(row.uwin, UWIN_COLOR, "U-WIN", "uwinNa" in row && row.uwinNa) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// The page
// ---------------------------------------------------------------

const selectClass =
  "w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200/70";

type SortKey = "label" | "total" | "hmis" | "uwin" | "districts" | "blocks" | "facilities" | "sessionSites" | "avgOverall" | "lastAtMs";

export function DashboardPage({ auth }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>({ ...EMPTY_DASHBOARD_FILTERS });
  const [activePreset, setActivePreset] = useState<DatePreset | null>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "total", dir: -1 });
  const [activityTable, setActivityTable] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data: SnapshotRecord[] = await apiFetch("/api/snapshots");
      setSnapshots(data);
    } catch {
      setLoadError("Failed to load DQA records. Check your connection and retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const records = useMemo(
    () => (snapshots ?? []).map(toDashboardRecord).filter((r): r is DashboardRecord => r !== null),
    [snapshots],
  );

  const filtered = useMemo(() => applyDashboardFilters(records, filters), [records, filters]);
  const stats = useMemo(() => computeDashboardStats(filtered), [filtered]);
  const months = useMemo(() => groupByMonth(filtered), [filtered]);

  // ---- filter options (cascading, derived from the scoped data) ----
  const stateOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) if (r.stateKey) map.set(r.stateKey, r.state);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records]);

  const districtOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) {
      if (filters.state && r.stateKey !== filters.state) continue;
      if (r.districtKey) map.set(r.districtKey, r.district);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records, filters.state]);

  const blockOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of records) {
      if (filters.state && r.stateKey !== filters.state) continue;
      if (filters.district && r.districtKey !== filters.district) continue;
      if (r.blockKey && r.block) map.set(r.blockKey, r.block);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records, filters.state, filters.district]);

  const designationOptions = useMemo(
    () => [...new Set(records.map((r) => r.designation))].sort(),
    [records],
  );
  const purposeOptions = useMemo(
    () => [...new Set(records.map((r) => r.purpose))].sort(),
    [records],
  );

  // ---- geographic drill level ----
  const uniqueStates = useMemo(() => new Set(records.map((r) => r.stateKey)).size, [records]);
  const geoLevel: GeoLevel = filters.district
    ? "block"
    : filters.state || uniqueStates <= 1
      ? "district"
      : "state";
  const geo = useMemo(() => groupByGeo(filtered, geoLevel), [filtered, geoLevel]);

  const designations = useMemo(
    () => groupByCategory(filtered, (r) => r.designation),
    [filtered],
  );
  const purposes = useMemo(
    () => groupByCategory(filtered, (r) => r.purpose, (r) => r.purposeDetail),
    [filtered],
  );

  const setFilter = useCallback((patch: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleGeoDrill = useCallback(
    (row: BarListRow) => {
      if (geoLevel === "state") {
        setFilter({ state: row.key, district: "", block: "" });
      } else if (geoLevel === "district") {
        const [stateKey, districtKey] = row.key.split("|");
        setFilter({ state: stateKey, district: districtKey, block: "" });
      } else {
        setFilter({ block: filters.block === row.key ? "" : row.key });
      }
    },
    [geoLevel, filters.block, setFilter],
  );

  const stateLabel = stateOptions.find(([k]) => k === filters.state)?.[1] ?? "";
  const districtLabel = districtOptions.find(([k]) => k === filters.district)?.[1] ?? "";

  const hasActiveFilters = useMemo(
    () => JSON.stringify({ ...filters }) !== JSON.stringify(EMPTY_DASHBOARD_FILTERS),
    [filters],
  );

  const showHmis = filters.portal !== "UWIN";
  const showUwin = filters.portal !== "HMIS";

  // ---- summary table ----
  const sortedGeoRows = useMemo(() => {
    const rows = [...geo.rows];
    rows.sort((a, b) => {
      const av = a[sort.key as keyof typeof a];
      const bv = b[sort.key as keyof typeof b];
      if (typeof av === "string" && typeof bv === "string") return sort.dir * av.localeCompare(bv);
      const an = (av as number | null) ?? -1;
      const bn = (bv as number | null) ?? -1;
      return sort.dir * (an - bn);
    });
    return rows;
  }, [geo.rows, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: key === "label" ? 1 : -1 }));
  };

  const levelNoun = geoLevel === "state" ? "State" : geoLevel === "district" ? "District" : "Block";

  function handleDownloadExcel() {
    const headers = [
      levelNoun,
      "Total DQA",
      "HMIS",
      "U-WIN",
      ...(geoLevel === "state" ? ["Districts"] : []),
      ...(geoLevel !== "block" ? ["Blocks (est.)"] : []),
      "Facilities (est.)",
      "Session sites (est.)",
      "Avg overall",
      "Last DQA",
    ];
    const rows = sortedGeoRows.map((r) => [
      r.label,
      r.total,
      r.hmis,
      r.uwin,
      ...(geoLevel === "state" ? [r.districts] : []),
      ...(geoLevel !== "block" ? [r.blocks] : []),
      r.facilities,
      r.sessionSites,
      r.avgOverall === null ? "-" : r.avgOverall.toFixed(1),
      fmtDay(r.lastAtMs),
    ]);
    const filterLine = [
      `Source: ${filters.portal}`,
      `DQA type: ${filters.dqaLevel}`,
      filters.state ? `State: ${stateLabel}` : "All states",
      filters.district ? `District: ${districtLabel}` : "",
      filters.designation ? `Designation: ${filters.designation}` : "",
      filters.purpose ? `Purpose: ${filters.purpose}` : "",
      filters.dateFrom ? `From: ${filters.dateFrom}` : "",
      filters.dateTo ? `To: ${filters.dateTo}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    const esc = (v: string | number) =>
      String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const tableHtml = `
      <table>
        <tr><td colspan="${headers.length}">DQA Analytics Dashboard — exported ${new Date().toLocaleString("en-IN")}</td></tr>
        <tr><td colspan="${headers.length}">${esc(filterLine)}</td></tr>
        <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    const blob = new Blob(
      [`<html><head><meta charset="UTF-8"></head><body>${tableHtml}</body></html>`],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DQA_Dashboard_${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const scopeText =
    auth.level === "NATIONAL" || auth.role === "admin"
      ? "National scope"
      : [auth.geoState, auth.geoDistrict, auth.geoBlock].filter(Boolean).join(" / ");

  const presets: { id: DatePreset; label: string }[] = [
    { id: "30d", label: "30 days" },
    { id: "90d", label: "90 days" },
    { id: "fy", label: "This FY" },
    { id: "all", label: "All time" },
  ];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5">
        {/* ── Header ─────────────────────────────── */}
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900">DQA Analytics Dashboard</h1>
                <div className="text-xs text-slate-500">
                  {scopeText} · based on saved DQA reviews · {fmtCount(records.length)} record{records.length !== 1 ? "s" : ""} accessible
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={fetchSnapshots}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <button
                onClick={handleDownloadExcel}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download Excel
              </button>
            </div>
          </div>
        </div>

        {/* ── Filter band (scopes everything below) ── */}
        <GlassPanel className="p-4">
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="block lg:col-span-2">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Review date</span>
              <div className="flex items-center gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const range = presetRange(p.id);
                      setActivePreset(p.id);
                      setFilter({ dateFrom: range.from, dateTo: range.to });
                    }}
                    className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
                      activePreset === p.id
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">From</span>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => {
                  setActivePreset(null);
                  setFilter({ dateFrom: e.target.value });
                }}
                className={selectClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">To</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => {
                  setActivePreset(null);
                  setFilter({ dateTo: e.target.value });
                }}
                className={selectClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Data source</span>
              <select
                value={filters.portal}
                onChange={(e) => setFilter({ portal: e.target.value as DashboardFilters["portal"] })}
                className={selectClass}
              >
                <option value="ALL">HMIS + U-WIN</option>
                <option value="HMIS">HMIS</option>
                <option value="UWIN">U-WIN</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Type of DQA</span>
              <select
                value={filters.dqaLevel}
                onChange={(e) => setFilter({ dqaLevel: e.target.value as DashboardFilters["dqaLevel"] })}
                className={selectClass}
              >
                <option value="ALL">All types</option>
                <option value="DISTRICT">District DQA</option>
                <option value="BLOCK">Block DQA</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">State</span>
              <select
                value={filters.state}
                onChange={(e) => setFilter({ state: e.target.value, district: "", block: "" })}
                className={selectClass}
              >
                <option value="">All states</option>
                {stateOptions.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">District</span>
              <select
                value={filters.district}
                onChange={(e) => setFilter({ district: e.target.value, block: "" })}
                className={selectClass}
              >
                <option value="">All districts</option>
                {districtOptions.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Block</span>
              <select
                value={filters.block}
                onChange={(e) => setFilter({ block: e.target.value })}
                className={selectClass}
              >
                <option value="">All blocks</option>
                {blockOptions.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Designation</span>
              <select
                value={filters.designation}
                onChange={(e) => setFilter({ designation: e.target.value })}
                className={selectClass}
              >
                <option value="">All designations</option>
                {designationOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Purpose</span>
              <select
                value={filters.purpose}
                onChange={(e) => setFilter({ purpose: e.target.value })}
                className={selectClass}
              >
                <option value="">All purposes</option>
                {purposeOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilters({ ...EMPTY_DASHBOARD_FILTERS });
                    setActivePreset("all");
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Clear filters
                </button>
              ) : (
                <div className="pb-2 text-[11px] font-medium text-slate-400">Filters scope every card below.</div>
              )}
            </div>
          </div>
        </GlassPanel>

        {loading && !snapshots ? (
          <GlassPanel className="p-10 text-center">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Loading dashboard…</div>
          </GlassPanel>
        ) : loadError ? (
          <GlassPanel className="p-10 text-center">
            <div className="text-sm font-semibold text-red-600">{loadError}</div>
          </GlassPanel>
        ) : records.length === 0 ? (
          <GlassPanel className="p-12 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">No DQA records yet</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-950">Save a snapshot after any analysis to populate this dashboard.</div>
            <div className="mt-2 text-sm text-slate-500">Every "Save snapshot" on an HMIS or U-WIN results page becomes one DQA record here.</div>
          </GlassPanel>
        ) : (
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="space-y-5">
              {/* ── KPI tiles ─────────────────────── */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile label="Total DQA reviews" value={fmtCount(stats.total)} sub={`${fmtCount(stats.reviewers)} reviewer${stats.reviewers !== 1 ? "s" : ""} engaged`} icon={<ClipboardList className="h-4 w-4" />} />
                <StatTile label="HMIS reviews" value={fmtCount(stats.hmis)} icon={<BarChart3 className="h-4 w-4" />} />
                <StatTile label="U-WIN reviews" value={fmtCount(stats.uwin)} icon={<Syringe className="h-4 w-4" />} />
                <StatTile
                  label="Avg overall score"
                  value={stats.avgOverall === null ? "—" : stats.avgOverall.toFixed(1)}
                  sub={stats.avgOverall === null ? "No scored reviews" : gradeOf(stats.avgOverall).label}
                  icon={<Landmark className="h-4 w-4" />}
                />
                <StatTile label="Districts covered" value={fmtCount(stats.districts)} sub={uniqueStates > 1 ? `${fmtCount(stats.states)} state${stats.states !== 1 ? "s" : ""}` : undefined} icon={<MapPin className="h-4 w-4" />} />
                <StatTile label="Blocks covered" value={fmtCount(stats.blocks)} sub="Widest review per district" icon={<MapPin className="h-4 w-4" />} />
                <StatTile label="Facilities covered" value={fmtCount(stats.facilities)} sub="Widest review per district" icon={<Building2 className="h-4 w-4" />} />
                <StatTile label="Session sites covered" value={fmtCount(stats.sessionSites)} sub="U-WIN datasets only" icon={<Users className="h-4 w-4" />} />
              </div>

              {/* ── Time charts ───────────────────── */}
              <div className="grid gap-4 lg:grid-cols-3">
                <GlassPanel className="p-5 lg:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">DQA activity</div>
                      <div className="text-sm font-bold text-slate-900">Reviews per month</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <PortalLegend hmis={showHmis} uwin={showUwin} />
                      <button
                        type="button"
                        onClick={() => setActivityTable((v) => !v)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        {activityTable ? "Chart" : "Table"}
                      </button>
                    </div>
                  </div>
                  {months.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center text-sm font-medium text-slate-400">No reviews in this slice.</div>
                  ) : activityTable ? (
                    <div className="max-h-[240px] overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            <th className="px-2 py-1.5">Month</th>
                            <th className="px-2 py-1.5 text-right">HMIS</th>
                            <th className="px-2 py-1.5 text-right">U-WIN</th>
                            <th className="px-2 py-1.5 text-right">Total</th>
                            <th className="px-2 py-1.5 text-right">Avg score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {months.map((m) => (
                            <tr key={m.key} className="border-t border-slate-100">
                              <td className="px-2 py-1.5 font-medium text-slate-700">{m.label}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtCount(m.hmis)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtCount(m.uwin)}</td>
                              <td className="px-2 py-1.5 text-right font-bold tabular-nums text-slate-900">{fmtCount(m.total)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{fmtScore(m.avgOverall)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <MonthlyActivityChart months={months} />
                  )}
                </GlassPanel>
                <GlassPanel className="p-5">
                  <div className="mb-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Data quality</div>
                    <div className="text-sm font-bold text-slate-900">Average overall score by month</div>
                  </div>
                  {months.length === 0 ? (
                    <div className="flex h-[200px] items-center justify-center text-sm font-medium text-slate-400">No reviews in this slice.</div>
                  ) : (
                    <ScoreTrendChart months={months} />
                  )}
                </GlassPanel>
              </div>

              {/* ── Geography + component profile ── */}
              <div className="grid gap-4 lg:grid-cols-3">
                <GlassPanel className="p-5 lg:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Where DQA is happening</div>
                      <div className="flex flex-wrap items-center gap-1 text-sm font-bold text-slate-900">
                        <button
                          type="button"
                          onClick={() => setFilter({ state: "", district: "", block: "" })}
                          className={`rounded-md px-1 transition hover:bg-slate-100 ${!filters.state ? "text-slate-900" : "text-sky-700 underline decoration-sky-300 underline-offset-2"}`}
                        >
                          {uniqueStates > 1 ? "All states" : "State"}
                        </button>
                        {filters.state || uniqueStates <= 1 ? (
                          <>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                            <button
                              type="button"
                              onClick={() => setFilter({ district: "", block: "" })}
                              className={`rounded-md px-1 transition hover:bg-slate-100 ${!filters.district ? "text-slate-900" : "text-sky-700 underline decoration-sky-300 underline-offset-2"}`}
                            >
                              {stateLabel || (uniqueStates === 1 ? geo.rows[0]?.label ?? "State" : "State")}
                            </button>
                          </>
                        ) : null}
                        {filters.district ? (
                          <>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                            <span className="px-1">{districtLabel}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <PortalLegend hmis={showHmis} uwin={showUwin} />
                  </div>
                  <StackedBarList
                    rows={geo.rows}
                    onRowClick={handleGeoDrill}
                    activeKey={geoLevel === "block" ? filters.block : undefined}
                    clickHint={
                      geoLevel === "state"
                        ? "Click to drill into districts"
                        : geoLevel === "district"
                          ? "Click to drill into blocks"
                          : "Click to filter this block"
                    }
                  />
                  {geoLevel === "block" && geo.unattributed > 0 ? (
                    <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                      {fmtCount(geo.unattributed)} district-level review{geo.unattributed !== 1 ? "s are" : " is"} not tied to a single block and {geo.unattributed !== 1 ? "are" : "is"} not shown as bars here.
                    </div>
                  ) : null}
                </GlassPanel>
                <GlassPanel className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quality profile</div>
                      <div className="text-sm font-bold text-slate-900">Average component scores</div>
                    </div>
                    <PortalLegend hmis={showHmis} uwin={showUwin} />
                  </div>
                  {filtered.length === 0 ? (
                    <div className="flex h-24 items-center justify-center text-sm font-medium text-slate-400">No reviews in this slice.</div>
                  ) : (
                    <ComponentProfile records={filtered} showHmis={showHmis} showUwin={showUwin} />
                  )}
                </GlassPanel>
              </div>

              {/* ── Who & why ─────────────────────── */}
              <div className="grid gap-4 lg:grid-cols-2">
                <GlassPanel className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reviewed by</div>
                      <div className="text-sm font-bold text-slate-900">DQA reviews by designation</div>
                    </div>
                    <PortalLegend hmis={showHmis} uwin={showUwin} />
                  </div>
                  <StackedBarList
                    rows={designations.map(categoryToRow)}
                    onRowClick={(row) => setFilter({ designation: filters.designation === row.key ? "" : row.key })}
                    activeKey={filters.designation || undefined}
                    clickHint="Click to filter by this designation"
                  />
                </GlassPanel>
                <GlassPanel className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Purpose of DQA</div>
                      <div className="text-sm font-bold text-slate-900">Why reviews were conducted</div>
                    </div>
                    <PortalLegend hmis={showHmis} uwin={showUwin} />
                  </div>
                  <StackedBarList
                    rows={purposes.map(categoryToRow)}
                    onRowClick={(row) => setFilter({ purpose: filters.purpose === row.key ? "" : row.key })}
                    activeKey={filters.purpose || undefined}
                    clickHint="Click to filter by this purpose"
                  />
                </GlassPanel>
              </div>

              {/* ── Summary table ─────────────────── */}
              <GlassPanel className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/70 px-5 py-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Summary</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{levelNoun}-wise DQA summary</div>
                  </div>
                  <div className="text-sm font-medium text-slate-500">
                    {fmtCount(filtered.length)} review{filtered.length !== 1 ? "s" : ""} · {fmtCount(geo.rows.length)} {levelNoun.toLowerCase()}{geo.rows.length !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/60 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        <SortableTh label={levelNoun} k="label" sort={sort} onSort={toggleSort} />
                        <SortableTh label="Total DQA" k="total" sort={sort} onSort={toggleSort} right />
                        <SortableTh label="HMIS" k="hmis" sort={sort} onSort={toggleSort} right />
                        <SortableTh label="U-WIN" k="uwin" sort={sort} onSort={toggleSort} right />
                        {geoLevel === "state" ? <SortableTh label="Districts" k="districts" sort={sort} onSort={toggleSort} right /> : null}
                        {geoLevel !== "block" ? <SortableTh label="Blocks*" k="blocks" sort={sort} onSort={toggleSort} right /> : null}
                        <SortableTh label="Facilities*" k="facilities" sort={sort} onSort={toggleSort} right />
                        <SortableTh label="Session sites*" k="sessionSites" sort={sort} onSort={toggleSort} right />
                        <SortableTh label="Avg overall" k="avgOverall" sort={sort} onSort={toggleSort} right />
                        <SortableTh label="Last DQA" k="lastAtMs" sort={sort} onSort={toggleSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedGeoRows.map((row) => (
                        <tr key={row.key} className="border-t border-white/80 bg-white/50 transition hover:bg-white/80">
                          <td className="px-4 py-2.5 font-semibold text-slate-800">{row.label}</td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{fmtCount(row.total)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCount(row.hmis)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCount(row.uwin)}</td>
                          {geoLevel === "state" ? <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCount(row.districts)}</td> : null}
                          {geoLevel !== "block" ? <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCount(row.blocks)}</td> : null}
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmtCount(row.facilities)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{row.sessionSites > 0 ? fmtCount(row.sessionSites) : "—"}</td>
                          <td className="px-4 py-2.5 text-right"><ScoreChip score={row.avgOverall} /></td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDay(row.lastAtMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-white/70 px-5 py-3 text-[11px] font-medium text-slate-500">
                  * Coverage estimates: snapshots store dataset totals, not facility lists, so each geography counts its single widest review (largest block/facility/session-site count among the filtered reviews) — repeat reviews never double-count. HMIS and U-WIN facility universes are counted separately.
                </div>
              </GlassPanel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function categoryToRow(c: CategoryRow): BarListRow {
  return {
    key: c.label,
    label: c.label,
    hmis: c.hmis,
    uwin: c.uwin,
    total: c.total,
    avgOverall: c.avgOverall,
    details: c.details,
  };
}

function SortableTh({
  label,
  k,
  sort,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={`px-4 py-3 ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-[0.14em] transition hover:text-slate-800 ${active ? "text-slate-900" : ""}`}
      >
        {label}
        {active ? <span aria-hidden>{sort.dir === -1 ? "↓" : "↑"}</span> : null}
      </button>
    </th>
  );
}

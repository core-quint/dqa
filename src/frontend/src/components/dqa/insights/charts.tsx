// Charts of the DQA Insights dashboard. Hand-drawn SVG / HTML so every mark can be
// hovered, clicked to drill, and sized to its container. One colour language:
// the four score bands (lib/insights BANDS) for score, one blue for "the series",
// slate for context.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  BANDS,
  GOOD_LINE,
  STALE_DAYS,
  bandOf,
  type ComponentProfile,
  type Matrix,
  type MatrixRow,
  type Mover,
  type ReReview,
  type Timeline,
  type Unit,
  type UnitGroup,
  type UnitLevel,
  UNIT_NOUN,
} from "../../../lib/insights";
import { monthFullLabel } from "../../../lib/snapshots";

export const INK = "#0f172a";
export const MUTED = "#64748b";
const GRID = "#e8edf3";
const AXIS = "#cbd5e1";
export const SERIES = "#2a78d6";
const SERIES_SOFT = "#cde2fb";
const CONTEXT = "#94a3b8";
const DOWN = "#b3292e";

export const fmt1 = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(1) : "—");
export const signed1 = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

// ---------------------------------------------------------------
// Shared: container width + tooltip
// ---------------------------------------------------------------

export function useWidth<T extends HTMLElement>(fallback = 800) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.clientWidth || fallback);
  }, [fallback]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Tip {
  x: number;
  y: number;
  hostWidth: number;
  node: ReactNode;
}

/** Tooltip positioned inside the nearest ancestor marked `data-tip-host` (which must be `relative`). */
export function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (event: MouseEvent, node: ReactNode) => {
    const host = (event.currentTarget as Element).closest("[data-tip-host]");
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setTip({ x: event.clientX - rect.left, y: event.clientY - rect.top, hostWidth: rect.width, node });
  };
  const hide = () => setTip(null);
  const box = tip ? (
    <div
      className="pointer-events-none absolute z-30 w-max max-w-[260px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-[0_8px_28px_rgba(15,23,42,0.16)]"
      style={
        tip.x > tip.hostWidth - 270
          ? { right: tip.hostWidth - tip.x + 14, top: Math.max(0, tip.y - 12) }
          : { left: tip.x + 14, top: Math.max(0, tip.y - 12) }
      }
    >
      {tip.node}
    </div>
  ) : null;
  return { show, hide, box };
}

function TipRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

export function BandDot({ score, size = 8 }: { score: number | null; size?: number }) {
  const band = bandOf(score);
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: band?.color ?? "#e2e8f0" }}
    />
  );
}

export function unitTip(u: Unit, level: UnitLevel) {
  const comps = (["availability", "completeness", "accuracy", "consistency"] as const).filter(
    (k) => typeof u.latest[k] === "number",
  );
  return (
    <div className="min-w-[190px]">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-950">
        <BandDot score={u.score} />
        {u.name}
      </div>
      {u.parent ? <div className="mb-1 text-[11px] text-slate-500">{u.parent}</div> : null}
      <TipRow label="Latest score" value={`${fmt1(u.score)} · ${bandOf(u.score)?.label}`} />
      {comps.map((k) => (
        <TipRow key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} value={fmt1(u.latest[k])} />
      ))}
      {u.change !== null ? <TipRow label="Change (same method)" value={signed1(u.change)} /> : null}
      <TipRow label="Reviews" value={u.reviews.length} />
      <TipRow label="Last reviewed" value={u.daysSince === 0 ? "today" : `${u.daysSince} d ago`} />
      <div className="mt-1 text-[11px] text-slate-400">
        {level === "block" ? "Block of the selected district" : "Click to open"}
      </div>
    </div>
  );
}

export function BandLegend({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 ${className}`}>
      {BANDS.map((band) => (
        <span key={band.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: band.color }} />
          {band.label} <span className="text-slate-400">{band.range}</span>
        </span>
      ))}
    </div>
  );
}

function scoreFloor(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(0, Math.min(40, Math.floor((Math.min(...values) - 4) / 10) * 10));
}

// ---------------------------------------------------------------
// Strip plot: every unit one dot, grouped by parent
// ---------------------------------------------------------------

export function ScoreStripPlot({
  groups,
  level,
  onPick,
  onPickGroup,
}: {
  groups: UnitGroup[];
  level: UnitLevel;
  onPick?: (u: Unit) => void;
  onPickGroup?: (g: UnitGroup) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const single = groups.length <= 1;
  const most = Math.max(1, ...groups.map((g) => g.units.length));
  const labelW = single ? 8 : Math.min(170, Math.max(110, width * 0.2));
  const padR = 52;
  const top = 30;
  const rowH = single ? Math.min(220, Math.max(120, most * 2.6)) : most > 45 ? 52 : 40;
  const r = most > 70 ? 3.4 : 4.6;
  const plotW = Math.max(120, width - labelW - padR);
  const all = groups.flatMap((g) => g.units.map((u) => u.score));
  const lo = scoreFloor(all);
  const x = (v: number) => labelW + ((v - lo) / (100 - lo)) * plotW;
  const height = top + rowH * Math.max(1, groups.length) + 26;

  const placed = useMemo(
    () =>
      groups.map((g) => {
        const half = rowH / 2 - r - 2;
        const done: Array<{ x: number; y: number; unit: Unit }> = [];
        const gap = (2 * r + 1) ** 2;
        for (const unit of [...g.units].sort((a, b) => a.score - b.score)) {
          const px = labelW + ((unit.score - lo) / (100 - lo)) * plotW;
          let py = 0;
          let found = false;
          for (let step = 0; step * (r * 0.9) <= half && !found; step += 1) {
            for (const sign of step === 0 ? [1] : [1, -1]) {
              const candidate = sign * step * (r * 0.9);
              if (done.every((d) => (d.x - px) ** 2 + (d.y - candidate) ** 2 >= gap)) {
                py = candidate;
                found = true;
                break;
              }
            }
          }
          done.push({ x: px, y: py, unit });
        }
        return done;
      }),
    [groups, labelW, lo, plotW, r, rowH],
  );

  const bandEdges = [lo, 50, 70, 85, 100];
  const ticks = [lo, 50, 70, 85, 100].filter((v, i, list) => v >= lo && list.indexOf(v) === i);

  return (
    <div ref={ref} className="relative" data-tip-host>
      <svg width={width} height={height} role="img" aria-label="Latest score of every unit">
        {BANDS.map((band, i) => {
          const from = Math.max(lo, bandEdges[i]);
          const to = bandEdges[i + 1];
          if (to <= from) return null;
          const wide = x(to) - x(from);
          return wide > 74 ? (
            <text key={band.key} x={(x(from) + x(to)) / 2} y={12} textAnchor="middle" fontSize={10} fontWeight={600} letterSpacing="0.06em" fill={MUTED}>
              {band.label.toUpperCase()}
            </text>
          ) : null;
        })}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top - 8} y2={height - 22} stroke={v === GOOD_LINE ? AXIS : GRID} strokeWidth={1} strokeDasharray={v === GOOD_LINE ? "4 3" : undefined} />
            <text x={x(v)} y={height - 8} textAnchor="middle" fontSize={10.5} fill={MUTED} style={{ fontVariantNumeric: "tabular-nums" }}>
              {v}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const cy = top + rowH * gi + rowH / 2;
          return (
            <g key={g.key}>
              {gi > 0 ? <line x1={0} x2={width} y1={cy - rowH / 2} y2={cy - rowH / 2} stroke={GRID} /> : null}
              {!single ? (
                <g
                  onClick={onPickGroup ? () => onPickGroup(g) : undefined}
                  style={{ cursor: onPickGroup ? "pointer" : "default" }}
                >
                  <text x={0} y={cy - 1} fontSize={12} fontWeight={600} fill={INK}>
                    {g.name.length > 21 ? `${g.name.slice(0, 20)}…` : g.name}
                  </text>
                  <text x={0} y={cy + 13} fontSize={10.5} fill={MUTED}>
                    {g.units.length} {g.units.length === 1 ? UNIT_NOUN[level].one : UNIT_NOUN[level].many}
                  </text>
                </g>
              ) : null}
              {placed[gi].map((d) => (
                <circle
                  key={d.unit.key}
                  cx={d.x}
                  cy={cy + d.y}
                  r={hover === d.unit.key ? r + 1.6 : r}
                  fill={bandOf(d.unit.score)!.color}
                  stroke={hover === d.unit.key ? INK : "#ffffff"}
                  strokeWidth={hover === d.unit.key ? 1.6 : 1}
                  style={{ cursor: onPick ? "pointer" : "default" }}
                  onMouseMove={(e) => {
                    setHover(d.unit.key);
                    tip.show(e, unitTip(d.unit, level));
                  }}
                  onMouseLeave={() => {
                    setHover(null);
                    tip.hide();
                  }}
                  onClick={onPick ? () => onPick(d.unit) : undefined}
                />
              ))}
              {/* Median of the group */}
              <line x1={x(g.median)} x2={x(g.median)} y1={cy - rowH / 2 + 5} y2={cy + rowH / 2 - 5} stroke={INK} strokeWidth={2} pointerEvents="none" />
              <text x={width - 2} y={cy + 4} textAnchor="end" fontSize={12} fontWeight={700} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt1(g.median)}
              </text>
            </g>
          );
        })}
        <text x={width - 2} y={12} textAnchor="end" fontSize={10} fontWeight={600} letterSpacing="0.06em" fill={MUTED}>
          MEDIAN
        </text>
      </svg>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Component profile: where quality is lost
// ---------------------------------------------------------------

export function ComponentProfileChart({ profiles, noun }: { profiles: ComponentProfile[]; noun: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(420);
  const tip = useTip();
  const labelW = 104;
  const padR = 48;
  const top = 22;
  const rowH = 54;
  const plotW = Math.max(100, width - labelW - padR);
  const lo = 0;
  const x = (v: number) => labelW + ((v - lo) / (100 - lo)) * plotW;
  const height = top + rowH * profiles.length + 22;
  const weakest = profiles.length > 1 ? [...profiles].sort((a, b) => a.median - b.median)[0].key : null;
  return (
    <div ref={ref} className="relative" data-tip-host>
      <svg width={width} height={height} role="img" aria-label="Score spread of each quality component">
        {[0, 25, 50, 70, 100].map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={top - 4} y2={height - 20} stroke={v === GOOD_LINE ? AXIS : GRID} strokeDasharray={v === GOOD_LINE ? "4 3" : undefined} />
            <text x={x(v)} y={height - 6} textAnchor="middle" fontSize={10.5} fill={MUTED}>
              {v}
            </text>
          </g>
        ))}
        <text x={x(GOOD_LINE)} y={10} textAnchor="middle" fontSize={10} fontWeight={600} fill={MUTED}>
          Good line
        </text>
        {profiles.map((p, i) => {
          const cy = top + rowH * i + rowH / 2;
          return (
            <g
              key={p.key}
              onMouseMove={(e) =>
                tip.show(
                  e,
                  <div className="min-w-[180px]">
                    <div className="mb-1 text-[13px] font-semibold text-slate-950">{p.label}</div>
                    <TipRow label="Median" value={fmt1(p.median)} />
                    <TipRow label="Middle half" value={`${fmt1(p.p25)} – ${fmt1(p.p75)}`} />
                    <TipRow label="10th – 90th pct" value={`${fmt1(p.p10)} – ${fmt1(p.p90)}`} />
                    <TipRow label={`Under ${GOOD_LINE}`} value={`${p.belowGood} of ${p.values.length} ${noun}`} />
                  </div>,
                )
              }
              onMouseLeave={tip.hide}
            >
              <rect x={0} y={cy - rowH / 2} width={width} height={rowH} fill="transparent" />
              <text x={0} y={cy - 1} fontSize={12.5} fontWeight={600} fill={INK}>
                {p.label}
              </text>
              {p.key === weakest ? (
                <text x={0} y={cy + 13} fontSize={10} fontWeight={700} letterSpacing="0.05em" fill={DOWN}>
                  ▼ WEAKEST
                </text>
              ) : null}
              {p.values.map((v, j) => (
                <circle key={j} cx={x(v)} cy={cy + (((j * 7919) % 17) - 8)} r={1.8} fill={CONTEXT} opacity={0.4} />
              ))}
              <line x1={x(p.p10)} x2={x(p.p90)} y1={cy} y2={cy} stroke={SERIES} strokeWidth={1.5} />
              <rect x={x(p.p25)} y={cy - 6} width={Math.max(2, x(p.p75) - x(p.p25))} height={12} rx={4} fill={SERIES} opacity={0.88} />
              <line x1={x(p.median)} x2={x(p.median)} y1={cy - 11} y2={cy + 11} stroke={INK} strokeWidth={2.5} />
              <text x={width - 2} y={cy + 4} textAnchor="end" fontSize={13} fontWeight={700} fill={INK} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt1(p.median)}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Priority matrix: score x days since last review
// ---------------------------------------------------------------

export function PriorityMatrix({ units, level, onPick }: { units: Unit[]; level: UnitLevel; onPick?: (u: Unit) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [hover, setHover] = useState<string | null>(null);
  const height = 380;
  const pad = { l: 40, r: 16, t: 26, b: 38 };
  const plotW = Math.max(120, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const maxDays = Math.max(60, Math.ceil(Math.max(0, ...units.map((u) => u.daysSince)) / 15) * 15);
  const lo = scoreFloor(units.map((u) => u.score));
  const x = (d: number) => pad.l + (d / maxDays) * plotW;
  const y = (s: number) => pad.t + (1 - (s - lo) / (100 - lo)) * plotH;
  const maxFac = Math.max(1, ...units.map((u) => u.facilities ?? 0));
  const radius = (u: Unit) => (u.facilities ? 4 + 7 * Math.sqrt(u.facilities / maxFac) : 5);
  const actNow = (u: Unit) => u.daysSince > STALE_DAYS && u.score < GOOD_LINE;
  const labelled = new Set(
    units
      .filter(actNow)
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map((u) => u.key),
  );
  const xStep = maxDays <= 90 ? 15 : maxDays <= 180 ? 30 : 60;
  const xTicks = Array.from({ length: Math.floor(maxDays / xStep) + 1 }, (_, i) => i * xStep);
  const yTicks = [lo, 50, 70, 85, 100].filter((v, i, list) => v >= lo && list.indexOf(v) === i);
  const quadrant = (label: string, sub: string, qx: number, qy: number, anchor: "start" | "end", strong = false) => (
    <g pointerEvents="none">
      <text x={qx} y={qy} textAnchor={anchor} fontSize={11} fontWeight={700} letterSpacing="0.05em" fill={strong ? DOWN : MUTED}>
        {label.toUpperCase()}
      </text>
      <text x={qx} y={qy + 13} textAnchor={anchor} fontSize={10.5} fill={MUTED}>
        {sub}
      </text>
    </g>
  );
  // Draw big dots first so small ones stay reachable; act-now dots on top.
  const ordered = [...units].sort((a, b) => Number(actNow(a)) - Number(actNow(b)) || radius(b) - radius(a));
  return (
    <div ref={ref} className="relative" data-tip-host>
      <svg width={width} height={height} role="img" aria-label="Latest score against days since last review">
        <rect x={x(STALE_DAYS)} y={y(GOOD_LINE)} width={x(maxDays) - x(STALE_DAYS)} height={y(lo) - y(GOOD_LINE)} fill={DOWN} opacity={0.06} />
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={v === GOOD_LINE ? AXIS : GRID} strokeDasharray={v === GOOD_LINE ? "4 3" : undefined} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill={MUTED}>
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text key={d} x={x(d)} y={height - 20} textAnchor="middle" fontSize={10.5} fill={MUTED}>
            {d}
          </text>
        ))}
        <line x1={x(STALE_DAYS)} x2={x(STALE_DAYS)} y1={pad.t} y2={pad.t + plotH} stroke={AXIS} strokeDasharray="4 3" />
        <line x1={pad.l} x2={width - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke={AXIS} />
        <text x={pad.l + plotW / 2} y={height - 4} textAnchor="middle" fontSize={11} fill={MUTED}>
          Days since last review →
        </text>
        <text x={4} y={12} fontSize={11} fill={MUTED}>
          ↑ Latest score
        </text>
        {/* Left-hand captions sit by the divider: recent reviews crowd the left edge. */}
        {quadrant("On track", "good data, reviewed recently", x(STALE_DAYS) - 8, pad.t + 12, "end")}
        {quadrant("Going quiet", "good data, no recent review", width - pad.r - 6, pad.t + 12, "end")}
        {quadrant("Being worked on", "weak data, reviewed recently", x(STALE_DAYS) - 8, pad.t + plotH - 22, "end")}
        {quadrant("Act now", "weak data, no recent review", width - pad.r - 6, pad.t + plotH - 22, "end", true)}
        {ordered.map((u) => {
          const hot = actNow(u);
          const isHover = hover === u.key;
          return (
            <circle
              key={u.key}
              cx={x(Math.min(u.daysSince, maxDays))}
              cy={y(u.score)}
              r={radius(u) + (isHover ? 1.5 : 0)}
              fill={hot ? DOWN : CONTEXT}
              fillOpacity={hot ? 0.9 : 0.55}
              stroke={isHover ? INK : "#ffffff"}
              strokeWidth={isHover ? 1.6 : 1.2}
              style={{ cursor: onPick ? "pointer" : "default" }}
              onMouseMove={(e) => {
                setHover(u.key);
                tip.show(e, unitTip(u, level));
              }}
              onMouseLeave={() => {
                setHover(null);
                tip.hide();
              }}
              onClick={onPick ? () => onPick(u) : undefined}
            />
          );
        })}
        {units
          .filter((u) => labelled.has(u.key))
          .map((u) => {
            const cx = x(Math.min(u.daysSince, maxDays));
            const flip = cx > width - 130;
            return (
              <text
                key={u.key}
                x={cx + (flip ? -1 : 1) * (radius(u) + 4)}
                y={y(u.score) + 3.5}
                textAnchor={flip ? "end" : "start"}
                fontSize={10.5}
                fontWeight={600}
                fill={INK}
                stroke="#ffffff"
                strokeWidth={3}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {u.name}
              </text>
            );
          })}
      </svg>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Movers: first review -> latest review
// ---------------------------------------------------------------

export function MoversChart({ improved, declined, level, onPick }: { improved: Mover[]; declined: Mover[]; level: UnitLevel; onPick?: (u: Unit) => void }) {
  const tip = useTip();
  const all = [...improved, ...declined];
  const lo = scoreFloor(all.flatMap((m) => [m.from, m.to]));
  const pos = (v: number) => `${((v - lo) / (100 - lo)) * 100}%`;
  const row = (m: Mover) => {
    const up = m.change > 0;
    const color = up ? SERIES : DOWN;
    return (
      <button
        key={m.unit.key}
        type="button"
        onClick={onPick ? () => onPick(m.unit) : undefined}
        onMouseMove={(e) =>
          tip.show(
            e,
            <div className="min-w-[190px]">
              <div className="text-[13px] font-semibold text-slate-950">{m.unit.name}</div>
              {m.unit.parent ? <div className="mb-1 text-[11px] text-slate-500">{m.unit.parent}</div> : null}
              <TipRow label="Earlier review" value={fmt1(m.from)} />
              <TipRow label="Latest review" value={fmt1(m.to)} />
              <TipRow label="Change" value={signed1(m.change)} />
              <TipRow label="Reviews" value={m.unit.reviews.length} />
              <div className="mt-1 text-[11px] text-slate-400">Both reviews use the same scoring method.</div>
            </div>,
          )
        }
        onMouseLeave={tip.hide}
        className="grid w-full grid-cols-[minmax(0,34%)_1fr_52px] items-center gap-3 rounded-lg px-1.5 py-[5px] text-left transition hover:bg-slate-50"
      >
        <span className="truncate text-[12.5px] font-medium text-slate-800">{m.unit.name}</span>
        <span className="relative block h-4">
          <span className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
          <span
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full"
            style={{ left: pos(Math.min(m.from, m.to)), width: `${(Math.abs(m.change) / (100 - lo)) * 100}%`, background: color, opacity: 0.45 }}
          />
          <span
            className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white"
            style={{ left: pos(m.from), borderColor: color }}
          />
          <span
            className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
            style={{ left: pos(m.to), background: color }}
          />
        </span>
        <span className="text-right text-[12.5px] font-semibold tabular-nums text-slate-900">
          <span style={{ color }}>{up ? "▲" : "▼"}</span> {Math.abs(m.change).toFixed(1)}
        </span>
      </button>
    );
  };
  const axis = (
    <div className="grid grid-cols-[minmax(0,34%)_1fr_52px] gap-3 px-1.5">
      <span />
      <span className="relative block h-4 text-[10.5px] text-slate-500">
        {[lo, GOOD_LINE, 100].map((v) => (
          <span key={v} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pos(v) }}>
            {v}
          </span>
        ))}
      </span>
      <span />
    </div>
  );
  const block = (title: string, list: Mover[], empty: string) => (
    <div>
      <div className="mb-1 px-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">{title}</div>
      {list.length > 0 ? list.map(row) : <div className="px-1.5 py-2 text-xs text-slate-400">{empty}</div>}
    </div>
  );
  const many = UNIT_NOUN[level].many;
  return (
    <div className="relative space-y-3" data-tip-host>
      {block("Most improved", improved, `No ${many} improved by more than 2 points.`)}
      {block("Largest drops", declined, `No ${many} dropped by more than 2 points.`)}
      {all.length > 0 ? axis : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[9px] w-[9px] rounded-full border-2 border-slate-400 bg-white" /> earlier review
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[10px] w-[10px] rounded-full bg-slate-500" /> latest review
        </span>
      </div>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Trajectory: median + middle half, with the review rhythm beneath
// ---------------------------------------------------------------

export function TrajectoryChart({ timeline, noun, methodLabel }: { timeline: Timeline; noun: string; methodLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTip();
  const [active, setActive] = useState<number | null>(null);
  const buckets = timeline.buckets;
  const pad = { l: 40, r: 14 };
  const topH = 210;
  const gap = 34;
  const barH = 62;
  const height = 16 + topH + gap + barH + 24;
  const plotW = Math.max(120, width - pad.l - pad.r);
  const n = buckets.length;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? pad.l + i * step : pad.l + plotW / 2);
  const scored = buckets.filter((b) => b.median !== null);
  const lo = scoreFloor(scored.flatMap((b) => [b.median!, b.p25 ?? b.median!]));
  const y0 = 16;
  const y = (s: number) => y0 + (1 - (s - lo) / (100 - lo)) * topH;
  const maxReviews = Math.max(1, ...buckets.map((b) => b.reviews));
  const barTop = y0 + topH + gap;
  const barW = Math.max(3, Math.min(26, (n > 1 ? step : 40) - 4));

  // Line and band break where a bucket has no scored unit.
  const segments: number[][] = [];
  buckets.forEach((b, i) => {
    if (b.median === null) return;
    const last = segments[segments.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else segments.push([i]);
  });
  const bandSegments: number[][] = [];
  buckets.forEach((b, i) => {
    if (b.p25 === null || b.p75 === null) return;
    const last = bandSegments[bandSegments.length - 1];
    if (last && last[last.length - 1] === i - 1) last.push(i);
    else bandSegments.push([i]);
  });
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 62))));
  const yTicks = [lo, 50, 70, 85, 100].filter((v, i, list) => v >= lo && list.indexOf(v) === i);
  const lastScored = [...buckets].map((b, i) => ({ b, i })).filter((d) => d.b.median !== null).pop();

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + pad.l - 10;
    const i = n > 1 ? Math.max(0, Math.min(n - 1, Math.round((px - pad.l) / step))) : 0;
    const b = buckets[i];
    setActive(i);
    tip.show(
      e,
      <div className="min-w-[190px]">
        <div className="mb-1 text-[13px] font-semibold text-slate-950">{b.longLabel}</div>
        <TipRow label="Median score" value={fmt1(b.median)} />
        {b.p25 !== null ? <TipRow label="Middle half" value={`${fmt1(b.p25)} – ${fmt1(b.p75)}`} /> : null}
        <TipRow label={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} reviewed`} value={b.units} />
        <TipRow label="Reviews saved" value={b.reviews} />
      </div>,
    );
  };

  if (n === 0) return <EmptyNote>No reviews in this period.</EmptyNote>;
  return (
    <div ref={ref} className="relative" data-tip-host>
      <svg width={width} height={height} role="img" aria-label="Score trend and reviews saved over time">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke={v === GOOD_LINE ? AXIS : GRID} strokeDasharray={v === GOOD_LINE ? "4 3" : undefined} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill={MUTED}>
              {v}
            </text>
          </g>
        ))}
        {bandSegments.map((seg, si) => (
          <path
            key={si}
            d={`M${seg.map((i) => `${x(i)},${y(buckets[i].p75!)}`).join("L")}L${[...seg].reverse().map((i) => `${x(i)},${y(buckets[i].p25!)}`).join("L")}Z`}
            fill={SERIES_SOFT}
            opacity={0.75}
          />
        ))}
        {segments.map((seg, si) => (
          <polyline key={si} points={seg.map((i) => `${x(i)},${y(buckets[i].median!)}`).join(" ")} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {buckets.map((b, i) =>
          b.median !== null ? (
            <circle key={b.key} cx={x(i)} cy={y(b.median)} r={active === i ? 5 : 3} fill={SERIES} stroke="#ffffff" strokeWidth={2} />
          ) : null,
        )}
        {lastScored ? (
          <text
            x={Math.min(x(lastScored.i) + 8, width - pad.r)}
            y={y(lastScored.b.median!) - 9}
            textAnchor={x(lastScored.i) > width - 70 ? "end" : "start"}
            fontSize={12}
            fontWeight={700}
            fill={INK}
            stroke="#ffffff"
            strokeWidth={3}
            paintOrder="stroke"
          >
            {fmt1(lastScored.b.median)}
          </text>
        ) : null}
        {timeline.methodChangeIndex !== null ? (
          <g pointerEvents="none">
            <line x1={x(timeline.methodChangeIndex) - step / 2} x2={x(timeline.methodChangeIndex) - step / 2} y1={y0 - 2} y2={y0 + topH} stroke={MUTED} strokeWidth={1} strokeDasharray="2 3" />
            <text
              x={x(timeline.methodChangeIndex) - step / 2 + (x(timeline.methodChangeIndex) > width - 190 ? -6 : 6)}
              y={y0 + topH - 8}
              textAnchor={x(timeline.methodChangeIndex) > width - 190 ? "end" : "start"}
              fontSize={10.5}
              fill={MUTED}
              stroke="#ffffff"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {x(timeline.methodChangeIndex) > width - 190 ? `${methodLabel} from here →` : `← ${methodLabel} from here`}
            </text>
          </g>
        ) : null}
        {/* Review rhythm */}
        <text x={pad.l} y={barTop - 10} fontSize={10.5} fontWeight={600} letterSpacing="0.06em" fill={MUTED}>
          REVIEWS SAVED PER {timeline.grain.toUpperCase()}
        </text>
        <text x={width - pad.r} y={barTop - 10} textAnchor="end" fontSize={10.5} fill={MUTED}>
          peak {maxReviews}
        </text>
        <line x1={pad.l} x2={width - pad.r} y1={barTop + barH} y2={barTop + barH} stroke={AXIS} />
        {buckets.map((b, i) => {
          const h = (b.reviews / maxReviews) * barH;
          return b.reviews > 0 ? (
            <path
              key={b.key}
              d={`M${x(i) - barW / 2},${barTop + barH}V${barTop + barH - h + Math.min(3, h)}Q${x(i) - barW / 2},${barTop + barH - h} ${x(i) - barW / 2 + Math.min(3, barW / 2)},${barTop + barH - h}H${x(i) + barW / 2 - Math.min(3, barW / 2)}Q${x(i) + barW / 2},${barTop + barH - h} ${x(i) + barW / 2},${barTop + barH - h + Math.min(3, h)}V${barTop + barH}Z`}
              fill={active === i ? MUTED : CONTEXT}
            />
          ) : null;
        })}
        {buckets.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={b.key} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10.5} fill={MUTED}>
              {b.label}
            </text>
          ) : null,
        )}
        {active !== null ? <line x1={x(active)} x2={x(active)} y1={y0} y2={barTop + barH} stroke={CONTEXT} strokeWidth={1} pointerEvents="none" /> : null}
        <rect
          x={pad.l - 10}
          y={y0}
          width={plotW + 20}
          height={barTop + barH - y0}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => {
            setActive(null);
            tip.hide();
          }}
        />
      </svg>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Re-review effect: change when the same months were reviewed again
// ---------------------------------------------------------------

export function ReReviewChart({ data }: { data: ReReview }) {
  const tip = useTip();
  const max = Math.max(1, ...data.bins.map((b) => b.count));
  const color = { down: DOWN, flat: CONTEXT, up: SERIES } as const;
  return (
    <div className="relative" data-tip-host>
      <div className="flex h-[150px] items-end gap-[6px] border-b border-slate-300 px-1">
        {data.bins.map((bin) => (
          <div
            key={bin.label}
            className="flex h-full flex-1 flex-col items-center justify-end"
            onMouseMove={(e) =>
              tip.show(
                e,
                <div>
                  <div className="text-[13px] font-semibold text-slate-950">{bin.label} points</div>
                  <TipRow label="Re-reviewed periods" value={`${bin.count} (${Math.round((bin.count / Math.max(1, data.groups)) * 100)}%)`} />
                </div>,
              )
            }
            onMouseLeave={tip.hide}
          >
            <span className="mb-1 text-[11px] font-semibold tabular-nums text-slate-700">{bin.count}</span>
            <span
              className="w-full max-w-[44px] rounded-t-[4px]"
              style={{ height: `${Math.max(bin.count > 0 ? 2 : 0, (bin.count / max) * 112)}px`, background: color[bin.tone] }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[6px] px-1">
        {data.bins.map((bin) => (
          <span key={bin.label} className="flex-1 text-center text-[10px] leading-3 text-slate-500">
            {bin.label}
          </span>
        ))}
      </div>
      <div className="mt-2 text-center text-[11px] text-slate-500">Score change between first and last review of the same data months →</div>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Data-month matrix
// ---------------------------------------------------------------

export function MonthMatrix({ matrix, onPickRow, limit }: { matrix: Matrix; onPickRow?: (row: MatrixRow) => void; limit: number }) {
  const tip = useTip();
  const rows = matrix.rows.slice(0, limit);
  const short = (m: string) => {
    const [year, month] = m.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short" });
  };
  return (
    <div className="relative" data-tip-host>
      <div className="overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                {matrix.rowLevel} · lowest score first
              </th>
              {matrix.months.map((m, i) => (
                <th key={m} className="min-w-[44px] px-0 pb-1 text-center text-[10.5px] font-semibold text-slate-500">
                  <div>{short(m)}</div>
                  <div className="font-normal text-slate-400">{i === 0 || m.endsWith("-01") ? m.slice(0, 4) : " "}</div>
                </th>
              ))}
              <th className="pl-2 text-right text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">Months checked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="sticky left-0 z-10 max-w-[190px] bg-white pr-3">
                  <button
                    type="button"
                    disabled={!onPickRow}
                    onClick={onPickRow ? () => onPickRow(row) : undefined}
                    className="block w-full truncate text-left text-[12.5px] font-medium text-slate-800 enabled:hover:text-blue-700 enabled:hover:underline"
                  >
                    {row.name}
                  </button>
                </td>
                {row.cells.map((cell, i) => {
                  const band = bandOf(cell.value);
                  return (
                    <td
                      key={matrix.months[i]}
                      className="h-7 rounded-[5px] text-center text-[11px] font-semibold tabular-nums"
                      style={
                        band
                          ? { background: cell.exact ? band.color : `${band.color}66`, color: cell.exact ? band.ink : INK }
                          : { background: "#f4f6f9", color: "#cbd5e1" }
                      }
                      onMouseMove={(e) =>
                        tip.show(
                          e,
                          <div className="min-w-[180px]">
                            <div className="text-[13px] font-semibold text-slate-950">{row.name}</div>
                            <div className="mb-1 text-[11px] text-slate-500">Data of {monthFullLabel(matrix.months[i])}</div>
                            {cell.value === null ? (
                              <div className="text-slate-500">Not reviewed.</div>
                            ) : (
                              <>
                                <TipRow label={cell.n > 1 ? `Median of ${cell.n} districts` : "Score"} value={`${fmt1(cell.value)} · ${band?.label}`} />
                                <div className="mt-1 text-[11px] text-slate-400">
                                  {cell.exact
                                    ? "This month's own score, from the latest review that covered it."
                                    : "Faded: from a multi-month review saved without month-by-month scores, so this is the score of its whole period."}
                                </div>
                              </>
                            )}
                          </div>,
                        )
                      }
                      onMouseLeave={tip.hide}
                    >
                      {cell.value === null ? "·" : Math.round(cell.value)}
                    </td>
                  );
                })}
                <td className="pl-2 text-right text-[12px] tabular-nums text-slate-600">
                  {row.covered}/{matrix.months.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip.box}
    </div>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------

export function Sparkline({ values, width = 92, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const shown = values.slice(-24);
  const lo = Math.min(40, ...shown) - 2;
  const px = (i: number) => (shown.length > 1 ? 4 + (i / (shown.length - 1)) * (width - 8) : width - 4);
  const py = (v: number) => 4 + (1 - (v - lo) / (100 - lo)) * (height - 8);
  const last = shown[shown.length - 1];
  return (
    <svg width={width} height={height} aria-hidden>
      {shown.length > 1 ? (
        <polyline points={shown.map((v, i) => `${px(i)},${py(v)}`).join(" ")} fill="none" stroke={CONTEXT} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ) : null}
      <circle cx={px(shown.length - 1)} cy={py(last)} r={3.2} fill={bandOf(last)!.color} stroke="#ffffff" strokeWidth={1.2} />
    </svg>
  );
}

export function MiniBars({ values, width = 120, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  const barW = Math.max(2, slot - 2);
  return (
    <svg width={width} height={height} aria-hidden>
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * (height - 2));
        return <rect key={i} x={i * slot + (slot - barW) / 2} y={height - h} width={barW} height={h} rx={1.5} fill={i === values.length - 1 ? SERIES : CONTEXT} opacity={i === values.length - 1 ? 1 : 0.6} />;
      })}
    </svg>
  );
}

export function CountBars({ rows, total }: { rows: Array<{ label: string; count: number }>; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-[7px]">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr_auto] items-center gap-2.5 text-[12.5px]">
          <span className="truncate text-slate-700" title={row.label}>
            {row.label}
          </span>
          <span className="block h-[10px]">
            <span className="block h-full rounded-r-[4px]" style={{ width: `${(row.count / max) * 100}%`, minWidth: row.count > 0 ? 2 : 0, background: SERIES }} />
          </span>
          <span className="min-w-[64px] text-right tabular-nums text-slate-900">
            <span className="font-semibold">{row.count.toLocaleString("en-IN")}</span>
            <span className="ml-1.5 text-[11px] text-slate-500">{total > 0 ? `${Math.round((row.count / total) * 100)}%` : ""}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function BandBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Share of units in each score band">
      {counts.map((count, i) =>
        count > 0 ? <span key={BANDS[i].key} title={`${BANDS[i].label}: ${count}`} style={{ width: `${(count / total) * 100}%`, background: BANDS[i].color }} /> : null,
      )}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[120px] items-center justify-center rounded-2xl bg-slate-50 px-4 text-center text-sm text-slate-500">{children}</div>;
}

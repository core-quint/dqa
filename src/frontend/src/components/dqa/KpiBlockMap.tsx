import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import {
  combineBounds,
  padBounds,
  topologyBounds,
  topologyToFeatures,
  type Bounds,
  type MapFeature,
  type Topology,
} from "../../lib/maps/topology";

interface BlockShapeProps {
  block_name: string;
  block_shape_id: string;
  state_name: string;
  state_lgd: string;
  district_name: string;
  district_lgd: string;
}

interface HoverInfo {
  x: number;
  y: number;
  blockName: string;
  count: number | null;
  inCsvData: boolean;
}

interface Props {
  stateName: string;
  districtName: string;
  /** Blocks with at least one flagged facility: block label → count */
  blockCounts: Record<string, number>;
  /** All block names present in the filtered CSV (regardless of flag status) */
  allDataBlocks: string[];
  maxCount: number;
}

// Module-level cache — 5.7 MB JSON, only fetched once per app session
let _blocksPromise: Promise<Topology<BlockShapeProps>> | null = null;

function loadBlocksTopology(): Promise<Topology<BlockShapeProps>> {
  if (!_blocksPromise) {
    _blocksPromise = fetch(new URL("../../../assets/blocks.json", import.meta.url).href)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load block boundaries");
        return r.json() as Promise<Topology<BlockShapeProps>>;
      })
      .catch((err) => {
        _blocksPromise = null; // allow retry on next mount
        throw err;
      });
  }
  return _blocksPromise;
}

function normalizeBlock(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshteinDist(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function matchBlock(
  label: string,
  features: MapFeature<BlockShapeProps>[],
): MapFeature<BlockShapeProps> | null {
  const norm = normalizeBlock(label);
  if (!norm) return null;

  const exact = features.find((f) => normalizeBlock(f.properties.block_name) === norm);
  if (exact) return exact;

  let best: MapFeature<BlockShapeProps> | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const f of features) {
    const d = levenshteinDist(norm, normalizeBlock(f.properties.block_name));
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  const threshold = Math.max(1, Math.floor(norm.length * 0.28));
  return bestDist <= threshold ? best : null;
}

function flagColor(featureId: string, featureToCount: Map<string, number>, featureInData: Map<string, boolean>, maxCount: number): string {
  const inData = featureInData.get(featureId) ?? false;
  if (!inData) return "#e2e8f0"; // unknown — not in CSV
  const count = featureToCount.get(featureId) ?? 0;
  if (count === 0) return "#bbf7d0"; // in CSV, no issues — light green
  const ratio = count / Math.max(maxCount, 1);
  if (ratio < 0.2) return "#fef9c3";
  if (ratio < 0.4) return "#fde68a";
  if (ratio < 0.6) return "#f97316";
  if (ratio < 0.8) return "#ef4444";
  return "#b91c1c";
}

const FLAG_THRESHOLDS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const FLAG_LABELS = ["Very low", "Low", "Medium", "High", "Very high"];
const FLAG_COLORS = ["#fef9c3", "#fde68a", "#f97316", "#ef4444", "#b91c1c"];

function buildLegendItems(maxCount: number) {
  const base = [{ color: "#bbf7d0", label: "No flagged facilities" }];
  const tail = [{ color: "#e2e8f0", label: "Not in this analysis" }];
  if (maxCount <= 0) return [...base, ...tail];

  const bands = FLAG_LABELS.map((label, i) => {
    const lo = i === 0 ? 1 : Math.ceil(FLAG_THRESHOLDS[i] * maxCount);
    const hi = i === FLAG_LABELS.length - 1
      ? maxCount
      : Math.ceil(FLAG_THRESHOLDS[i + 1] * maxCount) - 1;
    return { color: FLAG_COLORS[i], label, lo, hi };
  }).filter(({ lo, hi }) => lo <= hi);

  return [
    ...base,
    ...bands.map(({ color, label, lo, hi }) => ({
      color,
      label: lo === hi
        ? `${label} — ${lo} ${lo === 1 ? "facility" : "facilities"}`
        : `${label} — ${lo}–${hi} facilities`,
    })),
    ...tail,
  ];
}

export function KpiBlockMap({ stateName, districtName, blockCounts, allDataBlocks, maxCount }: Props) {
  const [topology, setTopology] = useState<Topology<BlockShapeProps> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  function buildFilename(ext: string) {
    const parts = ["dqa-block-map", stateName, districtName]
      .filter(Boolean)
      .map((s) => s.toLowerCase().replace(/\s+/g, "-"));
    return `${parts.join("-")}.${ext}`;
  }

  function downloadSVG() {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const source = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob(['<?xml version="1.0" encoding="utf-8"?>\n', source], { type: "image/svg+xml" });
    triggerDownload(URL.createObjectURL(blob), buildFilename("svg"));
  }

  function downloadPNG() {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const source = new XMLSerializer().serializeToString(svgEl);
    const scale = 2;
    const w = svgEl.clientWidth * scale;
    const h = svgEl.clientHeight * scale;
    const blob = new Blob(['<?xml version="1.0" encoding="utf-8"?>\n', source], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#dce8f0";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      triggerDownload(canvas.toDataURL("image/png"), buildFilename("png"));
    };
    img.src = url;
  }

  function triggerDownload(href: string, filename: string) {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  useEffect(() => {
    let mounted = true;
    loadBlocksTopology()
      .then((data) => {
        if (mounted) {
          setTopology(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoadError("Could not load block boundaries.");
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const allFeatures = useMemo(
    () => (topology ? topologyToFeatures(topology, "blocks") : []),
    [topology],
  );

  // Filter topology features to this district
  const districtFeatures = useMemo(() => {
    const normState = normalizeBlock(stateName);
    const normDist = normalizeBlock(districtName);
    return allFeatures.filter(
      (f) =>
        normalizeBlock(f.properties.state_name) === normState &&
        normalizeBlock(f.properties.district_name) === normDist,
    );
  }, [allFeatures, stateName, districtName]);

  // Build: featureId → count, featureId → inCsvData, and unmapped block list
  const { featureToCount, featureInData, unmappedBlocks } = useMemo(() => {
    const featureToCount = new Map<string, number>();
    const featureInData = new Map<string, boolean>();
    const matchedIds = new Set<string>();
    const unmapped: Array<{ block: string; count: number }> = [];

    // Match flagged blocks to topology features
    for (const [blockLabel, count] of Object.entries(blockCounts)) {
      const feature = matchBlock(blockLabel, districtFeatures);
      if (feature) {
        featureToCount.set(feature.id, (featureToCount.get(feature.id) ?? 0) + count);
        featureInData.set(feature.id, true);
        matchedIds.add(feature.id);
      } else {
        unmapped.push({ block: blockLabel, count });
      }
    }

    // Mark features whose blocks are in the CSV but have 0 flags
    for (const feature of districtFeatures) {
      if (matchedIds.has(feature.id)) continue;
      const normName = normalizeBlock(feature.properties.block_name);
      const inData = allDataBlocks.some((b) => {
        const d = levenshteinDist(normalizeBlock(b), normName);
        return d <= Math.max(1, Math.floor(normName.length * 0.28));
      });
      featureInData.set(feature.id, inData);
    }

    return {
      featureToCount,
      featureInData,
      unmappedBlocks: unmapped.sort((a, b) => b.count - a.count),
    };
  }, [allDataBlocks, blockCounts, districtFeatures]);

  const mapBounds: Bounds = useMemo(() => {
    if (districtFeatures.length > 0) {
      const fb = topology ? topologyBounds(topology) : undefined;
      return padBounds(combineBounds(districtFeatures, fb), 0.05);
    }
    return topology ? (topologyBounds(topology) ?? [0, 0, 1, 1]) : [0, 0, 1, 1];
  }, [districtFeatures, topology]);

  const [bMinX, bMinY, bMaxX, bMaxY] = mapBounds;
  const viewW = Math.max(bMaxX - bMinX, 1);
  const viewH = Math.max(bMaxY - bMinY, 1);
  const labelFontSize = viewW / 42;
  const viewBox = `${bMinX} ${bMinY} ${viewW} ${viewH}`;

  const mappedFlagged = Object.keys(blockCounts).length - unmappedBlocks.length;
  const totalFlagged = Object.keys(blockCounts).length;

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex h-[380px] items-center justify-center text-sm text-slate-400">
        Loading block boundaries…
      </div>
    );
  }

  // ── Error ──
  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {loadError}
      </div>
    );
  }

  // ── No district features ──
  if (districtFeatures.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No block boundaries found for <strong>{districtName}</strong>,&nbsp;{stateName}. The
          district may not be present in the map data.
        </div>
        {unmappedBlocks.length > 0 && <UnmappedList blocks={unmappedBlocks} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* SVG choropleth */}
      <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-[#dce8f0] shadow-sm">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="h-[380px] w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Background ocean */}
          <rect x={bMinX - 2} y={bMinY - 2} width={viewW + 4} height={viewH + 4} fill="#dce8f0" />

          {/* Block fills */}
          {districtFeatures.map((feature) => {
            const isHovered = hovered?.blockName === feature.properties.block_name;
            const count = featureToCount.get(feature.id) ?? 0;
            const inData = featureInData.get(feature.id) ?? false;
            const fill = flagColor(feature.id, featureToCount, featureInData, maxCount);

            return (
              <path
                key={feature.id}
                d={feature.path}
                fill={fill}
                fillRule="evenodd"
                stroke={isHovered ? "#0f172a" : "rgba(255,255,255,0.88)"}
                strokeWidth={isHovered ? 2.5 : 1}
                vectorEffect="non-scaling-stroke"
                style={{ transition: "fill 150ms ease", cursor: "default" }}
                onMouseMove={(e) =>
                  setHovered({
                    x: e.clientX,
                    y: e.clientY,
                    blockName: feature.properties.block_name,
                    count: inData ? count : null,
                    inCsvData: inData,
                  })
                }
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}

          {/* Labels — shown when district has ≤40 blocks and feature is large enough */}
          {districtFeatures.length <= 40 &&
            districtFeatures.map((feature) => {
              const cx = (feature.bounds[0] + feature.bounds[2]) / 2;
              const cy = (feature.bounds[1] + feature.bounds[3]) / 2;
              const featureW = feature.bounds[2] - feature.bounds[0];
              if (featureW < viewW * 0.07) return null;

              const raw = feature.properties.block_name;
              const label = raw.length > 13 ? raw.slice(0, 11) + "…" : raw;

              return (
                <text
                  key={`lbl-${feature.id}`}
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={labelFontSize}
                  fontWeight="600"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fill="rgba(15,23,42,0.85)"
                  stroke="rgba(255,255,255,0.72)"
                  strokeWidth={labelFontSize * 0.28}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {label}
                </text>
              );
            })}
        </svg>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div
          className="pointer-events-none fixed z-50 min-w-[160px] rounded-xl border border-white/80 bg-slate-950/95 px-3 py-2.5 shadow-xl backdrop-blur-sm"
          style={{
            left: Math.min(hovered.x + 14, (globalThis.window?.innerWidth ?? 9999) - 200),
            top: Math.min(hovered.y + 14, (globalThis.window?.innerHeight ?? 9999) - 100),
          }}
        >
          <div className="text-sm font-bold text-white">{hovered.blockName}</div>
          <div className="mt-1 text-xs">
            {!hovered.inCsvData ? (
              <span className="text-white/50">Not in this analysis</span>
            ) : hovered.count === 0 ? (
              <span className="text-emerald-400 font-medium">No flagged facilities</span>
            ) : (
              <span className="text-amber-300 font-medium">
                {hovered.count} flagged {hovered.count === 1 ? "facility" : "facilities"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Legend + download */}
      <div className="space-y-2 rounded-xl bg-slate-50/80 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Flagged facilities per block
            {maxCount > 0 && (
              <span className="ml-1 font-normal text-slate-400">(max in dataset: {maxCount})</span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={downloadSVG}
              title="Download map as SVG"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Download className="h-3 w-3" />
              SVG
            </button>
            <button
              type="button"
              onClick={downloadPNG}
              title="Download map as PNG"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <Download className="h-3 w-3" />
              PNG
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {buildLegendItems(maxCount).map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 flex-none rounded-full border border-black/10"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coverage note */}
      {totalFlagged > 0 && (
        <p className="text-[11px] text-slate-400">
          {mappedFlagged} of {totalFlagged} blocks with flagged facilities matched to map
          boundaries.
          {unmappedBlocks.length > 0 ? " Unmatched blocks are listed below." : ""}
        </p>
      )}

      {/* Unmapped blocks */}
      {unmappedBlocks.length > 0 && <UnmappedList blocks={unmappedBlocks} />}
    </div>
  );
}

function UnmappedList({ blocks }: { blocks: Array<{ block: string; count: number }> }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        Blocks not located on map
      </div>
      <div className="flex flex-wrap gap-2">
        {blocks.map(({ block, count }) => (
          <div
            key={block}
            className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5"
          >
            <span className="text-xs font-medium text-amber-800">{block}</span>
            {count > 0 && (
              <span className="rounded-full bg-amber-200/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                {count}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

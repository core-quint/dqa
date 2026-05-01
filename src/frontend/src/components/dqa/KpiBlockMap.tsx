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
import {
  loadBlocksTopology,
  normalizeBlock,
  levenshteinDist,
  matchBlock,
  flagColor,
  buildLegendItems,
  type BlockShapeProps,
} from "../../lib/maps/blockMapUtils";

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

  const districtFeatures = useMemo(() => {
    const normState = normalizeBlock(stateName);
    const normDist = normalizeBlock(districtName);
    return allFeatures.filter(
      (f) =>
        normalizeBlock(f.properties.state_name) === normState &&
        normalizeBlock(f.properties.district_name) === normDist,
    );
  }, [allFeatures, stateName, districtName]);

  const { featureToCount, featureInData, unmappedBlocks } = useMemo(() => {
    const featureToCount = new Map<string, number>();
    const featureInData = new Map<string, boolean>();
    const matchedIds = new Set<string>();
    const unmapped: Array<{ block: string; count: number }> = [];

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

  if (loading) {
    return (
      <div className="flex h-[380px] items-center justify-center text-sm text-slate-400">
        Loading block boundaries…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {loadError}
      </div>
    );
  }

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
          <rect x={bMinX - 2} y={bMinY - 2} width={viewW + 4} height={viewH + 4} fill="#dce8f0" />

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

      {totalFlagged > 0 && (
        <p className="text-[11px] text-slate-400">
          {mappedFlagged} of {totalFlagged} blocks with flagged facilities matched to map
          boundaries.
          {unmappedBlocks.length > 0 ? " Unmatched blocks are listed below." : ""}
        </p>
      )}

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

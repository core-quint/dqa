import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  Download,
  Layers3,
  MapPinned,
  RefreshCcw,
  RotateCcw,
  Route,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { API_BASE } from "../../config";
import type { AuthState } from "./LoginPage";
import { GlassPanel } from "../branding/GlassPanel";
import {
  type SnapshotDqaLevel,
  type SnapshotRecord,
  getSnapshotBlock,
  getSnapshotDqaLevel,
  getSnapshotPeriod,
  normalizePortal,
} from "../../lib/snapshots";
import {
  combineBounds,
  padBounds,
  topologyBounds,
  topologyToFeatures,
  type Bounds,
  type MapFeature,
  type Topology,
} from "../../lib/maps/topology";

type PortalFilter = "ALL" | "HMIS" | "UWIN";
type CoverageIndicator =
  | "count"
  | "overall"
  | "availability"
  | "completeness"
  | "accuracy"
  | "consistency";

interface StateShapeProps {
  state_name: string;
  state_lgd: string;
}

interface DistrictShapeProps {
  state_name: string;
  state_lgd: string;
  district_name: string;
  district_lgd: string;
}

interface BlockShapeProps {
  block_name: string;
  block_shape_id: string;
  state_name: string;
  state_lgd: string;
  district_name: string;
  district_lgd: string;
}

interface CoverageMetric {
  featureId: string;
  value: number | null;
  snapshots: number;
}

interface HoverState {
  x: number;
  y: number;
  featureId: string;
  label: string;
  sublabel: string;
  valueLabel: string;
  snapshots: number;
}

const LEVEL_OPTIONS: Array<{ value: SnapshotDqaLevel; label: string }> = [
  { value: "DISTRICT", label: "District" },
  { value: "BLOCK", label: "Block" },
];

const INDICATOR_OPTIONS: Array<{ value: CoverageIndicator; label: string }> = [
  { value: "count", label: "Number of DQA" },
  { value: "overall", label: "Overall component scoring" },
  { value: "availability", label: "Availability" },
  { value: "completeness", label: "Completeness" },
  { value: "accuracy", label: "Accuracy" },
  { value: "consistency", label: "Consistency" },
];

const portalLabelMap: Record<PortalFilter, string> = {
  ALL: "All portals",
  HMIS: "HMIS",
  UWIN: "U-WIN",
};

// 5-step discrete color scale: red → orange → yellow → lime → green
const COLOR_SCALE = ["#dc2626", "#f97316", "#eab308", "#84cc16", "#16a34a"];
const LEGEND_BANDS = ["0–20", "20–40", "40–60", "60–80", "80–100"];

export function CoveragePage({ auth }: { auth: AuthState }) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [snapshotError, setSnapshotError] = useState("");
  const [statesTopology, setStatesTopology] = useState<Topology<StateShapeProps> | null>(null);
  const [districtsTopology, setDistrictsTopology] =
    useState<Topology<DistrictShapeProps> | null>(null);
  const [blocksTopology, setBlocksTopology] = useState<Topology<BlockShapeProps> | null>(null);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [level, setLevel] = useState<SnapshotDqaLevel>("DISTRICT");
  const [portal, setPortal] = useState<PortalFilter>("ALL");
  const [selectedState, setSelectedState] = useState(initialStateValue(auth));
  const [selectedDistrict, setSelectedDistrict] = useState(initialDistrictValue(auth));
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [indicator, setIndicator] = useState<CoverageIndicator>("count");
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [zoomBounds, setZoomBounds] = useState<Bounds | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const blocksLoadingRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startBounds: Bounds;
    moved: boolean;
  } | null>(null);
  const wasDragRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    async function loadBaseData() {
      try {
        const [snapshotResponse, statesResponse, districtsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/snapshots`, {
            headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
          }),
          fetch(new URL("../../../assets/states.json", import.meta.url).href),
          fetch(new URL("../../../assets/districts.json", import.meta.url).href),
        ]);

        if (!snapshotResponse.ok) throw new Error("Failed to load saved DQA snapshots.");
        if (!statesResponse.ok || !districtsResponse.ok) throw new Error("Failed to load map files.");

        const [snapshotData, statesData, districtsData] = await Promise.all([
          snapshotResponse.json() as Promise<SnapshotRecord[]>,
          statesResponse.json() as Promise<Topology<StateShapeProps>>,
          districtsResponse.json() as Promise<Topology<DistrictShapeProps>>,
        ]);

        if (!mounted) return;
        setSnapshots(snapshotData);
        setStatesTopology(statesData);
        setDistrictsTopology(districtsData);
        setSnapshotError("");
      } catch (error) {
        if (!mounted) return;
        setSnapshotError(
          error instanceof Error ? error.message : "Failed to load coverage data.",
        );
      } finally {
        if (mounted) setLoadingSnapshots(false);
      }
    }

    void loadBaseData();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (level !== "BLOCK" || blocksTopology || blocksLoadingRef.current) return;
    blocksLoadingRef.current = true;
    let mounted = true;
    setLoadingBlocks(true);

    fetch(new URL("../../../assets/blocks.json", import.meta.url).href)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load block map.");
        return r.json() as Promise<Topology<BlockShapeProps>>;
      })
      .then((data) => {
        if (mounted) {
          setBlocksTopology(data);
          setLoadingBlocks(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setSnapshotError(err instanceof Error ? err.message : "Failed to load block map.");
          setLoadingBlocks(false);
        }
        blocksLoadingRef.current = false;
      });

    return () => { mounted = false; };
  }, [blocksTopology, level]);

  // Reset zoom when geography scope changes
  useEffect(() => {
    setZoomBounds(null);
  }, [level, selectedState, selectedDistrict, portal]);

  // Attach non-passive wheel handler for zoom
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const b = boundsRef.current;
      if (!b) return;
      const rect = svgEl!.getBoundingClientRect();
      const [bMinX, bMinY, bMaxX, bMaxY] = b;
      const bW = bMaxX - bMinX;
      const bH = bMaxY - bMinY;
      const mouseX = bMinX + ((e.clientX - rect.left) / rect.width) * bW;
      const mouseY = bMinY + ((e.clientY - rect.top) / rect.height) * bH;
      const factor = e.deltaY < 0 ? 0.78 : 1.28;
      const newMinX = mouseX - (mouseX - bMinX) * factor;
      const newMinY = mouseY - (mouseY - bMinY) * factor;
      setZoomBounds([newMinX, newMinY, newMinX + bW * factor, newMinY + bH * factor]);
    }

    svgEl.addEventListener("wheel", onWheel, { passive: false });
    return () => svgEl.removeEventListener("wheel", onWheel);
  }, []);

  const stateFeatures = useMemo(
    () => (statesTopology ? topologyToFeatures(statesTopology, "states") : []),
    [statesTopology],
  );
  const districtFeatures = useMemo(
    () => (districtsTopology ? topologyToFeatures(districtsTopology, "districts") : []),
    [districtsTopology],
  );
  const blockFeatures = useMemo(
    () => (blocksTopology ? topologyToFeatures(blocksTopology, "blocks") : []),
    [blocksTopology],
  );

  const allStateNames = useMemo(
    () =>
      [...new Set(stateFeatures.map((f) => f.properties.state_name))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [stateFeatures],
  );

  const resolvedScopedState = useMemo(() => {
    if (auth.role === "admin" || auth.level === "NATIONAL") return null;
    return resolveOptionValue(auth.geoState, allStateNames);
  }, [allStateNames, auth.geoState, auth.level, auth.role]);

  const stateOptions = useMemo(() => {
    if (auth.role === "admin" || auth.level === "NATIONAL") return allStateNames;
    return resolvedScopedState ? [resolvedScopedState] : [];
  }, [allStateNames, auth.level, auth.role, resolvedScopedState]);

  useEffect(() => {
    if (auth.role === "admin" || auth.level === "NATIONAL") return;
    if (resolvedScopedState && selectedState !== resolvedScopedState) {
      setSelectedState(resolvedScopedState);
    }
  }, [auth.level, auth.role, resolvedScopedState, selectedState]);

  const districtPool = useMemo(() => {
    if (selectedState === "ALL") return [];
    return districtFeatures
      .filter(
        (f) =>
          normalizeGeoName(f.properties.state_name) === normalizeGeoName(selectedState),
      )
      .map((f) => f.properties.district_name)
      .filter(uniqueValue)
      .sort((a, b) => a.localeCompare(b));
  }, [districtFeatures, selectedState]);

  const resolvedScopedDistrict = useMemo(() => {
    if (auth.level !== "DISTRICT" && auth.level !== "BLOCK") return null;
    return resolveOptionValue(auth.geoDistrict, districtPool);
  }, [auth.geoDistrict, auth.level, districtPool]);

  const districtOptions = useMemo(() => {
    if (selectedState === "ALL") return [];
    if (auth.level === "DISTRICT" || auth.level === "BLOCK") {
      return resolvedScopedDistrict ? [resolvedScopedDistrict] : [];
    }
    return districtPool;
  }, [auth.level, districtPool, resolvedScopedDistrict, selectedState]);

  useEffect(() => {
    if (selectedState !== "ALL" && districtOptions.length === 0) {
      setSelectedDistrict("ALL");
      return;
    }
    if (
      auth.level !== "DISTRICT" &&
      auth.level !== "BLOCK" &&
      selectedDistrict !== "ALL" &&
      !districtOptions.some(
        (o) => normalizeGeoName(o) === normalizeGeoName(selectedDistrict),
      )
    ) {
      setSelectedDistrict("ALL");
      return;
    }
    if (
      (auth.level === "DISTRICT" || auth.level === "BLOCK") &&
      resolvedScopedDistrict &&
      selectedDistrict !== resolvedScopedDistrict
    ) {
      setSelectedDistrict(resolvedScopedDistrict);
    }
  }, [auth.level, districtOptions, resolvedScopedDistrict, selectedDistrict, selectedState]);

  const visibleStateValue =
    selectedState !== "ALL" && stateOptions.length > 0
      ? (resolveOptionValue(selectedState, stateOptions) ?? selectedState)
      : selectedState;
  const visibleDistrictValue =
    selectedDistrict !== "ALL" && districtOptions.length > 0
      ? (resolveOptionValue(selectedDistrict, districtOptions) ?? selectedDistrict)
      : selectedDistrict;

  const visibleFeatures = useMemo(() => {
    const pool = level === "BLOCK" ? blockFeatures : districtFeatures;
    return pool.filter((f) => {
      if (
        visibleStateValue !== "ALL" &&
        normalizeGeoName(f.properties.state_name) !== normalizeGeoName(visibleStateValue)
      )
        return false;
      if (
        visibleDistrictValue !== "ALL" &&
        normalizeGeoName(f.properties.district_name) !== normalizeGeoName(visibleDistrictValue)
      )
        return false;
      return true;
    });
  }, [blockFeatures, districtFeatures, level, visibleDistrictValue, visibleStateValue]);

  const outlineFeatures = useMemo(() => {
    const pool = level === "BLOCK" ? districtFeatures : stateFeatures;
    return pool.filter((f) => {
      if (
        visibleStateValue !== "ALL" &&
        normalizeGeoName(f.properties.state_name) !== normalizeGeoName(visibleStateValue)
      )
        return false;
      if (
        level === "BLOCK" &&
        visibleDistrictValue !== "ALL" &&
        "district_name" in f.properties &&
        normalizeGeoName((f.properties as DistrictShapeProps).district_name) !==
          normalizeGeoName(visibleDistrictValue)
      )
        return false;
      return true;
    });
  }, [districtFeatures, level, stateFeatures, visibleDistrictValue, visibleStateValue]);

  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((s) => {
      if (portal !== "ALL" && normalizePortal(s.portal) !== portal) return false;
      if (getSnapshotDqaLevel(s) !== level) return false;
      if (
        visibleStateValue !== "ALL" &&
        normalizeGeoName(s.state) !== normalizeGeoName(visibleStateValue)
      )
        return false;
      if (
        visibleDistrictValue !== "ALL" &&
        normalizeGeoName(s.district) !== normalizeGeoName(visibleDistrictValue)
      )
        return false;
      const period = getSnapshotPeriod(s);
      if (fromMonth && period.end < fromMonth) return false;
      if (toMonth && period.start > toMonth) return false;
      return true;
    });
  }, [fromMonth, level, portal, snapshots, toMonth, visibleDistrictValue, visibleStateValue]);

  const featureLookup = useMemo(
    () => buildFeatureLookup(level, visibleFeatures),
    [level, visibleFeatures],
  );

  const metricsByFeature = useMemo(() => {
    const buckets = new Map<string, { count: number; sum: number; valueCount: number }>();

    for (const snapshot of filteredSnapshots) {
      const match = matchFeature(featureLookup, snapshot, level);
      if (!match) continue;
      const current = buckets.get(match.id) ?? { count: 0, sum: 0, valueCount: 0 };
      current.count += 1;
      const metricValue = getIndicatorValue(snapshot, indicator);
      if (metricValue !== null) {
        current.sum += metricValue;
        current.valueCount += 1;
      }
      buckets.set(match.id, current);
    }

    const metrics = new Map<string, CoverageMetric>();
    for (const feature of visibleFeatures) {
      const bucket = buckets.get(feature.id);
      if (!bucket) continue;
      metrics.set(feature.id, {
        featureId: feature.id,
        value:
          indicator === "count"
            ? bucket.count
            : bucket.valueCount > 0
              ? bucket.sum / bucket.valueCount
              : null,
        snapshots: bucket.count,
      });
    }
    return metrics;
  }, [featureLookup, filteredSnapshots, indicator, level, visibleFeatures]);

  const valueExtent = useMemo(() => {
    const values = [...metricsByFeature.values()]
      .map((m) => m.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length === 0) return indicator === "count" ? [0, 1] : [0, 100];
    if (indicator === "count") return [0, Math.max(1, Math.max(...values))];
    return [0, 100];
  }, [indicator, metricsByFeature]);

  const regionsWithData = useMemo(
    () => [...metricsByFeature.values()].filter((m) => m.snapshots > 0).length,
    [metricsByFeature],
  );

  const averageValue = useMemo(() => {
    const values = [...metricsByFeature.values()]
      .map((m) => m.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }, [metricsByFeature]);

  const mapBounds = useMemo(() => {
    const fallback =
      level === "BLOCK"
        ? blocksTopology
          ? topologyBounds(blocksTopology)
          : undefined
        : districtsTopology
          ? topologyBounds(districtsTopology)
          : undefined;
    return padBounds(combineBounds(visibleFeatures, fallback), 0.025);
  }, [blocksTopology, districtsTopology, level, visibleFeatures]);

  const effectiveBounds = zoomBounds ?? mapBounds;
  boundsRef.current = effectiveBounds;

  const showLabels = visibleFeatures.length > 0 && visibleFeatures.length <= 55;
  const labelFontSize = (effectiveBounds[2] - effectiveBounds[0]) / 52;

  const [topRegions, bottomRegions] = useMemo(() => {
    const entries = [...metricsByFeature.entries()]
      .filter(([, m]) => m.snapshots > 0 && m.value !== null)
      .sort((a, b) => (b[1].value ?? 0) - (a[1].value ?? 0));

    const mapEntry = ([featureId, metric]: [string, CoverageMetric]) => {
      const feature = visibleFeatures.find((f) => f.id === featureId);
      return feature ? { feature, metric } : null;
    };

    const top = entries
      .slice(0, 6)
      .map(mapEntry)
      .filter(
        (r): r is { feature: MapFeature<DistrictShapeProps | BlockShapeProps>; metric: CoverageMetric } =>
          r !== null,
      );
    const bottom =
      indicator === "count"
        ? []
        : entries
            .slice(-6)
            .reverse()
            .map(mapEntry)
            .filter(
              (r): r is {
                feature: MapFeature<DistrictShapeProps | BlockShapeProps>;
                metric: CoverageMetric;
              } => r !== null,
            );

    return [top, bottom];
  }, [indicator, metricsByFeature, visibleFeatures]);

  // Zoom helpers
  function zoomInStep() {
    const b = boundsRef.current ?? mapBounds;
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const hw = (b[2] - b[0]) * 0.38;
    const hh = (b[3] - b[1]) * 0.38;
    setZoomBounds([cx - hw, cy - hh, cx + hw, cy + hh]);
  }

  function zoomOutStep() {
    const b = boundsRef.current ?? mapBounds;
    const cx = (b[0] + b[2]) / 2;
    const cy = (b[1] + b[3]) / 2;
    const hw = (b[2] - b[0]) * 0.64;
    const hh = (b[3] - b[1]) * 0.64;
    setZoomBounds([cx - hw, cy - hh, cx + hw, cy + hh]);
  }

  // Pan handlers
  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startBounds: effectiveBounds,
      moved: false,
    };
  }

  function handleSVGMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

    if (!dragRef.current.moved) {
      dragRef.current.moved = true;
      wasDragRef.current = true;
      setIsDragging(true);
      setHovered(null);
    }

    const rect = svgRef.current!.getBoundingClientRect();
    const [bMinX, bMinY, bMaxX, bMaxY] = dragRef.current.startBounds;
    const bW = bMaxX - bMinX;
    const bH = bMaxY - bMinY;
    const svgDx = -(dx / rect.width) * bW;
    const svgDy = -(dy / rect.height) * bH;
    setZoomBounds([bMinX + svgDx, bMinY + svgDy, bMaxX + svgDx, bMaxY + svgDy]);
  }

  function handleMouseUp() {
    dragRef.current = null;
    setIsDragging(false);
    setTimeout(() => { wasDragRef.current = false; }, 80);
  }

  // Download
  function downloadSVG() {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob(['<?xml version="1.0" encoding="utf-8"?>\n', source], {
      type: "image/svg+xml",
    });
    triggerDownload(URL.createObjectURL(blob), buildFilename("svg"));
  }

  function downloadPNG() {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const scale = 2;
    const w = svgEl.clientWidth * scale;
    const h = svgEl.clientHeight * scale;
    const blob = new Blob(['<?xml version="1.0" encoding="utf-8"?>\n', source], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f1f5f9";
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

  function buildFilename(ext: string) {
    const parts = ["dqa-coverage", level.toLowerCase()];
    if (visibleStateValue !== "ALL") parts.push(visibleStateValue.toLowerCase().replace(/\s+/g, "-"));
    if (visibleDistrictValue !== "ALL")
      parts.push(visibleDistrictValue.toLowerCase().replace(/\s+/g, "-"));
    parts.push(indicator);
    return `${parts.join("-")}.${ext}`;
  }

  const scopeLabel =
    auth.role === "admin" || auth.level === "NATIONAL"
      ? "National scope"
      : [auth.level, resolvedScopedState, resolvedScopedDistrict].filter(Boolean).join(" / ");

  const loadingMap =
    loadingSnapshots ||
    !statesTopology ||
    !districtsTopology ||
    (level === "BLOCK" && !blocksTopology);
  const canChangeState = auth.role === "admin" || auth.level === "NATIONAL";
  const canChangeDistrict =
    (auth.role === "admin" || auth.level === "NATIONAL" || auth.level === "STATE") &&
    visibleStateValue !== "ALL";

  const isZoomed = zoomBounds !== null;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 md:py-8">
      <div className="space-y-5">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-900">DQA Coverage</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-xs text-slate-500">
              Records: <strong className="font-semibold text-slate-700">{filteredSnapshots.length}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Regions: <strong className="font-semibold text-slate-700">{regionsWithData}</strong>
            </span>
            <span className="text-xs text-slate-500">
              Indicator: <strong className="font-semibold text-slate-700">{INDICATOR_OPTIONS.find((o) => o.value === indicator)?.label ?? "Number of DQA"}</strong>
            </span>
            {averageValue !== null ? (
              <span className="text-xs text-slate-500">
                Avg: <strong className="font-semibold text-slate-700">{formatMetric(averageValue, indicator)}</strong>
              </span>
            ) : null}
            <span className="text-xs text-slate-500">
              {scopeLabel} · {portalLabelMap[portal]} · {level === "DISTRICT" ? "District DQA" : "Block DQA"}
            </span>
          </div>
        </div>

        {/* Filters card */}
        <GlassPanel className="p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
            <Field label="Level of DQA">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as SnapshotDqaLevel)}
                className={selectClassName}
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Portal">
              <select
                value={portal}
                onChange={(e) => setPortal(e.target.value as PortalFilter)}
                className={selectClassName}
              >
                <option value="ALL">All portals</option>
                <option value="HMIS">HMIS</option>
                <option value="UWIN">U-WIN</option>
              </select>
            </Field>

            <Field label="State">
              <select
                value={visibleStateValue}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setSelectedDistrict("ALL");
                }}
                disabled={!canChangeState}
                className={selectClassName}
              >
                {canChangeState ? <option value="ALL">All states</option> : null}
                {stateOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="District">
              <select
                value={visibleDistrictValue}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                disabled={!canChangeDistrict}
                className={selectClassName}
              >
                <option value="ALL">All districts</option>
                {districtOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Duration from">
              <input
                type="month"
                value={fromMonth}
                onChange={(e) => setFromMonth(e.target.value)}
                className={selectClassName}
              />
            </Field>

            <Field label="Duration to">
              <input
                type="month"
                value={toMonth}
                onChange={(e) => setToMonth(e.target.value)}
                className={selectClassName}
              />
            </Field>

            <Field label="Indicator">
              <select
                value={indicator}
                onChange={(e) => setIndicator(e.target.value as CoverageIndicator)}
                className={selectClassName}
              >
                {INDICATOR_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-50/90 px-4 py-3">
            <div className="text-sm font-medium text-slate-600">
              Regions without saved records are shown in grey.
            </div>
            <button
              type="button"
              onClick={() => {
                setPortal("ALL");
                setLevel("DISTRICT");
                setIndicator("count");
                setFromMonth("");
                setToMonth("");
                setSelectedState(initialStateValue(auth));
                setSelectedDistrict(initialDistrictValue(auth));
                setZoomBounds(null);
              }}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-white"
            >
              <RefreshCcw className="h-4 w-4" />
              Reset
            </button>
          </div>
        </GlassPanel>

        {/* Map card */}
        <GlassPanel className="overflow-hidden p-0">
          {/* Map header */}
          <div className="border-b border-white/70 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Interactive map
                </div>
                <div className="mt-1 text-lg font-bold text-slate-950">
                  {level === "DISTRICT" ? "District coverage" : "Block coverage"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* Legend */}
                {indicator === "count" ? (
                  <div className="min-w-[180px]">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <span>DQA count</span>
                      <span>
                        {valueExtent[0]} – {Math.round(valueExtent[1])}
                      </span>
                    </div>
                    <div className="h-3.5 rounded-full bg-[linear-gradient(90deg,#dc2626_0%,#f97316_25%,#eab308_50%,#84cc16_75%,#16a34a_100%)]" />
                  </div>
                ) : (
                  <div className="min-w-[210px]">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Score (%)
                    </div>
                    <div className="flex h-3.5 overflow-hidden rounded-full">
                      {COLOR_SCALE.map((color, i) => (
                        <div
                          key={i}
                          className="flex-1"
                          style={{ backgroundColor: color }}
                          title={`${LEGEND_BANDS[i]}%`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-400">
                      {[0, 20, 40, 60, 80, 100].map((v) => (
                        <span key={v}>{v}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#cbd5e1]" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      No data
                    </span>
                  </div>
                </div>

                {/* Download buttons */}
                <div className="flex gap-1.5">
                  <button
                    onClick={downloadSVG}
                    title="Download as SVG"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    SVG
                  </button>
                  <button
                    onClick={downloadPNG}
                    title="Download as PNG"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PNG
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Map area */}
          <div className="relative p-4 md:p-6">
            {snapshotError ? (
              <div className="rounded-[24px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                {snapshotError}
              </div>
            ) : null}

            {loadingMap ? (
              <div className="flex min-h-[580px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white/65 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                Loading coverage map…
              </div>
            ) : visibleFeatures.length === 0 ? (
              <div className="flex min-h-[580px] items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white/65 text-sm font-semibold text-slate-500">
                No map regions match the current scope.
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-[28px] border border-white/70 bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.95),rgba(248,250,252,0.92)_48%,rgba(255,255,255,0.92)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                {/* Zoom controls */}
                <div className="absolute right-4 top-4 z-10 flex flex-col gap-1">
                  <button
                    onClick={zoomInStep}
                    title="Zoom in"
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <button
                    onClick={zoomOutStep}
                    title="Zoom out"
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  {isZoomed && (
                    <button
                      onClick={() => setZoomBounds(null)}
                      title="Reset zoom"
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-200 bg-amber-50/95 text-amber-700 shadow-sm transition hover:bg-amber-100"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Interaction hint */}
                <div className="absolute left-4 top-4 z-10 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-slate-400 shadow-sm backdrop-blur-sm">
                  {isZoomed
                    ? "Scroll to zoom · drag to pan · click region"
                    : "Scroll or +/− to zoom · drag to pan"}
                </div>

                <svg
                  ref={svgRef}
                  viewBox={viewBoxFromBounds(effectiveBounds)}
                  className={`h-[72vh] min-h-[520px] w-full select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                  preserveAspectRatio="xMidYMid meet"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleSVGMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  {/* Ocean/background fill */}
                  <rect
                    x={effectiveBounds[0] - 5}
                    y={effectiveBounds[1] - 5}
                    width={effectiveBounds[2] - effectiveBounds[0] + 10}
                    height={effectiveBounds[3] - effectiveBounds[1] + 10}
                    fill="#dce8f0"
                  />

                  {/* Fill layer — choropleth regions */}
                  <g>
                    {visibleFeatures.map((feature) => {
                      const metric = metricsByFeature.get(feature.id);
                      const fill = heatColor(metric?.value ?? null, valueExtent[1]);
                      const isActive = hovered?.featureId === feature.id;

                      return (
                        <path
                          key={feature.id}
                          d={feature.path}
                          fill={fill}
                          fillRule="evenodd"
                          stroke={isActive ? "#0f172a" : "rgba(255,255,255,0.82)"}
                          strokeWidth={isActive ? 2.5 : 1}
                          vectorEffect="non-scaling-stroke"
                          style={{ transition: "fill 180ms ease" }}
                          onMouseMove={(e) => {
                            if (dragRef.current?.moved) return;
                            setHovered({
                              x: e.clientX,
                              y: e.clientY,
                              featureId: feature.id,
                              label: featurePrimaryLabel(feature, level),
                              sublabel: featureSecondaryLabel(feature, level),
                              valueLabel:
                                metric?.value !== null && metric?.value !== undefined
                                  ? formatMetric(metric.value, indicator)
                                  : "No data",
                              snapshots: metric?.snapshots ?? 0,
                            });
                          }}
                          onMouseLeave={() => {
                            if (!dragRef.current?.moved) setHovered(null);
                          }}
                          onClick={() => {
                            if (wasDragRef.current) return;
                            setSelectedState(feature.properties.state_name);
                            if ("district_name" in feature.properties) {
                              setSelectedDistrict(
                                (feature.properties as DistrictShapeProps).district_name,
                              );
                            }
                          }}
                        />
                      );
                    })}
                  </g>

                  {/* Outline layer — state/district borders over fills */}
                  <g pointerEvents="none">
                    {outlineFeatures.map((feature) => (
                      <path
                        key={`outline-${feature.id}`}
                        d={feature.path}
                        fill="none"
                        stroke={
                          level === "BLOCK" ? "rgba(15,23,42,0.32)" : "rgba(15,23,42,0.42)"
                        }
                        strokeWidth={level === "BLOCK" ? 1.5 : 2}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </g>

                  {/* Label layer */}
                  {showLabels &&
                    visibleFeatures.map((feature) => {
                      const cx = (feature.bounds[0] + feature.bounds[2]) / 2;
                      const cy = (feature.bounds[1] + feature.bounds[3]) / 2;
                      const featureW = feature.bounds[2] - feature.bounds[0];
                      const viewW = effectiveBounds[2] - effectiveBounds[0];
                      if (featureW < viewW * 0.035) return null;

                      const raw = featurePrimaryLabel(feature, level);
                      const label = raw.length > 14 ? raw.slice(0, 12) + "…" : raw;

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
            )}

            {/* Floating tooltip */}
            {hovered ? (
              <div
                className="pointer-events-none fixed z-50 min-w-[180px] rounded-2xl border border-white/80 bg-slate-950/95 px-4 py-3 shadow-[0_22px_50px_rgba(15,23,42,0.32)] backdrop-blur-sm"
                style={{
                  left: Math.min(hovered.x + 18, globalThis.window?.innerWidth - 220 || hovered.x + 18),
                  top: Math.min(hovered.y + 18, globalThis.window?.innerHeight - 130 || hovered.y + 18),
                }}
              >
                <div className="text-sm font-bold text-white leading-snug">{hovered.label}</div>
                <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/55">
                  {hovered.sublabel}
                </div>
                <div className="mt-2.5 border-t border-white/10 pt-2">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[11px] text-white/55">
                      {INDICATOR_OPTIONS.find((o) => o.value === indicator)?.label}
                    </span>
                    <span className="text-sm font-bold text-white">{hovered.valueLabel}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-4">
                    <span className="text-[11px] text-white/55">Snapshots</span>
                    <span className="text-[11px] font-semibold text-white/80">
                      {hovered.snapshots}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Ranked regions table */}
          {(topRegions.length > 0 || bottomRegions.length > 0) && (
            <div className="border-t border-white/70 px-5 py-5">
              <div className="grid gap-6 md:grid-cols-2">
                {topRegions.length > 0 && (
                  <div>
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {indicator === "count" ? "Most DQAs conducted" : "Highest scoring"}
                    </div>
                    <div className="space-y-1.5">
                      {topRegions.map(({ feature, metric }, i) => (
                        <RegionRow
                          key={feature.id}
                          rank={i + 1}
                          label={featurePrimaryLabel(feature, level)}
                          sublabel={featureSecondaryLabel(feature, level)}
                          value={formatMetric(metric.value!, indicator)}
                          color={heatColor(metric.value, valueExtent[1])}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {bottomRegions.length > 0 && (
                  <div>
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Needs attention
                    </div>
                    <div className="space-y-1.5">
                      {bottomRegions.map(({ feature, metric }, i) => (
                        <RegionRow
                          key={feature.id}
                          rank={i + 1}
                          label={featurePrimaryLabel(feature, level)}
                          sublabel={featureSecondaryLabel(feature, level)}
                          value={formatMetric(metric.value!, indicator)}
                          color={heatColor(metric.value, valueExtent[1])}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SummaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Layers3;
}) {
  return (
    <div className="rounded-[24px] border border-white/70 bg-white/72 p-4 shadow-[0_18px_38px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-3 text-lg font-bold text-slate-950">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function RegionRow({
  rank,
  label,
  sublabel,
  value,
  color,
}: {
  rank: number;
  label: string;
  sublabel: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5">
      <div className="min-w-[20px] text-[11px] font-bold text-slate-400">#{rank}</div>
      <div className="h-3 w-3 flex-none rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-slate-900">{label}</div>
        <div className="truncate text-[10px] text-slate-400">{sublabel}</div>
      </div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

const selectClassName =
  "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

// --- Pure utilities ---

function initialStateValue(auth: AuthState) {
  if (auth.role === "admin" || auth.level === "NATIONAL") return "ALL";
  return auth.geoState ?? "ALL";
}

function initialDistrictValue(auth: AuthState) {
  if (auth.level === "DISTRICT" || auth.level === "BLOCK") return auth.geoDistrict ?? "ALL";
  return "ALL";
}

function featurePrimaryLabel(
  feature: MapFeature<DistrictShapeProps | BlockShapeProps>,
  level: SnapshotDqaLevel,
) {
  if (level === "BLOCK" && "block_name" in feature.properties)
    return feature.properties.block_name;
  return (feature.properties as DistrictShapeProps).district_name;
}

function featureSecondaryLabel(
  feature: MapFeature<StateShapeProps | DistrictShapeProps | BlockShapeProps>,
  level: SnapshotDqaLevel,
) {
  if (level === "BLOCK" && "block_name" in feature.properties) {
    const p = feature.properties as BlockShapeProps;
    return `${p.district_name}, ${p.state_name}`;
  }
  return feature.properties.state_name;
}

function viewBoxFromBounds([minX, minY, maxX, maxY]: Bounds) {
  return `${minX} ${minY} ${Math.max(maxX - minX, 1)} ${Math.max(maxY - minY, 1)}`;
}

function buildFeatureLookup(
  level: SnapshotDqaLevel,
  features: Array<MapFeature<DistrictShapeProps> | MapFeature<BlockShapeProps>>,
) {
  const exact = new Map<string, MapFeature<DistrictShapeProps> | MapFeature<BlockShapeProps>>();
  const byState = new Map<
    string,
    Array<MapFeature<DistrictShapeProps> | MapFeature<BlockShapeProps>>
  >();
  const byDistrict = new Map<
    string,
    Array<MapFeature<DistrictShapeProps> | MapFeature<BlockShapeProps>>
  >();

  for (const feature of features) {
    const stateKey = normalizeGeoName(feature.properties.state_name);
    const districtKey = normalizeGeoName(feature.properties.district_name);
    const sd = `${stateKey}|${districtKey}`;

    if (level === "BLOCK" && "block_name" in feature.properties) {
      exact.set(`${sd}|${normalizeGeoName(feature.properties.block_name)}`, feature);
    } else {
      exact.set(sd, feature);
    }

    byState.set(stateKey, [...(byState.get(stateKey) ?? []), feature]);
    byDistrict.set(sd, [...(byDistrict.get(sd) ?? []), feature]);
  }

  return { exact, byState, byDistrict, features };
}

function matchFeature(
  lookup: ReturnType<typeof buildFeatureLookup>,
  snapshot: SnapshotRecord,
  level: SnapshotDqaLevel,
) {
  const stateKey = normalizeGeoName(snapshot.state);
  const districtKey = normalizeGeoName(snapshot.district);
  const sd = `${stateKey}|${districtKey}`;

  if (level === "BLOCK") {
    const blockName = getSnapshotBlock(snapshot);
    if (!blockName) return null;
    const exact = lookup.exact.get(`${sd}|${normalizeGeoName(blockName)}`);
    if (exact) return exact as MapFeature<BlockShapeProps>;
    const districtMatches = lookup.byDistrict.get(sd) ?? [];
    const fuzzy =
      fuzzyMatch(blockName, districtMatches, (f) =>
        "block_name" in f.properties ? f.properties.block_name : "",
      ) ??
      fuzzyMatch(blockName, lookup.features, (f) =>
        "block_name" in f.properties ? f.properties.block_name : "",
      );
    return (fuzzy as MapFeature<BlockShapeProps> | null) ?? null;
  }

  const exact = lookup.exact.get(sd);
  if (exact) return exact as MapFeature<DistrictShapeProps>;
  const stateMatches = lookup.byState.get(stateKey) ?? [];
  const fuzzy =
    fuzzyMatch(snapshot.district, stateMatches, (f) => f.properties.district_name) ??
    fuzzyMatch(snapshot.district, lookup.features, (f) => f.properties.district_name);
  return (fuzzy as MapFeature<DistrictShapeProps> | null) ?? null;
}

function getIndicatorValue(snapshot: SnapshotRecord, indicator: CoverageIndicator) {
  switch (indicator) {
    case "count":
      return 1;
    case "overall":
      return snapshot.overallScore ?? null;
    case "availability":
      return snapshot.kpiData?.availabilityScore ?? null;
    case "completeness":
      return normalizePortal(snapshot.portal) === "HMIS"
        ? (snapshot.kpiData?.completenessScore ?? null)
        : null;
    case "accuracy":
      return snapshot.kpiData?.accuracyScore ?? null;
    case "consistency":
      return snapshot.kpiData?.consistencyScore ?? null;
    default:
      return null;
  }
}

function heatColor(value: number | null, max: number) {
  if (value === null || !Number.isFinite(value)) return "#cbd5e1";
  const ratio = Math.min(1, Math.max(0, value / Math.max(max, 1)));
  const step = Math.min(4, Math.floor(ratio * 5));
  return COLOR_SCALE[step];
}

function formatMetric(value: number, indicator: CoverageIndicator) {
  return indicator === "count" ? String(Math.round(value)) : `${value.toFixed(1)}%`;
}

function normalizeGeoName(value?: string | null) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveOptionValue(target: string | null | undefined, options: string[]) {
  if (!target) return null;
  const norm = normalizeGeoName(target);
  return (
    options.find((o) => normalizeGeoName(o) === norm) ??
    fuzzyMatch(target, options, (o) => o) ??
    null
  );
}

function fuzzyMatch<T>(target: string, options: T[], getName: (o: T) => string) {
  const norm = normalizeGeoName(target);
  if (!norm) return null;
  let best: T | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const d = levenshtein(norm, normalizeGeoName(getName(option)));
    if (d < bestDist) {
      bestDist = d;
      best = option;
    }
  }
  if (!best) return null;
  return bestDist <= Math.max(1, Math.floor(norm.length * 0.25)) ? best : null;
}

function levenshtein(a: string, b: string) {
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

function uniqueValue<T>(v: T, i: number, arr: T[]) {
  return arr.indexOf(v) === i;
}

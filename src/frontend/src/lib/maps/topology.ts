export type Bounds = [number, number, number, number];
export type Point = [number, number];

interface TopologyTransform {
  scale: [number, number];
  translate: [number, number];
}

interface TopologyGeometry<P extends object = Record<string, unknown>> {
  type: "Polygon" | "MultiPolygon";
  arcs: number[][] | number[][][];
  properties: P;
  id?: string | number;
}

interface TopologyObject<P extends object = Record<string, unknown>> {
  geometries: TopologyGeometry<P>[];
}

export interface Topology<P extends object = Record<string, unknown>> {
  type: "Topology";
  arcs: number[][][];
  bbox?: [number, number, number, number];
  transform?: TopologyTransform;
  objects: Record<string, TopologyObject<P>>;
}

export interface MapFeature<P extends object = Record<string, unknown>> {
  id: string;
  properties: P;
  polygons: Point[][][];
  path: string;
  bounds: Bounds;
}

export function topologyToFeatures<P extends object>(
  topology: Topology<P>,
  objectName: string,
): MapFeature<P>[] {
  const object = topology.objects[objectName];
  if (!object) return [];

  const arcCache = new Map<number, Point[]>();

  return object.geometries
    .filter(
      (geometry): geometry is TopologyGeometry<P> =>
        geometry.type === "Polygon" || geometry.type === "MultiPolygon",
    )
    .map((geometry, index) => {
      const polygons =
        geometry.type === "Polygon"
          ? [expandPolygon(topology, geometry.arcs as number[][], arcCache)]
          : (geometry.arcs as number[][][]).map((polygon) =>
              expandPolygon(topology, polygon, arcCache),
            );

      return {
        id: String(geometry.id ?? index),
        properties: geometry.properties,
        polygons,
        path: polygonsToPath(polygons),
        bounds: polygonsBounds(polygons),
      };
    });
}

export function combineBounds(features: Array<Pick<MapFeature, "bounds">>, fallback?: Bounds): Bounds {
  if (features.length === 0) {
    return fallback ?? [0, 0, 1, 1];
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const feature of features) {
    const [x0, y0, x1, y1] = feature.bounds;
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }

  return [minX, minY, maxX, maxY];
}

export function padBounds(bounds: Bounds, paddingRatio = 0.03): Bounds {
  const [minX, minY, maxX, maxY] = bounds;
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const padX = width * paddingRatio;
  const padY = height * paddingRatio;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

export function topologyBounds<P extends object>(topology: Topology<P>): Bounds | undefined {
  if (!topology.bbox) return undefined;
  const [minX, minY, maxX, maxY] = topology.bbox;
  return [minX, -maxY, maxX, -minY];
}

function expandPolygon<P extends object>(
  topology: Topology<P>,
  polygonArcs: number[][],
  arcCache: Map<number, Point[]>,
) {
  return polygonArcs.map((ring) => expandRing(topology, ring, arcCache));
}

function expandRing<P extends object>(
  topology: Topology<P>,
  ringArcIndexes: number[],
  arcCache: Map<number, Point[]>,
) {
  const ring: Point[] = [];

  for (const arcIndex of ringArcIndexes) {
    const points = resolveArc(topology, arcIndex, arcCache);
    if (points.length === 0) continue;

    if (ring.length === 0) {
      ring.push(...points);
      continue;
    }

    ring.push(...points.slice(1));
  }

  return ring;
}

function resolveArc<P extends object>(
  topology: Topology<P>,
  arcIndex: number,
  arcCache: Map<number, Point[]>,
) {
  const isReversed = arcIndex < 0;
  const cacheKey = isReversed ? ~arcIndex : arcIndex;
  const cached = arcCache.get(cacheKey);
  const decoded = cached ?? decodeArc(topology, cacheKey);

  if (!cached) {
    arcCache.set(cacheKey, decoded);
  }

  return isReversed ? [...decoded].reverse() : decoded;
}

function decodeArc<P extends object>(
  topology: Topology<P>,
  arcIndex: number,
) {
  const rawArc = topology.arcs[arcIndex] ?? [];
  const transform = topology.transform;
  const points: Point[] = [];

  let x = 0;
  let y = 0;

  for (const point of rawArc) {
    if (!Array.isArray(point) || point.length < 2) continue;
    x += point[0];
    y += point[1];

    if (transform) {
      points.push([
        x * transform.scale[0] + transform.translate[0],
        -(y * transform.scale[1] + transform.translate[1]),
      ]);
      continue;
    }

    points.push([x, -y]);
  }

  return points;
}

function polygonsToPath(polygons: Point[][][]) {
  return polygons
    .flat()
    .map((ring) => {
      if (ring.length === 0) return "";
      return ring
        .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
        .join(" ")
        .concat(" Z");
    })
    .join(" ");
}

function polygonsBounds(polygons: Point[][][]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return [0, 0, 1, 1];
  }

  return [minX, minY, maxX, maxY];
}

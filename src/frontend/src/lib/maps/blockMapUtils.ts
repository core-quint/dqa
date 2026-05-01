// Shared block-map utilities used by both KpiBlockMap component and PDF report generator
import {
  topologyToFeatures,
  combineBounds,
  padBounds,
  topologyBounds,
} from './topology';
import type { Topology, MapFeature } from './topology';

export interface BlockShapeProps {
  block_name: string;
  block_shape_id: string;
  state_name: string;
  state_lgd: string;
  district_name: string;
  district_lgd: string;
}

// Module-level cache — 5.7 MB JSON, only fetched once per app session
let _blocksPromise: Promise<Topology<BlockShapeProps>> | null = null;

export function loadBlocksTopology(): Promise<Topology<BlockShapeProps>> {
  if (!_blocksPromise) {
    _blocksPromise = fetch(new URL('../../../assets/blocks.json', import.meta.url).href)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load block boundaries');
        return r.json() as Promise<Topology<BlockShapeProps>>;
      })
      .catch((err) => {
        _blocksPromise = null;
        throw err;
      });
  }
  return _blocksPromise;
}

export function normalizeBlock(name: string): string {
  return (name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function levenshteinDist(a: string, b: string): number {
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

export function matchBlock(
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
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return bestDist <= Math.max(1, Math.floor(norm.length * 0.28)) ? best : null;
}

export const FLAG_THRESHOLDS = [0, 0.2, 0.4, 0.6, 0.8, 1];
export const FLAG_LABELS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
export const FLAG_COLORS = ['#fef9c3', '#fde68a', '#f97316', '#ef4444', '#b91c1c'];

export function flagColor(
  featureId: string,
  featureToCount: Map<string, number>,
  featureInData: Map<string, boolean>,
  maxCount: number,
): string {
  const inData = featureInData.get(featureId) ?? false;
  if (!inData) return '#e2e8f0';
  const count = featureToCount.get(featureId) ?? 0;
  if (count === 0) return '#bbf7d0';
  const ratio = count / Math.max(maxCount, 1);
  if (ratio < 0.2) return '#fef9c3';
  if (ratio < 0.4) return '#fde68a';
  if (ratio < 0.6) return '#f97316';
  if (ratio < 0.8) return '#ef4444';
  return '#b91c1c';
}

export function buildLegendItems(maxCount: number) {
  const base = [{ color: '#bbf7d0', label: 'No flagged facilities' }];
  const tail = [{ color: '#e2e8f0', label: 'Not in this analysis' }];
  if (maxCount <= 0) return [...base, ...tail];
  const bands = FLAG_LABELS.map((label, i) => {
    const lo = i === 0 ? 1 : Math.ceil(FLAG_THRESHOLDS[i] * maxCount);
    const hi =
      i === FLAG_LABELS.length - 1
        ? maxCount
        : Math.ceil(FLAG_THRESHOLDS[i + 1] * maxCount) - 1;
    return { color: FLAG_COLORS[i], label, lo, hi };
  }).filter(({ lo, hi }) => lo <= hi);
  return [
    ...base,
    ...bands.map(({ color, label, lo, hi }) => ({
      color,
      label:
        lo === hi
          ? `${label} — ${lo} ${lo === 1 ? 'facility' : 'facilities'}`
          : `${label} — ${lo}–${hi} facilities`,
    })),
    ...tail,
  ];
}

export async function generateBlockMapDataUrl(
  stateName: string,
  districtName: string,
  blockCounts: Record<string, number>,
  allDataBlocks: string[],
  imgWidth = 1024,
  imgHeight = 512,
): Promise<string | null> {
  try {
    const topology = await loadBlocksTopology();
    const allFeatures = topologyToFeatures(topology, 'blocks');
    const normState = normalizeBlock(stateName);
    const normDist = normalizeBlock(districtName);
    const districtFeatures = allFeatures.filter(
      (f) =>
        normalizeBlock(f.properties.state_name) === normState &&
        normalizeBlock(f.properties.district_name) === normDist,
    );
    if (districtFeatures.length === 0) return null;

    const featureToCount = new Map<string, number>();
    const featureInData = new Map<string, boolean>();
    const matchedIds = new Set<string>();

    for (const [blockLabel, count] of Object.entries(blockCounts)) {
      const feature = matchBlock(blockLabel, districtFeatures);
      if (feature) {
        featureToCount.set(feature.id, (featureToCount.get(feature.id) ?? 0) + count);
        featureInData.set(feature.id, true);
        matchedIds.add(feature.id);
      }
    }
    for (const feature of districtFeatures) {
      if (matchedIds.has(feature.id)) continue;
      const normName = normalizeBlock(feature.properties.block_name);
      const inData = allDataBlocks.some(
        (b) =>
          levenshteinDist(normalizeBlock(b), normName) <=
          Math.max(1, Math.floor(normName.length * 0.28)),
      );
      featureInData.set(feature.id, inData);
    }

    const maxCount =
      Object.values(blockCounts).length > 0 ? Math.max(...Object.values(blockCounts)) : 0;
    const fb = topologyBounds(topology);
    const bounds = padBounds(combineBounds(districtFeatures, fb), 0.05);
    const [bMinX, bMinY, bMaxX, bMaxY] = bounds;
    const viewW = Math.max(bMaxX - bMinX, 1);
    const viewH = Math.max(bMaxY - bMinY, 1);
    const vb = `${bMinX} ${bMinY} ${viewW} ${viewH}`;
    const sw = viewW / 300; // stroke-width scales with view

    const paths = districtFeatures
      .map(
        (f) =>
          `<path d="${f.path.replace(/"/g, "'")}" fill="${flagColor(f.id, featureToCount, featureInData, maxCount)}" fill-rule="evenodd" stroke="rgba(255,255,255,0.85)" stroke-width="${sw}"/>`,
      )
      .join('');

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${imgWidth}" height="${imgHeight}" preserveAspectRatio="xMidYMid meet"><rect x="${bMinX}" y="${bMinY}" width="${viewW}" height="${viewH}" fill="#dce8f0"/>${paths}</svg>`;

    return await new Promise<string | null>((resolve) => {
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = imgWidth;
          canvas.height = imgHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#dce8f0';
          ctx.fillRect(0, 0, imgWidth, imgHeight);
          ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
}

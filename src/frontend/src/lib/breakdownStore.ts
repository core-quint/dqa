// Loads saved-review score grids (lib/snapshotBreakdown.ts) on demand. A grid never
// changes once saved, so each is fetched at most once per session; reviews saved
// without one (kpiData.hasBreakdown unset) never trigger a request.
import { apiFetch } from "../api";
import type { SnapshotRecord } from "./snapshots";
import type { SnapshotBreakdown } from "./snapshotBreakdown";

const cache = new Map<string, SnapshotBreakdown | null>();
const BULK_LIMIT = 200;

/** The saved grid of one review, or null when it was saved without one. */
export async function loadBreakdown(snapshot: SnapshotRecord): Promise<SnapshotBreakdown | null> {
  if (!snapshot.kpiData?.hasBreakdown) return null;
  if (!cache.has(snapshot.id)) {
    const result: { breakdown: SnapshotBreakdown | null } = await apiFetch(`/api/snapshots/${snapshot.id}/breakdown`);
    cache.set(snapshot.id, result.breakdown);
  }
  return cache.get(snapshot.id) ?? null;
}

/** Saved grids of many reviews, keyed by snapshot id; reviews without one are absent. */
export async function loadBreakdowns(snapshots: SnapshotRecord[]): Promise<Map<string, SnapshotBreakdown>> {
  const wanted = [...new Set(snapshots.filter((s) => s.kpiData?.hasBreakdown).map((s) => s.id))];
  const missing = wanted.filter((id) => !cache.has(id));
  for (let start = 0; start < missing.length; start += BULK_LIMIT) {
    const chunk = missing.slice(start, start + BULK_LIMIT);
    const result: { breakdowns: Record<string, SnapshotBreakdown> } = await apiFetch(
      `/api/snapshots/breakdowns?ids=${chunk.map(encodeURIComponent).join(",")}`,
    );
    for (const id of chunk) cache.set(id, result.breakdowns[id] ?? null);
  }
  const grids = new Map<string, SnapshotBreakdown>();
  for (const id of wanted) {
    const grid = cache.get(id);
    if (grid) grids.set(id, grid);
  }
  return grids;
}

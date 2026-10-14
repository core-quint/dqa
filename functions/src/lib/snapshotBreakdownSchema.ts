import { z } from "zod";

const isoDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

// Saved-review score grid (frontend lib/snapshotBreakdown.ts). Stored apart from the
// snapshot in snapshotBreakdowns/{snapshotId}: the snapshot list is fetched whole
// by Trends and the Dashboard, the grid only when one review is opened.
const gridScore = z.number().min(0).max(100).nullable();
const gridCell = z.object({
  overall: gridScore,
  availability: gridScore,
  completeness: gridScore,
  accuracy: gridScore,
  consistency: gridScore,
  units: z.number().int().min(0).nullable(),
});
export const breakdownSchema = z.object({
  version: z.number().int().min(1).max(100),
  methodVersion: z.number().int().min(1).max(100),
  areaLevel: z.enum(["STATE", "DISTRICT"]),
  areaName: z.string().max(200),
  rowLevel: z.enum(["BLOCK", "DISTRICT"]),
  unitLabel: z.string().max(40),
  periodKind: z.enum(["MONTH", "WEEK"]),
  cumulative: gridCell.nullable(),
  periods: z.array(z.object({
    key: z.string().min(1).max(40),
    label: z.string().max(80),
    from: isoDay.nullable(),
    to: isoDay.nullable(),
    cell: gridCell,
  })).max(60),
  rows: z.array(z.object({
    name: z.string().max(200),
    cell: gridCell,
    // Per-period cells of this row; absent on grids saved before 2026-10-14.
    periods: z.array(z.object({ key: z.string().min(1).max(40), cell: gridCell })).max(60).optional(),
  })).max(2000),
});

export type SnapshotBreakdownInput = z.infer<typeof breakdownSchema>;

// Firestore caps a document at 1 MiB. A grid over this budget first drops its
// per-period row cells (the least used part), then is not stored at all.
const GRID_BYTE_BUDGET = 900_000;

/** The grid as it can be stored, or null when even its compact form is too large. */
export function fitBreakdownToDocument(grid: SnapshotBreakdownInput): SnapshotBreakdownInput | null {
  if (JSON.stringify(grid).length <= GRID_BYTE_BUDGET) return grid;
  const compact = { ...grid, rows: grid.rows.map(({ periods: _periods, ...row }) => row) };
  return JSON.stringify(compact).length <= GRID_BYTE_BUDGET ? compact : null;
}

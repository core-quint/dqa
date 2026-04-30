import type { FilterState } from "./dqa/types";
import type { AuthState } from "../components/dqa/LoginPage";

export type SnapshotPortal = "HMIS" | "UWIN";
export type SnapshotDqaLevel = "DISTRICT" | "BLOCK";

export interface SnapshotKpiData {
  availabilityScore?: number;
  completenessScore?: number;
  accuracyScore?: number;
  consistencyScore?: number;
  dqaLevel?: SnapshotDqaLevel;
  block?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface SnapshotRecord {
  id: string;
  state: string;
  district: string;
  reportingMonth: string;
  overallScore: number;
  createdAt: string;
  portal?: string;
  canDelete?: boolean;
  createdBy?: {
    id: string;
    email: string;
    level: string;
    geoState: string | null;
    geoDistrict: string | null;
    geoBlock: string | null;
  } | null;
  kpiData: SnapshotKpiData;
}

export interface SnapshotSaveMeta {
  dqaLevel: SnapshotDqaLevel;
  block?: string;
  periodStart?: string;
  periodEnd?: string;
}

export function normalizePortal(portal?: string | null): SnapshotPortal {
  return portal?.toUpperCase() === "UWIN" ? "UWIN" : "HMIS";
}

export function getSnapshotDqaLevel(snapshot: Pick<SnapshotRecord, "kpiData">): SnapshotDqaLevel {
  return snapshot.kpiData?.dqaLevel === "BLOCK" && snapshot.kpiData?.block
    ? "BLOCK"
    : "DISTRICT";
}

export function getSnapshotBlock(snapshot: Pick<SnapshotRecord, "kpiData">): string | null {
  return snapshot.kpiData?.block?.trim() || null;
}

export function getSnapshotPeriod(snapshot: Pick<SnapshotRecord, "createdAt" | "kpiData">) {
  const fallbackMonth = snapshot.createdAt.slice(0, 7);
  return {
    start: snapshot.kpiData?.periodStart || fallbackMonth,
    end: snapshot.kpiData?.periodEnd || fallbackMonth,
  };
}

export function buildSnapshotSaveMeta(
  auth: Pick<AuthState, "level" | "geoBlock">,
  filters: Pick<FilterState, "blocks">,
  allMonths: Record<string, string>,
): SnapshotSaveMeta {
  const periodMonths = Object.keys(allMonths).sort();
  const periodStart = periodMonths[0];
  const periodEnd = periodMonths[periodMonths.length - 1];
  const selectedBlocks = uniqueNonEmpty(filters.blocks);
  const scopedBlock = auth.geoBlock?.trim();

  if (auth.level === "BLOCK" && scopedBlock) {
    return {
      dqaLevel: "BLOCK",
      block: scopedBlock,
      periodStart,
      periodEnd,
    };
  }

  if (selectedBlocks.length === 1) {
    return {
      dqaLevel: "BLOCK",
      block: selectedBlocks[0],
      periodStart,
      periodEnd,
    };
  }

  return {
    dqaLevel: "DISTRICT",
    periodStart,
    periodEnd,
  };
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

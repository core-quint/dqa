import type { ActiveGroup, ParsedCSV } from "../../lib/dqa/types";
import type { UwinParsedCSV } from "../../lib/uwin/types";
import type { AppState, TrendSource } from "../../context/AppContext";

export type PortalKind = "HMIS" | "U-WIN";

export interface ShellGroupItem {
  id: Exclude<ActiveGroup, "">;
  label: string;
  color: string;
}

export const HMIS_GROUPS: ShellGroupItem[] = [
  { id: "availability", label: "Availability", color: "#ef4444" },
  { id: "completeness", label: "Completeness", color: "#6366f1" },
  { id: "accuracy", label: "Accuracy", color: "#f59e0b" },
  { id: "consistency", label: "Consistency", color: "#22c55e" },
];

export const UWIN_GROUPS: ShellGroupItem[] = [
  { id: "availability", label: "Availability", color: "#2563eb" },
  { id: "accuracy", label: "Accuracy", color: "#f59e0b" },
  { id: "consistency", label: "Consistency", color: "#22c55e" },
];

export function getPortalForView(
  appState: AppState,
  trendSource: TrendSource,
  csvData: ParsedCSV | null,
  uwinData: UwinParsedCSV | null,
): PortalKind | null {
  if (appState === "coverage") return null;
  if (appState === "landing" || appState === "results") return "HMIS";
  if (appState === "uwin-landing" || appState === "uwin-results") return "U-WIN";
  if (appState === "trend") {
    if (trendSource === "UWIN") return "U-WIN";
    if (trendSource === "HMIS") return "HMIS";
    return null;
  }
  if (csvData && !uwinData) return "HMIS";
  if (uwinData && !csvData) return "U-WIN";
  return null;
}

export function getPortalGroups(portal: PortalKind | null): ShellGroupItem[] {
  return portal === "U-WIN" ? UWIN_GROUPS : HMIS_GROUPS;
}

export function getPortalData(
  portal: PortalKind | null,
  csvData: ParsedCSV | null,
  uwinData: UwinParsedCSV | null,
): ParsedCSV | UwinParsedCSV | null {
  if (portal === "U-WIN") return uwinData;
  if (portal === "HMIS") return csvData;
  return csvData ?? uwinData;
}

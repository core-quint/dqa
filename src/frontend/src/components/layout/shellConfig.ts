import type { ActiveGroup, ParsedCSV } from "../../lib/dqa/types";
import type { UwinParsedCSV } from "../../lib/uwin/types";
import type { PctsParsed } from "../../lib/pcts/types";
import type { AppState, TrendSource } from "../../context/AppContext";

export type PortalKind = "HMIS" | "U-WIN" | "U-WIN STATE" | "PCTS";

export interface ShellGroupItem {
  id: Exclude<ActiveGroup, "">;
  label: string;
  color: string;
}

export interface PortalContextData {
  stateName: string;
  distName: string;
  fileName: string;
}

export const HMIS_GROUPS: ShellGroupItem[] = [
  { id: "availability", label: "Availability", color: "#2a78d6" },
  { id: "completeness", label: "Completeness", color: "#4a3aa7" },
  { id: "accuracy", label: "Accuracy", color: "#eb6834" },
  { id: "consistency", label: "Consistency", color: "#199e70" },
];

export const UWIN_GROUPS: ShellGroupItem[] = [
  { id: "availability", label: "Availability", color: "#2a78d6" },
  { id: "accuracy", label: "Accuracy", color: "#eb6834" },
  { id: "consistency", label: "Consistency", color: "#199e70" },
];

export const PCTS_GROUPS: ShellGroupItem[] = HMIS_GROUPS;

export function getPortalForView(
  appState: AppState,
  trendSource: TrendSource,
  csvData: ParsedCSV | null,
  uwinData: UwinParsedCSV | null,
  pctsData: PctsParsed | null,
): PortalKind | null {
  if (appState === "coverage") return null;
  if (appState === "landing" || appState === "results") return "HMIS";
  if (appState === "uwin-landing" || appState === "uwin-results") return "U-WIN";
  if (appState === "state-uwin-landing" || appState === "state-uwin-results") return "U-WIN STATE";
  if (appState === "pcts-landing" || appState === "pcts-results") return "PCTS";
  if (appState === "trend") {
    if (trendSource === "UWIN") return "U-WIN";
    if (trendSource === "UWIN_STATE") return "U-WIN STATE";
    if (trendSource === "HMIS") return "HMIS";
    if (trendSource === "PCTS") return "PCTS";
    return null;
  }
  if (csvData && !uwinData && !pctsData) return "HMIS";
  if (uwinData && !csvData && !pctsData) return "U-WIN";
  if (pctsData && !csvData && !uwinData) return "PCTS";
  return null;
}

export function getPortalGroups(portal: PortalKind | null): ShellGroupItem[] {
  if (portal === "PCTS") return PCTS_GROUPS;
  return portal === "U-WIN" || portal === "U-WIN STATE" ? UWIN_GROUPS : HMIS_GROUPS;
}

export function getPortalData(
  portal: PortalKind | null,
  csvData: ParsedCSV | null,
  uwinData: UwinParsedCSV | null,
  pctsData: PctsParsed | null,
): PortalContextData | null {
  if (portal === "U-WIN" || portal === "U-WIN STATE") return uwinData;
  if (portal === "HMIS") return csvData;
  if (portal === "PCTS" && pctsData) {
    return {
      stateName: pctsData.stateName,
      distName: pctsData.districtName,
      fileName: pctsData.fileNames.join(", "),
    };
  }
  return csvData ?? uwinData;
}

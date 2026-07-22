import { apiFetch } from "../../api";
import { API_BASE } from "../../config";
import { auth } from "../firebase";
import type { FilterState } from "../dqa/types";
import { computeOverallScore } from "../dqa/scoreUtils";
import type { PreUploadInfo } from "../dqa/preUploadOptions";
import type { UwinComputedKpis, UwinParsedCSV } from "./types";
import { buildUwinStateFactPack, UWIN_STATE_REPORT_RULES_VERSION, type UwinStateReportFactPack } from "./stateReportFacts";

export type UwinStateReportStatus = "DRAFT" | "REVIEWED" | "APPROVED" | "SUPERSEDED";

export interface UwinStateReportRecord {
  id: string;
  portal: "UWIN_STATE";
  state: string;
  periodStart: string;
  periodEnd: string;
  analysisFingerprint: string;
  version: number;
  reportNumber: string;
  status: UwinStateReportStatus;
  analysisMode: "facility" | "sessionsite";
  narrativeMode: "DETERMINISTIC" | "AI_ASSISTED";
  rulesVersion: string;
  templateVersion: string;
  scores: {
    overall: number;
    availability: number;
    accuracy: number;
    consistency: number;
  };
  counts: {
    districts: number;
    blocks: number;
    facilities: number;
    sessionSites: number;
    analysedUnits: number;
  };
  createdBy: { id: string; email: string; level: string | null };
  createdAt: string | null;
  factPack?: UwinStateReportFactPack;
  hasFactPack?: boolean;
  pdfAvailable?: boolean;
  pdfFileName?: string | null;
  aiNarrative?: {
    executiveSummary: Array<{ statement: string; evidenceIds: string[] }>;
    keyFindings: Array<{ statement: string; evidenceIds: string[] }>;
    positiveSummary: { statement: string; evidenceIds: string[] } | null;
    highlightedActionRuleIds: string[];
    model: string;
    promptVersion: string;
    validated: boolean;
    usage: { promptTokens: number; outputTokens: number; totalTokens: number };
    estimatedUsd: number;
    disclosure: string;
  };
  reused?: boolean;
}

export type ReportActionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "VERIFIED" | "OVERDUE";
export interface UwinStateReportAction {
  id: string;
  reportId: string;
  evidenceId: string;
  findingTitle: string;
  affectedUnits: number;
  actionRuleId: string;
  action: string;
  responsibleLevel: string;
  responsibleOfficer: string | null;
  dueDate: string;
  status: ReportActionStatus;
  progressNote: string | null;
  verification: string;
  updatedAt: string | null;
}

function compactHash(value: string): string {
  let a = 2166136261;
  let b = 2246822519;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489917);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

export function getUwinStateReportPeriod(csv: UwinParsedCSV) {
  const months = Object.keys(csv.allMonths).sort();
  return { periodStart: months[0], periodEnd: months[months.length - 1] };
}

export function buildUwinStateReportRequest(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  filters: FilterState,
  reviewInfo: PreUploadInfo | null,
  narrativeMode: "DETERMINISTIC" | "AI_ASSISTED" = "DETERMINISTIC",
) {
  const score = computeOverallScore(kpis as never, ["availability", "accuracy", "consistency"]);
  const { periodStart, periodEnd } = getUwinStateReportPeriod(csv);
  if (!periodStart || !periodEnd) throw new Error("The reporting period could not be determined");

  const factPack = buildUwinStateFactPack(csv, kpis);
  const sourceEvidence = {
    fileName: csv.fileName,
    rowCount: csv.rows.length,
    header: csv.header,
    months: Object.keys(csv.allMonths).sort(),
    counts: [csv.globalDistrictCount, csv.globalBlockCount, csv.globalFacilityCount, csv.globalSessionSiteCount],
    cards: kpis.cards
      .map((card) => [card.id, card.group, card.stat.total, card.stat.any, card.stat.all])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    factPack,
  };

  return {
    state: csv.stateName,
    periodStart,
    periodEnd,
    sourceSignature: compactHash(JSON.stringify(sourceEvidence)),
    analysisMode: kpis.analysisMode,
    narrativeMode,
    filters: {
      districts: [...(filters.districts ?? [])].sort(),
      blocks: [...filters.blocks].sort(),
      months: [...filters.months].sort(),
      ownership: [...filters.ownership].sort(),
      ru: [...filters.ru].sort(),
    },
    scores: {
      overall: score.overall,
      availability: score.components.availability?.score ?? 0,
      accuracy: score.components.accuracy?.score ?? 0,
      consistency: score.components.consistency?.score ?? 0,
    },
    counts: {
      districts: new Set(Object.values(kpis.filteredFacilities).map((item) => item.district).filter(Boolean)).size,
      blocks: kpis.globalBlockCount,
      facilities: csv.globalFacilityCount,
      sessionSites: csv.globalSessionSiteCount,
      analysedUnits: kpis.globalDen,
    },
    reviewContext: {
      designation: reviewInfo?.designation || null,
      purpose: reviewInfo?.purpose || null,
      purposeDetail: reviewInfo?.purposeSubOption || reviewInfo?.purposeOtherText || null,
    },
    factPack,
    rulesVersion: UWIN_STATE_REPORT_RULES_VERSION,
    templateVersion: "uwin-state-report-v1",
  };
}

export async function createUwinStateReport(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
  filters: FilterState,
  reviewInfo: PreUploadInfo | null,
  narrativeMode: "DETERMINISTIC" | "AI_ASSISTED" = "DETERMINISTIC",
): Promise<UwinStateReportRecord> {
  return apiFetch("/api/uwin-state-reports", {
    method: "POST",
    body: JSON.stringify(buildUwinStateReportRequest(csv, kpis, filters, reviewInfo, narrativeMode)),
  });
}

export async function getUwinStateAiStatus(): Promise<{ enabled: boolean; model: string; promptVersion: string; configured: boolean }> {
  return apiFetch("/api/uwin-state-reports/ai-status");
}

export async function generateUwinStateAiNarrative(id: string): Promise<{ cached: boolean; aiNarrative: UwinStateReportRecord["aiNarrative"] }> {
  return apiFetch(`/api/uwin-state-reports/${encodeURIComponent(id)}/ai-narrative`, { method: "POST", body: "{}" });
}

export async function listUwinStateReports(
  state: string,
  periodStart?: string,
  periodEnd?: string,
): Promise<UwinStateReportRecord[]> {
  const params = new URLSearchParams({ state });
  if (periodStart) params.set("periodStart", periodStart);
  if (periodEnd) params.set("periodEnd", periodEnd);
  return apiFetch(`/api/uwin-state-reports?${params.toString()}`);
}

export async function getUwinStateReport(id: string): Promise<UwinStateReportRecord> {
  return apiFetch(`/api/uwin-state-reports/${encodeURIComponent(id)}`);
}

async function authenticatedArtifactFetch(url: string, options?: RequestInit) {
  if (!auth.currentUser) throw new Error("Session expired. Please log in again.");
  const token = await auth.currentUser.getIdToken();
  return fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options?.headers },
  });
}

export async function uploadUwinStateReportPdf(id: string, blob: Blob) {
  const response = await authenticatedArtifactFetch(`/api/uwin-state-reports/${encodeURIComponent(id)}/pdf`, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: blob,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Failed to save report PDF");
  return data as { pdfAvailable: boolean; reused: boolean; fileName: string };
}

export async function downloadSavedUwinStateReportPdf(report: UwinStateReportRecord) {
  const response = await authenticatedArtifactFetch(`/api/uwin-state-reports/${encodeURIComponent(report.id)}/pdf`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Failed to download report PDF");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = report.pdfFileName || `${report.reportNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function updateUwinStateReportStatus(id: string, status: "REVIEWED" | "APPROVED"): Promise<UwinStateReportRecord> {
  return apiFetch(`/api/uwin-state-reports/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function listUwinStateReportActions(id: string): Promise<UwinStateReportAction[]> {
  return apiFetch(`/api/uwin-state-reports/${encodeURIComponent(id)}/actions`);
}

export async function updateUwinStateReportAction(
  reportId: string,
  actionId: string,
  update: Pick<UwinStateReportAction, "status" | "responsibleOfficer" | "dueDate" | "progressNote">,
): Promise<UwinStateReportAction> {
  return apiFetch(`/api/uwin-state-reports/${encodeURIComponent(reportId)}/actions/${encodeURIComponent(actionId)}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

import type { DistrictReportFact } from "./stateReportFacts";
import type { UwinStateReportRecord } from "./stateReports";

export interface ReportComparison {
  comparable: boolean;
  reason: string | null;
  overallDelta: number;
  componentDeltas: { availability: number; accuracy: number; consistency: number };
  districtsImproved: number;
  districtsDeclined: number;
  districtsUnchanged: number;
  enteredCriticalOrHigh: string[];
  exitedCriticalOrHigh: string[];
}

function monthIndex(month: string): number {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
}

function periodLength(report: UwinStateReportRecord): number {
  return monthIndex(report.periodEnd) - monthIndex(report.periodStart) + 1;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function analysisLevelLabel(mode: UwinStateReportRecord["analysisMode"]): string {
  if (mode === "sessionsite") return "session site";
  if (mode === "subcenter") return "sub center";
  return "facility";
}

export function comparabilityReason(current: UwinStateReportRecord, previous: UwinStateReportRecord): string | null {
  if (current.state.trim().toLowerCase() !== previous.state.trim().toLowerCase()) return "Reports are for different states.";
  if (current.analysisMode !== previous.analysisMode) {
    const levels = new Set([current.analysisMode, previous.analysisMode]);
    if (levels.has("facility") && levels.has("sessionsite") && levels.size === 2) {
      return "Analysis levels differ (facility versus session site).";
    }
    return `Analysis levels differ (${analysisLevelLabel(current.analysisMode)} versus ${analysisLevelLabel(previous.analysisMode)}).`;
  }
  if (current.rulesVersion !== previous.rulesVersion) return "DQA rules versions differ.";
  if (periodLength(current) !== periodLength(previous)) return "Reporting-period durations differ.";
  return null;
}

export function findPreviousComparableReport(
  current: UwinStateReportRecord,
  reports: UwinStateReportRecord[],
): UwinStateReportRecord | null {
  const candidates = reports
    .filter((report) => report.id !== current.id && report.periodEnd < current.periodStart && !comparabilityReason(current, report))
    .sort((a, b) => {
      if (a.periodEnd !== b.periodEnd) return b.periodEnd.localeCompare(a.periodEnd);
      return b.version - a.version;
    });
  return candidates[0] ?? null;
}

export function latestReportPerPeriod(reports: UwinStateReportRecord[]) {
  const selected = new Map<string, UwinStateReportRecord>();
  reports.forEach((report) => {
    const key = `${report.periodStart}|${report.periodEnd}`;
    const current = selected.get(key);
    if (!current || report.version > current.version) {
      selected.set(key, report);
    }
  });
  return [...selected.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

function priorityFlag(district: DistrictReportFact | undefined) {
  return district?.priority === "CRITICAL" || district?.priority === "HIGH";
}

export function compareUwinStateReports(
  current: UwinStateReportRecord,
  previous: UwinStateReportRecord,
): ReportComparison {
  const reason = comparabilityReason(current, previous);
  if (reason) {
    return {
      comparable: false, reason, overallDelta: 0,
      componentDeltas: { availability: 0, accuracy: 0, consistency: 0 },
      districtsImproved: 0, districtsDeclined: 0, districtsUnchanged: 0,
      enteredCriticalOrHigh: [], exitedCriticalOrHigh: [],
    };
  }
  const currentDistricts = new Map((current.factPack?.districts ?? []).map((district) => [district.district.toLowerCase(), district]));
  const previousDistricts = new Map((previous.factPack?.districts ?? []).map((district) => [district.district.toLowerCase(), district]));
  let improved = 0;
  let declined = 0;
  let unchanged = 0;
  const entered: string[] = [];
  const exited: string[] = [];
  for (const [key, district] of currentDistricts) {
    const before = previousDistricts.get(key);
    if (!before) continue;
    const delta = district.scores.overall - before.scores.overall;
    if (delta >= 0.5) improved += 1;
    else if (delta <= -0.5) declined += 1;
    else unchanged += 1;
    if (priorityFlag(district) && !priorityFlag(before)) entered.push(district.district);
    if (!priorityFlag(district) && priorityFlag(before)) exited.push(district.district);
  }
  return {
    comparable: true,
    reason: null,
    overallDelta: round(current.scores.overall - previous.scores.overall),
    componentDeltas: {
      availability: round(current.scores.availability - previous.scores.availability),
      accuracy: round(current.scores.accuracy - previous.scores.accuracy),
      consistency: round(current.scores.consistency - previous.scores.consistency),
    },
    districtsImproved: improved,
    districtsDeclined: declined,
    districtsUnchanged: unchanged,
    enteredCriticalOrHigh: entered.sort(),
    exitedCriticalOrHigh: exited.sort(),
  };
}

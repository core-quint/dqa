import type { KpiCard } from "../dqa/types";
import { computeOverallScore } from "../dqa/scoreUtils";
import type { UwinComputedKpis, UwinParsedCSV } from "./types";

export const UWIN_STATE_REPORT_RULES_VERSION = "uwin-state-dqa-v1";

export type DqaStatus = "GOOD" | "SATISFACTORY" | "NEEDS_IMPROVEMENT" | "CRITICAL";
export type PriorityBand = "CRITICAL" | "HIGH" | "MODERATE" | "ROUTINE";

export interface ReportFinding {
  evidenceId: string;
  indicatorId: string;
  group: "availability" | "accuracy" | "consistency";
  title: string;
  affectedUnits: number;
  denominator: number;
  affectedPercent: number;
  severity: "HIGH" | "MODERATE" | "LOW";
  actionRuleId: string;
}

export interface DistrictReportFact {
  district: string;
  analysedUnits: number;
  scores: {
    overall: number;
    availability: number;
    accuracy: number;
    consistency: number;
  };
  status: DqaStatus;
  priority: PriorityBand;
  mainFindingEvidenceId: string | null;
  affectedIndicatorCount: number;
}

export interface ReportActionRule {
  id: string;
  indicatorId: string;
  action: string;
  responsibleLevel: "STATE" | "DISTRICT" | "DISTRICT_BLOCK";
  timelineDays: number;
  verification: string;
}

export interface UwinStateReportFactPack {
  schemaVersion: "1.0";
  rulesVersion: string;
  generatedFrom: "UWIN_STATE_COMPUTED_KPIS";
  scope: {
    state: string;
    periodStart: string;
    periodEnd: string;
    analysisMode: "facility" | "sessionsite";
    districtCount: number;
    blockCount: number;
    facilityCount: number;
    sessionSiteCount: number;
    analysedUnits: number;
  };
  scores: {
    overall: number;
    availability: number;
    accuracy: number;
    consistency: number;
    status: DqaStatus;
  };
  districtDistribution: Record<PriorityBand, number>;
  districts: DistrictReportFact[];
  findings: ReportFinding[];
  actionRules: ReportActionRule[];
  positiveFindings: string[];
  limitations: string[];
}

const REPORT_GROUPS = ["availability", "accuracy", "consistency"] as const;

export function dqaStatus(score: number): DqaStatus {
  if (score >= 80) return "GOOD";
  if (score >= 60) return "SATISFACTORY";
  if (score >= 40) return "NEEDS_IMPROVEMENT";
  return "CRITICAL";
}

export function priorityBand(score: number): PriorityBand {
  if (score < 40) return "CRITICAL";
  if (score < 60) return "HIGH";
  if (score < 80) return "MODERATE";
  return "ROUTINE";
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function actionForCard(card: KpiCard): ReportActionRule {
  const title = card.name.toLowerCase();
  if (card.id === "t6") {
    return {
      id: "ACT-SESSION-STATUS-01", indicatorId: card.id,
      action: "Reconcile planned and held session status with the approved microplan and source records.",
      responsibleLevel: "DISTRICT_BLOCK", timelineDays: 14,
      verification: "Documented reconciliation and corrected session records, where required.",
    };
  }
  if (card.id === "t8") {
    return {
      id: "ACT-SESSION-YIELD-01", indicatorId: card.id,
      action: "Validate beneficiary and session-held entries, then review repeatedly low-yield sessions during the district RI review.",
      responsibleLevel: "DISTRICT_BLOCK", timelineDays: 30,
      verification: "Validated source records and district review minutes with follow-up decisions.",
    };
  }
  if (card.id === "t9" || title.includes("zero")) {
    return {
      id: "ACT-ZERO-REPORTING-01", indicatorId: card.id,
      action: "Verify zero values against session records and distinguish true zero vaccination from missing or incomplete reporting.",
      responsibleLevel: "DISTRICT_BLOCK", timelineDays: 14,
      verification: "Sample verification log and documented corrections or confirmation of true zero values.",
    };
  }
  if (card.id === "t7" || title.includes("same value")) {
    return {
      id: "ACT-REPEATED-VALUE-01", indicatorId: card.id,
      action: "Review repeated monthly values against source records and correct any copied-forward entries.",
      responsibleLevel: "DISTRICT_BLOCK", timelineDays: 14,
      verification: "Source-to-system verification sample and correction log.",
    };
  }
  if (card.id === "t3" || title.includes("outlier")) {
    return {
      id: "ACT-OUTLIER-01", indicatorId: card.id,
      action: "Validate flagged month-to-month outliers against source records before using them for programme interpretation.",
      responsibleLevel: "DISTRICT", timelineDays: 21,
      verification: "District outlier validation sheet with confirmed or corrected values.",
    };
  }
  if (card.id.startsWith("drop") || title.includes("dropout")) {
    return {
      id: "ACT-DROPOUT-CONSISTENCY-01", indicatorId: card.id,
      action: "Validate the related dose entries and confirm that the flagged relationship is not caused by reporting or denominator errors.",
      responsibleLevel: "DISTRICT", timelineDays: 21,
      verification: "Dose-pair validation record and documented corrections, if applicable.",
    };
  }
  if (card.group === "consistency") {
    return {
      id: `ACT-CONSISTENCY-${card.id.toUpperCase()}`, indicatorId: card.id,
      action: "Review the flagged logical relationship between related indicators and validate both values against source records.",
      responsibleLevel: "DISTRICT", timelineDays: 21,
      verification: "Completed consistency check and correction or justification recorded.",
    };
  }
  return {
    id: `ACT-VALIDATE-${card.id.toUpperCase()}`, indicatorId: card.id,
    action: "Validate the flagged records and document corrections or confirmation of the submitted values.",
    responsibleLevel: "DISTRICT_BLOCK", timelineDays: 21,
    verification: "Validation record with reviewer, date, result, and corrective action.",
  };
}

export function buildUwinStateFactPack(
  csv: UwinParsedCSV,
  kpis: UwinComputedKpis,
): UwinStateReportFactPack {
  const months = Object.keys(csv.allMonths).sort();
  const overall = computeOverallScore(kpis as never, [...REPORT_GROUPS]);
  const reportCards = kpis.cards.filter((card) => REPORT_GROUPS.includes(card.group as typeof REPORT_GROUPS[number]));
  const den = Math.max(1, kpis.globalDen);

  const actionByIndicator = new Map<string, ReportActionRule>();
  const findings: ReportFinding[] = reportCards
    .filter((card) => card.stat.total > 0)
    .map((card) => {
      const affectedPercent = round((card.stat.total / den) * 100);
      const action = actionForCard(card);
      actionByIndicator.set(card.id, action);
      return {
        evidenceId: `EV-${card.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
        indicatorId: card.id,
        group: card.group as ReportFinding["group"],
        title: card.name,
        affectedUnits: card.stat.total,
        denominator: kpis.globalDen,
        affectedPercent,
        severity: affectedPercent >= 20 ? "HIGH" : affectedPercent >= 5 ? "MODERATE" : "LOW",
        actionRuleId: action.id,
      };
    })
    .sort((a, b) => b.affectedPercent - a.affectedPercent || a.title.localeCompare(b.title));

  const evidenceByIndicator = new Map(findings.map((finding) => [finding.indicatorId, finding.evidenceId]));
  const districtUnits = new Map<string, Set<string>>();
  for (const [key, facility] of Object.entries(kpis.filteredFacilities)) {
    const district = facility.district?.trim() || "Unknown district";
    if (!districtUnits.has(district)) districtUnits.set(district, new Set());
    districtUnits.get(district)!.add(key);
  }

  const districts: DistrictReportFact[] = [...districtUnits.entries()].map(([district, unitKeys]) => {
    const denominator = Math.max(1, unitKeys.size);
    const componentScores = Object.fromEntries(REPORT_GROUPS.map((group) => {
      const cards = reportCards.filter((card) => card.group === group);
      const maximumIssueRate = Math.max(0, ...cards.map((card) => {
        let affected = 0;
        for (const key of card.stat.facilityKeys) if (unitKeys.has(key)) affected += 1;
        return (affected / denominator) * 100;
      }));
      return [group, round(Math.max(0, 100 - maximumIssueRate))];
    })) as Record<typeof REPORT_GROUPS[number], number>;
    const districtOverall = round(REPORT_GROUPS.reduce((sum, group) => sum + componentScores[group], 0) / REPORT_GROUPS.length);

    const districtIssues = reportCards.map((card) => {
      let count = 0;
      for (const key of card.stat.facilityKeys) if (unitKeys.has(key)) count += 1;
      return { card, count, percent: (count / denominator) * 100 };
    }).filter((item) => item.count > 0).sort((a, b) => b.percent - a.percent);

    return {
      district,
      analysedUnits: unitKeys.size,
      scores: {
        overall: districtOverall,
        availability: componentScores.availability,
        accuracy: componentScores.accuracy,
        consistency: componentScores.consistency,
      },
      status: dqaStatus(districtOverall),
      priority: priorityBand(districtOverall),
      mainFindingEvidenceId: districtIssues[0] ? evidenceByIndicator.get(districtIssues[0].card.id) ?? null : null,
      affectedIndicatorCount: districtIssues.length,
    };
  }).sort((a, b) => a.scores.overall - b.scores.overall || a.district.localeCompare(b.district));

  const districtDistribution: Record<PriorityBand, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, ROUTINE: 0 };
  districts.forEach((district) => { districtDistribution[district.priority] += 1; });

  const strongest = [...districts].sort((a, b) => b.scores.overall - a.scores.overall).slice(0, 3);
  const zeroIssueDistricts = districts.filter((district) => district.affectedIndicatorCount === 0).length;
  const positiveFindings = [
    zeroIssueDistricts > 0 ? `${zeroIssueDistricts} district${zeroIssueDistricts === 1 ? " has" : "s have"} no flags under the selected DQA rules and filters.` : null,
    strongest.length > 0 ? `Highest district DQA scores: ${strongest.map((item) => `${item.district} (${item.scores.overall.toFixed(1)}%)`).join(", ")}.` : null,
  ].filter((item): item is string => Boolean(item));

  return {
    schemaVersion: "1.0",
    rulesVersion: UWIN_STATE_REPORT_RULES_VERSION,
    generatedFrom: "UWIN_STATE_COMPUTED_KPIS",
    scope: {
      state: csv.stateName,
      periodStart: months[0] ?? "",
      periodEnd: months[months.length - 1] ?? "",
      analysisMode: kpis.analysisMode,
      districtCount: districts.length,
      blockCount: kpis.globalBlockCount,
      facilityCount: csv.globalFacilityCount,
      sessionSiteCount: csv.globalSessionSiteCount,
      analysedUnits: kpis.globalDen,
    },
    scores: {
      overall: round(overall.overall),
      availability: round(overall.components.availability?.score ?? 0),
      accuracy: round(overall.components.accuracy?.score ?? 0),
      consistency: round(overall.components.consistency?.score ?? 0),
      status: dqaStatus(overall.overall),
    },
    districtDistribution,
    districts,
    findings,
    actionRules: [...actionByIndicator.values()],
    positiveFindings,
    limitations: [
      "This is a data quality assessment; it does not measure immunization coverage, service performance, vaccine stock, or workforce adequacy.",
      "A flagged record requires validation and is not, by itself, confirmation of an error or its cause.",
      "District scores and priorities reflect only the uploaded period, selected filters, available fields, and the stated DQA rules version.",
      "The overall score combines availability, accuracy, and consistency; completeness is not included in this U-WIN State score.",
    ],
  };
}

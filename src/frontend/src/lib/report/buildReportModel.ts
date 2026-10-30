// ============================================================
// Portal-neutral ReportModel builder for the DQA analysis report.
//
// Each portal supplies its units (with their area), its standard score cards
// (the ones the score is computed from) and the weighted score; everything in
// the report — findings, per-area counts, the 4+ / 1–3 / 0 table, the top 3
// units — is derived here the same way for HMIS, U-WIN, PCTS and HMIS-State.
// ============================================================

import { GROUP_COLORS } from "../dqa/constants";
import { scoreGrade } from "../dqa/scoreUtils";
import { SCORING_METHOD_VERSION } from "../dqa/scoring";
import type { WeightedScoreResult } from "../dqa/weightedScoring";
import type { ReportCheck, ReportComponent, ReportModel, TextRun } from "./dqaReportPdf";

export interface ReportInputCard {
  id: string;
  name: string;
  group: string;
  /** Units the check could be evaluated for; 0 = it cannot run. */
  eligible: number;
  /** Keys of the units it flagged. */
  flaggedUnits: Iterable<string>;
}

export interface ReportInputUnit {
  key: string;
  name: string;
  /** The area the unit belongs to (block or district). */
  area: string;
}

export interface ReportInput {
  kicker: string;
  title: string;
  meta: { label: string; value: string }[];
  /** Footer line, e.g. "HMIS DQA · Bhagalpur, Bihar · April 2026 to June 2026". */
  footer: string;
  unit: { one: string; many: string };
  area: { one: string; many: string };
  /** The units are the areas themselves (district-level HMIS-State). */
  unitIsArea?: boolean;
  units: ReportInputUnit[];
  /** The standard score cards. */
  cards: ReportInputCard[];
  /** Scored components, in order. */
  groups: string[];
  weighted: WeightedScoreResult;
  /** Portal wording for "flagged for …", by check id. */
  phrases: Record<string, string>;
  /** Standard dropout threshold (%). */
  dropoutThreshold: number;
  /** Units in the whole upload, to say when the report covers a filtered selection. */
  uploadedUnits: number;
  extraNotes?: string[];
}

// ---- check names ----

type CheckKind = "dropout" | "coadmin" | "order" | "other";

const DASH = /\s+[—–-]\s+/;

function kindOf(card: Pick<ReportInputCard, "id" | "name">): CheckKind {
  if (card.id.startsWith("drop_")) return "dropout";
  if (/^co\d+$/.test(card.id) || card.id.startsWith("coadmin_")) return "coadmin";
  if (/^i\d+$/.test(card.id) || /_gt_/.test(card.id) || /^custom_\d+$/.test(card.id) || /^Inconsistencies/i.test(card.name)) {
    return "order";
  }
  return "other";
}

/** "Penta1 → Penta3" from "Dropouts — Penta1→Penta3", "Penta1 → Penta3 Dropout", … */
function dropoutPair(name: string): string {
  return name
    .replace(/^Dropouts?\s*[—–-]\s*/i, "")
    .replace(/\s*Dropout$/i, "")
    .replace(/\s*→\s*/g, " → ")
    .trim();
}

/** Visit and vaccines from "6 weeks — OPV1, …" or "Co-administered Antigens — 6 weeks". */
function coadminParts(name: string): { visit: string; vaccines: string } {
  const [head, ...rest] = name.split(DASH);
  const tail = rest.join(" — ");
  return /^co-?administ/i.test(head) ? { visit: tail || head, vaccines: "" } : { visit: head, vaccines: tail };
}

/** "Penta3 > Penta1" from "Inconsistencies — Penta3>Penta1" or "Penta3 > Penta1". */
function orderPair(name: string): string {
  return name.replace(/^Inconsistencies\s*[—–-]\s*/i, "").replace(/\s*>\s*/g, " > ").trim();
}

/** Chart label for a check. */
export function reportCheckLabel(card: Pick<ReportInputCard, "id" | "name">, threshold: number): string {
  switch (kindOf(card)) {
    case "dropout":
      return `Dropout ${dropoutPair(card.name)} (≥${threshold}%)`;
    case "coadmin": {
      const { visit, vaccines } = coadminParts(card.name);
      return vaccines ? `Co-admin ${visit}: ${vaccines}` : `Co-admin ${visit}`;
    }
    case "order":
      return orderPair(card.name);
    default:
      return card.name;
  }
}

/** "… flagged for <phrase>." in the key findings. */
export function reportFindingPhrase(
  card: Pick<ReportInputCard, "id" | "name">,
  threshold: number,
  phrases: Record<string, string>,
): string {
  if (phrases[card.id]) return phrases[card.id];
  switch (kindOf(card)) {
    case "dropout":
      return `a dropout of ${threshold}% or more (${dropoutPair(card.name)})`;
    case "coadmin":
      return `${coadminParts(card.name).visit} co-administered vaccines not matching`;
    case "order": {
      const [later, earlier] = orderPair(card.name).split(" > ");
      return earlier ? `${later} reported above ${earlier}` : orderPair(card.name);
    }
    default:
      return card.name.charAt(0).toLowerCase() + card.name.slice(1);
  }
}

// ---- builder ----

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctText = (value: number) => (value > 0 && value < 0.1 ? "<0.1" : value.toFixed(1));
const byCountThenName = <T extends { name: string }>(count: (row: T) => number) =>
  (a: T, b: T) => count(b) - count(a) || a.name.localeCompare(b.name);

export function buildReportModel(input: ReportInput): ReportModel {
  const { units, cards, weighted, unit } = input;
  const unitByKey = new Map(units.map((row) => [row.key, row]));
  const areas = [...new Set(units.map((row) => row.area))];
  const totalUnits = units.length;

  const flaggedOf = new Map(cards.map((card) => [card.id, [...card.flaggedUnits].filter((key) => unitByKey.has(key))]));

  const byArea = (keys: string[]) => {
    const counts = new Map(areas.map((area) => [area, 0]));
    for (const key of keys) {
      const area = unitByKey.get(key)!.area;
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort(byCountThenName((row) => row.count));
  };

  const components: ReportComponent[] = input.groups.map((group) => {
    const own = cards.filter((card) => card.group === group);
    const checks: ReportCheck[] = own.map((card) => {
      const flagged = flaggedOf.get(card.id) ?? [];
      return {
        id: card.id,
        label: reportCheckLabel(card, input.dropoutThreshold),
        flagged: flagged.length,
        pct: pctOf(flagged.length, totalUnits),
        canRun: card.eligible > 0,
        byArea: byArea(flagged),
        flaggedNames: input.unitIsArea
          ? flagged.map((key) => unitByKey.get(key)!.name).sort((a, b) => a.localeCompare(b))
          : undefined,
      };
    });
    const worst = checks.reduce<ReportCheck | null>(
      (best, check) => (check.canRun && check.flagged > 0 && (!best || check.flagged > best.flagged) ? check : best),
      null,
    );
    const weight = weighted.components[group];
    const score = weight?.score ?? null;
    let note: string | undefined;
    if (score === null) {
      note = weight && weight.baseWeight === 0
        ? "Not scored for a single-period review: these checks compare periods, so they need two or more months (or weeks)."
        : "Not assessed: none of its checks could run on this selection.";
    }
    const worstCard = worst ? own.find((card) => card.id === worst.id) : undefined;
    const finding: TextRun[] = note
      ? [{ text: "not assessed for this selection." }]
      : worst && worstCard
        ? [
            { text: `${pctText(worst.pct)}% ${unit.many} (${worst.flagged})`, bold: true },
            { text: ` flagged for ${reportFindingPhrase(worstCard, input.dropoutThreshold, input.phrases)}.` },
          ]
        : [{ text: `no ${unit.one} flagged.` }];
    return {
      key: group,
      name: weight?.name ?? group,
      color: GROUP_COLORS[group] ?? "#475569",
      score,
      checks,
      worst,
      finding,
      note,
    };
  });

  // Distinct checks flagged per unit, and per area.
  const issuesByUnit = new Map(units.map((row) => [row.key, 0]));
  const checkNamesByUnit = new Map(units.map((row) => [row.key, [] as string[]]));
  const checksByArea = new Map(areas.map((area) => [area, new Set<string>()]));
  for (const card of cards) {
    for (const key of flaggedOf.get(card.id) ?? []) {
      issuesByUnit.set(key, (issuesByUnit.get(key) ?? 0) + 1);
      checkNamesByUnit.get(key)?.push(reportCheckLabel(card, input.dropoutThreshold));
      checksByArea.get(unitByKey.get(key)!.area)?.add(card.id);
    }
  }
  const issuesByArea = areas
    .map((name) => ({ name, issues: checksByArea.get(name)?.size ?? 0 }))
    .sort(byCountThenName((row) => row.issues));
  const order = issuesByArea.map((row) => row.name);
  const unitsIn = (area: string) => units.filter((row) => row.area === area);

  const areaTable = order.map((name) => {
    const counts = unitsIn(name).map((row) => issuesByUnit.get(row.key) ?? 0);
    return {
      name,
      high: counts.filter((n) => n >= 4).length,
      some: counts.filter((n) => n >= 1 && n <= 3).length,
      none: counts.filter((n) => n === 0).length,
      total: counts.length,
    };
  });
  const topUnits = order.map((name) => ({
    area: name,
    units: unitsIn(name)
      .map((row) => ({ name: row.name, issues: issuesByUnit.get(row.key) ?? 0 }))
      .filter((row) => row.issues > 0)
      .sort(byCountThenName((row) => row.issues))
      .slice(0, 3),
  }));
  const unitTable = input.unitIsArea
    ? units
      .map((row) => ({ name: row.name, issues: issuesByUnit.get(row.key) ?? 0, checks: checkNamesByUnit.get(row.key) ?? [] }))
      .sort(byCountThenName((row) => row.issues))
    : undefined;

  const checksAssessed = cards.filter((card) => card.eligible > 0).length;
  const generated = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
  const notes = [
    `Percentages are shares of all ${totalUnits} ${unit.many} in this selection. An issue count is the number of distinct checks flagged (of ${checksAssessed} checks that could run); 4 or more marks a priority ${unit.one}.`,
    `Scores use the weighted scoring method (v${SCORING_METHOD_VERSION}) with the standard check settings: every check has a fixed weight, and a check that cannot run passes its weight on.`,
    ...(input.extraNotes ?? []),
    ...(totalUnits < input.uploadedUnits
      ? [`Scope: a filtered selection of ${totalUnits} of the ${input.uploadedUnits} ${unit.many} in the upload.`]
      : []),
    `Generated on ${generated} from the DQA Desk Review tool.`,
  ];

  return {
    kicker: input.kicker,
    title: input.title,
    meta: input.meta,
    overall: weighted.overall,
    grade: scoreGrade(weighted.overall),
    unit,
    area: input.area,
    unitIsArea: Boolean(input.unitIsArea),
    totalUnits,
    checksAssessed,
    components,
    issuesByArea,
    areaTable,
    topUnits,
    unitTable,
    footer: input.footer,
    notes,
  };
}

/** "April 2026 to June 2026" from the first and last selected period labels. */
export function periodRange(keys: string[], labelOf: (key: string) => string): string {
  const sorted = [...keys].sort();
  if (sorted.length === 0) return "No period selected";
  const first = labelOf(sorted[0]);
  const last = labelOf(sorted[sorted.length - 1]);
  return sorted.length === 1 ? first : `${first} to ${last}`;
}

/** Saves the rendered report under `name`. */
export async function saveReport(model: ReportModel, name: string): Promise<void> {
  const [{ renderDqaReport }, { loadReportFonts }] = await Promise.all([
    import("./dqaReportPdf"),
    import("./reportFonts"),
  ]);
  const doc = renderDqaReport(model, await loadReportFonts());
  doc.save(`${name.replace(/\s+/g, "-")}.pdf`);
}

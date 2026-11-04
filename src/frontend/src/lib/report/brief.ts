// ============================================================
// DQA brief — what the two-page "Download Report" says, for every portal that
// uses it (HMIS, U-WIN / U-WIN State, PCTS).
//
// Template: docs/Report Template/HMIS DQA Brief - Template.pdf; every figure
// follows the developer notes in "HMIS DQA Brief - Rules.pdf" (adopted
// 2026-11-04). Each portal supplies its units (facilities, sub centers or
// session sites, each with its area: a block, or a district for a state
// upload), its standard score cards and its weighted score; everything else is
// derived here the same way. A district-level state upload, whose units are
// the districts themselves, gets a district list on page 2 instead of area
// rows. lib/report/briefPdf.ts draws the result.
//
// A unit's issue count is the number of standard checks that flag it.
// ============================================================

import { scoreGrade } from "../dqa/scoreUtils";
import type { WeightedScoreResult } from "../dqa/weightedScoring";
import type { ReviewBaseline } from "../snapshots";

export interface BriefNoun {
  one: string;
  many: string;
}

export interface BriefCheckText {
  /** Tile title. */
  title: string;
  /** Name in the block table's "Most common issue"; defaults to the title. */
  short?: string;
  /** Name inside a sentence; defaults to the title with ">" read as "more than". */
  prose?: string;
  /** Grey line under the title ("20% or more", the co-administered vaccines). */
  detail?: string | null;
  /** "title": right under the title, as a qualifier; "row" (default): level across the tile row. */
  detailAlign?: "title" | "row";
}

export interface BriefInputCard {
  id: string;
  name: string;
  group: string;
  /** Units the check could be evaluated for; 0 = it could not run. */
  eligible: number;
  /** Keys of the units it flagged. */
  flaggedUnits: Iterable<string>;
}

export interface BriefInput {
  /** "HMIS", "U-WIN", "PCTS", "HMIS State": banner kicker and footer. */
  portal: string;
  /** Where the data is corrected ("Fix in HMIS, then re-run…"); defaults to `portal`. */
  system?: string;
  /** "Nalanda, Bihar". */
  place: string;
  /** "Apr to Jun 2026". */
  period: string;
  /** "16 Oct 2026" — when the portal export was taken; null leaves the line out. */
  dataAsOn: string | null;
  unit: BriefNoun;
  area: BriefNoun;
  /** Units in the selection; `area` "" = not mapped to one. */
  units: { key: string; name: string; area: string }[];
  /** Each unit is its own area (a district-level state upload): page 2 lists the units. */
  unitIsArea?: boolean;
  /** The standard score cards. */
  cards: BriefInputCard[];
  /** Scored components, in order. */
  components: { key: string; name: string; description: string[] }[];
  weighted: WeightedScoreResult;
  /** Periods analysed and what one is called ("month", "week"). */
  periodCount: number;
  periodNoun: string;
  /** Wording by check id, for checks the generic rules cannot name. */
  checkText?: Record<string, BriefCheckText>;
  /** Display order by check id; others follow in tool order. */
  checkOrder?: string[];
  /** The check of the third "What stands out" sentence, and what flagged units did. */
  spotlight?: { id: string; verb: string };
  /** Standard dropout band (%). */
  dropoutThreshold: number;
  /** The last saved review of the previous period (same scope and method), if any. */
  previous?: ReviewBaseline | null;
  /** Units in the whole upload, to say when the brief covers a filtered part of it. */
  uploadedUnits: number;
  /** "District total", "State total". */
  totalLabel: string;
  /** When the brief is generated; defaults to now. */
  now?: Date;
}

/**
 * worst — the most concerning check of its component (red tile);
 * flagged — any other check that flagged a unit (grey tile);
 * clear — ran, flagged nothing (dashed, "No facility flagged");
 * notChecked — could not run for any unit (dashed, "Not checked").
 */
export type BriefTileState = "worst" | "flagged" | "clear" | "notChecked";

export interface BriefTile {
  id: string;
  title: string;
  detail: string | null;
  detailAlign: "title" | "row";
  /** Units flagged. */
  flagged: number;
  /** Areas, "not mapped" included, with at least one unit flagged. */
  areas: number;
  state: BriefTileState;
}

export interface BriefComponent {
  key: string;
  name: string;
  /** Text under the component name, one entry per line. */
  description: string[];
  score: number | null;
  /** Replaces "N facilities flagged" when the component is not scored. */
  scoreNote: string | null;
  /** Units with at least one flag in this component. */
  flaggedUnits: number;
  tiles: BriefTile[];
}

export type BriefHighlightIcon = "search" | "layers" | "fileX" | "mapPin";

export interface BriefHighlight {
  icon: BriefHighlightIcon;
  title: string;
  detail: string;
}

export interface BriefAreaRow {
  name: string;
  unmapped: boolean;
  total: number;
  /** Units with 4+ / 1 to 3 / no issues. */
  high: number;
  some: number;
  none: number;
  /** Most common issue: the first two tied checks, how many more tie, units flagged by each. */
  common: { names: string[]; more: number; count: number } | null;
  /** Most concerning units: the highest issue count and every unit at it, A to Z (cut at 40 characters). */
  concerning: { issues: number; names: string[] } | null;
}

/** One row of the unit list (unitIsArea): checks flagged, in tool order. */
export interface BriefUnitRow {
  name: string;
  issues: number;
  checks: string[];
}

export interface DqaBrief {
  portal: string;
  system: string;
  unit: BriefNoun;
  area: BriefNoun;
  /** The units are the areas: page 2 lists `unitRows` instead of `rows`. */
  unitIsArea: boolean;
  place: string;
  units: number;
  /** Units in the upload, when the brief covers a filtered part of it. */
  uploadedUnits: number | null;
  /** Areas the units are mapped to. */
  areas: number;
  /** Units without an area. */
  unmapped: number;
  period: string;
  dataAsOn: string | null;
  generatedOn: string;
  overall: number | null;
  grade: string;
  /** Against the last saved review of the previous period; null hides the line. */
  change: { delta: number; previous: number; period: string } | null;
  components: BriefComponent[];
  withIssue: number;
  high: number;
  some: number;
  none: number;
  callToAction: string;
  highlights: BriefHighlight[];
  /** Checks that could run — the "out of N" of an issue count. */
  checksRun: number;
  /** Area rows in page-2 order, the not-mapped row last (empty when unitIsArea). */
  rows: BriefAreaRow[];
  /** Units, most issues first (unitIsArea only). */
  unitRows: BriefUnitRow[];
  totalLabel: string;
  footer: string;
}

// ---- check wording ----

/** "Penta1" / "Penta 1" -> "Penta-1", "MR2" -> "MR-2". */
const hyphenate = (antigen: string) => antigen.trim().replace(/^([A-Za-z]+)\s*(\d+)$/, "$1-$2");
const stemOf = (antigen: string) => antigen.trim().replace(/\s*\d+$/, "");
const doseOf = (antigen: string) => antigen.trim().slice(stemOf(antigen).length).trim();

type CheckWording = Required<BriefCheckText>;

function checkWording(card: Pick<BriefInputCard, "id" | "name">, input: BriefInput): CheckWording {
  const complete = (text: BriefCheckText): CheckWording => ({
    title: text.title,
    short: text.short ?? text.title,
    prose: text.prose ?? text.title.replace(/\s>\s/g, " more than "),
    detail: text.detail ?? null,
    detailAlign: text.detailAlign ?? "row",
  });
  const fixed = input.checkText?.[card.id];
  if (fixed) return complete(fixed);

  // Only a spaced dash separates parts ("16–24 months" is one part).
  const [head, ...rest] = card.name.split(/\s+[—–]\s+/);
  const tail = rest.join(" — ");
  if (card.id.startsWith("drop_")) {
    // "Dropouts — Penta1→Penta3" (HMIS, U-WIN) or "Penta 1 → Penta 3 Dropout" (PCTS)
    const pair = (tail || head).replace(/\s*dropouts?$/i, "");
    const [from = "", to = ""] = pair.split(/\s*→\s*/);
    const title = `${hyphenate(from)} to ${hyphenate(to)} dropout`;
    const short = stemOf(from) && stemOf(from) === stemOf(to) ? `${hyphenate(from)} to ${doseOf(to)} dropout` : title;
    return complete({ title, short, prose: title, detail: `${input.dropoutThreshold}% or more` });
  }
  if (/^co\d+$/.test(card.id) || card.id.startsWith("coadmin_")) {
    // "6 weeks — OPV1, Penta1, …" (HMIS, U-WIN) or "Co-administered Antigens — 6 weeks" (PCTS)
    const [visit, vaccines] = /^co-?administ/i.test(head) ? [tail, ""] : [head, tail];
    const title = `Co-admin ${visit.trim()}`;
    return complete({ title, prose: title, detail: vaccines ? `${vaccines.trim()} not equal` : null });
  }
  if (card.name.includes(">")) {
    // "Inconsistencies — Penta3>Penta1"
    const [later = "", earlier = ""] = (tail || head).split(/\s*>\s*/);
    return complete({
      title: `${hyphenate(later)} > ${hyphenate(earlier)}`,
      prose: `${hyphenate(later)} more than ${hyphenate(earlier)}`,
    });
  }
  return complete({ title: card.name.charAt(0).toUpperCase() + card.name.slice(1).toLowerCase() });
}

// ---- dates and places ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "28 Oct 2026" (fixed month names: en-GB would print "Sept"). */
export function briefDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "2026-10-16" -> "16 Oct 2026"; null for anything else. */
export function briefDay(iso: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  return briefDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * The date in free text such as a report's "Status as on 16/10/2026 10:23",
 * as "YYYY-MM-DD": day-first numbers, ISO dates and "16th Oct 2026" are read;
 * null when there is none.
 */
export function briefFindDay(text: string | null | undefined): string | null {
  const value = text ?? "";
  const iso = (year: number, month: number, day: number) =>
    month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : null;
  const isoDate = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (isoDate) return iso(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  const numeric = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(value);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = /(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{4})/.exec(value);
  if (named) {
    const month = MONTHS.findIndex((m) => m.toLowerCase() === named[2].slice(0, 3).toLowerCase()) + 1;
    return iso(Number(named[3]), month, Number(named[1]));
  }
  return null;
}

/** "Apr to Jun 2026", "Nov 2025 to Jan 2026", or "Apr 2026" for one month ("YYYY-MM" keys). */
export function briefPeriod(startKey: string, endKey: string): string {
  const parse = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return { year, month: MONTHS[month - 1] ?? key };
  };
  const start = parse(startKey);
  const end = parse(endKey);
  if (startKey === endKey) return `${start.month} ${start.year}`;
  return start.year === end.year
    ? `${start.month} to ${end.month} ${end.year}`
    : `${start.month} ${start.year} to ${end.month} ${end.year}`;
}

/** "1 to 7 Mar 2026", "28 Feb to 6 Mar 2026", "28 Dec 2025 to 3 Jan 2026" ("YYYY-MM-DD"). */
export function briefDays(from: string, to: string): string {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const end = `${td} ${MONTHS[tm - 1]} ${ty}`;
  if (from === to) return end;
  if (fy !== ty) return `${fd} ${MONTHS[fm - 1]} ${fy} to ${end}`;
  return fm === tm ? `${fd} to ${end}` : `${fd} ${MONTHS[fm - 1]} to ${end}`;
}

/** A state or district name for display: "" for unknown, "UTTAR PRADESH" -> "Uttar Pradesh". */
export function briefPlaceName(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "—" || trimmed === "Multiple") return "";
  if (/[a-z]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

// ---- helpers ----

const NAME_LIMIT = 40;
const plural = (n: number, noun: BriefNoun) => (n === 1 ? noun.one : noun.many);
const counted = (n: number, noun: BriefNoun) => `${n.toLocaleString("en-IN")} ${plural(n, noun)}`;
const cutName = (name: string) => (name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1).trimEnd()}…` : name);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface CheckStat {
  card: BriefInputCard;
  text: CheckWording;
  /** Display order across all checks. */
  order: number;
  canRun: boolean;
  flagged: string[];
  /** Flagged units per area key ("" = not mapped). */
  byArea: Map<string, number>;
}

/** More units, then more areas, then tool order. */
const byReach = (a: CheckStat, b: CheckStat) =>
  b.flagged.length - a.flagged.length || b.byArea.size - a.byArea.size || a.order - b.order;

// ---- builder ----

export function buildBrief(input: BriefInput): DqaBrief {
  const { unit, area, weighted } = input;
  const unitIsArea = Boolean(input.unitIsArea);
  const now = input.now ?? new Date();
  const groups = input.components.map((component) => component.key);

  const areaOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const row of input.units) {
    areaOf.set(row.key, unitIsArea ? row.key : row.area.trim());
    nameOf.set(row.key, row.name.trim() || `Unknown ${unit.one}`);
  }
  const areaKeys = [...new Set(areaOf.values())];
  const mappedAreas = areaKeys.filter(Boolean);
  const unmapped = [...areaOf.values()].filter((key) => !key).length;
  const total = areaOf.size;

  const rank = (id: string) => {
    const index = input.checkOrder?.indexOf(id) ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const cards = input.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => groups.includes(card.group))
    .sort((a, b) => rank(a.card.id) - rank(b.card.id) || a.index - b.index)
    .map(({ card }) => card);
  const stats: CheckStat[] = cards.map((card, order) => {
    const flagged = [...new Set(card.flaggedUnits)].filter((key) => areaOf.has(key));
    const byArea = new Map<string, number>();
    for (const key of flagged) {
      const at = areaOf.get(key)!;
      byArea.set(at, (byArea.get(at) ?? 0) + 1);
    }
    return { card, text: checkWording(card, input), order, canRun: card.eligible > 0, flagged, byArea };
  });

  const checksRun = stats.filter((stat) => stat.canRun).length;
  const issues = new Map([...areaOf.keys()].map((key) => [key, 0]));
  for (const stat of stats) for (const key of stat.flagged) issues.set(key, (issues.get(key) ?? 0) + 1);
  const band = (keys: string[]) => {
    const counts = keys.map((key) => issues.get(key) ?? 0);
    return {
      high: counts.filter((n) => n >= 4).length,
      some: counts.filter((n) => n >= 1 && n <= 3).length,
      none: counts.filter((n) => n === 0).length,
    };
  };

  // Components and their tiles.
  const singlePeriod = input.periodCount === 1;
  const components: BriefComponent[] = input.components.map((meta) => {
    const own = stats.filter((stat) => stat.card.group === meta.key);
    const worst = own.filter((stat) => stat.canRun && stat.flagged.length > 0).sort(byReach)[0];
    const weight = weighted.components[meta.key];
    const score = weight?.score ?? null;
    return {
      key: meta.key,
      name: meta.name,
      description: meta.description,
      score,
      scoreNote: score !== null
        ? null
        : weight && weight.baseWeight === 0
          ? `Not scored for ${singlePeriod ? `one ${input.periodNoun}` : "this period"}`
          : "Not assessed",
      flaggedUnits: new Set(own.flatMap((stat) => stat.flagged)).size,
      tiles: own.map((stat) => ({
        id: stat.card.id,
        title: stat.text.title,
        detail: stat.text.detail,
        detailAlign: stat.text.detailAlign,
        flagged: stat.flagged.length,
        areas: stat.byArea.size,
        state: !stat.canRun ? "notChecked" : stat.flagged.length === 0 ? "clear" : stat === worst ? "worst" : "flagged",
      })),
    };
  });

  // What stands out.
  const overallBand = band([...areaOf.keys()]);
  const withIssue = overallBand.high + overallBand.some;
  const has = overallBand.high === 1 ? "has" : "have";
  const callToAction = overallBand.high > 0
    ? unitIsArea
      ? `Start with the ${counted(overallBand.high, unit)} that ${has} 4+ issues. Page 2 lists every ${unit.one}, most issues first.`
      : `Start with the ${counted(overallBand.high, unit)} that ${has} 4+ issues. Page 2 lists ${
        overallBand.high === 1 ? "it" : "them"
      } by ${area.one}.`
    : withIssue > 0
      ? unitIsArea
        ? `No ${unit.one} has 4+ issues. Page 2 lists every ${unit.one}, most issues first.`
        : `No ${unit.one} has 4+ issues. Page 2 lists the most concerning ${unit.many} in each ${area.one}.`
      : `No data quality issue was flagged for any ${unit.one}.`;

  const highlights: BriefHighlight[] = [];
  const widest = stats.filter((stat) => stat.flagged.length > 0).sort(byReach)[0];
  if (widest) {
    highlights.push({
      icon: "search",
      title: `${widest.text.prose} is the most widespread issue`,
      detail: unitIsArea
        ? `${counted(widest.flagged.length, unit)} of ${total.toLocaleString("en-IN")}.`
        : `${counted(widest.flagged.length, unit)} in ${counted(widest.byArea.size, area)}.`,
    });
  }
  const everywhere = areaKeys.length > 1
    ? stats.filter((stat) => stat !== widest && areaKeys.every((key) => (stat.byArea.get(key) ?? 0) > 0)).sort(byReach)[0]
    : undefined;
  if (everywhere) {
    highlights.push({
      icon: "layers",
      title: `${everywhere.text.prose} appears in every ${area.one}`,
      detail: `${counted(everywhere.flagged.length, unit)}.`,
    });
  }
  const spot = input.spotlight ? stats.find((stat) => stat.card.id === input.spotlight!.id) : undefined;
  if (spot && spot.flagged.length > 0) {
    const n = spot.flagged.length;
    const notMapped = spot.byArea.get("") ?? 0;
    const when = singlePeriod ? `in ${input.period}` : `in at least one ${input.periodNoun}`;
    const which = notMapped === n
      ? n === 1 ? "it is" : "all are"
      : `${notMapped} of them ${notMapped === 1 ? "is" : "are"}`;
    highlights.push({
      icon: "fileX",
      title: `${counted(n, unit)} ${input.spotlight!.verb}`,
      detail: notMapped > 0 ? `${when}; ${which} not mapped to a ${area.one}.` : when,
    });
  }

  // Area rows (or, when the units are the areas, the unit list).
  const unitRows: BriefUnitRow[] = unitIsArea
    ? [...areaOf.keys()]
      .map((key) => ({
        name: nameOf.get(key)!,
        issues: issues.get(key) ?? 0,
        checks: stats.filter((stat) => stat.flagged.includes(key)).map((stat) => stat.text.short),
      }))
      .sort((a, b) => b.issues - a.issues || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    : [];
  const rows: BriefAreaRow[] = unitIsArea ? [] : areaKeys.map((key) => {
    const keys = [...areaOf.entries()].filter(([, at]) => at === key).map(([unitKey]) => unitKey);
    const inArea = stats
      .map((stat) => ({ stat, count: stat.byArea.get(key) ?? 0 }))
      .filter((row) => row.count > 0);
    const top = Math.max(0, ...inArea.map((row) => row.count));
    const tied = inArea.filter((row) => row.count === top).sort((a, b) => a.stat.order - b.stat.order);
    const worstIssues = Math.max(0, ...keys.map((unitKey) => issues.get(unitKey) ?? 0));
    return {
      name: key || `Not mapped to a ${area.one}`,
      unmapped: !key,
      total: keys.length,
      ...band(keys),
      common: top > 0
        ? { names: tied.slice(0, 2).map((row) => row.stat.text.short), more: Math.max(0, tied.length - 2), count: top }
        : null,
      concerning: worstIssues > 0
        ? {
            issues: worstIssues,
            names: keys
              .filter((unitKey) => issues.get(unitKey) === worstIssues)
              .map((unitKey) => cutName(nameOf.get(unitKey)!))
              .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
          }
        : null,
    };
  });
  rows.sort((a, b) =>
    Number(a.unmapped) - Number(b.unmapped)
    || b.high - a.high
    || (b.high + b.some) - (a.high + a.some)
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const closest = rows
    .filter((row) => !row.unmapped && row.high > 0)
    .sort((a, b) => b.high - a.high || (b.high + b.some) - (a.high + a.some) || a.name.localeCompare(b.name))[0];
  const topUnit = unitRows[0];
  if (unitIsArea && topUnit && topUnit.issues >= 4) {
    const tied = unitRows.filter((row) => row.issues === topUnit.issues).length;
    highlights.push({
      icon: "mapPin",
      title: `${capitalize(unit.one)} ${topUnit.name} needs the closest look`,
      detail: `${topUnit.issues} of ${checksRun} checks flagged, ${tied > 1 ? "the joint highest" : `the most of any ${unit.one}`}.`,
    });
  } else if (closest) {
    highlights.push({
      icon: "mapPin",
      title: `${capitalize(area.one)} ${closest.name} needs the closest look`,
      detail: `${closest.high} of its ${counted(closest.total, unit)} ${closest.high === 1 ? "has" : "have"} 4+ issues${
        mappedAreas.length > 1 ? `, the most of any ${area.one}` : ""
      }.`,
    });
  }

  const generatedOn = briefDate(now);
  const previous = input.previous;
  const overall = weighted.overall;
  const change = previous && previous.overall !== null && previous.period && overall !== null
    ? { delta: overall - previous.overall, previous: previous.overall, period: briefPeriod(previous.period.start, previous.period.end) }
    : null;

  return {
    portal: input.portal,
    system: input.system ?? input.portal,
    unit,
    area,
    unitIsArea,
    place: input.place,
    units: total,
    uploadedUnits: total < input.uploadedUnits ? input.uploadedUnits : null,
    areas: mappedAreas.length,
    unmapped,
    period: input.period,
    dataAsOn: input.dataAsOn,
    generatedOn,
    overall,
    grade: scoreGrade(overall),
    change,
    components,
    withIssue,
    ...overallBand,
    callToAction,
    highlights,
    checksRun,
    rows,
    unitRows,
    totalLabel: input.totalLabel,
    footer: `${input.portal} DQA brief  |  ${input.place}  |  ${input.period}  |  Generated from the DQA Review tool on ${generatedOn}`,
  };
}

/** Saves the brief as `<name>.pdf`; the renderer and fonts load on demand. */
export async function saveBrief(brief: DqaBrief, name: string): Promise<void> {
  const [{ renderBrief }, { loadBriefFonts }] = await Promise.all([
    import("./briefPdf"),
    import("./reportFonts"),
  ]);
  const doc = renderBrief(brief, await loadBriefFonts());
  doc.save(`${name.replace(/\s+/g, "-")}.pdf`);
}

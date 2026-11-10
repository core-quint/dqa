// ============================================================
// "Download Report" of the PHP tools — HMIS (dqahmis.php, dqahmisblock.php) and
// U-WIN (dqauwin.php, dqauwinblock.php): the same two-page DQA brief as the web
// application's HMIS and U-WIN portals.
//
// The PHP results page writes `window.__DQA_BRIEF__` from the analysis on
// screen: the units under the selection, the standard score cards with the
// units each flags, the selected periods and place (HMIS: PhpBriefPayload, plus
// "data as on"; U-WIN: PhpUwinBriefPayload, plus the analysis level and the
// declared From - To dates of the files). This file turns that into the inputs
// of the web adapter (lib/dqa/pdfReport.ts buildHmisBrief, lib/uwin/pdfReport.ts
// buildUwinBrief) and runs the web's own code on it (lib/report/brief.ts rules →
// lib/report/briefPdf.ts renderer, scoring v8 via computeOverallScore), so
// wording, layout and score are the web's. Not used by the web application.
//
// Build (from src/frontend), then copy to <PHP site>/assets/report/ together
// with assets/fonts/{DQABriefText-*,Poppins-Bold}.ttf and the two *-OFL.txt
// (fonts go in assets/report/fonts/):
//   <repo>/node_modules/.pnpm/@esbuild+win32-x64@0.21.5/node_modules/@esbuild/win32-x64/esbuild.exe
//     src/lib/report/phpBrief.ts --bundle --format=iife --platform=browser --target=es2018 --minify
//     --external:*.ttf?url --external:html2canvas --external:dompurify --external:canvg
//     --outfile=<PHP site>/assets/report/dqa_brief_report.js
// ============================================================

import { buildHmisBrief } from "../dqa/pdfReport";
import type { ComputedKpis, FacilityRecord, KpiCard, ParsedCSV } from "../dqa/types";
import { buildUwinBrief } from "../uwin/pdfReport";
import type { UwinComputedKpis, UwinParsedCSV, UwinReportingPeriod } from "../uwin/types";
import { renderBrief, type BriefFonts } from "./briefPdf";

export interface PhpBriefPayload {
  /** Payload format version. */
  v: 1;
  /** As the web parser names them: the single value, "Multiple" or "—". */
  state: string;
  district: string;
  /** "YYYY-MM-DD" from the export's "Data as on …" title row or file name; null when neither says. */
  dataAsOn: string | null;
  /** Selected months, "YYYY-MM". */
  months: string[];
  /** Facilities under the selection (the score's denominator). */
  den: number;
  /** Facilities in the whole upload. */
  uploaded: number;
  /** Facilities under the selection: [facility name, block name ("" = none)]; the index is the unit key. */
  units: [string, string][];
  /** The standard score cards, in tool order; `units` = indexes of the facilities flagged. */
  cards: { id: string; name: string; group: string; eligible: number; total: number; any: number; all: number; units: number[] }[];
}

/** U-WIN payload (dqauwin.php, dqauwinblock.php). */
export interface PhpUwinBriefPayload {
  v: 1;
  portal: "UWIN";
  state: string;
  district: string;
  /** Analysis level on screen. */
  mode: "facility" | "subcenter" | "sessionsite";
  /** Selected period keys ("YYYY-MM" or "YYYY-MM-DD..YYYY-MM-DD"). */
  months: string[];
  /** Declared From - To of every uploaded file. */
  periods: UwinReportingPeriod[];
  /** Units under the selection (the score's denominator). */
  den: number;
  /** Units in the whole upload, per level. */
  uploaded: { facility: number; subcenter: number; sessionsite: number };
  /** Units under the selection: [facility, sub center | null, session site | null, block, district]; the index is the unit key. */
  units: [string, string | null, string | null, string, string][];
  cards: PhpBriefPayload["cards"];
}

const FONT_FILES = {
  regular: "DQABriefText-Regular.ttf",
  bold: "DQABriefText-Bold.ttf",
  italic: "DQABriefText-Italic.ttf",
  boldItalic: "DQABriefText-BoldItalic.ttf",
  heading: "Poppins-Bold.ttf",
} as const;

/** Where this script was loaded from; the fonts sit in its fonts/ folder. */
const SCRIPT_URL = (document.currentScript as HTMLScriptElement | null)?.src ?? window.location.href;

async function base64Of(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

let fontsPromise: Promise<BriefFonts | null> | null = null;

/** The brief fonts, or null (the renderer then falls back to Helvetica), as on the web. */
function loadFonts(): Promise<BriefFonts | null> {
  fontsPromise ??= (async () => {
    const entries = await Promise.all(
      Object.entries(FONT_FILES).map(async ([key, file]) => [key, await base64Of(new URL(`fonts/${file}`, SCRIPT_URL).href)] as const),
    );
    return Object.fromEntries(entries) as unknown as BriefFonts;
  })().catch(() => {
    fontsPromise = null;
    return null;
  });
  return fontsPromise;
}

function scoreCardsOf(cards: PhpBriefPayload["cards"]): KpiCard[] {
  return cards.map((card) => ({
    id: card.id,
    name: card.name,
    group: card.group,
    downloadKey: card.id,
    stat: {
      total: card.total,
      any: card.any,
      all: card.all,
      eligible: card.eligible,
      eligibleKeys: new Set<string>(),
      facilityKeys: new Set(card.units.map(String)),
      anyFacilityKeys: new Set<string>(),
      allFacilityKeys: new Set<string>(),
    },
  })) as unknown as KpiCard[];
}

/** The web U-WIN adapter's inputs, holding only what buildUwinBrief and computeOverallScore read. */
function toUwinInputs(p: PhpUwinBriefPayload): { csv: UwinParsedCSV; kpis: UwinComputedKpis } {
  const filteredFacilities: Record<string, FacilityRecord> = {};
  p.units.forEach(([facility, subcenter, sessionsite, block, district], index) => {
    filteredFacilities[String(index)] = {
      district,
      block,
      facility,
      ...(subcenter !== null ? { subcenter } : {}),
      ...(sessionsite !== null ? { sessionsite } : {}),
      ownership: "",
      ru: "",
      months: {},
    };
  });
  const scoreCards = scoreCardsOf(p.cards);
  const csv = {
    portal: "UWIN",
    stateName: p.state,
    distName: p.district,
    reportingPeriods: p.periods,
    globalFacilityCount: p.uploaded.facility,
    globalSubCenterCount: p.uploaded.subcenter,
    globalSessionSiteCount: p.uploaded.sessionsite,
  } as unknown as UwinParsedCSV;
  const kpis = {
    analysisMode: p.mode,
    selMonths: p.months,
    filteredFacilities,
    scoreCards,
    cards: scoreCards,
    globalDen: p.den,
  } as unknown as UwinComputedKpis;
  return { csv, kpis };
}

/** The web adapter's inputs, holding only what buildHmisBrief and computeOverallScore read. */
function toWebInputs(p: PhpBriefPayload): { csv: ParsedCSV; kpis: ComputedKpis } {
  const filteredFacilities: Record<string, FacilityRecord> = {};
  p.units.forEach(([facility, block], index) => {
    filteredFacilities[String(index)] = { block, facility, ownership: "", ru: "", months: {} };
  });
  const facilityData: Record<string, FacilityRecord> = {};
  for (let i = 0; i < p.uploaded; i += 1) facilityData[`u${i}`] = { block: "", facility: "", ownership: "", ru: "", months: {} };
  const scoreCards = p.cards.map((card) => {
    const keys = new Set(card.units.map(String));
    return {
      id: card.id,
      name: card.name,
      group: card.group,
      downloadKey: card.id,
      stat: {
        total: card.total,
        any: card.any,
        all: card.all,
        eligible: card.eligible,
        eligibleKeys: new Set<string>(),
        facilityKeys: keys,
        anyFacilityKeys: new Set<string>(),
        allFacilityKeys: new Set<string>(),
      },
    };
  }) as unknown as KpiCard[];
  const csv = { stateName: p.state, distName: p.district, dataAsOn: p.dataAsOn, facilityData } as unknown as ParsedCSV;
  const kpis = { selMonths: p.months, filteredFacilities, scoreCards, cards: scoreCards, globalDen: p.den } as unknown as ComputedKpis;
  return { csv, kpis };
}

function isUwin(payload: PhpBriefPayload | PhpUwinBriefPayload): payload is PhpUwinBriefPayload {
  return (payload as PhpUwinBriefPayload).portal === "UWIN";
}

/** Saves the brief, named as the web application names it. */
async function download(payload: PhpBriefPayload | PhpUwinBriefPayload): Promise<void> {
  if (!payload || payload.v !== 1) throw new Error("No report data on this page.");
  const date = new Date().toISOString().slice(0, 10);
  let brief;
  let name: string;
  if (isUwin(payload)) {
    const { csv, kpis } = toUwinInputs(payload);
    brief = buildUwinBrief(csv, kpis, null);
    name = ["UWIN-DQA-Brief", csv.stateName, csv.distName, date].join("-");
  } else {
    const { csv, kpis } = toWebInputs(payload);
    brief = buildHmisBrief(csv, kpis, null);
    name = ["HMIS-DQA-Brief", csv.stateName, csv.distName, date].join("-");
  }
  const doc = renderBrief(brief, await loadFonts());
  doc.save(`${name.replace(/\s+/g, "-")}.pdf`);
}

(window as unknown as { DQABriefReport: unknown }).DQABriefReport = { download, toWebInputs, toUwinInputs, buildHmisBrief, buildUwinBrief };

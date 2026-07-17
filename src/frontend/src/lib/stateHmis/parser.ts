import * as XLSX from "xlsx";
import { monthKey, monthShortLabel, normalizeLooseText } from "../dqa/parseUtils";
import type {
  StateHmisDistrictRecord,
  StateHmisFileSummary,
  StateHmisItem,
  StateHmisMonthRecord,
  StateHmisParsed,
  StateHmisValidationIssue,
} from "./types";

interface ParsedStateFile {
  summary: StateHmisFileSummary;
  items: StateHmisItem[];
  valuesByDistrict: Record<string, Record<string, number | null>>;
  invalidByDistrict: Record<string, string[]>;
}

const CODE_SHORTS: Record<string, string> = {
  "9.1.2": "BCG",
  "9.1.3": "Penta1",
  "9.1.4": "Penta2",
  "9.1.5": "Penta3",
  "9.1.6": "OPV0",
  "9.1.7": "OPV1",
  "9.1.8": "OPV2",
  "9.1.9": "OPV3",
  "9.1.10": "HepB0",
  "9.1.11": "IPV1",
  "9.1.12": "IPV2",
  "9.1.13": "RVV1",
  "9.1.14": "RVV2",
  "9.1.15": "RVV3",
  "9.1.16": "PCV1",
  "9.1.17": "PCV2",
  "9.2.1": "IPV3",
  "9.2.2": "MR1",
  "9.2.3": "JE1",
  "9.2.4": "PCV Booster",
  "9.4.1": "MR2",
  "9.4.2": "DPT 1st Booster",
  "9.7.1": "Sessions Planned",
  "9.7.2": "Sessions Held",
  "9.6.3": "AEFI Serious",
  "9.6.3.a": "AEFI Deaths",
};

function cellValue(sheet: XLSX.WorkSheet, col: number, row = 0): unknown {
  return sheet[XLSX.utils.encode_cell({ r: row, c: col })]?.v;
}

export function normalizeStateHmisCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\//g, ".")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "");
}

function itemShort(code: string, name: string): string {
  const mapped = CODE_SHORTS[code];
  if (mapped) return mapped;
  const compact = normalizeLooseText(name).replace(/[^a-z0-9]+/g, "");
  if (compact.includes("fullyimmunized") && compact.includes("male")) return "FIC-M";
  if (compact.includes("fullyimmunized") && compact.includes("female")) return "FIC-F";
  return code;
}

function parseStateAndMonth(title: string, footerPeriod: string): {
  stateName: string;
  month: string;
} {
  const stateMatch = title.match(/\bof\s+(.+?)\s+State\b/i);
  const stateName = stateMatch?.[1]?.trim() ?? "";
  const periodText = footerPeriod || title;
  const periodMatch = periodText.match(/(?:From\s+)?([A-Za-z]{3,9}-\d{4})\s+To\s+([A-Za-z]{3,9}-\d{4})/i);
  if (!stateName) throw new Error("Could not identify the state from the HMIS report title.");
  if (!periodMatch) throw new Error("Could not identify the reporting month from the HMIS report.");
  const start = monthKey(periodMatch[1]);
  const end = monthKey(periodMatch[2]);
  if (!start || !end) throw new Error("The selected reporting period is not readable.");
  if (start !== end) {
    throw new Error(
      `This module requires one month per file, but the report covers ${periodMatch[1]} to ${periodMatch[2]}.`,
    );
  }
  return { stateName, month: start };
}

function parseCount(raw: unknown): { value: number | null; invalid: boolean } {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { value: null, invalid: false };
  }
  const cleaned = String(raw).replace(/,/g, "").trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(cleaned)) return { value: null, invalid: true };
  const value = Number(cleaned);
  return { value, invalid: !Number.isFinite(value) || value < 0 || !Number.isInteger(value) };
}

export async function parseStateHmisFile(file: File): Promise<ParsedStateFile[]> {
  if (!/\.xlsx?$/i.test(file.name)) {
    throw new Error(`${file.name}: only .xls and .xlsx state HMIS reports are supported.`);
  }
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    raw: true,
    cellText: false,
  });
  if (!workbook.SheetNames.length) throw new Error(`${file.name}: workbook has no readable worksheet.`);

  // A workbook may hold one report per sheet (one month each). Parse every sheet
  // that carries the Across Districts title; each may be the horizontal (single-row)
  // export or the vertical grid template.
  const entries: { sheetName: string; parsed: ParsedStateFile }[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const title = String(cellValue(sheet, 0) ?? "").replace(/\s+/g, " ").trim();
    if (!/Monthly Data Item Wise Report Across Districts/i.test(title)) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
    const parsed =
      range.e.r === 0
        ? parseHorizontalSheet(sheet, range, title, file.name)
        : parseVerticalSheet(sheet, range, title, file.name);
    entries.push({ sheetName, parsed });
  }
  if (!entries.length) {
    throw new Error(`${file.name}: report type is not Monthly Data Item Wise Report Across Districts.`);
  }
  if (entries.length > 1) {
    for (const entry of entries) {
      entry.parsed.summary.fileName = `${file.name} [${entry.sheetName}]`;
    }
  }
  return entries.map((entry) => entry.parsed);
}

function parseHorizontalSheet(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  title: string,
  fileName: string,
): ParsedStateFile {
  let footerPeriod = "";
  for (let col = range.s.c; col <= range.e.c; col += 1) {
    if (normalizeLooseText(String(cellValue(sheet, col) ?? "")) === "selected period :") {
      footerPeriod = String(cellValue(sheet, col + 1) ?? "").trim();
      break;
    }
  }
  const { stateName, month } = parseStateAndMonth(title, footerPeriod);

  const categoryCol = Array.from({ length: range.e.c + 1 }, (_, col) => col).find((col) =>
    /^M\d+\b/i.test(String(cellValue(sheet, col) ?? "").trim()),
  );
  if (categoryCol === undefined) throw new Error(`${fileName}: no HMIS category blocks were found.`);

  const merges = sheet["!merges"] ?? [];
  const stateHeaderCol = Array.from({ length: categoryCol }, (_, col) => col).find(
    (col) => normalizeLooseText(String(cellValue(sheet, col) ?? "")) === normalizeLooseText(stateName),
  );
  if (stateHeaderCol === undefined) {
    throw new Error(`${fileName}: the state district-header group could not be identified.`);
  }
  const stateMerge = merges.find((merge) => merge.s.r === 0 && merge.s.c === stateHeaderCol);
  if (!stateMerge) throw new Error(`${fileName}: the merged state district header is missing.`);
  const districts: string[] = [];
  for (let col = stateMerge.e.c + 1; col < categoryCol; col += 1) {
    const value = String(cellValue(sheet, col) ?? "").trim();
    if (value) districts.push(value);
  }
  if (districts.length === 0) throw new Error(`${fileName}: no district columns were found.`);

  const mergeByStart = new Map(merges.map((merge) => [merge.s.c, merge]));
  const items: StateHmisItem[] = [];
  const valuesByDistrict: Record<string, Record<string, number | null>> = Object.fromEntries(
    districts.map((district) => [district, {}]),
  );
  const invalidByDistrict: Record<string, string[]> = Object.fromEntries(
    districts.map((district) => [district, []]),
  );
  let category = "";

  for (const nameMerge of merges) {
    if (nameMerge.s.r !== 0 || nameMerge.e.r !== 0 || nameMerge.e.c - nameMerge.s.c + 1 !== 5) continue;
    const subItemMerge = mergeByStart.get(nameMerge.e.c + 1);
    if (!subItemMerge || subItemMerge.e.c - subItemMerge.s.c + 1 !== 2) continue;
    const codeCol = nameMerge.s.c - 1;
    const possibleCategory = String(cellValue(sheet, codeCol - 1) ?? "").trim();
    if (/^M\d+\b/i.test(possibleCategory)) category = possibleCategory;
    const code = normalizeStateHmisCode(cellValue(sheet, codeCol));
    const name = String(cellValue(sheet, nameMerge.s.c) ?? "").replace(/\s+/g, " ").trim();
    if (!code || !name || !category) continue;
    const item: StateHmisItem = { code, name, category, short: itemShort(code, name) };
    items.push(item);
    const valuesStart = subItemMerge.e.c + 1;
    districts.forEach((district, index) => {
      const parsed = parseCount(cellValue(sheet, valuesStart + index));
      valuesByDistrict[district][code] = parsed.value;
      if (parsed.invalid) invalidByDistrict[district].push(code);
    });
  }
  if (!items.some((item) => /^M9\b/i.test(item.category))) {
    throw new Error(`${fileName}: no M9 Child Immunisation data items were found.`);
  }

  const summary: StateHmisFileSummary = {
    fileName,
    stateName,
    month,
    districtCount: districts.length,
    itemCount: items.length,
    m2ItemCount: items.filter((item) => /^M2\b/i.test(item.category)).length,
    m9ItemCount: items.filter((item) => /^M9\b/i.test(item.category)).length,
    districts,
    itemCodes: items.map((item) => item.code),
  };
  return { summary, items, valuesByDistrict, invalidByDistrict };
}

// Vertical grid template: header rows Category / Data Item Code / Data Item Name /
// Sub Data Item, a merged state group header spanning the value columns, optional
// grouping rows (e.g. Circles), then the district row directly above the first
// category block. Data rows follow one item per row; a footer "Selected Parameter"
// block closes the sheet.
function parseVerticalSheet(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  title: string,
  fileName: string,
): ParsedStateFile {
  let footerPeriod = "";
  outer: for (let row = range.e.r; row >= 0; row -= 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      if (normalizeLooseText(String(cellValue(sheet, col, row) ?? "")) === "selected period :") {
        footerPeriod = String(cellValue(sheet, col + 1, row) ?? "").trim();
        break outer;
      }
    }
  }
  const { stateName, month } = parseStateAndMonth(title, footerPeriod);

  let headerRow = -1;
  for (let row = 0; row <= range.e.r; row += 1) {
    if (normalizeLooseText(String(cellValue(sheet, 0, row) ?? "")) === "category") {
      headerRow = row;
      break;
    }
  }
  if (headerRow < 0) throw new Error(`${fileName}: the Category header row could not be found.`);

  let stateCol = -1;
  for (let col = 1; col <= range.e.c; col += 1) {
    if (
      normalizeLooseText(String(cellValue(sheet, col, headerRow) ?? "")) ===
      normalizeLooseText(stateName)
    ) {
      stateCol = col;
      break;
    }
  }
  if (stateCol < 0) {
    throw new Error(`${fileName}: the state district-header group could not be identified.`);
  }
  const merges = sheet["!merges"] ?? [];
  const stateMerge = merges.find((merge) => merge.s.r === headerRow && merge.s.c === stateCol);
  const lastValueCol = stateMerge ? stateMerge.e.c : range.e.c;

  let dataStart = -1;
  for (let row = headerRow + 1; row <= range.e.r; row += 1) {
    if (/^M\d+\b/i.test(String(cellValue(sheet, 0, row) ?? "").trim())) {
      dataStart = row;
      break;
    }
  }
  if (dataStart < 0) throw new Error(`${fileName}: no HMIS category blocks were found.`);
  const districtRow = dataStart - 1;
  if (districtRow <= headerRow) throw new Error(`${fileName}: no district columns were found.`);

  const districtCols: { name: string; col: number }[] = [];
  for (let col = stateCol; col <= lastValueCol; col += 1) {
    const value = String(cellValue(sheet, col, districtRow) ?? "").trim();
    if (value) districtCols.push({ name: value, col });
  }
  if (districtCols.length === 0) throw new Error(`${fileName}: no district columns were found.`);

  const districts = districtCols.map((entry) => entry.name);
  const items: StateHmisItem[] = [];
  const valuesByDistrict: Record<string, Record<string, number | null>> = Object.fromEntries(
    districts.map((district) => [district, {}]),
  );
  const invalidByDistrict: Record<string, string[]> = Object.fromEntries(
    districts.map((district) => [district, []]),
  );
  let category = "";

  for (let row = dataStart; row <= range.e.r; row += 1) {
    const categoryRaw = String(cellValue(sheet, 0, row) ?? "").trim();
    if (normalizeLooseText(categoryRaw).startsWith("selected parameter")) break;
    if (/^M\d+\b/i.test(categoryRaw)) category = categoryRaw;
    const code = normalizeStateHmisCode(cellValue(sheet, 1, row));
    const name = String(cellValue(sheet, 2, row) ?? "").replace(/\s+/g, " ").trim();
    if (!categoryRaw && !code && !name) break;
    if (!/^\d/.test(code) || !name || !category) continue;
    items.push({ code, name, category, short: itemShort(code, name) });
    for (const { name: district, col } of districtCols) {
      const parsed = parseCount(cellValue(sheet, col, row));
      valuesByDistrict[district][code] = parsed.value;
      if (parsed.invalid) invalidByDistrict[district].push(code);
    }
  }
  if (!items.some((item) => /^M9\b/i.test(item.category))) {
    throw new Error(`${fileName}: no M9 Child Immunisation data items were found.`);
  }

  const summary: StateHmisFileSummary = {
    fileName,
    stateName,
    month,
    districtCount: districts.length,
    itemCount: items.length,
    m2ItemCount: items.filter((item) => /^M2\b/i.test(item.category)).length,
    m9ItemCount: items.filter((item) => /^M9\b/i.test(item.category)).length,
    districts,
    itemCodes: items.map((item) => item.code),
  };
  return { summary, items, valuesByDistrict, invalidByDistrict };
}

function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const result: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m += 1) {
    if (m === 13) { y += 1; m = 1; }
    result.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return result;
}

export async function parseStateHmisFiles(files: File[]): Promise<StateHmisParsed> {
  if (files.length < 1 || files.length > 12) throw new Error("Upload between 1 and 12 monthly files.");
  const parsedFiles = (await Promise.all(files.map(parseStateHmisFile))).flat();
  if (parsedFiles.length > 12) {
    throw new Error("The uploaded workbooks contain more than 12 monthly reports.");
  }
  parsedFiles.sort((a, b) => a.summary.month.localeCompare(b.summary.month));
  const stateName = parsedFiles[0].summary.stateName;
  if (parsedFiles.some((entry) => normalizeLooseText(entry.summary.stateName) !== normalizeLooseText(stateName))) {
    throw new Error("All uploaded state HMIS files must belong to the same state.");
  }
  const duplicateMonth = parsedFiles.find(
    (entry, index) => parsedFiles.findIndex((candidate) => candidate.summary.month === entry.summary.month) !== index,
  );
  if (duplicateMonth) throw new Error(`Duplicate reporting month: ${duplicateMonth.summary.month}.`);

  const validationIssues: StateHmisValidationIssue[] = [];
  const districts = [...new Set(parsedFiles.flatMap((entry) => entry.summary.districts))].sort((a, b) => a.localeCompare(b));
  const items: Record<string, StateHmisItem> = {};
  const orderedItemCodes: string[] = [];
  for (const entry of parsedFiles) {
    for (const item of entry.items) {
      if (!items[item.code]) orderedItemCodes.push(item.code);
      items[item.code] = items[item.code] ?? item;
    }
  }
  const allItemCodes = new Set(orderedItemCodes);
  for (const entry of parsedFiles) {
    const districtSet = new Set(entry.summary.districts);
    const missingDistricts = districts.filter((district) => !districtSet.has(district));
    if (missingDistricts.length) validationIssues.push({
      severity: "warning",
      code: "MISSING_DISTRICTS",
      fileName: entry.summary.fileName,
      message: `${missingDistricts.length} district(s) missing in ${entry.summary.month}: ${missingDistricts.join(", ")}.`,
    });
    const codeSet = new Set(entry.summary.itemCodes);
    const missingCodes = [...allItemCodes].filter((code) => !codeSet.has(code));
    if (missingCodes.length) validationIssues.push({
      severity: "warning",
      code: "MISSING_ITEMS",
      fileName: entry.summary.fileName,
      message: `${missingCodes.length} data item(s) are absent in ${entry.summary.month}.`,
    });
  }
  const uploadedMonths = parsedFiles.map((entry) => entry.summary.month);
  const expectedMonths = monthsBetween(uploadedMonths[0], uploadedMonths[uploadedMonths.length - 1]);
  const missingMonths = expectedMonths.filter((month) => !uploadedMonths.includes(month));
  if (missingMonths.length) validationIssues.push({
    severity: "warning",
    code: "MISSING_MONTHS",
    message: `The uploaded period has missing month(s): ${missingMonths.join(", ")}.`,
  });

  const districtData: Record<string, StateHmisDistrictRecord> = Object.fromEntries(
    districts.map((district) => [district, { district, months: {} }]),
  );
  for (const entry of parsedFiles) {
    for (const district of entry.summary.districts) {
      const monthRecord: StateHmisMonthRecord = {
        month: entry.summary.month,
        values: entry.valuesByDistrict[district],
        invalidCodes: entry.invalidByDistrict[district],
        sourceFile: entry.summary.fileName,
      };
      districtData[district].months[entry.summary.month] = monthRecord;
    }
  }
  return {
    portal: "HMIS_STATE",
    stateName,
    fileNames: parsedFiles.map((entry) => entry.summary.fileName),
    districts,
    months: Object.fromEntries(uploadedMonths.map((month) => [month, monthShortLabel(month)])),
    items,
    orderedItemCodes,
    districtData,
    fileSummaries: parsedFiles.map((entry) => entry.summary),
    validationIssues,
  };
}

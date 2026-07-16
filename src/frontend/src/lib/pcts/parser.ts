import * as XLSX from "xlsx";
import {
  monthKey,
  monthYearLabel,
  normalizeLooseText,
  safeKey,
} from "../dqa/parseUtils";
import {
  PCTS_INDICATORS,
  type PctsFileParseResult,
  type PctsFileSummary,
  type PctsFacilityRecord,
  type PctsIndicator,
  type PctsMonthRecord,
  type PctsOwnership,
  type PctsParsed,
  type PctsParseOptions,
  type PctsRuralUrban,
  type PctsTotalKind,
  type PctsTotalRecord,
  type PctsValidationIssue,
} from "./types";

type SheetRow = unknown[];

interface CountResult {
  value: number | null;
  invalid: boolean;
  raw: string;
}

const STANDARD_STATE = "Rajasthan";
const URBAN_UNITS = "Urban Units";

const FACILITY_TYPES: Record<string, string> = {
  chcs: "CHC",
  phcs: "PHC",
  subdivisionhospitals: "Subdivision Hospital",
  privatehospitals: "Private Hospital",
  jantaclinics: "Janta Clinic",
  districthospitals: "District Hospital",
  esis: "ESI",
  satellitehospitals: "Satellite Hospital",
  medicalhospitals: "Medical Hospital",
  othergovernmenthospitals: "Other Government Hospital",
};

function displayText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: unknown): string {
  return normalizeLooseText(displayText(value)).replace(/[^a-z0-9]+/g, "");
}

function normalizedIdentity(value: string): string {
  return normalizeLooseText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

export function makePctsFacilityKey(block: string, facility: string): string {
  return `${normalizedIdentity(block)}||${normalizedIdentity(facility)}`;
}

function validationError(
  code: string,
  message: string,
  fileName?: string,
): PctsValidationError {
  return new PctsValidationError(message, [{ severity: "error", code, message, fileName }]);
}

export class PctsValidationError extends Error {
  readonly issues: PctsValidationIssue[];

  constructor(message: string, issues: PctsValidationIssue[]) {
    super(message);
    this.name = "PctsValidationError";
    this.issues = issues;
  }
}

function parseCount(raw: unknown): CountResult {
  if (raw === null || raw === undefined || displayText(raw) === "") {
    return { value: null, invalid: false, raw: "" };
  }
  if (typeof raw === "boolean") {
    return { value: null, invalid: true, raw: String(raw) };
  }
  const text = displayText(raw).replace(/,/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    return { value: null, invalid: true, raw: displayText(raw) };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return { value: null, invalid: true, raw: displayText(raw) };
  }
  return { value, invalid: false, raw: displayText(raw) };
}

function findHeaderRow(rows: SheetRow[]): number {
  return rows.findIndex(
    (row) => compact(row[0]) === "sno" && compact(row[1]) === "locations",
  );
}

function nonEmptyLastIndex(...rows: SheetRow[]): number {
  let last = -1;
  rows.forEach((row) => row.forEach((value, index) => {
    if (displayText(value)) last = Math.max(last, index);
  }));
  return last;
}

function describeHeaders(topRow: SheetRow, doseRow: SheetRow): { column: number; header: string }[] {
  const endColumn = nonEmptyLastIndex(topRow, doseRow);
  const result: { column: number; header: string }[] = [];
  let group = "";
  for (let column = 2; column <= endColumn; column += 1) {
    const top = displayText(topRow[column]);
    if (top) group = top;
    const dose = displayText(doseRow[column]);
    const header = [group, dose].filter(Boolean).join(" ");
    if (header) result.push({ column, header });
  }
  return result;
}

function parseIndicators(
  topRow: SheetRow,
  doseRow: SheetRow,
  fileName: string,
): { indicators: PctsIndicator[]; issues: PctsValidationIssue[] } {
  const descriptors = describeHeaders(topRow, doseRow);
  if (descriptors.length === 0 || !doseRow.some((value, index) => index >= 2 && displayText(value))) {
    throw validationError(
      "MISSING_INDICATOR_HEADER",
      `${fileName}: the two-row PCTS indicator header is missing or unreadable.`,
      fileName,
    );
  }
  const expected = new Map(PCTS_INDICATORS.map((indicator) => [compact(indicator.sourceHeader), indicator]));
  const usedIds = new Set<string>();
  const indicators: PctsIndicator[] = [];
  const issues: PctsValidationIssue[] = [];
  for (const descriptor of descriptors) {
    const standard = expected.get(compact(descriptor.header));
    if (standard && !usedIds.has(standard.id)) {
      indicators.push({ ...standard, sourceColumn: descriptor.column, sourceHeader: descriptor.header });
      usedIds.add(standard.id);
      continue;
    }
    let id = `extra_${safeKey(descriptor.header)}`;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `extra_${safeKey(descriptor.header)}_${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    indicators.push({
      id,
      label: descriptor.header,
      family: "Other",
      sourceColumn: descriptor.column,
      sourceHeader: descriptor.header,
    });
    issues.push({
      severity: "warning",
      code: "UNEXPECTED_INDICATOR",
      message: `${fileName}: unexpected indicator column “${descriptor.header}” was retained.`,
      fileName,
      indicator: id,
    });
  }
  const missing = PCTS_INDICATORS.filter((indicator) => !usedIds.has(indicator.id));
  if (missing.length > 0) {
    issues.push({
      severity: "warning",
      code: "MISSING_INDICATORS",
      message: `${fileName}: ${missing.length} expected indicator(s) are absent: ${missing.map((item) => item.label).join(", ")}.`,
      fileName,
    });
  }
  const essential = ["bcg", "penta1", "penta3", "opv1", "opv3", "mr1", "mr2", "fullyImmunized"];
  const missingEssential = essential.filter((id) => !usedIds.has(id));
  if (missingEssential.length > 0) {
    throw validationError(
      "INVALID_PCTS_SCHEMA",
      `${fileName}: essential PCTS indicators are missing (${missingEssential.join(", ")}).`,
      fileName,
    );
  }
  return { indicators: indicators.sort((a, b) => a.sourceColumn - b.sourceColumn), issues };
}

function readMetadata(
  rows: SheetRow[],
  headerRow: number,
  fileName: string,
): { stateName: string; districtName: string; month: string; generatedAt: string | null } {
  const textCells = rows
    .slice(0, headerRow)
    .flatMap((row) => row.map(displayText))
    .filter(Boolean);
  const governmentSignature = textCells.find((value) => /govt\.?\s+of\s+rajasthan/i.test(value));
  const reportSignature = textCells.find((value) => /report\s+of\s+immuni[sz]ation\s+coverage/i.test(value));
  if (!governmentSignature || !reportSignature) {
    throw validationError(
      "NOT_RAJASTHAN_PCTS",
      `${fileName}: this is not the Rajasthan PCTS Immunization Coverage report.`,
      fileName,
    );
  }
  const districtCell = textCells.find((value) => /^district\s*:/i.test(value));
  const monthCell = textCells.find((value) => /^month\s*:/i.test(value));
  const districtName = districtCell?.replace(/^district\s*:\s*/i, "").trim() ?? "";
  const rawMonth = monthCell?.replace(/^month\s*:\s*/i, "").trim() ?? "";
  const month = monthKey(rawMonth);
  if (!districtName) {
    throw validationError("MISSING_DISTRICT", `${fileName}: the district name is missing.`, fileName);
  }
  if (!month) {
    throw validationError(
      "MISSING_REPORTING_MONTH",
      `${fileName}: the reporting month inside the workbook is missing or unreadable.`,
      fileName,
    );
  }
  const status = textCells.find((value) => /^status\s+as\s+on\b/i.test(value));
  return {
    stateName: STANDARD_STATE,
    districtName,
    month,
    generatedAt: status?.replace(/^status\s+as\s+on\s*/i, "").trim() || null,
  };
}

function valuesFromRow(
  row: SheetRow,
  indicators: PctsIndicator[],
): { values: Record<string, number | null>; invalidIndicators: string[]; rawInvalidValues: Record<string, string> } {
  const values: Record<string, number | null> = {};
  const invalidIndicators: string[] = [];
  const rawInvalidValues: Record<string, string> = {};
  for (const indicator of indicators) {
    const parsed = parseCount(row[indicator.sourceColumn]);
    values[indicator.id] = parsed.value;
    if (parsed.invalid) {
      invalidIndicators.push(indicator.id);
      rawInvalidValues[indicator.id] = parsed.raw;
    }
  }
  return { values, invalidIndicators, rawInvalidValues };
}

function totalKind(label: string): PctsTotalKind | null {
  const normalized = normalizeLooseText(label);
  if (normalized === "rural total") return "rural";
  if (normalized === "urban total") return "urban";
  if (normalized === "urban units total") return "urban_units";
  if (normalized === "district total") return "district";
  if (/^block\s*:.+\s+total$/i.test(label)) return "block";
  return null;
}

function blockFromTotal(label: string, currentBlock: string): string | null {
  const kind = totalKind(label);
  if (kind === "district") return null;
  if (kind === "urban_units") return URBAN_UNITS;
  if (kind === "block") return label.replace(/^block\s*:\s*/i, "").replace(/\s+total\s*$/i, "").trim();
  return currentBlock || null;
}

function addInvalidCountIssues(
  issues: PctsValidationIssue[],
  invalidIndicators: string[],
  rawInvalidValues: Record<string, string>,
  context: Omit<PctsValidationIssue, "severity" | "code" | "message" | "indicator" | "actual">,
  indicatorById: Map<string, PctsIndicator>,
): void {
  for (const indicatorId of invalidIndicators) {
    const label = indicatorById.get(indicatorId)?.label ?? indicatorId;
    issues.push({
      severity: "warning",
      code: "INVALID_COUNT",
      message: `${context.fileName ?? "PCTS file"}: ${label} has a negative, decimal, boolean, or malformed count${context.facility ? ` for ${context.facility}` : ""}.`,
      ...context,
      indicator: indicatorId,
      actual: rawInvalidValues[indicatorId],
    });
  }
}

function expectedFacilitiesForTotal(
  total: PctsTotalRecord,
  facilities: PctsFacilityRecord[],
): PctsFacilityRecord[] {
  if (total.kind === "district") return facilities;
  if (total.kind === "urban_units") return facilities.filter((facility) => facility.block === URBAN_UNITS);
  if (total.kind === "block") return facilities.filter((facility) => facility.block === total.block);
  if (total.kind === "rural") {
    return facilities.filter((facility) => facility.block === total.block && facility.ruralUrban === "Rural");
  }
  return facilities.filter((facility) => facility.block === total.block && facility.ruralUrban === "Urban");
}

function reconcileTotals(
  facilities: PctsFacilityRecord[],
  totals: PctsTotalRecord[],
  indicators: PctsIndicator[],
  month: string,
  fileName: string,
): PctsValidationIssue[] {
  const issues: PctsValidationIssue[] = [];
  for (const total of totals) {
    const scope = expectedFacilitiesForTotal(total, facilities);
    for (const indicator of indicators) {
      const reported = total.values[indicator.id];
      const sourceValues = scope.map((facility) => facility.months[month]?.values[indicator.id]);
      if (reported === null || sourceValues.some((value) => value === null || value === undefined)) continue;
      const expected = sourceValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      if (expected !== reported) {
        issues.push({
          severity: "warning",
          code: "TOTAL_MISMATCH",
          message: `${fileName}: ${total.label} does not match the facility sum for ${indicator.label} (${reported} reported; ${expected} calculated).`,
          fileName,
          month,
          block: total.block ?? undefined,
          indicator: indicator.id,
          sourceRow: total.sourceRow,
          expected,
          actual: reported,
        });
      }
    }
  }
  const blocks = [...new Set(facilities.map((facility) => facility.block))];
  const hasTotal = (kind: PctsTotalKind, block: string | null) => totals.some(
    (total) => total.kind === kind && total.block === block,
  );
  for (const block of blocks.filter((name) => name !== URBAN_UNITS)) {
    const blockFacilities = facilities.filter((facility) => facility.block === block);
    const expectedKinds: PctsTotalKind[] = ["block"];
    if (blockFacilities.some((facility) => facility.ruralUrban === "Rural")) expectedKinds.push("rural");
    if (blockFacilities.some((facility) => facility.ruralUrban === "Urban")) expectedKinds.push("urban");
    for (const kind of expectedKinds) {
      if (!hasTotal(kind, block)) issues.push({
        severity: "warning",
        code: "MISSING_TOTAL_ROW",
        message: `${fileName}: ${kind} total row is missing for ${block}.`,
        fileName,
        month,
        block,
      });
    }
  }
  if (blocks.includes(URBAN_UNITS) && !hasTotal("urban_units", URBAN_UNITS)) issues.push({
    severity: "warning",
    code: "MISSING_TOTAL_ROW",
    message: `${fileName}: Urban Units Total row is missing.`,
    fileName,
    month,
    block: URBAN_UNITS,
  });
  if (!hasTotal("district", null)) issues.push({
    severity: "warning",
    code: "MISSING_TOTAL_ROW",
    message: `${fileName}: District Total row is missing.`,
    fileName,
    month,
  });
  return issues;
}

function parseSheetRows(
  rows: SheetRow[],
  sheetName: string,
  fileName: string,
): PctsFileParseResult {
  const headerRow = findHeaderRow(rows);
  if (headerRow < 0 || !rows[headerRow + 1]) {
    throw validationError(
      "MISSING_INDICATOR_HEADER",
      `${fileName}: could not find the PCTS S.No / Locations two-row header.`,
      fileName,
    );
  }
  const metadata = readMetadata(rows, headerRow, fileName);
  const parsedHeader = parseIndicators(rows[headerRow], rows[headerRow + 1], fileName);
  const indicators = parsedHeader.indicators;
  const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  const facilities: PctsFacilityRecord[] = [];
  const totals: PctsTotalRecord[] = [];
  const issues: PctsValidationIssue[] = [...parsedHeader.issues];
  let currentBlock = "";
  let currentRuralUrban: PctsRuralUrban | null = null;
  let currentFacilityType = "";

  for (let rowIndex = headerRow + 2; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const first = row[0];
    const firstText = displayText(first);
    const secondText = displayText(row[1]);
    if (!firstText && !secondText) continue;

    const suppliedTotalKind = totalKind(firstText);
    if (suppliedTotalKind) {
      const parsedValues = valuesFromRow(row, indicators);
      const block = blockFromTotal(firstText, currentBlock);
      const total: PctsTotalRecord = {
        key: `${metadata.month}||${suppliedTotalKind}||${normalizedIdentity(block ?? "district")}`,
        kind: suppliedTotalKind,
        label: firstText,
        block,
        ruralUrban: suppliedTotalKind === "rural" ? "Rural" : suppliedTotalKind === "urban" || suppliedTotalKind === "urban_units" ? "Urban" : null,
        month: metadata.month,
        ...parsedValues,
        sourceFile: fileName,
        sourceRow: rowIndex + 1,
      };
      totals.push(total);
      addInvalidCountIssues(issues, total.invalidIndicators, total.rawInvalidValues, {
        fileName,
        month: metadata.month,
        block: block ?? undefined,
        sourceRow: rowIndex + 1,
      }, indicatorById);
      continue;
    }

    const blockMatch = firstText.match(/^block\s*:\s*(.+)$/i);
    if (blockMatch) {
      currentBlock = blockMatch[1].trim();
      currentRuralUrban = null;
      currentFacilityType = "";
      continue;
    }
    if (normalizeLooseText(firstText) === normalizeLooseText(URBAN_UNITS)) {
      currentBlock = URBAN_UNITS;
      currentRuralUrban = "Urban";
      currentFacilityType = "";
      continue;
    }
    if (normalizeLooseText(firstText) === "rural" || normalizeLooseText(firstText) === "urban") {
      currentRuralUrban = normalizeLooseText(firstText) === "rural" ? "Rural" : "Urban";
      currentFacilityType = "";
      continue;
    }
    const sectionType = FACILITY_TYPES[compact(firstText)];
    if (sectionType) {
      currentFacilityType = sectionType;
      continue;
    }

    const serial = parseCount(first);
    const isFacilityRow = serial.value !== null && Number.isInteger(serial.value) && Boolean(secondText);
    if (!isFacilityRow) continue;
    if (!currentBlock || !currentRuralUrban || !currentFacilityType) {
      throw validationError(
        "BROKEN_FACILITY_HIERARCHY",
        `${fileName}: facility “${secondText}” at row ${rowIndex + 1} has no readable block, rural/urban section, or facility type.`,
        fileName,
      );
    }
    const key = makePctsFacilityKey(currentBlock, secondText);
    if (facilities.some((facility) => facility.key === key)) {
      throw validationError(
        "DUPLICATE_FACILITY",
        `${fileName}: duplicate facility “${secondText}” in ${currentBlock}.`,
        fileName,
      );
    }
    const parsedValues = valuesFromRow(row, indicators);
    const ownership: PctsOwnership = currentFacilityType === "Private Hospital" ? "Private" : "Public";
    const monthRecord: PctsMonthRecord = {
      month: metadata.month,
      ...parsedValues,
      sourceFile: fileName,
      sourceRow: rowIndex + 1,
    };
    facilities.push({
      key,
      serialNumber: serial.value,
      block: currentBlock,
      facility: secondText,
      ruralUrban: currentRuralUrban,
      ownership,
      facilityType: currentFacilityType,
      months: { [metadata.month]: monthRecord },
    });
    addInvalidCountIssues(issues, monthRecord.invalidIndicators, monthRecord.rawInvalidValues, {
      fileName,
      month: metadata.month,
      block: currentBlock,
      facility: secondText,
      sourceRow: rowIndex + 1,
    }, indicatorById);
  }

  if (facilities.length === 0) {
    throw validationError(
      "NO_FACILITIES",
      `${fileName}: no valid facility rows were found in the PCTS report.`,
      fileName,
    );
  }
  issues.push(...reconcileTotals(facilities, totals, indicators, metadata.month, fileName));
  const blocks = [...new Set(facilities.map((facility) => facility.block))];
  const facilityTypes = [...new Set(facilities.map((facility) => facility.facilityType))].sort((a, b) => a.localeCompare(b));
  const schemaFingerprint = indicators
    .map((indicator) => `${indicator.id}:${compact(indicator.sourceHeader)}`)
    .join("|");
  const summary: PctsFileSummary = {
    fileName,
    sheetName,
    ...metadata,
    monthLabel: monthYearLabel(metadata.month),
    blockCount: blocks.length,
    facilityCount: facilities.length,
    ruralCount: facilities.filter((facility) => facility.ruralUrban === "Rural").length,
    urbanCount: facilities.filter((facility) => facility.ruralUrban === "Urban").length,
    publicCount: facilities.filter((facility) => facility.ownership === "Public").length,
    privateCount: facilities.filter((facility) => facility.ownership === "Private").length,
    facilityTypes,
    indicatorCount: indicators.length,
    indicatorIds: indicators.map((indicator) => indicator.id),
    schemaFingerprint,
    reconciliationIssueCount: issues.filter((issue) => issue.code === "TOTAL_MISMATCH" || issue.code === "MISSING_TOTAL_ROW").length,
  };
  return { summary, indicators, facilities, totals, validationIssues: issues };
}

export function parsePctsArrayBuffer(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
): PctsFileParseResult {
  const workbook = XLSX.read(input, {
    type: input instanceof Uint8Array ? "array" : "array",
    raw: true,
    cellText: false,
    cellDates: false,
  });
  if (workbook.SheetNames.length === 0) {
    throw validationError("EMPTY_WORKBOOK", `${fileName}: workbook has no readable worksheet.`, fileName);
  }
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    }) as SheetRow[];
    if (findHeaderRow(rows) >= 0) return parseSheetRows(rows, sheetName, fileName);
  }
  throw validationError(
    "MISSING_INDICATOR_HEADER",
    `${fileName}: no worksheet contains the PCTS S.No / Locations two-row header.`,
    fileName,
  );
}

export async function parsePctsFile(file: File): Promise<PctsFileParseResult> {
  if (!/\.xlsx?$/i.test(file.name)) {
    throw validationError(
      "UNSUPPORTED_FILE_TYPE",
      `${file.name}: only .xls and .xlsx PCTS reports are supported.`,
      file.name,
    );
  }
  return parsePctsArrayBuffer(await file.arrayBuffer(), file.name);
}

function monthsBetween(start: string, end: string): string[] {
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);
  const months: string[] = [];
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth); month += 1) {
    if (month === 13) { year += 1; month = 1; }
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

function shortList(values: string[]): string {
  if (values.length <= 8) return values.join(", ");
  return `${values.slice(0, 8).join(", ")} and ${values.length - 8} more`;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function likelyRename(before: string, after: string): boolean {
  const left = normalizedIdentity(before).replace(/\s+/g, "");
  const right = normalizedIdentity(after).replace(/\s+/g, "");
  if (!left || !right || left === right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  return editDistance(left, right) <= Math.max(2, Math.floor(Math.max(left.length, right.length) * 0.15));
}

function rosterIssues(
  entries: PctsFileParseResult[],
): PctsValidationIssue[] {
  if (entries.length < 2) return [];
  const issues: PctsValidationIssue[] = [];
  const baseline = entries[0];
  const baselineByKey = new Map(baseline.facilities.map((facility) => [facility.key, facility]));
  const baselineBySerial = new Map(
    baseline.facilities
      .filter((facility) => facility.serialNumber !== null)
      .map((facility) => [facility.serialNumber as number, facility]),
  );
  for (const entry of entries.slice(1)) {
    const currentByKey = new Map(entry.facilities.map((facility) => [facility.key, facility]));
    const missing = [...baselineByKey.values()].filter((facility) => !currentByKey.has(facility.key));
    const added = entry.facilities.filter((facility) => !baselineByKey.has(facility.key));
    if (missing.length > 0) issues.push({
      severity: "warning",
      code: "FACILITIES_MISSING_FROM_ROSTER",
      message: `${entry.summary.fileName}: ${missing.length} baseline facility/facilities are absent in ${entry.summary.month}: ${shortList(missing.map((facility) => facility.facility))}.`,
      fileName: entry.summary.fileName,
      month: entry.summary.month,
    });
    if (added.length > 0) issues.push({
      severity: "warning",
      code: "FACILITIES_ADDED_TO_ROSTER",
      message: `${entry.summary.fileName}: ${added.length} facility/facilities were added after the baseline month: ${shortList(added.map((facility) => facility.facility))}.`,
      fileName: entry.summary.fileName,
      month: entry.summary.month,
    });

    for (const [key, before] of baselineByKey) {
      const after = currentByKey.get(key);
      if (!after) continue;
      if (after.ruralUrban !== before.ruralUrban) issues.push({
        severity: "warning",
        code: "FACILITY_AREA_CHANGED",
        message: `${entry.summary.fileName}: “${after.facility}” changed from ${before.ruralUrban} to ${after.ruralUrban}.`,
        fileName: entry.summary.fileName,
        month: entry.summary.month,
        block: after.block,
        facility: after.facility,
      });
      if (after.facilityType !== before.facilityType || after.ownership !== before.ownership) issues.push({
        severity: "warning",
        code: "FACILITY_TYPE_CHANGED",
        message: `${entry.summary.fileName}: “${after.facility}” changed from ${before.facilityType}/${before.ownership} to ${after.facilityType}/${after.ownership}.`,
        fileName: entry.summary.fileName,
        month: entry.summary.month,
        block: after.block,
        facility: after.facility,
      });
    }

    const baselineByName = new Map<string, PctsFacilityRecord[]>();
    const currentByName = new Map<string, PctsFacilityRecord[]>();
    for (const item of baseline.facilities) {
      const name = normalizedIdentity(item.facility);
      baselineByName.set(name, [...(baselineByName.get(name) ?? []), item]);
    }
    for (const item of entry.facilities) {
      const name = normalizedIdentity(item.facility);
      currentByName.set(name, [...(currentByName.get(name) ?? []), item]);
    }
    for (const [name, beforeMatches] of baselineByName) {
      const afterMatches = currentByName.get(name) ?? [];
      if (beforeMatches.length !== 1 || afterMatches.length !== 1) continue;
      const before = beforeMatches[0];
      const after = afterMatches[0];
      if (before.key === after.key) continue;
      if (normalizedIdentity(after.block) !== normalizedIdentity(before.block)) issues.push({
        severity: "warning",
        code: "FACILITY_MOVED_BLOCK",
        message: `${entry.summary.fileName}: “${after.facility}” moved from ${before.block} to ${after.block}.`,
        fileName: entry.summary.fileName,
        month: entry.summary.month,
        block: after.block,
        facility: after.facility,
      });
      if (after.ruralUrban !== before.ruralUrban) issues.push({
        severity: "warning",
        code: "FACILITY_AREA_CHANGED",
        message: `${entry.summary.fileName}: “${after.facility}” changed from ${before.ruralUrban} to ${after.ruralUrban}.`,
        fileName: entry.summary.fileName,
        month: entry.summary.month,
        block: after.block,
        facility: after.facility,
      });
    }

    const currentBySerial = new Map(
      entry.facilities
        .filter((facility) => facility.serialNumber !== null)
        .map((facility) => [facility.serialNumber as number, facility]),
    );
    for (const [serial, before] of baselineBySerial) {
      const after = currentBySerial.get(serial);
      if (!after || after.key === before.key) continue;
      if (
        normalizedIdentity(after.block) === normalizedIdentity(before.block)
        && after.ruralUrban === before.ruralUrban
        && after.facilityType === before.facilityType
        && likelyRename(before.facility, after.facility)
      ) issues.push({
        severity: "warning",
        code: "FACILITY_RENAMED",
        message: `${entry.summary.fileName}: serial ${serial} changed from “${before.facility}” to “${after.facility}”.`,
        fileName: entry.summary.fileName,
        month: entry.summary.month,
        facility: after.facility,
      });
    }
  }
  return issues;
}

export async function parsePctsFiles(
  files: File[],
  options: PctsParseOptions = {},
): Promise<PctsParsed> {
  if (files.length < 1 || files.length > 12) {
    throw validationError("INVALID_FILE_COUNT", "Upload between 1 and 12 monthly PCTS files.");
  }
  const entries = await Promise.all(files.map(parsePctsFile));
  entries.sort((a, b) => a.summary.month.localeCompare(b.summary.month));
  const districtName = entries[0].summary.districtName;
  const stateName = entries[0].summary.stateName;
  const expectedState = options.expectedStateName ?? STANDARD_STATE;
  if (normalizeLooseText(stateName) !== normalizeLooseText(expectedState)) {
    throw validationError(
      "WRONG_STATE",
      `PCTS is available only for ${expectedState}; the report is for ${stateName}.`,
    );
  }
  if (entries.some((entry) => normalizeLooseText(entry.summary.districtName) !== normalizeLooseText(districtName))) {
    throw validationError("MIXED_DISTRICTS", "All uploaded PCTS files must belong to the same district.");
  }
  if (options.expectedDistrictName && normalizeLooseText(districtName) !== normalizeLooseText(options.expectedDistrictName)) {
    throw validationError(
      "WRONG_DISTRICT",
      `The uploaded report is for ${districtName}, but your assigned district is ${options.expectedDistrictName}.`,
    );
  }
  const seenMonths = new Set<string>();
  for (const entry of entries) {
    if (seenMonths.has(entry.summary.month)) {
      throw validationError(
        "DUPLICATE_MONTH",
        `Duplicate reporting month: ${monthYearLabel(entry.summary.month)}. Upload only one file per month.`,
        entry.summary.fileName,
      );
    }
    seenMonths.add(entry.summary.month);
  }
  const baselineSchema = entries[0].summary.schemaFingerprint;
  const incompatible = entries.find((entry) => entry.summary.schemaFingerprint !== baselineSchema);
  if (incompatible) {
    throw validationError(
      "INCOMPATIBLE_SCHEMA",
      `${incompatible.summary.fileName}: indicator schema differs from ${entries[0].summary.fileName}. All monthly files must use the same PCTS template.`,
      incompatible.summary.fileName,
    );
  }

  const validationIssues = entries.flatMap((entry) => entry.validationIssues);
  validationIssues.push(...rosterIssues(entries));
  const uploadedMonths = entries.map((entry) => entry.summary.month);
  const expectedMonths = monthsBetween(uploadedMonths[0], uploadedMonths[uploadedMonths.length - 1]);
  const missingMonths = expectedMonths.filter((month) => !seenMonths.has(month));
  if (missingMonths.length > 0) validationIssues.push({
    severity: "warning",
    code: "MISSING_MONTHS",
    message: `The uploaded period has missing month(s): ${missingMonths.map(monthYearLabel).join(", ")}.`,
  });

  const facilities: Record<string, PctsFacilityRecord> = {};
  for (const entry of entries) {
    for (const incoming of entry.facilities) {
      const existing = facilities[incoming.key];
      if (!existing) {
        facilities[incoming.key] = { ...incoming, months: { ...incoming.months } };
      } else {
        existing.months[entry.summary.month] = incoming.months[entry.summary.month];
      }
    }
  }
  const facilityList = Object.values(facilities);
  const blocks = [...new Set(facilityList.map((facility) => facility.block))].sort((a, b) => {
    if (a === URBAN_UNITS) return 1;
    if (b === URBAN_UNITS) return -1;
    return a.localeCompare(b);
  });
  const facilityTypes = [...new Set(facilityList.map((facility) => facility.facilityType))].sort((a, b) => a.localeCompare(b));
  const indicators = entries[0].indicators.map((indicator) => ({ ...indicator }));
  return {
    portal: "PCTS",
    stateName,
    districtName,
    fileNames: entries.map((entry) => entry.summary.fileName),
    months: Object.fromEntries(uploadedMonths.map((month) => [month, monthYearLabel(month)])),
    blocks,
    facilityTypes,
    facilities,
    indicators,
    orderedIndicatorIds: indicators.map((indicator) => indicator.id),
    totalsByMonth: Object.fromEntries(entries.map((entry) => [entry.summary.month, entry.totals])),
    fileSummaries: entries.map((entry) => entry.summary),
    validationIssues,
    globalFacilityCount: facilityList.length,
    globalBlockCount: blocks.length,
    publicCount: facilityList.filter((facility) => facility.ownership === "Public").length,
    privateCount: facilityList.filter((facility) => facility.ownership === "Private").length,
    ruralCount: facilityList.filter((facility) => facility.ruralUrban === "Rural").length,
    urbanCount: facilityList.filter((facility) => facility.ruralUrban === "Urban").length,
  };
}

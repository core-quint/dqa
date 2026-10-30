import { downloadXLS } from "../dqa/exportUtils";
import type { PctsCard, PctsComputed, PctsParsed } from "./types";

type ExportRow = (string | number | null)[];

export function pctsCardRows(
  data: PctsParsed,
  card: PctsCard,
  months: string[],
  facilityKeys: string[] = card.affectedFacilities,
): ExportRow[] {
  const rows: ExportRow[] = [[
    "Block / group",
    "Facility",
    "Facility type",
    "Rural / Urban",
    "Ownership",
    ...months,
    ...(card.basis === "period" ? ["Selected period (decides the flag)"] : []),
    "Flagged months",
  ]];

  const visibleFacilityKeys = new Set(facilityKeys);
  const affectedFacilities = card.affectedFacilities
    .filter((facilityKey) => visibleFacilityKeys.has(facilityKey))
    .sort((left, right) => {
      const a = data.facilities[left];
      const b = data.facilities[right];
      return (a?.block ?? "").localeCompare(b?.block ?? "")
        || (a?.facility ?? "").localeCompare(b?.facility ?? "");
    });

  for (const facilityKey of affectedFacilities) {
    const facility = data.facilities[facilityKey];
    if (!facility) continue;
    const flaggedMonths = months.filter((month) => card.hits[facilityKey]?.[month]?.flag);
    rows.push([
      facility.block,
      facility.facility,
      facility.facilityType,
      facility.ruralUrban,
      facility.ownership,
      ...months.map((month) => card.hits[facilityKey]?.[month]?.detail ?? "Not evaluated"),
      ...(card.basis === "period" ? [card.periodHits?.[facilityKey]?.detail ?? "Not evaluated"] : []),
      flaggedMonths.length,
    ]);
  }
  return rows;
}

export function downloadPctsCard(
  data: PctsParsed,
  card: PctsCard,
  months: string[],
  facilityKeys?: string[],
) {
  downloadXLS(pctsCardRows(data, card, months, facilityKeys), `PCTS - ${card.name}`);
}

export function pctsOverallRows(data: PctsParsed, computed: PctsComputed): ExportRow[] {
  const rows: ExportRow[] = [[
    "State",
    "District",
    "Block / group",
    "Facility",
    "Facility type",
    "Rural / Urban",
    "Ownership",
    "No. of Data Quality Issues identified",
    "Indicators identified",
  ]];
  const facilities = [...computed.visibleFacilityKeys].sort((left, right) => {
    const a = data.facilities[left];
    const b = data.facilities[right];
    return (
      (computed.issueCountByFacility[right] ?? 0) -
        (computed.issueCountByFacility[left] ?? 0) ||
      (a?.block ?? "").localeCompare(b?.block ?? "") ||
      (a?.facility ?? "").localeCompare(b?.facility ?? "")
    );
  });
  for (const facilityKey of facilities) {
    const facility = data.facilities[facilityKey];
    if (!facility) continue;
    rows.push([
      data.stateName,
      data.districtName,
      facility.block,
      facility.facility,
      facility.facilityType,
      facility.ruralUrban,
      facility.ownership,
      computed.issueCountByFacility[facilityKey] ?? 0,
      computed.issueNamesByFacility[facilityKey]?.join(", ") || "None",
    ]);
  }
  return rows;
}

export function downloadPctsOverall(data: PctsParsed, computed: PctsComputed) {
  downloadXLS(
    pctsOverallRows(data, computed),
    `PCTS Overall - ${data.districtName}`,
  );
}

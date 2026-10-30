import { downloadXLS } from "../dqa/exportUtils";
import type { StateHmisCard, StateHmisComputed, StateHmisParsed } from "./types";

export function stateCardRows(data: StateHmisParsed, card: StateHmisCard, months: string[]) {
  const rows: (string | number | null)[][] = [[
    "District",
    ...(data.reportLevel === "block" ? ["Health Block"] : []),
    ...months,
    ...(card.basis === "period" ? ["Selected period (decides the flag)"] : []),
    "Flagged months",
  ]];
  for (const id of Object.keys(card.hits).sort((a, b) => {
    const left = data.unitData[a]; const right = data.unitData[b];
    return (left?.district ?? a).localeCompare(right?.district ?? b) ||
      (left?.block ?? "").localeCompare(right?.block ?? "");
  })) {
    const unit = data.unitData[id];
    const hitMonths = months.filter((month) => card.hits[id]?.[month]?.flag);
    rows.push([
      unit?.district ?? id,
      ...(data.reportLevel === "block" ? [unit?.block ?? ""] : []),
      ...months.map((month) => card.hits[id]?.[month]?.detail ?? "Not evaluated"),
      ...(card.basis === "period" ? [card.periodHits?.[id]?.detail ?? "Not evaluated"] : []),
      hitMonths.length,
    ]);
  }
  return rows;
}

export function downloadStateCard(data: StateHmisParsed, card: StateHmisCard, months: string[]) {
  downloadXLS(stateCardRows(data, card, months), `HMIS State - ${card.name}`);
}

export function downloadStateOverall(data: StateHmisParsed, computed: StateHmisComputed) {
  const rows: (string | number | null)[][] = [[
    "State", "District", ...(data.reportLevel === "block" ? ["Health Block"] : []),
    "DQ issues", "Indicators",
  ]];
  for (const id of computed.selectedUnits) {
    const unit = data.unitData[id];
    rows.push([
      data.stateName,
      unit?.district ?? id,
      ...(data.reportLevel === "block" ? [unit?.block ?? ""] : []),
      computed.issueCountByUnit[id],
      computed.issueNamesByUnit[id].join(", ") || "None",
    ]);
  }
  downloadXLS(rows, `HMIS State Overall - ${data.stateName}`);
}

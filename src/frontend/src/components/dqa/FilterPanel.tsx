import { useEffect, useRef, useState } from "react";
import { ChevronDown, Filter, Plus, X } from "lucide-react";
import type { FilterState, ParsedCSV } from "../../lib/dqa/types";
import type { UwinParsedCSV } from "../../lib/uwin/types";
import { BASE_VAX, ADD_VAX, PAIR_DEFAULTS } from "../../lib/dqa/constants";
import { monthLongLabel } from "../../lib/dqa/parseUtils";

interface Props {
  csv: ParsedCSV;
  filters: FilterState;
  activeGroup: string;
  onApply: (f: FilterState) => void;
  layout?: "inline" | "rail";
}

export const dropdownTriggerClass =
  "group inline-flex min-h-[2.75rem] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/78 px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_12px_28px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:bg-white";

const dropdownPanelClass =
  "absolute left-0 top-full z-[9999] mt-3 min-w-[280px] max-w-[92vw] overflow-hidden rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(248,250,252,0.92))] p-4 shadow-[0_26px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl sm:max-w-[360px]";

export const selectClassName =
  "h-10 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70";

export function Dropdown({
  label,
  children,
  fullWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={[
          dropdownTriggerClass,
          fullWidth ? "w-full justify-between" : "",
        ].join(" ")}
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-slate-950 group-hover:text-white">
          <Filter className="h-3.5 w-3.5" />
        </span>
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className={dropdownPanelClass}>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {label}
          </div>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function CheckAll({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50/80 hover:text-slate-950">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-300"
      />
      <span>{label}</span>
    </label>
  );
}

export function CheckItem({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-2 text-sm text-slate-600 transition hover:bg-slate-50/80 hover:text-slate-950">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-300"
      />
      <span>{label}</span>
    </label>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 first:mt-0">
      {children}
    </div>
  );
}

function PairRow({
  fromValue,
  toValue,
  onChangeFrom,
  onChangeTo,
  onRemove,
}: {
  fromValue: string;
  toValue: string;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-[1fr_1fr_auto]">
      <select
        value={fromValue}
        onChange={(event) => onChangeFrom(event.target.value)}
        className={selectClassName}
      >
        <option value="">Vaccine-1</option>
        {ADD_VAX.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <select
        value={toValue}
        onChange={(event) => onChangeTo(event.target.value)}
        className={selectClassName}
      >
        <option value="">Vaccine-2</option>
        {ADD_VAX.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Blocks present in the dataset, optionally restricted to a district selection.
 * Module-level so it can be used both while rendering and inside effects without
 * becoming an unstable dependency.
 */
function blocksForDistricts(csv: ParsedCSV, restrictTo: string[] | null): string[] {
  return Object.keys(
    Object.values(csv.facilityData).reduce<Record<string, true>>((acc, fd) => {
      const district = (fd as { district?: string }).district;
      if (fd.block && (restrictTo === null || !district || restrictTo.includes(district))) {
        acc[fd.block] = true;
      }
      return acc;
    }, {}),
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * Applied filters use `[]` to mean "everything". The draft the panel edits instead keeps
 * every selection explicit, so "Select All" behaves like a real checkbox that can be
 * unchecked (`[]` then genuinely means "nothing selected"). handleSubmit converts back.
 */
export function normalizeDraft(
  csv: ParsedCSV,
  applied: FilterState,
  districtKeys: string[],
  isStateUwin: boolean,
): FilterState {
  const monthKeys = Object.keys(csv.allMonths).sort();
  const districts = applied.districts?.length ? applied.districts : districtKeys;
  return {
    ...applied,
    months: applied.months.length ? applied.months : monthKeys,
    blocks: applied.blocks.length
      ? applied.blocks
      : blocksForDistricts(csv, isStateUwin ? districts : null),
    ...(districtKeys.length ? { districts } : {}),
  };
}

function AnalysisModeToggle({
  value,
  onChange,
  fullWidth,
}: {
  value: FilterState["analysisMode"];
  onChange: (value: FilterState["analysisMode"]) => void;
  fullWidth?: boolean;
}) {
  const options: { value: FilterState["analysisMode"]; label: string }[] = [
    { value: "facility", label: "Facility-wise" },
    { value: "sessionsite", label: "Session Site-wise" },
  ];
  return (
    <div
      className={[
        "inline-flex items-center gap-1 rounded-2xl border border-slate-200/80 bg-white/78 p-1 shadow-[0_12px_28px_rgba(15,23,42,0.06)]",
        fullWidth ? "w-full" : "",
      ].join(" ")}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "rounded-xl px-3 py-2 text-xs font-semibold transition",
            fullWidth ? "flex-1" : "",
            value === opt.value
              ? "bg-slate-950 text-white"
              : "text-slate-600 hover:bg-slate-100",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function FilterPanel({
  csv,
  filters: initFilters,
  activeGroup,
  onApply,
  layout = "inline",
}: Props) {
  const portal = (csv as unknown as { portal?: string }).portal ?? "HMIS";
  const isUwin = portal === "UWIN" || portal === "UWIN_STATE";
  const isStateUwin = portal === "UWIN_STATE";
  const uwinCsv = isUwin ? (csv as unknown as UwinParsedCSV) : null;
  const showAnalysisModeToggle = isUwin && uwinCsv?.idxSessionSite !== null;
  const allDistricts = uwinCsv?.districts ?? [];

  const [f, setF] = useState<FilterState>(() =>
    normalizeDraft(csv, initFilters, allDistricts, isStateUwin),
  );

  useEffect(() => {
    setF(normalizeDraft(csv, initFilters, uwinCsv?.districts ?? [], isStateUwin));
  }, [initFilters, csv, uwinCsv, isStateUwin]);

  const selectedDistricts = f.districts ?? [];
  const allBlocks = blocksForDistricts(csv, isStateUwin ? selectedDistricts : null);

  const allMonths = Object.keys(csv.allMonths).sort();
  const singleMonth = allMonths.length === 1;

  const toggleSet = (arr: string[], value: string, on: boolean): string[] =>
    on ? [...new Set([...arr, value])] : arr.filter((item) => item !== value);

  const setAll = (keys: string[], on: boolean): string[] => (on ? [...keys] : []);

  const isAllBlocks = allBlocks.length > 0 && f.blocks.length >= allBlocks.length;
  const isAllDistricts =
    allDistricts.length > 0 && (f.districts?.length ?? 0) >= allDistricts.length;
  const isAllMonths = allMonths.length > 0 && f.months.length >= allMonths.length;

  // Nothing selected in a mandatory dimension would mean "no data at all", so
  // block Apply instead of silently falling back to everything.
  const missingSelections: string[] = [];
  if (!singleMonth && f.months.length === 0) missingSelections.push("month");
  if (allBlocks.length > 0 && f.blocks.length === 0) missingSelections.push("block");
  if (isStateUwin && allDistricts.length > 0 && selectedDistricts.length === 0) {
    missingSelections.push("district");
  }
  const canApply = missingSelections.length === 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canApply) return;
    const next: FilterState = {
      ...f,
      months: isAllMonths ? [] : f.months,
      blocks: isAllBlocks ? [] : f.blocks,
    };
    if (f.districts) next.districts = isAllDistricts ? [] : f.districts;
    onApply(next);
  };

  const isAcc = activeGroup === "accuracy";
  const isComp = activeGroup === "completeness";
  const isCons = activeGroup === "consistency";
  const showCompletenessIndicatorFilters = isComp && !isUwin;
  const hasKeyInd = isAcc || showCompletenessIndicatorFilters;
  const isRail = layout === "rail";

  const maxDropPairs = Math.max(f.dropFrom.length, f.dropTo.length, 1);
  const maxInconsPairs = Math.max(f.inconsFrom.length, f.inconsTo.length, 1);

  return (
    <form onSubmit={handleSubmit} className={isRail ? "space-y-4" : ""}>
      <div
        className={
          isRail
            ? "flex flex-col items-stretch gap-3"
            : "flex flex-wrap items-start gap-3"
        }
      >
        {showAnalysisModeToggle ? (
          <AnalysisModeToggle
            value={f.analysisMode}
            onChange={(value) => setF((prev) => ({ ...prev, analysisMode: value }))}
            fullWidth={isRail}
          />
        ) : null}

        {isStateUwin ? (
          <Dropdown label="District Name" fullWidth={isRail}>
            <CheckAll
              label="Select All"
              checked={isAllDistricts}
              onChange={(value) => {
                const districts = setAll(allDistricts, value);
                setF((prev) => ({
                  ...prev,
                  districts,
                  blocks: blocksForDistricts(csv, districts),
                }));
              }}
            />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-slate-200/80 pt-2 thin-scroll">
              {allDistricts.map((district) => (
                <CheckItem
                  key={district}
                  label={district}
                  checked={selectedDistricts.includes(district)}
                  onChange={(value) => setF((prev) => {
                    const districts = toggleSet(prev.districts ?? [], district, value);
                    return {
                      ...prev,
                      districts,
                      blocks: blocksForDistricts(csv, districts),
                    };
                  })}
                />
              ))}
            </div>
          </Dropdown>
        ) : null}

        <Dropdown label="Block Name" fullWidth={isRail}>
          <CheckAll
            label="Select All"
            checked={isAllBlocks}
            onChange={(value) =>
              setF((prev) => ({ ...prev, blocks: setAll(allBlocks, value) }))
            }
          />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-slate-200/80 pt-2 thin-scroll">
            {allBlocks.map((block) => (
              <CheckItem
                key={block}
                label={block || "Unknown block"}
                checked={f.blocks.includes(block)}
                onChange={(value) =>
                  setF((prev) => ({
                    ...prev,
                    blocks: toggleSet(prev.blocks, block, value),
                  }))
                }
              />
            ))}
          </div>
        </Dropdown>

        {!singleMonth ? (
          <Dropdown label="Months" fullWidth={isRail}>
            <CheckAll
              label="Select All"
              checked={isAllMonths}
              onChange={(value) =>
                setF((prev) => ({ ...prev, months: setAll(allMonths, value) }))
              }
            />
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-slate-200/80 pt-2 thin-scroll">
              {allMonths.map((monthKey) => (
                <CheckItem
                  key={monthKey}
                  label={monthLongLabel(monthKey)}
                  checked={f.months.includes(monthKey)}
                  onChange={(value) =>
                    setF((prev) => ({
                      ...prev,
                      months: toggleSet(prev.months, monthKey, value),
                    }))
                  }
                />
              ))}
            </div>
          </Dropdown>
        ) : null}

        {hasKeyInd ? (
          <Dropdown label="Key Indicators" fullWidth={isRail}>
            <CheckAll
              label="Select All"
              checked={
                f.outliersVax.length >=
                BASE_VAX.filter((value) => csv.indicatorMap[value]).length
              }
              onChange={(value) =>
                setF((prev) => ({ ...prev, outliersVax: value ? [...BASE_VAX] : [] }))
              }
            />
            <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2">
              {BASE_VAX.map((value) => (
                <CheckItem
                  key={value}
                  label={value}
                  checked={f.outliersVax.includes(value)}
                  onChange={(on) =>
                    setF((prev) => ({
                      ...prev,
                      outliersVax: toggleSet(prev.outliersVax, value, on),
                    }))
                  }
                />
              ))}
            </div>
          </Dropdown>
        ) : null}

        {isAcc && allMonths.length > 1 ? (
          <Dropdown label="Outliers" fullWidth={isRail}>
            <SectionLabel>Increase buckets</SectionLabel>
            {[
              ["INC_LOW", "25-50.49% Low"],
              ["INC_MOD", "50.50-100% Moderate"],
              ["INC_EXT", ">100% Extreme"],
            ].map(([value, label]) => (
              <CheckItem
                key={value}
                label={label}
                checked={f.outliersInc.includes(value)}
                onChange={(on) =>
                  setF((prev) => ({
                    ...prev,
                    outliersInc: toggleSet(prev.outliersInc, value, on),
                  }))
                }
              />
            ))}

            <SectionLabel>Drop buckets</SectionLabel>
            {[
              ["DROP_LOW", "-25 to -50.49% Low"],
              ["DROP_MOD", "-50.50 to -100% Moderate"],
              ["DROP_EXT", "<-100% Extreme"],
            ].map(([value, label]) => (
              <CheckItem
                key={value}
                label={label}
                checked={f.outliersDrop.includes(value)}
                onChange={(on) =>
                  setF((prev) => ({
                    ...prev,
                    outliersDrop: toggleSet(prev.outliersDrop, value, on),
                  }))
                }
              />
            ))}
          </Dropdown>
        ) : null}

        {isAcc ? (
          <Dropdown label="Dropouts" fullWidth={isRail}>
            <SectionLabel>Dropout % ranges</SectionLabel>
            {[
              ["R5_10", "5-10.99% (Low)"],
              ["R11_20", "11-19.99% (Moderate)"],
              ["R20P", ">=20% (Extreme)"],
            ].map(([value, label]) => (
              <CheckItem
                key={value}
                label={label}
                checked={f.dropRanges.includes(value)}
                onChange={(on) =>
                  setF((prev) => ({
                    ...prev,
                    dropRanges: toggleSet(prev.dropRanges, value, on),
                  }))
                }
              />
            ))}

            <SectionLabel>Pairs</SectionLabel>
            {PAIR_DEFAULTS.map((pair) => (
              <CheckItem
                key={pair}
                label={pair}
                checked={f.dropPairs.includes(pair)}
                onChange={(on) =>
                  setF((prev) => ({
                    ...prev,
                    dropPairs: toggleSet(prev.dropPairs, pair, on),
                  }))
                }
              />
            ))}

            <SectionLabel>Custom pairs (Vaccine-1 -&gt; Vaccine-2)</SectionLabel>
            <div className="mt-2 space-y-2">
              {Array.from({ length: maxDropPairs }, (_, index) => index).map((index) => (
                <PairRow
                  key={`drop-pair-row-${index}`}
                  fromValue={f.dropFrom[index] ?? ""}
                  toValue={f.dropTo[index] ?? ""}
                  onChangeFrom={(value) => {
                    const arr = [...f.dropFrom];
                    arr[index] = value;
                    setF((prev) => ({ ...prev, dropFrom: arr }));
                  }}
                  onChangeTo={(value) => {
                    const arr = [...f.dropTo];
                    arr[index] = value;
                    setF((prev) => ({ ...prev, dropTo: arr }));
                  }}
                  onRemove={() => {
                    if (maxDropPairs <= 1) {
                      setF((prev) => ({ ...prev, dropFrom: [""], dropTo: [""] }));
                      return;
                    }
                    const dropFrom = [...f.dropFrom];
                    const dropTo = [...f.dropTo];
                    dropFrom.splice(index, 1);
                    dropTo.splice(index, 1);
                    setF((prev) => ({ ...prev, dropFrom, dropTo }));
                  }}
                />
              ))}

              <button
                type="button"
                onClick={() =>
                  setF((prev) => ({
                    ...prev,
                    dropFrom: [...prev.dropFrom, ""],
                    dropTo: [...prev.dropTo, ""],
                  }))
                }
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add pair
              </button>
            </div>
          </Dropdown>
        ) : null}

        {isCons ? (
          <Dropdown label="Inconsistencies" fullWidth={isRail}>
            <SectionLabel>Custom pairs (Vaccine-1 -&gt; Vaccine-2)</SectionLabel>
            <div className="mt-2 space-y-2">
              {Array.from({ length: maxInconsPairs }, (_, index) => index).map((index) => (
                <PairRow
                  key={`incons-pair-row-${index}`}
                  fromValue={f.inconsFrom[index] ?? ""}
                  toValue={f.inconsTo[index] ?? ""}
                  onChangeFrom={(value) => {
                    const arr = [...f.inconsFrom];
                    arr[index] = value;
                    setF((prev) => ({ ...prev, inconsFrom: arr }));
                  }}
                  onChangeTo={(value) => {
                    const arr = [...f.inconsTo];
                    arr[index] = value;
                    setF((prev) => ({ ...prev, inconsTo: arr }));
                  }}
                  onRemove={() => {
                    if (maxInconsPairs <= 1) {
                      setF((prev) => ({ ...prev, inconsFrom: [""], inconsTo: [""] }));
                      return;
                    }
                    const inconsFrom = [...f.inconsFrom];
                    const inconsTo = [...f.inconsTo];
                    inconsFrom.splice(index, 1);
                    inconsTo.splice(index, 1);
                    setF((prev) => ({ ...prev, inconsFrom, inconsTo }));
                  }}
                />
              ))}

              <button
                type="button"
                onClick={() =>
                  setF((prev) => ({
                    ...prev,
                    inconsFrom: [...prev.inconsFrom, ""],
                    inconsTo: [...prev.inconsTo, ""],
                  }))
                }
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add pair
              </button>
            </div>
          </Dropdown>
        ) : null}

        <Dropdown label="More filters" fullWidth={isRail}>
          <SectionLabel>Ownership</SectionLabel>
          {["Public", "Private"].map((value) => (
            <CheckItem
              key={value}
              label={value}
              checked={f.ownership.length === 0 || f.ownership.includes(value)}
              onChange={(on) =>
                setF((prev) => ({
                  ...prev,
                  ownership: toggleSet(
                    prev.ownership.length === 0 ? ["Public", "Private"] : prev.ownership,
                    value,
                    on,
                  ),
                }))
              }
            />
          ))}

          <SectionLabel>Rural/Urban</SectionLabel>
          {["Rural", "Urban"].map((value) => (
            <CheckItem
              key={value}
              label={value}
              checked={f.ru.length === 0 || f.ru.includes(value)}
              onChange={(on) =>
                setF((prev) => ({
                  ...prev,
                  ru: toggleSet(
                    prev.ru.length === 0 ? ["Rural", "Urban"] : prev.ru,
                    value,
                    on,
                  ),
                }))
              }
            />
          ))}

          {hasKeyInd ? (
            <>
              <SectionLabel>Additional Indicators</SectionLabel>
              {ADD_VAX.map((value) => (
                <CheckItem
                  key={value}
                  label={value}
                  checked={f.addVax.includes(value)}
                  onChange={(on) =>
                    setF((prev) => ({
                      ...prev,
                      addVax: toggleSet(prev.addVax, value, on),
                    }))
                  }
                />
              ))}
            </>
          ) : null}
        </Dropdown>
      </div>

      <div
        className={
          isRail
            ? "border-t border-slate-200/80 pt-4"
            : "mt-4 flex justify-end"
        }
      >
        <div className={isRail ? "space-y-2" : "flex flex-col items-end gap-2"}>
          {!canApply ? (
            <p className="text-xs font-semibold text-amber-700">
              Select at least one {missingSelections.join(" and one ")} to apply filters.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!canApply}
            className={[
              "inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] py-3 text-sm font-bold text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5",
              "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0",
              isRail ? "w-full justify-center px-4" : "px-5",
            ].join(" ")}
          >
            <Filter className="h-4 w-4" />
            Apply filters
          </button>
        </div>
      </div>
    </form>
  );
}

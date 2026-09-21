import { useEffect, useMemo, useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import {
  CheckAll,
  CheckItem,
  Dropdown,
  SectionLabel,
  selectClassName,
  selectionBadge,
} from "../dqa/FilterPanel";
import {
  PCTS_KEY_INDICATORS,
  type PctsFilters,
  type PctsParsed,
} from "../../lib/pcts/types";

interface Props {
  data: PctsParsed;
  filters: PctsFilters;
  onApply: (filters: PctsFilters) => void;
  /** "inline" lays the controls out as a horizontal bar; "rail" stacks them. */
  layout?: "inline" | "rail";
}

const toggle = (values: string[], value: string, checked: boolean) =>
  checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);

function allOrSelected(current: string[], all: string[]) {
  return current.length === 0 ? all : current;
}

export function PctsFilterPanel({ data, filters, onApply, layout = "inline" }: Props) {
  const isRail = layout === "rail";
  const [draft, setDraft] = useState<PctsFilters>({ ...filters });
  const [pairs, setPairs] = useState(
    filters.additionalPairs.length ? [...filters.additionalPairs] : [{ from: "", to: "" }],
  );
  const [dropoutPairs, setDropoutPairs] = useState(
    filters.dropoutPairs?.length ? [...filters.dropoutPairs] : [{ from: "", to: "" }],
  );

  useEffect(() => {
    setDraft({ ...filters });
    setPairs(filters.additionalPairs.length ? [...filters.additionalPairs] : [{ from: "", to: "" }]);
    setDropoutPairs(
      filters.dropoutPairs?.length ? [...filters.dropoutPairs] : [{ from: "", to: "" }],
    );
  }, [filters]);

  const months = useMemo(() => Object.keys(data.months).sort(), [data.months]);
  const allIndicators = useMemo(
    () => data.indicators.filter((indicator) => !indicator.structuralZero).map((indicator) => indicator.id),
    [data.indicators],
  );
  const indicatorLabels = useMemo(
    () => Object.fromEntries(data.indicators.map((indicator) => [indicator.id, indicator.label])),
    [data.indicators],
  );
  const additionalIndicators = allIndicators.filter(
    (indicator) => !PCTS_KEY_INDICATORS.includes(indicator as (typeof PCTS_KEY_INDICATORS)[number]),
  );

  const multiSelect = (
    label: string,
    allValues: string[],
    selected: string[],
    setSelected: (values: string[]) => void,
    display?: (value: string) => string,
    emptyMeansAll = true,
  ) => (
    <Dropdown
      label={label}
      fullWidth={isRail}
      badge={selectionBadge(
        emptyMeansAll && selected.length === 0 ? allValues.length : selected.length,
        allValues.length,
      )}
    >
      <CheckAll
        label="Select All"
        checked={
          selected.length === allValues.length
          || (emptyMeansAll && selected.length === 0)
        }
        onChange={(checked) => setSelected(checked ? [...allValues] : [])}
      />
      <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-slate-200/80 pt-2 thin-scroll">
        {allValues.map((value) => (
          <CheckItem
            key={value}
            label={display?.(value) ?? value}
            checked={(emptyMeansAll && selected.length === 0) || selected.includes(value)}
            onChange={(checked) =>
              setSelected(toggle(
                emptyMeansAll ? allOrSelected(selected, allValues) : selected,
                value,
                checked,
              ))
            }
          />
        ))}
      </div>
    </Dropdown>
  );

  return (
    <form
      className={isRail ? "space-y-4" : ""}
      onSubmit={(event) => {
        event.preventDefault();
        const validDropoutPairs = dropoutPairs.filter(
          (pair) => pair.from && pair.to && pair.from !== pair.to,
        );
        onApply({
          ...draft,
          additionalPairs: pairs.filter(
            (pair) => pair.from && pair.to && pair.from !== pair.to,
          ),
          dropoutPairs: validDropoutPairs.length ? validDropoutPairs : undefined,
        });
      }}
    >
      <div className={isRail ? "space-y-3" : "flex flex-wrap items-start gap-3"}>
        {multiSelect("Block / reporting group", data.blocks, draft.blocks, (blocks) =>
          setDraft((previous) => ({ ...previous, blocks })),
        )}

        {multiSelect(
          "Facility",
          Object.keys(data.facilities).sort((left, right) => {
            const a = data.facilities[left];
            const b = data.facilities[right];
            return a.block.localeCompare(b.block) || a.facility.localeCompare(b.facility);
          }),
          draft.facilityKeys ?? [],
          (facilityKeys) => setDraft((previous) => ({ ...previous, facilityKeys })),
          (facilityKey) => {
            const facility = data.facilities[facilityKey];
            return facility ? `${facility.facility} — ${facility.block}` : facilityKey;
          },
        )}

        {months.length > 1
          ? multiSelect(
              "Months",
              months,
              draft.months,
              (selectedMonths) =>
                setDraft((previous) => ({ ...previous, months: selectedMonths })),
              (month) => `${data.months[month] ?? month} (${month})`,
            )
          : null}

        {multiSelect(
          "Rural / Urban",
          ["Rural", "Urban"],
          draft.ruralUrban,
          (ruralUrban) =>
            setDraft((previous) => ({
              ...previous,
              ruralUrban: ruralUrban as PctsFilters["ruralUrban"],
            })),
        )}

        {multiSelect(
          "Ownership",
          ["Public", "Private"],
          draft.ownership,
          (ownership) =>
            setDraft((previous) => ({
              ...previous,
              ownership: ownership as PctsFilters["ownership"],
            })),
        )}

        {multiSelect(
          "Facility type",
          data.facilityTypes,
          draft.facilityTypes,
          (facilityTypes) => setDraft((previous) => ({ ...previous, facilityTypes })),
        )}

        <Dropdown label="Key Indicators" fullWidth={isRail}>
          <CheckAll
            label="Select All"
            checked={draft.keyIndicators.length >= PCTS_KEY_INDICATORS.length}
            onChange={(checked) =>
              setDraft((previous) => ({
                ...previous,
                keyIndicators: checked ? [...PCTS_KEY_INDICATORS] : [],
              }))
            }
          />
          <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2">
            {PCTS_KEY_INDICATORS.map((indicator) => (
              <CheckItem
                key={indicator}
                label={indicatorLabels[indicator] ?? indicator}
                checked={draft.keyIndicators.includes(indicator)}
                onChange={(checked) =>
                  setDraft((previous) => ({
                    ...previous,
                    keyIndicators: toggle(previous.keyIndicators, indicator, checked),
                  }))
                }
              />
            ))}
          </div>
        </Dropdown>

        {additionalIndicators.length
          ? multiSelect(
              "Additional Indicators",
              additionalIndicators,
              draft.additionalIndicators ?? [],
              (selected) =>
                setDraft((previous) => ({ ...previous, additionalIndicators: selected })),
              (indicator) => indicatorLabels[indicator] ?? indicator,
              false,
            )
          : null}

        <Dropdown label="Outliers" fullWidth={isRail}>
          <SectionLabel>Month-to-month change severity</SectionLabel>
          <select
            value={draft.outlierSeverity}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                outlierSeverity: event.target.value as PctsFilters["outlierSeverity"],
              }))
            }
            className={selectClassName}
          >
            <option value="low">At least 25% (Low)</option>
            <option value="moderate">Above 50% (Moderate)</option>
            <option value="extreme">Above 100% / at or below -75% (Extreme)</option>
          </select>
        </Dropdown>

        <Dropdown label="Dropouts" fullWidth={isRail}>
          <SectionLabel>Dropout threshold</SectionLabel>
          <select
            value={String(draft.dropoutThreshold)}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                dropoutThreshold: Number(event.target.value) as PctsFilters["dropoutThreshold"],
              }))
            }
            className={selectClassName}
          >
            <option value="5">At least 5% (Low)</option>
            <option value="11">At least 11% (Moderate)</option>
            <option value="20">At least 20% (Extreme)</option>
          </select>

          <SectionLabel>Custom dropout pairs</SectionLabel>
          <div className="mt-2 space-y-2">
            {dropoutPairs.map((pair, index) => (
              <div
                key={`pcts-dropout-pair-${index}`}
                className="grid gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <select
                  value={pair.from}
                  onChange={(event) =>
                    setDropoutPairs((previous) =>
                      previous.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, from: event.target.value } : item,
                      ),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Earlier indicator</option>
                  {allIndicators.map((indicator) => (
                    <option key={indicator} value={indicator}>{indicatorLabels[indicator] ?? indicator}</option>
                  ))}
                </select>
                <select
                  value={pair.to}
                  onChange={(event) =>
                    setDropoutPairs((previous) =>
                      previous.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, to: event.target.value } : item,
                      ),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Later indicator</option>
                  {allIndicators.map((indicator) => (
                    <option key={indicator} value={indicator}>{indicatorLabels[indicator] ?? indicator}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove custom dropout pair"
                  onClick={() =>
                    setDropoutPairs((previous) =>
                      previous.length === 1
                        ? [{ from: "", to: "" }]
                        : previous.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setDropoutPairs((previous) => [...previous, { from: "", to: "" }])}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add dropout pair
            </button>
          </div>
        </Dropdown>

        <Dropdown label="Inconsistencies" fullWidth={isRail}>
          <SectionLabel>Co-administration tolerance</SectionLabel>
          <select
            value={String(draft.coadminTolerance)}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                coadminTolerance: Number(event.target.value) as PctsFilters["coadminTolerance"],
              }))
            }
            className={selectClassName}
          >
            <option value="5">5%</option>
            <option value="10">10%</option>
            <option value="20">20%</option>
          </select>

          <SectionLabel>Custom sequence pairs</SectionLabel>
          <div className="mt-2 space-y-2">
            {pairs.map((pair, index) => (
              <div
                key={`pcts-pair-${index}`}
                className="grid gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <select
                  value={pair.from}
                  onChange={(event) =>
                    setPairs((previous) =>
                      previous.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, from: event.target.value } : item,
                      ),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Indicator 1</option>
                  {allIndicators.map((indicator) => (
                    <option key={indicator} value={indicator}>{indicatorLabels[indicator] ?? indicator}</option>
                  ))}
                </select>
                <select
                  value={pair.to}
                  onChange={(event) =>
                    setPairs((previous) =>
                      previous.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, to: event.target.value } : item,
                      ),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Indicator 2</option>
                  {allIndicators.map((indicator) => (
                    <option key={indicator} value={indicator}>{indicatorLabels[indicator] ?? indicator}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove custom pair"
                  onClick={() =>
                    setPairs((previous) =>
                      previous.length === 1
                        ? [{ from: "", to: "" }]
                        : previous.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-950 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setPairs((previous) => [...previous, { from: "", to: "" }])}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add pair
            </button>
          </div>
        </Dropdown>

        <label className="flex min-h-[2.75rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={draft.issuesOnly}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, issuesOnly: event.target.checked }))
            }
            className="h-4 w-4 rounded border-slate-300"
          />
          Show only facilities with an identified issue
        </label>
      </div>

      <div className={isRail ? "border-t border-slate-200/80 pt-4" : "mt-4 flex justify-end"}>
        <button
          type="submit"
          className={[
            "inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] py-3 text-sm font-bold text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5",
            isRail ? "w-full px-4" : "px-5",
          ].join(" ")}
        >
          <Filter className="h-4 w-4" />
          Apply filters
        </button>
      </div>
    </form>
  );
}

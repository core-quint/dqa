import { useEffect, useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import {
  CheckAll,
  CheckItem,
  Dropdown,
  SectionLabel,
  selectClassName,
} from "../dqa/FilterPanel";
import {
  STATE_HMIS_KEY_INDICATORS,
  type StateHmisFilters,
  type StateHmisParsed,
} from "../../lib/stateHmis/types";

interface Props {
  data: StateHmisParsed;
  filters: StateHmisFilters;
  onApply: (f: StateHmisFilters) => void;
  indicatorShorts: string[];
}

interface DraftPair {
  from: string;
  to: string;
}

export function StateHmisFilterPanel({ data, filters: initFilters, onApply, indicatorShorts }: Props) {
  const [f, setF] = useState<StateHmisFilters>({ ...initFilters });
  const [pairs, setPairs] = useState<DraftPair[]>(
    initFilters.additionalPairs.length ? [...initFilters.additionalPairs] : [{ from: "", to: "" }],
  );

  useEffect(() => {
    setF({ ...initFilters });
    setPairs(initFilters.additionalPairs.length ? [...initFilters.additionalPairs] : [{ from: "", to: "" }]);
  }, [initFilters]);

  const allDistricts = data.districts;
  const allMonths = Object.keys(data.months).sort();
  const singleMonth = allMonths.length === 1;
  const allKeyIndicators = [...STATE_HMIS_KEY_INDICATORS];

  const toggleSet = (arr: string[], value: string, on: boolean): string[] =>
    on ? [...new Set([...arr, value])] : arr.filter((item) => item !== value);

  const setAll = (keys: string[], on: boolean): string[] => (on ? [...keys] : []);

  const isAllDistricts = f.districts.length === 0 || f.districts.length === allDistricts.length;
  const isAllMonths = f.months.length === 0 || f.months.length === allMonths.length;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onApply({
      ...f,
      additionalPairs: pairs.filter((pair) => pair.from && pair.to && pair.from !== pair.to),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col items-stretch gap-3">
        <Dropdown label="District Name" fullWidth>
          <CheckAll
            label="Select All"
            checked={isAllDistricts}
            onChange={(value) =>
              setF((prev) => ({ ...prev, districts: setAll(allDistricts, value) }))
            }
          />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-slate-200/80 pt-2 thin-scroll">
            {allDistricts.map((district) => (
              <CheckItem
                key={district}
                label={district || "Unknown district"}
                checked={f.districts.length === 0 || f.districts.includes(district)}
                onChange={(value) =>
                  setF((prev) => ({
                    ...prev,
                    districts: toggleSet(
                      prev.districts.length === 0 ? allDistricts : prev.districts,
                      district,
                      value,
                    ),
                  }))
                }
              />
            ))}
          </div>
        </Dropdown>

        {!singleMonth ? (
          <Dropdown label="Months" fullWidth>
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
                  label={`${data.months[monthKey] ?? monthKey} (${monthKey})`}
                  checked={f.months.length === 0 || f.months.includes(monthKey)}
                  onChange={(value) =>
                    setF((prev) => ({
                      ...prev,
                      months: toggleSet(
                        prev.months.length === 0 ? allMonths : prev.months,
                        monthKey,
                        value,
                      ),
                    }))
                  }
                />
              ))}
            </div>
          </Dropdown>
        ) : null}

        <Dropdown label="Key Indicators" fullWidth>
          <CheckAll
            label="Select All"
            checked={f.keyIndicators.length >= allKeyIndicators.length}
            onChange={(value) =>
              setF((prev) => ({ ...prev, keyIndicators: value ? [...allKeyIndicators] : [] }))
            }
          />
          <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2">
            {allKeyIndicators.map((value) => (
              <CheckItem
                key={value}
                label={value}
                checked={f.keyIndicators.includes(value)}
                onChange={(on) =>
                  setF((prev) => ({
                    ...prev,
                    keyIndicators: toggleSet(prev.keyIndicators, value, on),
                  }))
                }
              />
            ))}
          </div>
        </Dropdown>

        <Dropdown label="Outliers" fullWidth>
          <SectionLabel>Change severity</SectionLabel>
          <select
            value={f.outlierSeverity}
            onChange={(event) =>
              setF((prev) => ({
                ...prev,
                outlierSeverity: event.target.value as StateHmisFilters["outlierSeverity"],
              }))
            }
            className={selectClassName}
          >
            <option value="low">&gt;=25% change (Low)</option>
            <option value="moderate">&gt;=50% change (Moderate)</option>
            <option value="extreme">&gt;100% change (Extreme)</option>
          </select>
        </Dropdown>

        <Dropdown label="Dropouts" fullWidth>
          <SectionLabel>Dropout % threshold</SectionLabel>
          <select
            value={String(f.dropoutThreshold)}
            onChange={(event) =>
              setF((prev) => ({
                ...prev,
                dropoutThreshold: Number(event.target.value) as StateHmisFilters["dropoutThreshold"],
              }))
            }
            className={selectClassName}
          >
            <option value="5">&gt;=5% (Low)</option>
            <option value="11">&gt;=11% (Moderate)</option>
            <option value="20">&gt;=20% (Extreme)</option>
          </select>
        </Dropdown>

        <Dropdown label="Inconsistencies" fullWidth>
          <SectionLabel>Co-admin tolerance</SectionLabel>
          <select
            value={String(f.coadminTolerance)}
            onChange={(event) =>
              setF((prev) => ({
                ...prev,
                coadminTolerance: Number(event.target.value) as StateHmisFilters["coadminTolerance"],
              }))
            }
            className={selectClassName}
          >
            <option value="5">5%</option>
            <option value="10">10%</option>
            <option value="20">20%</option>
          </select>

          <SectionLabel>Custom pairs (Indicator-1 -&gt; Indicator-2)</SectionLabel>
          <div className="mt-2 space-y-2">
            {pairs.map((pair, index) => (
              <div
                key={`state-pair-row-${index}`}
                className="grid gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/80 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <select
                  value={pair.from}
                  onChange={(event) =>
                    setPairs((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, from: event.target.value } : item)),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Indicator-1</option>
                  {indicatorShorts.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <select
                  value={pair.to}
                  onChange={(event) =>
                    setPairs((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, to: event.target.value } : item)),
                    )
                  }
                  className={selectClassName}
                >
                  <option value="">Indicator-2</option>
                  {indicatorShorts.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() =>
                    setPairs((prev) =>
                      prev.length <= 1 ? [{ from: "", to: "" }] : prev.filter((_, i) => i !== index),
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
              onClick={() => setPairs((prev) => [...prev, { from: "", to: "" }])}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 transition hover:bg-slate-950 hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add pair
            </button>
          </div>
        </Dropdown>
      </div>

      <div className="border-t border-slate-200/80 pt-4">
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5"
        >
          <Filter className="h-4 w-4" />
          Apply filters
        </button>
      </div>
    </form>
  );
}

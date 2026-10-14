import { useRef, useState } from "react";
import {
  Upload,
  AlertCircle,
  Loader2,
  Calendar,
  CalendarDays,
  CalendarRange,
  ArrowLeft,
} from "lucide-react";
import type { UwinParsedCSV } from "../../lib/uwin/types";
import {
  parseUwinCSVFile,
  parseUwinMultipleCSVFiles,
  preCheckUwinFiles,
  type UwinFilePrecheck,
  type UwinUploadPeriod,
} from "../../lib/uwin/csvParser";
import {
  UWIN_DURATION_RULES,
  addDays,
  checkUwinFileCount,
  checkUwinPeriod,
  findUwinPeriodConflicts,
  localToday,
  monthDayCounts,
  suggestedPeriodEnd,
  uwinPeriodKey,
  windowLabel,
  type UwinUploadDuration,
} from "../../lib/uwin/uploadPeriod";
import { daysSpanInclusive, monthLongLabel } from "../../lib/dqa/parseUtils";
import type { AuthState } from "../dqa/LoginPage";
import { GlassPanel } from "../branding/GlassPanel";
import { PreUploadInfoForm } from "../dqa/PreUploadInfoForm";
import {
  EMPTY_PRE_UPLOAD_INFO,
  buildUploadDatasetContext,
  isPreUploadInfoComplete,
  logUploadSession,
  type PreUploadInfo,
} from "../../lib/dqa/preUploadOptions";

interface Props {
  onDataReady: (data: UwinParsedCSV, reviewInfo: PreUploadInfo) => void;
  auth: AuthState;
  onBack: () => void;
  variant?: "district" | "state";
}


function checkGeoAccess(parsed: UwinParsedCSV, auth: AuthState): string | null {
  if (auth.level === "STATE" && auth.geoState) {
    if (
      parsed.stateName.trim().toLowerCase() !==
      auth.geoState.trim().toLowerCase()
    ) {
      return `Access denied: You can only analyse files for "${auth.geoState}". This file is for "${parsed.stateName}".`;
    }
  }
  if (
    (auth.level === "DISTRICT" || auth.level === "BLOCK") &&
    auth.geoState &&
    auth.geoDistrict
  ) {
    if (
      parsed.stateName.trim().toLowerCase() !==
        auth.geoState.trim().toLowerCase() ||
      parsed.distName.trim().toLowerCase() !==
        auth.geoDistrict.trim().toLowerCase()
    ) {
      return `Access denied: You can only analyse files for "${auth.geoState} / ${auth.geoDistrict}".`;
    }
  }
  return null;
}

/** One row of the mandatory reporting-period form. */
type PeriodDraft = { from: string; to: string };

const EMPTY_PERIOD: PeriodDraft = { from: "", to: "" };

const DURATION_OPTIONS: {
  value: UwinUploadDuration;
  icon: typeof CalendarDays;
  detail: string;
}[] = [
  { value: "WEEKLY", icon: CalendarDays, detail: "Each file covers exactly 7 days. Up to 4 files." },
  { value: "MONTHLY", icon: CalendarRange, detail: "Each file covers 28 to 31 days. Up to 12 files." },
];

/** How a valid monthly window splits across months, e.g. "11 days in April, 20 in May". */
function monthSplitNote(draft: PeriodDraft): string | null {
  const counts = monthDayCounts(draft.from, draft.to);
  if (counts.length < 2) return null;
  return counts
    .map((entry, index) => {
      const month = monthLongLabel(entry.month).split(" ")[0];
      return index === 0
        ? `${entry.days} day${entry.days === 1 ? "" : "s"} in ${month}`
        : `${entry.days} in ${month}`;
    })
    .join(", ");
}

export function UwinLandingPage({ onDataReady, auth, onBack, variant = "district" }: Props) {
  const isState = variant === "state";
  const [isLoading, setIsLoading] = useState(false);
  const [isPrechecking, setIsPrechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prechecks, setPrechecks] = useState<UwinFilePrecheck[] | null>(null);
  const [periods, setPeriods] = useState<PeriodDraft[]>([]);
  const [duration, setDuration] = useState<UwinUploadDuration | null>(null);
  const [preInfo, setPreInfo] = useState(EMPTY_PRE_UPLOAD_INFO);
  const infoComplete = isPreUploadInfoComplete(preInfo, auth.level);
  const uploadReady = infoComplete && duration !== null;

  const handleFiles = async (files: File[]) => {
    if (!uploadReady || !duration) return;
    const csvFiles = files.filter((file) => file.name.endsWith(".csv"));
    if (csvFiles.length === 0) {
      setError("Please upload .csv file(s).");
      return;
    }
    const countError = checkUwinFileCount(duration, csvFiles.length);
    if (countError) {
      setError(countError);
      return;
    }

    setError(null);
    setIsPrechecking(true);
    try {
      const checks = await preCheckUwinFiles(csvFiles);
      // The reporting period is always confirmed by hand. A month read off the
      // filename only prefills a monthly form; it cannot say which week a weekly
      // file holds, so weekly rows start empty.
      setPeriods(
        checks.map((check) =>
          duration === "MONTHLY"
            ? { from: check.suggestedFrom, to: check.suggestedTo }
            : { ...EMPTY_PERIOD },
        ),
      );
      setPrechecks(checks);
    } catch (precheckError) {
      setError(
        precheckError instanceof Error
          ? precheckError.message
          : "Failed to read file headers.",
      );
    } finally {
      setIsPrechecking(false);
    }
  };

  const runParse = async (
    checks: UwinFilePrecheck[],
    filePeriods: UwinUploadPeriod[],
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const files = checks.map((check) => check.file);

      const parsed =
        files.length === 1
          ? await parseUwinCSVFile(files[0], filePeriods[0])
          : await parseUwinMultipleCSVFiles(files, filePeriods);

      if (isState) {
        if (parsed.idxDist === null || parsed.globalDistrictCount === 0) {
          setError("U-WIN State requires a readable District column in every file.");
          return;
        }
        if (parsed.stateName === "Multiple") {
          setError("All U-WIN State files must belong to the same state.");
          return;
        }
        parsed.portal = "UWIN_STATE";
      }

      const geoErr = checkGeoAccess(parsed, auth);
      if (geoErr) {
        setError(geoErr);
        return;
      }
      logUploadSession(isState ? "UWIN_STATE" : "UWIN", preInfo, buildUploadDatasetContext(parsed)).catch((err) => console.error("Upload session log failed:", err));
      onDataReady(parsed, preInfo);
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Failed to parse CSV file(s).",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmPeriods = () => {
    if (!prechecks || !duration) return;
    for (let index = 0; index < prechecks.length; index += 1) {
      const draft = periods[index] ?? EMPTY_PERIOD;
      const problem = checkUwinPeriod(duration, draft.from, draft.to);
      if (problem) {
        setError(`${prechecks[index].file.name}: ${problem}`);
        return;
      }
    }
    runParse(
      prechecks,
      prechecks.map((_, index) => ({ duration, ...(periods[index] ?? EMPTY_PERIOD) })),
    );
  };

  // Weekly windows are always 7 days, so either date fills in the other. A monthly
  // window keeps the user's To date while it still fits 28-31 days, else suggests one.
  const setPeriodField = (index: number, field: keyof PeriodDraft, value: string) => {
    if (!duration) return;
    setPeriods((prev) => {
      const next = prev.slice();
      while (next.length <= index) next.push({ ...EMPTY_PERIOD });
      const draft = { ...next[index], [field]: value };
      if (value && duration === "WEEKLY") {
        if (field === "from") draft.to = addDays(value, 6);
        else draft.from = addDays(value, -6);
      } else if (value && field === "from" && checkUwinPeriod(duration, value, draft.to)) {
        draft.to = suggestedPeriodEnd(duration, value);
      }
      next[index] = draft;
      return next;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  };

  const handleReset = () => {
    setPrechecks(null);
    setPeriods([]);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (prechecks && duration) {
    const rule = UWIN_DURATION_RULES[duration];
    const today = localToday();
    const entries = prechecks.map((check, index) => ({
      fileName: check.file.name,
      ...(periods[index] ?? EMPTY_PERIOD),
    }));
    const conflicts = findUwinPeriodConflicts(duration, entries, today);
    const allPeriodsValid =
      entries.every((entry) => checkUwinPeriod(duration, entry.from, entry.to, today) === null) &&
      conflicts.length === 0;
    // Latest From that still leaves room for a full window ending by today.
    const latestFrom = addDays(today, -(rule.minDays - 1));
    const dateInputClass =
      "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100";

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-slate-200/70 px-6 py-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-bold text-slate-900">Confirm Reporting Period</h2>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white">
                {rule.label} files
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              {duration === "WEEKLY"
                ? "Pick the first or last day of each week; the other date fills in so every file covers exactly 7 days. Each week is analysed as its own period."
                : "Pick the From and To dates each file covers, 28 to 31 days. A window that crosses two months is analysed as the month holding most of its days, so 20 Apr to 20 May is May."}
              {" "}Files must be consecutive: each starts the day after the previous one
              ends{duration === "MONTHLY" ? ", one month after another" : ""}. Dates after
              today are not allowed.
            </p>
          </div>

          <div className="space-y-4 px-6 py-6">
            {prechecks.map((check, index) => {
              const draft = periods[index] ?? EMPTY_PERIOD;
              const problem = draft.from || draft.to ? checkUwinPeriod(duration, draft.from, draft.to, today) : null;
              const key = uwinPeriodKey(duration, draft.from, draft.to, today);
              const latestTo =
                duration === "MONTHLY" && draft.from && addDays(draft.from, rule.maxDays - 1) < today
                  ? addDays(draft.from, rule.maxDays - 1)
                  : today;
              const days = daysSpanInclusive(draft.from, draft.to);
              const split = duration === "MONTHLY" && key ? monthSplitNote(draft) : null;

              return (
                <div
                  key={`${check.file.name}-${index}`}
                  className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4"
                >
                  <div className="text-sm font-bold text-slate-950">
                    {check.file.name}
                  </div>
                  {check.hasMonthColumn ? (
                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Month column present - replaced by the dates below
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-600">From date</span>
                      <input
                        type="date"
                        value={draft.from}
                        max={latestFrom}
                        onChange={(event) => setPeriodField(index, "from", event.target.value)}
                        className={dateInputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-600">To date</span>
                      <input
                        type="date"
                        value={draft.to}
                        min={duration === "MONTHLY" && draft.from ? addDays(draft.from, rule.minDays - 1) : undefined}
                        max={latestTo}
                        onChange={(event) => setPeriodField(index, "to", event.target.value)}
                        className={dateInputClass}
                      />
                    </label>
                  </div>

                  <div className="mt-3 text-xs leading-6 text-slate-600">
                    {problem ? (
                      <span className="font-semibold text-red-600">{problem}</span>
                    ) : key ? (
                      <>
                        <span className="font-semibold text-slate-800">
                          Analysed as: {monthLongLabel(key)}
                        </span>
                        <span className="block text-slate-500">
                          {duration === "MONTHLY"
                            ? `${windowLabel(draft.from, draft.to)}, ${days} days${split ? ` (${split})` : ""}`
                            : `${days} days`}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-500">
                        Both dates are required before analysis can start.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {conflicts.length > 0 ? (
              <div className="space-y-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                {conflicts.map((conflict) => (
                  <p key={conflict} className="flex items-start gap-3 text-sm font-semibold">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {conflict}
                  </p>
                ))}
              </div>
            ) : null}

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleConfirmPeriods}
                disabled={isLoading || !allPeriodsValid}
                className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3 text-sm font-bold text-white shadow-[0_18px_38px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analysing...
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4" />
                    Confirm and analyse
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isLoading}
                className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                Back
              </button>
            </div>
          </div>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-slate-200/70 px-6 py-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              Upload dataset
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-950">
              Upload {isState ? "U-WIN State" : "U-WIN"} CSV files
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Choose whether you are uploading weekly or monthly session-site files,
              then upload them. You will confirm the From and To dates each file
              covers before analysis begins; that reporting period is what the
              analysis is built on.
            </p>
          </div>

          <div className="px-6 pt-6">
            <PreUploadInfoForm auth={auth} value={preInfo} onChange={setPreInfo} />
          </div>

          <div className="px-6 pt-6">
            <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                File duration
              </div>
              <div role="radiogroup" aria-label="File duration" className="grid gap-3 sm:grid-cols-2">
                {DURATION_OPTIONS.map((option) => {
                  const selected = duration === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setDuration(option.value);
                        setError(null);
                      }}
                      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/40"
                      }`}
                    >
                      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                      <span>
                        <span className="block text-sm font-bold">
                          {UWIN_DURATION_RULES[option.value].label}
                        </span>
                        <span className={`block text-xs ${selected ? "text-slate-200" : "text-slate-500"}`}>
                          {option.detail}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <button
              type="button"
              disabled={!uploadReady}
              className="group rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-amber-300 hover:bg-amber-50/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
              onClick={() => uploadReady && fileRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-slate-950 text-white shadow-[0_18px_38px_rgba(15,23,42,0.16)] transition group-hover:-translate-y-0.5">
                <Upload className="h-7 w-7" />
              </div>
              <div className="mt-4 text-base font-bold text-slate-950">
                Drop {isState ? "U-WIN State" : "U-WIN"} CSV files here or browse from your machine
              </div>
              <div className="mt-2 text-sm text-slate-500">
                {duration
                  ? `Up to ${UWIN_DURATION_RULES[duration].maxFiles} ${duration === "WEEKLY" ? "weekly" : "monthly"} files per upload. CSV format only.`
                  : "CSV format only."}
              </div>
              {!infoComplete ? (
                <div className="mt-3 text-xs font-semibold text-amber-600">
                  Complete the review details above to enable upload.
                </div>
              ) : !duration ? (
                <div className="mt-3 text-xs font-semibold text-amber-600">
                  Choose weekly or monthly files above to enable upload.
                </div>
              ) : null}
            </button>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <button
                onClick={() => fileRef.current?.click()}
                type="button"
                disabled={isLoading || isPrechecking || !uploadReady}
                className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3 text-sm font-bold text-white shadow-[0_18px_38px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPrechecking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analysing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload and analyse
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to portal selection
              </button>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) handleFiles(files);
              event.target.value = "";
            }}
            className="hidden"
          />

          {error ? (
            <div className="px-6 pb-6">
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            </div>
          ) : null}

          <div className="border-t border-slate-200/70 px-6 py-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Files are processed in-memory for the current session only.
          </div>
        </GlassPanel>
    </div>
  );
}

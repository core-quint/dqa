import { useRef, useState } from "react";
import {
  Upload,
  AlertCircle,
  Loader2,
  Calendar,
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
import { makePeriodKey, monthLongLabel } from "../../lib/dqa/parseUtils";
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

/** Human summary of a draft period, or null while it is incomplete or inverted. */
function periodSummary(draft: PeriodDraft): string | null {
  const key = makePeriodKey(draft.from, draft.to);
  return key ? monthLongLabel(key) : null;
}

/** Part of a single calendar month — the weekly/fortnightly case. */
function isSubMonth(draft: PeriodDraft): boolean {
  const key = makePeriodKey(draft.from, draft.to);
  return Boolean(key) && key !== draft.from.slice(0, 7);
}

export function UwinLandingPage({ onDataReady, auth, onBack, variant = "district" }: Props) {
  const isState = variant === "state";
  const [isLoading, setIsLoading] = useState(false);
  const [isPrechecking, setIsPrechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prechecks, setPrechecks] = useState<UwinFilePrecheck[] | null>(null);
  const [periods, setPeriods] = useState<PeriodDraft[]>([]);
  const [preInfo, setPreInfo] = useState(EMPTY_PRE_UPLOAD_INFO);
  const infoComplete = isPreUploadInfoComplete(preInfo, auth.level);

  const handleFiles = async (files: File[]) => {
    if (!infoComplete) return;
    const csvFiles = files.filter((file) => file.name.endsWith(".csv"));
    if (csvFiles.length === 0) {
      setError("Please upload .csv file(s).");
      return;
    }
    if (csvFiles.length > 12) {
      setError("Maximum 12 CSV files can be uploaded at once.");
      return;
    }

    setError(null);
    setIsPrechecking(true);
    try {
      const checks = await preCheckUwinFiles(csvFiles);
      // The reporting period is always confirmed by hand. A month read off the
      // filename only prefills the form — it is never applied on its own, because
      // a filename cannot tell a weekly export from a monthly one.
      setPeriods(
        checks.map((check) => ({
          from: check.suggestedFrom,
          to: check.suggestedTo,
        })),
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
    if (!prechecks) return;
    for (let index = 0; index < prechecks.length; index += 1) {
      const draft = periods[index] ?? EMPTY_PERIOD;
      const name = prechecks[index].file.name;
      if (!draft.from || !draft.to) {
        setError(`Enter both a From date and a To date for: ${name}`);
        return;
      }
      if (draft.from > draft.to) {
        setError(`The From date must be on or before the To date for: ${name}`);
        return;
      }
    }
    runParse(
      prechecks,
      prechecks.map((_, index) => ({ ...(periods[index] ?? EMPTY_PERIOD) })),
    );
  };

  const setPeriodField = (index: number, field: keyof PeriodDraft, value: string) => {
    setPeriods((prev) => {
      const next = prev.slice();
      while (next.length <= index) next.push({ ...EMPTY_PERIOD });
      next[index] = { ...next[index], [field]: value };
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

  if (prechecks) {
    const allPeriodsValid = prechecks.every(
      (_, index) => makePeriodKey(periods[index]?.from ?? "", periods[index]?.to ?? "") !== null,
    );
    const dateInputClass =
      "rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100";

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-slate-200/70 px-6 py-5">
            <h2 className="text-base font-bold text-slate-900">Confirm Reporting Period</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              Enter the period each file actually covers. A whole calendar month is
              analysed month-wise as before; a shorter span — a weekly export, for
              example — is analysed as its own period so it is never reported as a
              full month.
            </p>
          </div>

          <div className="space-y-4 px-6 py-6">
            {prechecks.map((check, index) => {
              const draft = periods[index] ?? EMPTY_PERIOD;
              const summary = periodSummary(draft);
              const inverted = Boolean(draft.from && draft.to && draft.from > draft.to);
              const monthColumnWins =
                check.hasMonthColumn && summary !== null && !isSubMonth(draft);

              return (
                <div
                  key={`${check.file.name}-${index}`}
                  className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4"
                >
                  <div className="text-sm font-bold text-slate-950">
                    {check.file.name}
                  </div>
                  <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {check.hasMonthColumn
                      ? "Month column present"
                      : "No month column in file"}
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-600">From date</span>
                      <input
                        type="date"
                        value={draft.from}
                        max={draft.to || undefined}
                        onChange={(event) => setPeriodField(index, "from", event.target.value)}
                        className={dateInputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-slate-600">To date</span>
                      <input
                        type="date"
                        value={draft.to}
                        min={draft.from || undefined}
                        onChange={(event) => setPeriodField(index, "to", event.target.value)}
                        className={dateInputClass}
                      />
                    </label>
                  </div>

                  <div className="mt-3 text-xs leading-6 text-slate-600">
                    {inverted ? (
                      <span className="font-semibold text-red-600">
                        The From date must be on or before the To date.
                      </span>
                    ) : summary ? (
                      <>
                        <span className="font-semibold text-slate-800">
                          Reporting period: {summary}
                        </span>
                        {monthColumnWins ? (
                          <span className="block text-slate-500">
                            This file has its own Month column, so the analysis keeps
                            one column per month in the file. The dates above are
                            recorded as the review period.
                          </span>
                        ) : null}
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
              Upload one to twelve session-site CSV files — monthly or weekly. You
              will confirm the From and To dates each file covers before analysis
              begins; that reporting period is what the analysis is built on.
            </p>
          </div>

          <div className="px-6 pt-6">
            <PreUploadInfoForm auth={auth} value={preInfo} onChange={setPreInfo} />
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <button
              type="button"
              disabled={!infoComplete}
              className="group rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-amber-300 hover:bg-amber-50/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent"
              onClick={() => infoComplete && fileRef.current?.click()}
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
                Up to twelve files per upload. CSV format only.
              </div>
              {!infoComplete ? (
                <div className="mt-3 text-xs font-semibold text-amber-600">
                  Complete the review details above to enable upload.
                </div>
              ) : null}
            </button>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <button
                onClick={() => fileRef.current?.click()}
                type="button"
                disabled={isLoading || isPrechecking || !infoComplete}
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

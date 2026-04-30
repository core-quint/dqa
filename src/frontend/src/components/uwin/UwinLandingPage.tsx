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
} from "../../lib/uwin/csvParser";
import type { AuthState } from "../dqa/LoginPage";
import { GlassPanel } from "../branding/GlassPanel";

interface Props {
  onDataReady: (data: UwinParsedCSV) => void;
  auth: AuthState;
  onBack: () => void;
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

export function UwinLandingPage({ onDataReady, auth, onBack }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPrechecking, setIsPrechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prechecks, setPrechecks] = useState<UwinFilePrecheck[] | null>(null);
  const [resolvedMonths, setResolvedMonths] = useState<Record<number, string>>(
    {},
  );

  const handleFiles = async (files: File[]) => {
    const csvFiles = files.filter((file) => file.name.endsWith(".csv"));
    if (csvFiles.length === 0) {
      setError("Please upload .csv file(s).");
      return;
    }
    if (csvFiles.length > 12) {
      setError("Maximum 12 monthly CSV files can be uploaded at once.");
      return;
    }

    setError(null);
    setIsPrechecking(true);
    try {
      const checks = await preCheckUwinFiles(csvFiles);
      const needsInput = checks.some(
        (check) => !check.hasMonthColumn && !check.detectedMonth,
      );

      if (!needsInput) {
        const auto: Record<number, string> = {};
        checks.forEach((check, index) => {
          if (!check.hasMonthColumn && check.detectedMonth) {
            auto[index] = check.detectedMonth;
          }
        });
        await runParse(checks, auto);
      } else {
        const prefilled: Record<number, string> = {};
        checks.forEach((check, index) => {
          if (!check.hasMonthColumn && check.detectedMonth) {
            prefilled[index] = check.detectedMonth;
          }
        });
        setResolvedMonths(prefilled);
        setPrechecks(checks);
      }
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
    months: Record<number, string>,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const files = checks.map((check) => check.file);
      const fileMonths = checks.map((check, index) => months[index] ?? "");

      const parsed =
        files.length === 1
          ? await parseUwinCSVFile(files[0], fileMonths[0] || undefined)
          : await parseUwinMultipleCSVFiles(files, fileMonths);

      const geoErr = checkGeoAccess(parsed, auth);
      if (geoErr) {
        setError(geoErr);
        return;
      }
      onDataReady(parsed);
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

  const handleConfirmMonths = () => {
    if (!prechecks) return;
    for (let index = 0; index < prechecks.length; index += 1) {
      if (!prechecks[index].hasMonthColumn && !resolvedMonths[index]) {
        setError(`Please select the month for: ${prechecks[index].file.name}`);
        return;
      }
    }
    runParse(prechecks, resolvedMonths);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  };

  const handleReset = () => {
    setPrechecks(null);
    setResolvedMonths({});
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  if (prechecks) {
    const filesNeedingMonth = prechecks.filter((check) => !check.hasMonthColumn);

    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/70 px-6 py-5">
            <h2 className="text-base font-bold text-slate-900">Confirm Reporting Month</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              {filesNeedingMonth.length === 1
                ? "One file is missing a Month column. Select the reporting month before analysis."
                : "Some files are missing a Month column. Select the reporting month for each file before analysis."}
            </p>
          </div>

          <div className="space-y-4 px-6 py-6">
            {prechecks.map((check, index) => (
              <div
                key={check.file.name}
                className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-950">
                      {check.file.name}
                    </div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {check.hasMonthColumn
                        ? "Month column present"
                        : "Month selection required"}
                    </div>
                  </div>

                  {!check.hasMonthColumn ? (
                    <input
                      type="month"
                      value={resolvedMonths[index] ?? ""}
                      onChange={(event) =>
                        setResolvedMonths((prev) => ({
                          ...prev,
                          [index]: event.target.value,
                        }))
                      }
                      className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
                    />
                  ) : null}
                </div>
              </div>
            ))}

            {error ? (
              <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleConfirmMonths}
                disabled={isLoading}
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
          <div className="border-b border-white/70 px-6 py-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              Upload dataset
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-950">
              Upload U-WIN CSV files
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Upload one to twelve monthly session-site CSV files. If a file
              does not contain a Month column, you will be asked to
              confirm that month before analysis begins.
            </p>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <button
              type="button"
              className="group rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-amber-300 hover:bg-amber-50/40"
              onClick={() => fileRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-slate-950 text-white shadow-[0_18px_38px_rgba(15,23,42,0.16)] transition group-hover:-translate-y-0.5">
                <Upload className="h-7 w-7" />
              </div>
              <div className="mt-4 text-base font-bold text-slate-950">
                Drop U-WIN CSV files here or browse from your machine
              </div>
              <div className="mt-2 text-sm text-slate-500">
                Up to twelve monthly files. CSV format only.
              </div>
            </button>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <button
                onClick={() => fileRef.current?.click()}
                type="button"
                disabled={isLoading || isPrechecking}
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

          <div className="border-t border-white/70 px-6 py-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            Files are processed in-memory for the current session only.
          </div>
        </GlassPanel>
    </div>
  );
}

import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import type { AuthState } from "../dqa/LoginPage";
import { GlassPanel } from "../branding/GlassPanel";
import { PreUploadInfoForm } from "../dqa/PreUploadInfoForm";
import {
  EMPTY_PRE_UPLOAD_INFO,
  isPreUploadInfoComplete,
  logUploadSession,
  type PreUploadInfo,
} from "../../lib/dqa/preUploadOptions";
import { parsePctsFiles } from "../../lib/pcts/parser";
import type { PctsParsed } from "../../lib/pcts/types";

interface Props {
  auth: AuthState;
  onBack: () => void;
  onDataReady: (data: PctsParsed, reviewInfo: PreUploadInfo) => void;
}

const normalizeGeo = (value: string | null | undefined) =>
  (value ?? "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function PctsLandingPage({ auth, onBack, onDataReady }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preInfo, setPreInfo] = useState(EMPTY_PRE_UPLOAD_INFO);
  const [parsed, setParsed] = useState<PctsParsed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const infoComplete = isPreUploadInfoComplete(preInfo, auth.level);

  const handleFiles = async (files: File[]) => {
    if (!infoComplete || files.length === 0) return;
    setLoading(true);
    setError("");
    setParsed(null);

    try {
      if (
        auth.role !== "admin" &&
        (auth.level !== "DISTRICT" || normalizeGeo(auth.geoState) !== "rajasthan")
      ) {
        throw new Error("PCTS review is available only to Rajasthan district users.");
      }
      const result = await parsePctsFiles(files, {
        expectedDistrictName:
          auth.role === "admin" ? undefined : (auth.geoDistrict ?? undefined),
      });
      if (
        auth.role !== "admin" &&
        auth.geoDistrict &&
        normalizeGeo(result.districtName) !== normalizeGeo(auth.geoDistrict)
      ) {
        throw new Error(
          `Access denied: these files are for ${result.districtName}, but your assigned district is ${auth.geoDistrict}.`,
        );
      }
      setParsed(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to read the PCTS files.");
    } finally {
      setLoading(false);
    }
  };

  const analyse = () => {
    if (!parsed) return;
    const months = Object.keys(parsed.months).sort();
    logUploadSession("PCTS", preInfo, {
      state: parsed.stateName,
      district: parsed.districtName,
      periodStart: months[0] ?? null,
      periodEnd: months[months.length - 1] ?? null,
      blockCount: parsed.globalBlockCount,
      facilityCount: parsed.globalFacilityCount,
      sessionSiteCount: null,
    }).catch((cause) => console.error("PCTS upload session log failed:", cause));
    onDataReady(parsed, preInfo);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <GlassPanel className="overflow-hidden">
        <div className="border-b border-slate-200/70 px-6 py-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
            Rajasthan district review
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-950">
            Upload PCTS immunization coverage files
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Upload one to twelve monthly facility-wise PCTS Excel reports. The district,
            reporting month, hierarchy, indicator schema, and published totals are read
            directly from every workbook.
          </p>
        </div>

        <div className="px-6 pt-6">
          <PreUploadInfoForm auth={auth} value={preInfo} onChange={setPreInfo} />
        </div>

        <div className="px-6 py-6">
          <button
            type="button"
            disabled={!infoComplete || loading}
            onClick={() => inputRef.current?.click()}
            onDrop={(event) => {
              event.preventDefault();
              void handleFiles(Array.from(event.dataTransfer.files));
            }}
            onDragOver={(event) => event.preventDefault()}
            className="group w-full rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200"
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-slate-950 text-white shadow-[0_18px_38px_rgba(15,23,42,0.16)] transition group-hover:-translate-y-0.5">
              <Upload className="h-7 w-7" />
            </div>
            <div className="mt-4 text-base font-bold text-slate-950">
              Drop the monthly PCTS files here or browse
            </div>
            <div className="mt-2 text-sm text-slate-500">
              1–12 Rajasthan PCTS reports in `.xlsx` or `.xls`
            </div>
            {!infoComplete ? (
              <div className="mt-3 text-xs font-semibold text-amber-600">
                Complete the review details above to enable upload.
              </div>
            ) : null}
          </button>

          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />

          {loading ? (
            <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading hierarchy, indicators, and published totals…
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          ) : null}

          {parsed ? (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                {parsed.fileNames.length} file{parsed.fileNames.length === 1 ? "" : "s"} passed structural validation
              </div>

              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">District</th>
                      <th className="px-4 py-3 text-right">Groups</th>
                      <th className="px-4 py-3 text-right">Facilities</th>
                      <th className="px-4 py-3 text-right">Rural / Urban</th>
                      <th className="px-4 py-3 text-right">Indicators</th>
                      <th className="px-4 py-3 text-right">Total checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.fileSummaries.map((summary) => (
                      <tr key={`${summary.fileName}-${summary.month}`} className="border-t border-slate-100">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{summary.fileName}</td>
                        <td className="px-4 py-2.5">{summary.month}</td>
                        <td className="px-4 py-2.5">{summary.districtName}</td>
                        <td className="px-4 py-2.5 text-right">{summary.blockCount}</td>
                        <td className="px-4 py-2.5 text-right">{summary.facilityCount}</td>
                        <td className="px-4 py-2.5 text-right">
                          {summary.ruralCount} / {summary.urbanCount}
                        </td>
                        <td className="px-4 py-2.5 text-right">{summary.indicatorCount}</td>
                        <td className="px-4 py-2.5 text-right">
                          {summary.reconciliationIssueCount === 0 ? (
                            <span className="font-semibold text-emerald-700">Matched</span>
                          ) : (
                            <span className="font-semibold text-amber-700">
                              {summary.reconciliationIssueCount} issue(s)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {parsed.validationIssues.map((issue, index) => (
                <div
                  key={`${issue.code}-${issue.fileName ?? "all"}-${index}`}
                  className={[
                    "rounded-2xl border px-4 py-3 text-sm",
                    issue.severity === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : issue.severity === "info"
                        ? "border-sky-200 bg-sky-50 text-sky-800"
                        : "border-amber-200 bg-amber-50 text-amber-800",
                  ].join(" ")}
                >
                  {issue.message}
                </div>
              ))}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={analyse}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3 text-sm font-bold text-white shadow-[0_18px_38px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Confirm and analyse
                </button>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4" />
                  Choose different files
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-6">
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

        <div className="border-t border-slate-200/70 px-6 py-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
          Files are processed in memory and source workbooks are not stored.
        </div>
      </GlassPanel>
    </div>
  );
}

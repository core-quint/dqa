import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Download, FileClock, FilePlus2, FileSpreadsheet, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { FilterState } from "../../lib/dqa/types";
import type { PreUploadInfo } from "../../lib/dqa/preUploadOptions";
import type { UwinComputedKpis, UwinParsedCSV } from "../../lib/uwin/types";
import {
  createUwinStateReport,
  generateUwinStateAiNarrative,
  getUwinStateAiStatus,
  downloadSavedUwinStateReportPdf,
  getUwinStateReport,
  getUwinStateReportPeriod,
  listUwinStateReports,
  uploadUwinStateReportPdf,
  updateUwinStateReportStatus,
  type UwinStateReportRecord,
} from "../../lib/uwin/stateReports";
import { downloadUwinStateDistrictAnnex, generateUwinStateExecutivePdf } from "../../lib/uwin/stateReportPdf";
import {
  compareUwinStateReports,
  findPreviousComparableReport,
  latestReportPerPeriod,
  type ReportComparison,
} from "../../lib/uwin/stateReportComparison";
import type { AuthState } from "../dqa/LoginPage";
import { UwinStateActionTracker } from "./UwinStateActionTracker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

interface Props {
  csv: UwinParsedCSV;
  kpis: UwinComputedKpis;
  filters: FilterState;
  reviewInfo: PreUploadInfo | null;
  auth: AuthState;
}

function formatDate(value: string | null) {
  if (!value) return "Pending timestamp";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function previousRevision(report: UwinStateReportRecord, reports: UwinStateReportRecord[]) {
  return reports
    .filter((candidate) => candidate.periodStart === report.periodStart && candidate.periodEnd === report.periodEnd && candidate.version < report.version)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function UwinStateReportDialog({ csv, kpis, filters, reviewInfo, auth }: Props) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<UwinStateReportRecord[]>([]);
  const [allReports, setAllReports] = useState<UwinStateReportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [artifactBusy, setArtifactBusy] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{ current: UwinStateReportRecord; previous: UwinStateReportRecord; result: ReportComparison } | null>(null);
  const [actionReport, setActionReport] = useState<UwinStateReportRecord | null>(null);
  const [aiStatus, setAiStatus] = useState<{ enabled: boolean; model: string } | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const period = getUwinStateReportPeriod(csv);

  const loadReports = useCallback(async () => {
    if (!period.periodStart || !period.periodEnd) return;
    setLoading(true);
    setError(null);
    try {
      const [periodHistory, stateHistory] = await Promise.all([
        listUwinStateReports(csv.stateName, period.periodStart, period.periodEnd),
        listUwinStateReports(csv.stateName),
      ]);
      setReports(periodHistory);
      setAllReports(stateHistory);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [csv.stateName, period.periodEnd, period.periodStart]);

  useEffect(() => {
    if (open) {
      void loadReports();
      getUwinStateAiStatus().then((status) => { setAiStatus(status); setUseAi(status.enabled); }).catch(() => setAiStatus({ enabled: false, model: "Unavailable" }));
    }
  }, [loadReports, open]);

  const saveDraft = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let report = await createUwinStateReport(csv, kpis, filters, reviewInfo, useAi ? "AI_ASSISTED" : "DETERMINISTIC");
      let aiFallback = false;
      if (useAi && !report.aiNarrative && !report.pdfAvailable) {
        try {
          await generateUwinStateAiNarrative(report.id);
          report = await getUwinStateReport(report.id);
        } catch {
          aiFallback = true;
        }
      }
      if (!report.pdfAvailable) {
        const generated = generateUwinStateExecutivePdf(report);
        await uploadUwinStateReportPdf(report.id, generated.blob);
      }
      setMessage(aiFallback
        ? `${report.reportNumber} was saved with the deterministic narrative because the AI output was unavailable or did not pass validation.`
        : report.reused
        ? `${report.reportNumber} already represents this exact analysis. Its saved report is ready.`
        : `${report.reportNumber} and its three-page PDF were saved as a new draft.`);
      await loadReports();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save report draft");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700">
          <FileClock className="h-3.5 w-3.5" />
          State reports
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>U-WIN State report registry</DialogTitle>
          <DialogDescription>
            {csv.stateName} · {period.periodStart} to {period.periodEnd}. Previous versions are retained for audit and comparison.
          </DialogDescription>
        </DialogHeader>

        {actionReport ? <UwinStateActionTracker report={actionReport} onBack={() => setActionReport(null)} /> : <>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">Current analysis</div>
            <div className="mt-1 text-xs text-slate-600">
              {kpis.globalDen.toLocaleString("en-IN")} {kpis.analysisMode === "sessionsite" ? "session sites" : "facilities"} analysed
            </div>
          </div>
          <button
            type="button"
            onClick={saveDraft}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
            Generate & save report
          </button>
        </div>
        <label className={`flex items-start gap-3 rounded-xl border p-3 ${aiStatus?.enabled ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
          <input type="checkbox" checked={useAi} disabled={!aiStatus?.enabled} onChange={(event) => setUseAi(event.target.checked)} className="mt-0.5 h-4 w-4" />
          <span><span className="block text-xs font-semibold text-slate-800">Use guarded AI-assisted editorial narrative</span><span className="mt-0.5 block text-[11px] text-slate-500">{aiStatus?.enabled ? `${aiStatus.model}; facts, scores, priorities and actions remain deterministic. Cached per exact report.` : "Not enabled in the server configuration. The complete deterministic report is available."}</span></span>
        </label>

        {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Reports for this period</h3>
          <button type="button" onClick={() => void loadReports()} disabled={loading} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {latestReportPerPeriod(allReports).length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">Saved progress over time</div>
            <div className="mt-1 text-xs text-slate-500">The latest approved version is preferred; otherwise the latest saved draft is shown.</div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-slate-500"><tr><th className="pb-2">Period</th><th className="pb-2">Version</th><th className="pb-2">Overall</th><th className="pb-2">Availability</th><th className="pb-2">Accuracy</th><th className="pb-2">Consistency</th></tr></thead>
                <tbody>
                  {latestReportPerPeriod(allReports).slice(-6).map((item) => (
                    <tr key={item.id} className="border-t border-slate-200 text-slate-700">
                      <td className="py-2 font-semibold">{item.periodStart}–{item.periodEnd}</td><td>V{item.version}</td><td>{item.scores.overall.toFixed(1)}%</td><td>{item.scores.availability.toFixed(1)}%</td><td>{item.scores.accuracy.toFixed(1)}%</td><td>{item.scores.consistency.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {comparison ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="text-sm font-bold text-slate-900">Comparable-period progress</div>
            <div className="mt-1 text-xs text-slate-600">{comparison.previous.periodStart}–{comparison.previous.periodEnd} to {comparison.current.periodStart}–{comparison.current.periodEnd}</div>
            {comparison.result.comparable ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Overall", comparison.result.overallDelta],
                    ["Availability", comparison.result.componentDeltas.availability],
                    ["Accuracy", comparison.result.componentDeltas.accuracy],
                    ["Consistency", comparison.result.componentDeltas.consistency],
                  ].map(([label, delta]) => (
                    <div key={String(label)} className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className={`text-sm font-bold ${Number(delta) >= 0 ? "text-emerald-700" : "text-red-700"}`}>{Number(delta) >= 0 ? "+" : ""}{Number(delta).toFixed(1)} pp</div></div>
                  ))}
                </div>
                <div className="mt-3 text-xs text-slate-700">Districts improved: <strong>{comparison.result.districtsImproved}</strong> · declined: <strong>{comparison.result.districtsDeclined}</strong> · unchanged: <strong>{comparison.result.districtsUnchanged}</strong></div>
                {comparison.result.enteredCriticalOrHigh.length > 0 ? <div className="mt-2 text-xs text-red-700">Entered critical/high priority: {comparison.result.enteredCriticalOrHigh.join(", ")}</div> : null}
                {comparison.result.exitedCriticalOrHigh.length > 0 ? <div className="mt-1 text-xs text-emerald-700">Exited critical/high priority: {comparison.result.exitedCriticalOrHigh.join(", ")}</div> : null}
              </>
            ) : <div className="mt-3 text-sm text-amber-800">Not comparable: {comparison.result.reason}</div>}
          </div>
        ) : null}

        {loading && reports.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading report history…</div>
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">
            No report has been saved for this state and period.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{report.reportNumber}</div>
                    <div className="mt-1 text-xs text-slate-500">Saved {formatDate(report.createdAt)} by {report.createdBy?.email || "Unknown user"}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{report.aiNarrative?.validated ? "AI-assisted narrative · validated" : "Deterministic narrative"}</div>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">{report.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ["Overall", report.scores.overall],
                    ["Availability", report.scores.availability],
                    ["Accuracy", report.scores.accuracy],
                    ["Consistency", report.scores.consistency],
                    ["Units", report.counts.analysedUnits],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">{typeof value === "number" && label !== "Units" ? `${value.toFixed(1)}%` : Number(value).toLocaleString("en-IN")}</div>
                    </div>
                  ))}
                </div>
                {previousRevision(report, reports) ? (
                  <div className="mt-2 text-xs text-slate-500">
                    Revision change from V{previousRevision(report, reports)!.version}: {report.scores.overall - previousRevision(report, reports)!.scores.overall >= 0 ? "+" : ""}{(report.scores.overall - previousRevision(report, reports)!.scores.overall).toFixed(1)} percentage points. This reflects revised source data, not period-to-period progress.
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!report.pdfAvailable || artifactBusy === report.id}
                    onClick={async () => {
                      setArtifactBusy(report.id);
                      setError(null);
                      try { await downloadSavedUwinStateReportPdf(report); }
                      catch (downloadError) { setError(downloadError instanceof Error ? downloadError.message : "Download failed"); }
                      finally { setArtifactBusy(null); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    {artifactBusy === report.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Download PDF
                  </button>
                  <button
                    type="button"
                    disabled={artifactBusy === report.id}
                    onClick={async () => {
                      setArtifactBusy(report.id);
                      setError(null);
                      try { downloadUwinStateDistrictAnnex(await getUwinStateReport(report.id)); }
                      catch (annexError) { setError(annexError instanceof Error ? annexError.message : "Annex generation failed"); }
                      finally { setArtifactBusy(null); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    District annex
                  </button>
                  <button
                    type="button"
                    disabled={artifactBusy === report.id || !findPreviousComparableReport(report, allReports)}
                    onClick={async () => {
                      const previous = findPreviousComparableReport(report, allReports);
                      if (!previous) return;
                      setArtifactBusy(report.id);
                      setError(null);
                      try {
                        const [currentDetail, previousDetail] = await Promise.all([getUwinStateReport(report.id), getUwinStateReport(previous.id)]);
                        setComparison({ current: currentDetail, previous: previousDetail, result: compareUwinStateReports(currentDetail, previousDetail) });
                      } catch (comparisonError) {
                        setError(comparisonError instanceof Error ? comparisonError.message : "Comparison failed");
                      } finally { setArtifactBusy(null); }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Compare previous period
                  </button>
                  <button type="button" onClick={() => setActionReport(report)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"><ClipboardCheck className="h-3.5 w-3.5" />Action tracker</button>
                  {report.status === "DRAFT" ? (
                    <button
                      type="button"
                      disabled={artifactBusy === report.id || !report.pdfAvailable}
                      onClick={async () => { setArtifactBusy(report.id); setError(null); try { await updateUwinStateReportStatus(report.id, "REVIEWED"); await loadReports(); } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "Status update failed"); } finally { setArtifactBusy(null); } }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    ><ShieldCheck className="h-3.5 w-3.5" />Submit for review</button>
                  ) : null}
                  {report.status === "REVIEWED" && (auth.role === "admin" || auth.level === "NATIONAL") ? (
                    <button
                      type="button"
                      disabled={artifactBusy === report.id}
                      onClick={async () => { setArtifactBusy(report.id); setError(null); try { await updateUwinStateReportStatus(report.id, "APPROVED"); await loadReports(); } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "Approval failed"); } finally { setArtifactBusy(null); } }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    ><ShieldCheck className="h-3.5 w-3.5" />Approve report</button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        </>}
      </DialogContent>
    </Dialog>
  );
}

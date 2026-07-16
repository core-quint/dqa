import { useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Upload } from "lucide-react";
import type { AuthState } from "../dqa/LoginPage";
import { GlassPanel } from "../branding/GlassPanel";
import { PreUploadInfoForm } from "../dqa/PreUploadInfoForm";
import {
  EMPTY_PRE_UPLOAD_INFO,
  isPreUploadInfoComplete,
  logUploadSession,
  type PreUploadInfo,
} from "../../lib/dqa/preUploadOptions";
import { parseStateHmisFiles } from "../../lib/stateHmis/parser";
import type { StateHmisParsed } from "../../lib/stateHmis/types";

interface Props {
  auth: AuthState;
  onBack: () => void;
  onDataReady: (data: StateHmisParsed, reviewInfo: PreUploadInfo) => void;
}

export function StateHmisLandingPage({ auth, onBack, onDataReady }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preInfo, setPreInfo] = useState(EMPTY_PRE_UPLOAD_INFO);
  const [parsed, setParsed] = useState<StateHmisParsed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const infoComplete = isPreUploadInfoComplete(preInfo, auth.level);

  const handleFiles = async (files: File[]) => {
    if (!infoComplete || files.length === 0) return;
    setLoading(true); setError(""); setParsed(null);
    try {
      const result = await parseStateHmisFiles(files);
      if (auth.geoState && result.stateName.trim().toLowerCase() !== auth.geoState.trim().toLowerCase()) {
        throw new Error(`Access denied: this report is for ${result.stateName}, but your state is ${auth.geoState}.`);
      }
      setParsed(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the state HMIS files.");
    } finally { setLoading(false); }
  };

  const analyse = () => {
    if (!parsed) return;
    const months = Object.keys(parsed.months).sort();
    logUploadSession("HMIS_STATE", preInfo, {
      state: parsed.stateName,
      district: null,
      periodStart: months[0] ?? null,
      periodEnd: months[months.length - 1] ?? null,
      blockCount: null,
      facilityCount: null,
      sessionSiteCount: null,
      districtCount: parsed.districts.length,
    }).catch((err) => console.error("Upload session log failed:", err));
    onDataReady(parsed, preInfo);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <GlassPanel className="overflow-hidden">
        <div className="border-b border-slate-200/70 px-6 py-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
            Upload dataset
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-950">
            Upload HMIS State files
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
            Upload the monthly Data Item Wise (across districts) Excel exports for the review period. State, month, district roster, and M9 schema are detected from each workbook.
          </p>
        </div>
        <div className="px-6 pt-6"><PreUploadInfoForm auth={auth} value={preInfo} onChange={setPreInfo} /></div>
        <div className="px-6 py-6">
          <button type="button" disabled={!infoComplete || loading} onClick={() => inputRef.current?.click()}
            onDrop={(event) => { event.preventDefault(); void handleFiles(Array.from(event.dataTransfer.files)); }} onDragOver={(event) => event.preventDefault()}
            className="group w-full rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-slate-950 text-white shadow-[0_18px_38px_rgba(15,23,42,0.16)] transition group-hover:-translate-y-0.5"><Upload className="h-7 w-7" /></div>
            <div className="mt-4 text-base font-bold text-slate-950">Drop the HMIS State files here or browse from your machine</div>
            <div className="mt-2 text-sm text-slate-500">1–12 monthly Data Item Wise exports in `.xlsx` or `.xls`; the reporting month is read from inside each file.</div>
            {!infoComplete ? (
              <div className="mt-3 text-xs font-semibold text-amber-600">
                Complete the review details above to enable upload.
              </div>
            ) : null}
          </button>
          <input ref={inputRef} type="file" accept=".xls,.xlsx" multiple className="hidden" onChange={(event) => {
            void handleFiles(Array.from(event.target.files ?? [])); event.target.value = "";
          }} />
          {loading ? <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Reading and validating workbooks…</div> : null}
          {error ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          ) : null}

          {parsed ? (
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-5 w-5" />Files passed structural validation</div>
              <div className="overflow-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500"><tr><th className="px-4 py-3">File</th><th className="px-4 py-3">Month</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Districts</th><th className="px-4 py-3">M2</th><th className="px-4 py-3">M9</th></tr></thead>
                  <tbody>{parsed.fileSummaries.map((summary) => <tr key={summary.fileName} className="border-t border-slate-100"><td className="px-4 py-2.5 font-medium">{summary.fileName}</td><td className="px-4 py-2.5">{summary.month}</td><td className="px-4 py-2.5">{summary.stateName}</td><td className="px-4 py-2.5">{summary.districtCount}</td><td className="px-4 py-2.5">{summary.m2ItemCount}</td><td className="px-4 py-2.5">{summary.m9ItemCount}</td></tr>)}</tbody>
                </table>
              </div>
              {parsed.validationIssues.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{issue.message}</div>)}
              <button type="button" onClick={analyse} className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#14532d)] px-5 py-3 text-sm font-bold text-white shadow-[0_18px_38px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5"><Upload className="h-4 w-4" />Confirm and analyse</button>
            </div>
          ) : null}
          <div className="mt-6"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"><ArrowLeft className="h-4 w-4" />Back to portal selection</button></div>
        </div>
        <div className="border-t border-slate-200/70 px-6 py-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
          Files are processed in-memory for the current session only.
        </div>
      </GlassPanel>
    </div>
  );
}

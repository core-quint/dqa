import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import {
  listUwinStateReportActions,
  updateUwinStateReportAction,
  type ReportActionStatus,
  type UwinStateReportAction,
  type UwinStateReportRecord,
} from "../../lib/uwin/stateReports";

interface Props { report: UwinStateReportRecord; onBack: () => void; }
const STATUSES: ReportActionStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "VERIFIED", "OVERDUE"];

export function UwinStateActionTracker({ report, onBack }: Props) {
  const [actions, setActions] = useState<UwinStateReportAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listUwinStateReportActions(report.id).then(setActions).catch((err) => setError(err instanceof Error ? err.message : "Failed to load actions")).finally(() => setLoading(false));
  }, [report.id]);

  const counts = useMemo(() => Object.fromEntries(STATUSES.map((status) => [status, actions.filter((action) => action.status === status).length])), [actions]);
  const change = (id: string, field: keyof UwinStateReportAction, value: string | null) => {
    setActions((current) => current.map((action) => action.id === id ? { ...action, [field]: value } : action));
  };
  const save = async (action: UwinStateReportAction) => {
    setBusy(action.id); setError(null);
    try {
      const saved = await updateUwinStateReportAction(report.id, action.id, {
        status: action.status,
        responsibleOfficer: action.responsibleOfficer || null,
        dueDate: action.dueDate,
        progressNote: action.progressNote || null,
      });
      setActions((current) => current.map((item) => item.id === saved.id ? saved : item));
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update action"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600"><ArrowLeft className="h-3.5 w-3.5" />Back to report history</button>
      <div><div className="text-base font-bold text-slate-900">Action tracker · {report.reportNumber}</div><div className="mt-1 text-xs text-slate-500">Updates are saved with user and timestamp history.</div></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {STATUSES.map((status) => <div key={status} className="rounded-lg bg-slate-50 p-2"><div className="text-[9px] font-semibold text-slate-500">{status.replace(/_/g, " ")}</div><div className="text-lg font-bold text-slate-900">{counts[status]}</div></div>)}
      </div>
      {error ? <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
      {loading ? <div className="py-10 text-center text-sm text-slate-500">Loading actions…</div> : (
        <div className="space-y-3">
          {actions.map((action) => (
            <div key={action.id} className="rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-bold text-blue-700">{action.evidenceId} · {action.findingTitle}</div>
              <div className="mt-2 text-sm text-slate-800">{action.action}</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-slate-500">Status<select value={action.status} onChange={(event) => change(action.id, "status", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800">{STATUSES.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}</select></label>
                <label className="text-xs text-slate-500">Responsible officer<input value={action.responsibleOfficer ?? ""} onChange={(event) => change(action.id, "responsibleOfficer", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800" /></label>
                <label className="text-xs text-slate-500">Due date<input type="date" value={action.dueDate} onChange={(event) => change(action.id, "dueDate", event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800" /></label>
              </div>
              <label className="mt-3 block text-xs text-slate-500">Progress/verification note<textarea value={action.progressNote ?? ""} onChange={(event) => change(action.id, "progressNote", event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-xs text-slate-800" /></label>
              <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500">Verification: {action.verification}</span><button type="button" disabled={busy === action.id} onClick={() => void save(action)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{busy === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save</button></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

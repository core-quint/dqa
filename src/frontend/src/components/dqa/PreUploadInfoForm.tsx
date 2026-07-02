import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import type { AuthState } from "./LoginPage";
import {
  DESIGNATION_OPTIONS,
  PURPOSE_OPTIONS,
  REVIEW_MEETING_SUBOPTIONS,
  requiresPreUploadInfo,
  type PreUploadInfo,
} from "../../lib/dqa/preUploadOptions";

interface Props {
  auth: AuthState;
  value: PreUploadInfo;
  onChange: (value: PreUploadInfo) => void;
}

const selectClassName =
  "h-11 w-full rounded-2xl border border-slate-200/80 bg-white/90 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70";

const labelClassName =
  "mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500";

export function PreUploadInfoForm({ auth, value, onChange }: Props) {
  const level = auth.level;
  const [gpsStatus, setGpsStatus] = useState<"idle" | "captured" | "unavailable">("idle");

  useEffect(() => {
    if (!requiresPreUploadInfo(level)) return;
    if (!navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus("captured");
        onChange({ ...value, gpsLat: pos.coords.latitude, gpsLng: pos.coords.longitude });
      },
      () => setGpsStatus("unavailable"),
      { timeout: 8000 },
    );
    // Capture once on mount only — GPS is best-effort, not re-requested on every keystroke.
  }, [level]);

  if (!requiresPreUploadInfo(level)) return null;

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
          Review details
        </div>
        {gpsStatus === "captured" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
            <MapPin className="h-3 w-3" />
            Location captured
          </span>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelClassName}>Designation</span>
          <select
            value={value.designation}
            onChange={(event) => onChange({ ...value, designation: event.target.value })}
            className={selectClassName}
          >
            <option value="">Select designation</option>
            {DESIGNATION_OPTIONS[level].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelClassName}>Purpose</span>
          <select
            value={value.purpose}
            onChange={(event) =>
              onChange({
                ...value,
                purpose: event.target.value,
                purposeSubOption: "",
                purposeOtherText: "",
              })
            }
            className={selectClassName}
          >
            <option value="">Select purpose</option>
            {PURPOSE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {value.purpose === "Review Meeting" ? (
          <label className="block sm:col-span-2">
            <span className={labelClassName}>Review meeting type</span>
            <select
              value={value.purposeSubOption}
              onChange={(event) => onChange({ ...value, purposeSubOption: event.target.value })}
              className={selectClassName}
            >
              <option value="">Select meeting type</option>
              {REVIEW_MEETING_SUBOPTIONS[level].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {value.purpose === "Others" ? (
          <label className="block sm:col-span-2">
            <span className={labelClassName}>Please specify</span>
            <input
              type="text"
              value={value.purposeOtherText}
              onChange={(event) => onChange({ ...value, purposeOtherText: event.target.value })}
              placeholder="Describe the purpose"
              className={selectClassName}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

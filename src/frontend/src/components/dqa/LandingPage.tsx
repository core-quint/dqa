import { useRef, useState } from "react";
import {
  Upload,
  ExternalLink,
  AlertCircle,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import type { ParsedCSV } from "../../lib/dqa/types";
import { parseCSVFile } from "../../lib/dqa/csvParser";
import type { AuthState } from "./LoginPage";
import { GlassPanel } from "../branding/GlassPanel";

interface Props {
  onDataReady: (data: ParsedCSV) => void;
  auth: AuthState;
  onBack: () => void;
}


function checkGeoAccess(parsed: ParsedCSV, auth: AuthState): string | null {
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

export function LandingPage({ onDataReady, auth, onBack }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hmisFileRef = useRef<HTMLInputElement>(null);

  const handleHmisFile = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setError("Please upload a .csv file.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const parsed = await parseCSVFile(file);
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
          : "Failed to parse CSV file.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleHmisDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleHmisFile(file);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <GlassPanel className="overflow-hidden">
          <div className="border-b border-white/70 px-6 py-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500">
              Upload dataset
            </div>
            <div className="mt-2 text-2xl font-extrabold text-slate-950">
              Upload HMIS CSV
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
              Upload the facility-wise CSV for the review period.
            </p>
          </div>

          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <button
              type="button"
              className="group rounded-[28px] border-2 border-dashed border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.82))] p-10 text-center transition hover:border-sky-300 hover:bg-sky-50/50"
              onClick={() => hmisFileRef.current?.click()}
              onDrop={handleHmisDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-slate-950 text-white shadow-[0_18px_38px_rgba(15,23,42,0.16)] transition group-hover:-translate-y-0.5">
                <Upload className="h-7 w-7" />
              </div>
              <div className="mt-4 text-base font-bold text-slate-950">
                Drop the CSV here or browse from your machine
              </div>
              <div className="mt-2 text-sm text-slate-500">
                Facility-wise monthly HMIS export, CSV format only
              </div>
            </button>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <button
                onClick={() => hmisFileRef.current?.click()}
                type="button"
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
              <a
                href="https://hmis.mohfw.gov.in/#!/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
              >
                <ExternalLink className="h-4 w-4" />
                HMIS portal
              </a>
            </div>
          </div>

          <input
            ref={hmisFileRef}
            type="file"
            accept=".csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleHmisFile(file);
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

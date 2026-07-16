import { ArrowRight } from "lucide-react";
import type { AuthState } from "./LoginPage";
import { GlassPanel } from "../branding/GlassPanel";
import {
  canUsePcts,
  isAssignedRajasthanDistrict,
} from "../../lib/pcts/access";

interface Props {
  auth: AuthState;
  onSelectHmis: () => void;
  onSelectUwin: () => void;
  onSelectStateHmis: () => void;
  onSelectPcts: () => void;
}

const PORTAL_CARDS = [
  {
    key: "HMIS",
    title: "HMIS Review",
    description:
      "Upload the monthly HMIS facility-wise CSV for M9 analysis, completeness checks, and cross-month diagnostics.",
    accent: "linear-gradient(135deg, rgba(14,165,233,0.95), rgba(99,102,241,0.92))",
    bulletA: "Single-file monthly workflow",
    bulletB: "Availability, completeness, accuracy, and consistency",
  },
  {
    key: "PCTS",
    title: "PCTS Review",
    description:
      "Upload one to twelve Rajasthan PCTS district reports and assess block- and facility-level immunization data quality across months.",
    accent: "linear-gradient(135deg, rgba(225,29,72,0.94), rgba(249,115,22,0.92))",
    bulletA: "Multi-file monthly Excel workflow",
    bulletB: "Rajasthan PCTS availability, completeness, accuracy, and consistency",
  },
  {
    key: "U-WIN",
    title: "U-WIN Review",
    description:
      "Merge up to twelve session-site exports, confirm missing month metadata, and review immunization quality indicators in one pass.",
    accent: "linear-gradient(135deg, rgba(245,158,11,0.95), rgba(16,185,129,0.92))",
    bulletA: "Multi-file monthly merge",
    bulletB: "U-WIN-specific session and beneficiary logic",
  },
  {
    key: "HMIS-STATE",
    title: "HMIS State Review",
    description: "Merge up to twelve Monthly Data Item Wise reports and assess district-level M9 data quality.",
    accent: "linear-gradient(135deg, rgba(5,150,105,0.95), rgba(14,116,144,0.92))",
    bulletA: "Multi-file district-wise workflow",
    bulletB: "State-level completeness, accuracy, and consistency",
  },
];

export function PortalSelector({
  auth,
  onSelectHmis,
  onSelectUwin,
  onSelectStateHmis,
  onSelectPcts,
}: Props) {
  const isAdmin = auth.role === "admin";
  const isRajasthanDistrict = isAssignedRajasthanDistrict(auth);
  const hasPctsAccess = canUsePcts(auth);
  const cards = PORTAL_CARDS.filter((card) => {
    if (card.key === "HMIS") return isAdmin || !isRajasthanDistrict;
    if (card.key === "PCTS") return hasPctsAccess;
    if (card.key === "HMIS-STATE") return auth.level === "STATE" || isAdmin;
    return true;
  });
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <div className="grid gap-5 md:grid-cols-2">
        {cards.map((card) => {
          const isHmis = card.key === "HMIS";
          return (
            <button
              key={card.key}
              type="button"
              onClick={
                isHmis
                  ? onSelectHmis
                  : card.key === "PCTS"
                    ? onSelectPcts
                    : card.key === "U-WIN"
                      ? onSelectUwin
                      : onSelectStateHmis
              }
              className="group text-left"
            >
              <GlassPanel className="h-full overflow-hidden transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_28px_60px_rgba(15,23,42,0.16)]">
                <div className="px-6 py-5" style={{ background: card.accent }}>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-white/70">
                    Portal
                  </div>
                  <div className="mt-1 text-3xl font-extrabold text-white">
                    {card.key}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-lg font-bold text-slate-900">{card.title}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{card.description}</p>
                  <div className="mt-5 space-y-1.5 rounded-2xl bg-slate-50 px-4 py-3.5">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                      Covers
                    </div>
                    <div className="text-sm font-medium text-slate-700">{card.bulletA}</div>
                    <div className="text-sm font-medium text-slate-700">{card.bulletB}</div>
                  </div>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                    Open module
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </GlassPanel>
            </button>
          );
        })}
      </div>
    </div>
  );
}

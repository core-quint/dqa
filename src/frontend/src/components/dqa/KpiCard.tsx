import { ArrowUpRight } from "lucide-react";
import type { KpiCard as KpiCardType } from "../../lib/dqa/types";

interface Props {
  card: KpiCardType;
  top3?: string[];
  onClick?: () => void;
}

const GROUP_STYLE: Record<
  string,
  { badgeBg: string; badgeText: string; accent: string; panel: string }
> = {
  availability: {
    badgeBg: "#e8f1fb",
    badgeText: "#1c5cab",
    accent: "#2a78d6",
    panel: "linear-gradient(180deg, rgba(232,241,251,0.6), rgba(255,255,255,1))",
  },
  completeness: {
    badgeBg: "#eceafa",
    badgeText: "#3a2d85",
    accent: "#4a3aa7",
    panel: "linear-gradient(180deg, rgba(236,234,250,0.6), rgba(255,255,255,1))",
  },
  accuracy: {
    badgeBg: "#fdeee7",
    badgeText: "#b04516",
    accent: "#eb6834",
    panel: "linear-gradient(180deg, rgba(253,238,231,0.6), rgba(255,255,255,1))",
  },
  consistency: {
    badgeBg: "#e5f6ef",
    badgeText: "#0d7a54",
    accent: "#199e70",
    panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
  },
};

function resolveStyle(group: string, id: string) {
  if (id.startsWith("drop_")) {
    return {
      badgeBg: "#fbecf2",
      badgeText: "#a63762",
      accent: "#d55181",
      panel: "linear-gradient(180deg, rgba(251,236,242,0.6), rgba(255,255,255,1))",
    };
  }
  if (id === "t3" || id.startsWith("t3")) {
    return {
      badgeBg: "#fbf3e2",
      badgeText: "#8a5c00",
      accent: "#c98500",
      panel: "linear-gradient(180deg, rgba(251,243,226,0.6), rgba(255,255,255,1))",
    };
  }
  if (id.startsWith("iadd_")) {
    return {
      badgeBg: "#e5f6ef",
      badgeText: "#0d7a54",
      accent: "#3fae85",
      panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
    };
  }
  if (id.startsWith("co")) {
    return {
      badgeBg: "#0e7a54",
      badgeText: "#ffffff",
      accent: "#199e70",
      panel: "linear-gradient(180deg, rgba(229,246,239,0.6), rgba(255,255,255,1))",
    };
  }
  return (
    GROUP_STYLE[group] ?? {
      badgeBg: "#f1f5f9",
      badgeText: "#475569",
      accent: "#64748b",
      panel: "linear-gradient(180deg, rgba(248,250,252,0.6), rgba(255,255,255,1))",
    }
  );
}

export function KpiCard({ card, top3, onClick }: Props) {
  const { stat, name, group, id } = card;
  const isEmpty = stat.total === 0;
  const style = resolveStyle(group, id);

  const showSplit =
    group === "availability" ||
    id === "t2" ||
    id === "t6" ||
    id.startsWith("drop_") ||
    id.startsWith("co");

  return (
    <button
      type="button"
      className={[
        "group flex w-full flex-col gap-4 overflow-hidden rounded-[28px] border p-4 text-left transition-all md:p-5",
        isEmpty
          ? "cursor-not-allowed border-slate-200/70 opacity-55"
          : "cursor-pointer border-slate-200/90 hover:-translate-y-1 hover:shadow-[0_16px_32px_rgba(15,23,42,0.10)]",
      ].join(" ")}
      style={{
        background: style.panel,
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 10px 24px rgba(15,23,42,0.05)",
      }}
      onClick={isEmpty ? undefined : onClick}
      disabled={isEmpty}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ background: style.badgeBg, color: style.badgeText }}
        >
          {name}
        </span>

        {!isEmpty ? (
          <span
            className="flex h-10 w-10 items-center justify-center rounded-2xl border bg-white/80 transition group-hover:bg-white"
            style={{ borderColor: `${style.accent}33`, color: style.accent }}
          >
            <ArrowUpRight className="h-4 w-4" />
          </span>
        ) : null}
      </div>

      <div className="rounded-[24px] border border-slate-200/80 bg-white/76 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Flagged facilities
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-display text-4xl font-extrabold text-slate-950">
            {stat.total}
          </span>
          <span className="pb-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            total
          </span>
        </div>
      </div>

      {showSplit ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[22px] border border-slate-200/80 bg-white/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Any month
            </div>
            <div className="mt-1 text-xl font-bold text-slate-950">
              {stat.any}
            </div>
            <div className="text-xs text-slate-500">at least one period</div>
          </div>
          <div className="rounded-[22px] border border-slate-200/80 bg-white/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              All months
            </div>
            <div className="mt-1 text-xl font-bold text-slate-950">
              {stat.all}
            </div>
            <div className="text-xs text-slate-500">every selected period</div>
          </div>
        </div>
      ) : null}

      {top3 && top3.length > 0 ? (
        <div className="rounded-[22px] border border-slate-200/80 bg-white/70 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Quick hints
          </div>
          <div className="mt-2 space-y-1.5 text-sm text-slate-700">
            {top3.map((item) => (
              <div key={item} className="truncate">
                - {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em]">
        <span style={{ color: style.accent }}>
          {isEmpty ? "No affected facilities" : "Open drill-down"}
        </span>
        <span className="text-slate-400">
          {showSplit ? "Cards + detail views" : "Detail view"}
        </span>
      </div>
    </button>
  );
}

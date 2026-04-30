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
    badgeBg: "#fef2f2",
    badgeText: "#b91c1c",
    accent: "#ef4444",
    panel: "linear-gradient(180deg, rgba(254,242,242,0.96), rgba(255,255,255,0.92))",
  },
  completeness: {
    badgeBg: "#eef2ff",
    badgeText: "#4338ca",
    accent: "#6366f1",
    panel: "linear-gradient(180deg, rgba(238,242,255,0.96), rgba(255,255,255,0.92))",
  },
  accuracy: {
    badgeBg: "#fffbeb",
    badgeText: "#92400e",
    accent: "#f59e0b",
    panel: "linear-gradient(180deg, rgba(255,251,235,0.96), rgba(255,255,255,0.92))",
  },
  consistency: {
    badgeBg: "#f0fdf4",
    badgeText: "#166534",
    accent: "#22c55e",
    panel: "linear-gradient(180deg, rgba(240,253,244,0.96), rgba(255,255,255,0.92))",
  },
};

function resolveStyle(group: string, id: string) {
  if (id.startsWith("drop_")) {
    return {
      badgeBg: "#faf5ff",
      badgeText: "#7e22ce",
      accent: "#a855f7",
      panel: "linear-gradient(180deg, rgba(250,245,255,0.96), rgba(255,255,255,0.92))",
    };
  }
  if (id === "t3" || id.startsWith("t3")) {
    return {
      badgeBg: "#eff6ff",
      badgeText: "#1d4ed8",
      accent: "#3b82f6",
      panel: "linear-gradient(180deg, rgba(239,246,255,0.96), rgba(255,255,255,0.92))",
    };
  }
  if (id.startsWith("iadd_")) {
    return {
      badgeBg: "#dcfce7",
      badgeText: "#14532d",
      accent: "#22c55e",
      panel: "linear-gradient(180deg, rgba(220,252,231,0.96), rgba(255,255,255,0.92))",
    };
  }
  if (id.startsWith("co")) {
    return {
      badgeBg: "#166534",
      badgeText: "#ffffff",
      accent: "#15803d",
      panel: "linear-gradient(180deg, rgba(240,253,244,0.96), rgba(255,255,255,0.92))",
    };
  }
  return (
    GROUP_STYLE[group] ?? {
      badgeBg: "#f1f5f9",
      badgeText: "#475569",
      accent: "#64748b",
      panel: "linear-gradient(180deg, rgba(248,250,252,0.96), rgba(255,255,255,0.92))",
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
          : "cursor-pointer border-white/80 hover:-translate-y-1 hover:shadow-[0_24px_44px_rgba(15,23,42,0.14)]",
      ].join(" ")}
      style={{
        background: style.panel,
        boxShadow: "0 16px 34px rgba(15,23,42,0.08)",
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

      <div className="rounded-[24px] border border-white/80 bg-white/76 p-4">
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
          <div className="rounded-[22px] border border-white/80 bg-white/70 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Any month
            </div>
            <div className="mt-1 text-xl font-bold text-slate-950">
              {stat.any}
            </div>
            <div className="text-xs text-slate-500">at least one period</div>
          </div>
          <div className="rounded-[22px] border border-white/80 bg-white/70 px-4 py-3">
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
        <div className="rounded-[22px] border border-white/80 bg-white/70 px-4 py-3">
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

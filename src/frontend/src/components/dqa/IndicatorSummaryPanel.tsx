import { ArrowUpRight } from "lucide-react";

export interface RankedIndicatorCard {
  id: string;
  name: string;
  total: number;
  any: number;
  all: number;
}

interface GroupMetaLike {
  label: string;
  color: string;
  surface: string;
  bar: string;
  ring: string;
}

interface Props {
  meta: GroupMetaLike;
  monthsCount: number;
  totalUnits: number;
  /** Lowercase plural of the analysed unit, e.g. "facilities", "session sites", "districts". */
  unitLabel: string;
  affectedUnique: number;
  cards: RankedIndicatorCard[];
  onOpenCard: (id: string) => void;
  subtitle?: string;
}

function severityBadge(pct: number) {
  if (pct >= 50) {
    return { bg: "bg-red-100", text: "text-red-700", label: "High" };
  }
  if (pct >= 25) {
    return { bg: "bg-amber-100", text: "text-amber-700", label: "Medium" };
  }
  return { bg: "bg-emerald-100", text: "text-emerald-700", label: "Low" };
}

export function IndicatorSummaryPanel({
  meta,
  monthsCount,
  totalUnits,
  unitLabel,
  affectedUnique,
  cards,
  onOpenCard,
  subtitle = "Open any indicator to inspect charts, tables, and summaries.",
}: Props) {
  const sortedCards = [...cards].sort((a, b) => b.total - a.total);
  const maxAffected = sortedCards[0]?.total ?? 0;
  const worstPct = Math.round((maxAffected / totalUnits) * 100);

  return (
    <div
      className={`overflow-hidden rounded-[30px] ring-1 ${meta.ring}`}
      style={{
        background: `linear-gradient(140deg, ${meta.surface}, rgba(255,255,255,0.82))`,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-3 px-5 py-4 text-white"
        style={{ background: meta.color }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/72">
          Indicator summary
        </span>
        <span className="text-sm font-bold">{meta.label}</span>
        <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
          {monthsCount} months / {totalUnits} {unitLabel}
        </span>
      </div>

      <div className="grid gap-px bg-white/50 sm:grid-cols-3">
        {[
          {
            label: "Worst impact",
            value: `${worstPct}%`,
            sub: `${unitLabel} affected`,
          },
          {
            label: "Unique affected",
            value: String(affectedUnique),
            sub: `of ${totalUnits} ${unitLabel}`,
          },
          {
            label: "Indicators",
            value: String(sortedCards.length),
            sub: "in this component",
          },
        ].map((item) => (
          <div key={item.label} className="bg-white/72 px-5 py-4 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {item.label}
            </div>
            <div className="mt-2 text-3xl font-extrabold text-slate-950">
              {item.value}
            </div>
            <div className="mt-1 text-xs font-medium text-slate-500">
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 md:p-5">
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Indicators ranked by impact
          </div>
          <div className="mt-1 text-sm font-medium text-slate-600">
            {subtitle}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {sortedCards.map((card, index) => {
            const pct = Math.round((card.total / totalUnits) * 100);
            const anyPct = Math.round((card.any / totalUnits) * 100);
            const allPct = Math.round((card.all / totalUnits) * 100);
            const severity = severityBadge(pct);
            const isEmpty = card.total === 0;

            return (
              <button
                key={card.id}
                type="button"
                disabled={isEmpty}
                onClick={isEmpty ? undefined : () => onOpenCard(card.id)}
                className={[
                  "rounded-[24px] border border-slate-200/70 bg-white/78 p-4 text-left shadow-[0_14px_30px_rgba(15,23,42,0.08)] transition",
                  isEmpty
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-pointer hover:-translate-y-1 hover:shadow-[0_16px_32px_rgba(15,23,42,0.12)]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Indicator {index + 1}
                    </div>
                    <div className="mt-1 text-sm font-bold text-slate-950">
                      {card.name}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${severity.bg} ${severity.text}`}
                  >
                    {severity.label}
                  </span>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>Affected {unitLabel}</span>
                    <span className="font-bold text-slate-800">
                      {card.total} / {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full ${meta.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-slate-50/80 px-3 py-3 text-center">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Any month
                    </div>
                    <div className="mt-1 text-lg font-bold text-slate-900">
                      {card.any}
                    </div>
                    <div className="text-xs text-slate-500">
                      {anyPct}% of {unitLabel}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50/80 px-3 py-3 text-center">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      All months
                    </div>
                    <div className="mt-1 text-lg font-bold text-slate-900">
                      {card.all}
                    </div>
                    <div className="text-xs text-slate-500">
                      {allPct}% of {unitLabel}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em]">
                  <span style={{ color: meta.color }}>
                    {isEmpty ? `No affected ${unitLabel}` : "Open drill-down"}
                  </span>
                  {!isEmpty ? (
                    <ArrowUpRight className="h-4 w-4" style={{ color: meta.color }} />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

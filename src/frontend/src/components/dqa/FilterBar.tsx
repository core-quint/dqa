import { useState } from "react";
import { ChevronUp, SlidersHorizontal } from "lucide-react";
import { GlassPanel } from "../branding/GlassPanel";

interface FilterBarProps {
  children: React.ReactNode;
  title?: string;
  /** One line under the title saying what the controls do for this tab. */
  hint?: string;
}

/**
 * The analysis filters, laid out as a horizontal bar directly under the data
 * quality components. It replaces the old left-hand rail: filters now read as a
 * toolbar for the results below them, and the results get the full page width.
 *
 * Open by default — the rail defaulted to collapsed on desktop, which hid the
 * controls behind an icon. Hiding is still available, just no longer the default.
 */
export function FilterBar({
  children,
  title = "Filters",
  hint = "Narrow the analysis, then apply.",
}: FilterBarProps) {
  const [open, setOpen] = useState(true);

  return (
    <GlassPanel className="px-4 py-3 md:px-5 md:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {title}
            </div>
            <div className="text-xs text-slate-500">{hint}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <ChevronUp className={`h-3.5 w-3.5 transition-transform ${open ? "" : "rotate-180"}`} />
          {open ? "Hide" : "Show"} filters
        </button>
      </div>

      {open ? (
        <div className="mt-4 border-t border-slate-200/80 pt-4">{children}</div>
      ) : null}
    </GlassPanel>
  );
}

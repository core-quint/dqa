import { SlidersHorizontal } from "lucide-react";
import { GlassPanel } from "../branding/GlassPanel";

interface FilterBarProps {
  children: React.ReactNode;
  title?: string;
}

/**
 * The analysis filters as a single horizontal strip under the data quality
 * components. Everything — controls and Apply — lives on one row; the panel is
 * deliberately thin so the results keep the page.
 */
export function FilterBar({ children, title = "Filters" }: FilterBarProps) {
  return (
    <GlassPanel className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {title}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </GlassPanel>
  );
}

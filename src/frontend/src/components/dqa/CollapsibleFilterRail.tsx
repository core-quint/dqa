import { useEffect, useState } from "react";
import { ChevronsLeft, Filter } from "lucide-react";
import { GlassPanel } from "../branding/GlassPanel";

interface CollapsibleFilterRailProps {
  children: React.ReactNode;
  title?: string;
}

export function CollapsibleFilterRail({
  children,
  title = "Filters",
}: CollapsibleFilterRailProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
    };

    setIsDesktop(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      setCollapsed(false);
    }
  }, [isDesktop]);

  const showCollapsed = isDesktop && collapsed;

  return (
    <div
      className={[
        "w-full shrink-0 transition-all duration-300 lg:self-start",
        showCollapsed ? "lg:w-12" : "lg:w-[288px]",
      ].join(" ")}
    >
      <div className="sticky top-4">
        {showCollapsed ? (
          <GlassPanel className="p-0">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand filters"
              aria-expanded="false"
              className="flex min-h-[320px] w-full flex-col items-center gap-4 px-0 py-4 text-slate-700 transition hover:bg-white/55"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-[0_16px_24px_rgba(15,23,42,0.18)]">
                <Filter className="h-4 w-4" />
              </span>
              <span
                className="rotate-180 text-[10px] font-semibold uppercase tracking-[0.26em] text-slate-500"
                style={{ writingMode: "vertical-rl" }}
              >
                {title}
              </span>
            </button>
          </GlassPanel>
        ) : (
          <GlassPanel className="p-4 md:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {title}
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse filters"
                aria-expanded="true"
                className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/88 text-slate-500 transition hover:bg-slate-950 hover:text-white lg:inline-flex"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
            {children}
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

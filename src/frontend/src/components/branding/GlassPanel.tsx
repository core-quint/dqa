import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type PanelTone = "default" | "muted" | "warm" | "dark";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
}

const TONE_MAP: Record<PanelTone, string> = {
  default:
    "border-slate-200/90 bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)]",
  muted:
    "border-slate-200/80 bg-slate-50/70 text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
  warm:
    "border-slate-200/90 bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.06)]",
  dark:
    "border-white/10 bg-[#08111d] text-white shadow-[0_26px_60px_rgba(2,6,23,0.42)]",
};

export function GlassPanel({
  className,
  tone = "default",
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn("rounded-[28px] border", TONE_MAP[tone], className)}
      {...props}
    />
  );
}

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type PanelTone = "default" | "muted" | "warm" | "dark";

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
}

const TONE_MAP: Record<PanelTone, string> = {
  default:
    "border-white/75 bg-white/72 text-slate-900 shadow-[0_24px_60px_rgba(15,23,42,0.12)]",
  muted:
    "border-white/70 bg-white/60 text-slate-900 shadow-[0_20px_44px_rgba(15,23,42,0.10)]",
  warm:
    "border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(252,248,241,0.82))] text-slate-900 shadow-[0_26px_60px_rgba(15,23,42,0.12)]",
  dark:
    "border-white/10 bg-[#08111d]/84 text-white shadow-[0_26px_60px_rgba(2,6,23,0.42)]",
};

export function GlassPanel({
  className,
  tone = "default",
  ...props
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        "rounded-[28px] border backdrop-blur-xl",
        TONE_MAP[tone],
        className,
      )}
      {...props}
    />
  );
}

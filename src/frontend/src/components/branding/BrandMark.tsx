import logo from "../../../assets/logo.png";
import { cn } from "@/lib/utils";

type BrandSize = "sm" | "md" | "lg";
type BrandTone = "light" | "dark";

interface BrandMarkProps {
  className?: string;
  size?: BrandSize;
  tone?: BrandTone;
  showText?: boolean;
  title?: string;
  subtitle?: string;
  caption?: string;
}

const SIZE_MAP: Record<
  BrandSize,
  {
    gap: string;
    tile: string;
    title: string;
    subtitle: string;
    caption: string;
  }
> = {
  sm: {
    gap: "gap-3",
    tile: "h-11 w-11 rounded-2xl p-2.5",
    title: "text-sm",
    subtitle: "text-[11px]",
    caption: "text-[10px]",
  },
  md: {
    gap: "gap-4",
    tile: "h-16 w-16 rounded-[24px] p-3.5",
    title: "text-lg",
    subtitle: "text-xs",
    caption: "text-[11px]",
  },
  lg: {
    gap: "gap-5",
    tile: "h-20 w-20 rounded-[28px] p-4",
    title: "text-2xl",
    subtitle: "text-sm",
    caption: "text-xs",
  },
};

const TONE_MAP: Record<
  BrandTone,
  {
    tile: string;
    title: string;
    subtitle: string;
    caption: string;
  }
> = {
  light: {
    tile: "border-white/80 bg-white/80 shadow-[0_24px_50px_rgba(15,23,42,0.14)]",
    title: "text-slate-950",
    subtitle: "text-slate-600",
    caption: "text-slate-500",
  },
  dark: {
    tile: "border-white/10 bg-white/10 shadow-[0_24px_50px_rgba(2,6,23,0.34)]",
    title: "text-white",
    subtitle: "text-white/70",
    caption: "text-white/45",
  },
};

export function BrandMark({
  className,
  size = "md",
  tone = "light",
  showText = true,
  title = "Data Quality Assessment",
  subtitle = "Review Application",
  caption,
}: BrandMarkProps) {
  const sizeMap = SIZE_MAP[size];
  const toneMap = TONE_MAP[tone];

  return (
    <div className={cn("flex items-center", sizeMap.gap, className)}>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border",
          sizeMap.tile,
          toneMap.tile,
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(244,169,64,0.32),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(72,184,106,0.24),transparent_52%)]" />
        <img
          src={logo}
          alt="DQA logo"
          className="relative h-full w-full object-contain"
        />
      </div>

      {showText ? (
        <div className="min-w-0">
          <div className={cn("font-display font-extrabold leading-tight", sizeMap.title, toneMap.title)}>
            {title}
          </div>
          {subtitle ? (
            <div className={cn("font-medium tracking-[0.02em]", sizeMap.subtitle, toneMap.subtitle)}>
              {subtitle}
            </div>
          ) : null}
          {caption ? (
            <div className={cn("mt-1 uppercase tracking-[0.24em] font-semibold", sizeMap.caption, toneMap.caption)}>
              {caption}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

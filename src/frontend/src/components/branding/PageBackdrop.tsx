import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageBackdrop({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden bg-[#f6f2e9] text-slate-900",
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-20 top-[-5rem] h-80 w-80 rounded-full bg-[#f4a940]/22 blur-3xl" />
        <div className="absolute right-[-4rem] top-8 h-72 w-72 rounded-full bg-[#48b86a]/16 blur-3xl" />
        <div className="absolute bottom-[-7rem] left-1/3 h-96 w-96 rounded-full bg-[#2563eb]/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.08) 1px, transparent 1px)",
            backgroundPosition: "center center",
            backgroundSize: "84px 84px",
          }}
        />
      </div>

      <div className="relative">{children}</div>
    </div>
  );
}

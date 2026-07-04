import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function PageBackdrop({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative min-h-screen bg-white text-slate-900", className)}
      {...props}
    >
      <div className="relative">{children}</div>
    </div>
  );
}

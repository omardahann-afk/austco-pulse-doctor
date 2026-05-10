import type { HealthStatus } from "@/lib/types";
import { STATUS_BG } from "@/lib/deviceClassifier";
import { cn } from "@/lib/utils";

export function StatusPill({ status, className }: { status: HealthStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        STATUS_BG[status],
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "Healthy" && "bg-success",
          status === "Warning" && "bg-warning",
          status === "Critical" && "bg-critical animate-pulse",
          status === "Offline" && "bg-muted-foreground",
          status === "Scanning" && "bg-info animate-pulse",
        )}
      />
      {status}
    </span>
  );
}

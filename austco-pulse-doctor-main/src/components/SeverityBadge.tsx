import { AlertTriangle, AlertOctagon, Info } from "lucide-react";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAP: Record<Severity, { cls: string; Icon: typeof Info; label: string }> = {
  Critical: { cls: "bg-critical/15 text-critical border-critical/40", Icon: AlertOctagon, label: "Critical" },
  Warning: { cls: "bg-warning/15 text-warning border-warning/40", Icon: AlertTriangle, label: "Warning" },
  Info: { cls: "bg-info/15 text-info border-info/40", Icon: Info, label: "Info" },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const m = MAP[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        m.cls,
        className,
      )}
    >
      <m.Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}
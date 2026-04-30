import type { Confidence } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAP: Record<Confidence, string> = {
  High: "bg-success/10 text-success border-success/30",
  Medium: "bg-warning/10 text-warning border-warning/30",
  Low: "bg-muted text-muted-foreground border-border",
};

export function ConfidenceBadge({ confidence, className }: { confidence: Confidence; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", MAP[confidence], className)}>
      Confidence: {confidence}
    </span>
  );
}

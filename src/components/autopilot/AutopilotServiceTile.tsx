import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<string, string> = {
  LOW:    "border-success/40 bg-success/10 text-success",
  MEDIUM: "border-warning/40 bg-warning/10 text-warning",
  HIGH:   "border-critical/40 bg-critical/10 text-critical",
};

export function AutopilotServiceTile({
  icon, shortName, description, riskClass, monitoredCount, onClick,
}: {
  icon: string;
  shortName: string;
  description: string;
  riskClass: string;
  monitoredCount: number;
  onClick?: () => void;
}) {
  const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[icon] ?? Icons.Cog;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-full min-h-[140px] w-full flex-col justify-between overflow-hidden rounded-lg border bg-card/60 p-3.5 text-left transition-all",
        "border-border/60 hover:border-primary/60 hover:bg-card hover:shadow-[0_0_0_1px_var(--ring),0_8px_24px_-12px_oklch(0_0_0/0.6)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-primary group-hover:border-primary/60 group-hover:bg-primary/10">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[12px] font-bold uppercase leading-tight tracking-wider">{shortName}</div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{monitoredCount} registered</div>
          </div>
        </div>
        <span className={cn("inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest", RISK_STYLES[riskClass] ?? RISK_STYLES.MEDIUM)}>
          {riskClass}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">{description}</p>
      <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-primary/80 opacity-0 transition-opacity group-hover:opacity-100">
        + Register service
      </div>
    </button>
  );
}
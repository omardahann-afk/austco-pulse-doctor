import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";

export type InfrastructureTileProps = {
  icon: string;
  shortName: string;
  description: string;
  critical?: boolean;
  active?: boolean;
  monitoredCount?: number;
  onClick?: () => void;
};

export function InfrastructureTile({ icon, shortName, description, critical, active, monitoredCount, onClick }: InfrastructureTileProps) {
  const Icon = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[icon] ?? Icons.Server;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-full min-h-[128px] w-full flex-col justify-between overflow-hidden rounded-lg border bg-card/60 p-3.5 text-left transition-all",
        "border-border/60 hover:border-primary/60 hover:bg-card hover:shadow-[0_0_0_1px_var(--ring),0_8px_24px_-12px_oklch(0_0_0/0.6)]",
        active && "border-primary/80 bg-primary/5 shadow-[0_0_0_1px_var(--ring)]",
      )}
    >
      {critical && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-sm border border-critical/40 bg-critical/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-critical">
          CRITICAL
        </span>
      )}
      <div className="flex items-start gap-2.5">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-primary transition-colors",
          "group-hover:border-primary/60 group-hover:bg-primary/10",
          active && "border-primary/70 bg-primary/15",
        )}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[12px] font-bold uppercase leading-tight tracking-wider text-foreground">
            {shortName}
          </div>
          {typeof monitoredCount === "number" && (
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {monitoredCount} monitored
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 line-clamp-3 text-[11.5px] leading-snug text-muted-foreground">
        {description}
      </p>
      <div className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-primary/80 opacity-0 transition-opacity group-hover:opacity-100">
        + Deploy probe
      </div>
    </button>
  );
}
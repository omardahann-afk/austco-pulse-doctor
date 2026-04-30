import type { ChainStep } from "@/lib/breakpointEngine";
import { CheckCircle2, XCircle, Loader2, Circle, MinusCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function BreakpointMap({ steps }: { steps: ChainStep[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-2 p-1">
        {steps.map((s, i) => {
          const tone =
            s.status === "Passed" ? "border-success/50 bg-success/10 text-success" :
            s.status === "Failed" ? "border-critical/60 bg-critical/15 text-critical shadow-[0_0_24px_-6px_var(--critical)]" :
            s.status === "Running" ? "border-info/60 bg-info/10 text-info" :
            s.status === "Skipped" ? "border-border bg-muted/20 text-muted-foreground opacity-60" :
            "border-border bg-muted/20 text-muted-foreground";
          const Icon =
            s.status === "Passed" ? CheckCircle2 :
            s.status === "Failed" ? XCircle :
            s.status === "Running" ? Loader2 :
            s.status === "Skipped" ? MinusCircle : Circle;
          return (
            <div key={s.id} className="flex items-center gap-1.5">
              <div className={cn("min-w-[180px] max-w-[220px] rounded-lg border p-2.5", tone)}>
                <div className="flex items-center gap-1.5">
                  <Icon className={cn("h-3.5 w-3.5", s.status === "Running" && "animate-spin")} />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">{s.layer}</span>
                  <span className="ml-auto rounded bg-background/40 px-1 font-mono text-[9px] uppercase opacity-70">{s.source}</span>
                </div>
                <div className="mt-1 text-xs font-medium leading-snug">{s.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug opacity-80">{s.detail}</div>
              </div>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
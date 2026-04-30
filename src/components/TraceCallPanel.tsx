import type { TraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2, Circle } from "lucide-react";

export function TraceCallPanel({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-stretch gap-2 p-1">
        {steps.map((s, idx) => {
          const colour =
            s.status === "Passed" ? "border-success/50 bg-success/10 text-success" :
            s.status === "Failed" ? "border-critical/60 bg-critical/10 text-critical shadow-[0_0_24px_-6px_var(--critical)]" :
            s.status === "Running" ? "border-info/60 bg-info/10 text-info" :
            "border-border bg-muted/20 text-muted-foreground";
          const Icon = s.status === "Passed" ? CheckCircle2 : s.status === "Failed" ? XCircle : s.status === "Running" ? Loader2 : Circle;
          return (
            <div key={s.id} className="flex items-center gap-2">
              <div className={cn("min-w-[180px] rounded-lg border p-3", colour)}>
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", s.status === "Running" && "animate-spin")} />
                  <span className="text-xs font-semibold uppercase tracking-wide">{s.label}</span>
                </div>
                <p className="mt-1 text-[11px] leading-snug opacity-90">{s.detail}</p>
                {s.timestamp && <p className="mt-1 font-mono text-[10px] opacity-70">{new Date(s.timestamp).toLocaleTimeString()}</p>}
              </div>
              {idx < steps.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

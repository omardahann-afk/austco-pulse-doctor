import type { DiagnosticModule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Circle } from "lucide-react";

export function ModuleProgressList({ modules }: { modules: DiagnosticModule[] }) {
  return (
    <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card/60">
      {modules.map((m, i) => {
        const cfg =
          m.status === "Passed" ? { Icon: CheckCircle2, color: "text-success", bg: "bg-success/10" } :
          m.status === "Warning" ? { Icon: AlertTriangle, color: "text-warning", bg: "bg-warning/10" } :
          m.status === "Failed" ? { Icon: XCircle, color: "text-critical", bg: "bg-critical/10" } :
          m.status === "Scanning" ? { Icon: Loader2, color: "text-info", bg: "bg-info/10" } :
          { Icon: Circle, color: "text-muted-foreground", bg: "bg-muted/20" };
        return (
          <li key={m.id} className="flex items-start gap-3 p-3">
            <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", cfg.bg)}>
              <cfg.Icon className={cn("h-4 w-4", cfg.color, m.status === "Scanning" && "animate-spin")} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">M{(i + 1).toString().padStart(2, "0")}</span>
                  <span className="text-sm font-medium">{m.name}</span>
                </div>
                <span className={cn("text-[11px] font-medium uppercase tracking-wide", cfg.color)}>{m.status}</span>
              </div>
              <p className="text-xs text-muted-foreground">{m.description}</p>
              {m.findings.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {m.findings.map((f, j) => <li key={j} className="font-mono text-[11.5px] text-foreground/75">· {f}</li>)}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

import { cn } from "@/lib/utils";
import type { AutopilotPlan, AutopilotExecutionReport } from "@/lib/agentClient";

type Entry = { at: string | null; label: string; tone: "muted" | "primary" | "success" | "destructive" | "warning"; detail?: string };

const DOT: Record<Entry["tone"], string> = {
  muted: "bg-muted-foreground",
  primary: "bg-primary",
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
};

function fmt(t: string | null) {
  if (!t) return "—";
  try { return new Date(t).toLocaleTimeString(); } catch { return t; }
}

export function AuditTimeline({ plan, report, approved, aiExplained, lastScanAt }: {
  plan: AutopilotPlan;
  report: AutopilotExecutionReport | null;
  approved: boolean;
  aiExplained: string | null;
  lastScanAt: string | null;
}) {
  const entries: Entry[] = [];
  entries.push({ at: lastScanAt, label: "Issue detected", tone: "warning", detail: `${plan.serviceName} · ${plan.issueType}` });
  entries.push({ at: plan.createdAt, label: "Root cause generated", tone: "primary", detail: plan.rootCause });
  entries.push({ at: plan.createdAt, label: "Playbook selected", tone: "primary", detail: plan.issueType });
  entries.push({ at: plan.createdAt, label: "Commands rendered from templates", tone: "primary", detail: `${plan.actions.length} action(s)` });
  entries.push({
    at: report?.startedAt ?? null,
    label: approved ? "Approval granted" : "Awaiting approval",
    tone: approved ? "success" : "muted",
    detail: approved ? "Technician acknowledged" : "Plan held for review",
  });
  if (report) {
    entries.push({
      at: report.finishedAt,
      label: report.success ? "Commands executed" : "Execution failed",
      tone: report.success ? "success" : "destructive",
      detail: `${report.actionsRun} action(s)`,
    });
    entries.push({
      at: report.finishedAt,
      label: report.fixVerified ? "Verification passed" : "Verification not confirmed",
      tone: report.fixVerified ? "success" : "warning",
    });
  }
  if (aiExplained) {
    entries.push({ at: aiExplained, label: "AI explanation generated", tone: "primary", detail: "Copilot · explanation only" });
  }

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Safety audit trail</div>
      <ol className="relative space-y-2 border-l border-border/60 pl-4">
        {entries.map((e, i) => (
          <li key={i} className="relative">
            <span className={cn("absolute -left-[1.1rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background", DOT[e.tone])} />
            <div className="flex items-start justify-between gap-3 text-xs">
              <div>
                <div className="font-medium">{e.label}</div>
                {e.detail && <div className="text-[11px] text-muted-foreground">{e.detail}</div>}
              </div>
              <div className="shrink-0 font-mono text-[10px] text-muted-foreground">{fmt(e.at)}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
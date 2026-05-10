import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, HandMetal } from "lucide-react";
import type { AutopilotPlan, AutopilotExecutionReport, AutopilotActionResult } from "@/lib/agentClient";

type Verdict = "fixed" | "not_fixed" | "manual";

function verdictFor(plan: AutopilotPlan, report: AutopilotExecutionReport): Verdict {
  if (plan.riskLevel === "HIGH") return "manual";
  if (report.fixVerified || (report.success && plan.verification === "manual")) return "fixed";
  return "not_fixed";
}

const VERDICT_STYLES: Record<Verdict, { cls: string; label: string; icon: React.ReactNode }> = {
  fixed: { cls: "border-success/40 bg-success/10 text-success", label: "Fixed", icon: <ShieldCheck className="h-5 w-5" /> },
  not_fixed: { cls: "border-destructive/40 bg-destructive/10 text-destructive", label: "Not fixed", icon: <ShieldAlert className="h-5 w-5" /> },
  manual: { cls: "border-warning/40 bg-warning/10 text-warning", label: "Needs manual escalation", icon: <HandMetal className="h-5 w-5" /> },
};

function StateChip({ data }: { data?: { ok?: boolean; matched?: boolean } | null }) {
  if (!data) return <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">unknown</span>;
  const matched = data.matched;
  const cls = matched === true ? "bg-success/15 text-success" : matched === false ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground";
  const label = matched === true ? "matched" : matched === false ? "did not match" : data.ok ? "ran" : "error";
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", cls)}>{label}</span>;
}

function ActionRow({ a }: { a: AutopilotActionResult }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{a.label || a.actionId}</span>
        <span className={cn("text-[10px] font-semibold uppercase", a.ok ? "text-success" : "text-destructive")}>{a.ok ? "OK" : "FAIL"}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Before</div>
            <StateChip data={a.before} />
          </div>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5 font-mono text-[10px]">{a.before?.stdout?.trim() || "—"}</pre>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Action</div>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-primary/5 p-1.5 font-mono text-[10px] text-primary">{a.command || "—"}</pre>
          {typeof a.exitCode === "number" && <div className="text-[10px] text-muted-foreground">exit {a.exitCode} · {a.durationMs ?? 0}ms</div>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">After</div>
            <StateChip data={a.verify} />
          </div>
          <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5 font-mono text-[10px]">{a.verify?.stdout?.trim() || "—"}</pre>
        </div>
      </div>
    </div>
  );
}

export function ProofPanel({ plan, report }: { plan: AutopilotPlan; report: AutopilotExecutionReport }) {
  const v = verdictFor(plan, report);
  const vs = VERDICT_STYLES[v];
  const actionable = report.commandOutputs.filter((r) => r.command || r.before || r.verify);

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Before / After Proof</div>
        <div className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-1 text-sm font-semibold", vs.cls)}>
          {vs.icon}
          {vs.label}
        </div>
      </div>
      <div className="space-y-2">
        {actionable.length === 0 && <div className="text-xs text-muted-foreground">No before/after evidence captured for this plan.</div>}
        {actionable.map((a) => <ActionRow key={a.actionId} a={a} />)}
      </div>
    </div>
  );
}
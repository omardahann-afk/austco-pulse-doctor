import { Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AutopilotPlan, AutopilotExecutionReport } from "@/lib/agentClient";

type State = "PASS" | "WARN" | "FAIL" | "PENDING";

function stateIcon(s: State) {
  if (s === "PASS") return <Check className="h-3.5 w-3.5" />;
  if (s === "WARN") return <AlertTriangle className="h-3.5 w-3.5" />;
  if (s === "FAIL") return <X className="h-3.5 w-3.5" />;
  return <span className="block h-2 w-2 rounded-full bg-current" />;
}

const STATE_CLS: Record<State, string> = {
  PASS: "bg-success/15 text-success border-success/30",
  WARN: "bg-warning/15 text-warning border-warning/30",
  FAIL: "bg-destructive/15 text-destructive border-destructive/30",
  PENDING: "bg-muted text-muted-foreground border-border",
};

export function ConfidenceLadder({ plan, report, approved }: {
  plan: AutopilotPlan;
  report: AutopilotExecutionReport | null;
  approved: boolean;
}) {
  const hasEvidence = (plan.evidence?.length ?? 0) > 0;
  const hasRootCause = !!plan.rootCause;
  const playbookMatched = (plan.actions?.length ?? 0) > 0 || (plan.manualNotes?.length ?? 0) > 0;
  const allAllowlisted = plan.actions.length > 0 && plan.actions.every((a) => !a.blocked || a.risk === "HIGH");
  const someBlocked = plan.actions.some((a) => a.blocked);
  const requiresApproval = plan.requiresApproval === true;
  const verifyAvailable = plan.actions.some((a) => !!a.verifyCommand);

  const steps: { label: string; state: State; detail: string }[] = [
    { label: "Detection evidence", state: hasEvidence ? "PASS" : "WARN", detail: hasEvidence ? `${plan.evidence.length} signal(s)` : "no log evidence captured" },
    { label: "Root cause identified", state: hasRootCause ? "PASS" : "WARN", detail: plan.rootCause || "—" },
    { label: "Playbook matched", state: playbookMatched ? "PASS" : "FAIL", detail: plan.issueType || "no match" },
    { label: "Commands allowlisted", state: allAllowlisted ? (someBlocked ? "WARN" : "PASS") : "FAIL", detail: someBlocked ? "some actions blocked" : "all actions resolved from templates" },
    { label: "Approval required", state: requiresApproval ? "PASS" : "WARN", detail: approved ? "approved by technician" : "awaiting approval" },
    { label: "Verification available", state: verifyAvailable ? "PASS" : "WARN", detail: verifyAvailable ? (report?.fixVerified ? "verified after run" : "verify command ready") : "manual verification" },
  ];

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fix confidence ladder</div>
        <div className="text-[11px] text-muted-foreground">deterministic · {(plan.confidence * 100).toFixed(0)}% engine confidence</div>
      </div>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className="w-4 text-center text-[10px] font-mono text-muted-foreground">{i + 1}</span>
            <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full border", STATE_CLS[s.state])}>
              {stateIcon(s.state)}
            </span>
            <span className="font-medium">{s.label}</span>
            <span className="ml-auto truncate text-[11px] text-muted-foreground">{s.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
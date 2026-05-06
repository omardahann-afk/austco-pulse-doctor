import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Play, Square, RefreshCw, ShieldAlert, ShieldCheck, AlertTriangle, Copy, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadSiteConfig } from "@/lib/siteConfig";
import {
  autopilotGetStatus, autopilotScanNow, autopilotStart, autopilotStop,
  autopilotGetPlan, autopilotExecute, autopilotVerify,
  type AutopilotStatus, type AutopilotPlan, type AutopilotIssue, type AutopilotExecutionReport, type AutopilotRisk,
} from "@/lib/agentClient";

export const Route = createFileRoute("/autopilot")({
  head: () => ({
    meta: [
      { title: "Autopilot — Tacera Doctor" },
      { name: "description", content: "Safe deterministic remediation engine: detects issues, prepares fix plans, executes only after technician approval." },
    ],
  }),
  component: AutopilotPage,
});

const RISK_STYLES: Record<AutopilotRisk, string> = {
  LOW: "bg-success/10 text-success border-success/30",
  MEDIUM: "bg-warning/10 text-warning border-warning/30",
  HIGH: "bg-destructive/10 text-destructive border-destructive/30",
};

function RiskPill({ risk }: { risk: AutopilotRisk }) {
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", RISK_STYLES[risk])}>{risk}</span>;
}

function AutopilotPage() {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<AutopilotPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [report, setReport] = useState<AutopilotExecutionReport | null>(null);

  const refresh = async () => {
    const r = await autopilotGetStatus();
    if ("ok" in r && r.ok) { setStatus(r); setError(null); }
    else setError(("message" in r && r.message) || "Failed to load Autopilot status.");
  };

  useEffect(() => { refresh(); }, []);

  const enabledServices = useMemo(() => loadSiteConfig().services.filter((s) => s.enabled !== false), []);

  const scanNow = async () => {
    setBusy("scan"); setError(null);
    const r = await autopilotScanNow({ services: enabledServices });
    setBusy(null);
    if (!("ok" in r) || !r.ok) { setError(("message" in r && r.message) || "Scan failed."); return; }
    await refresh();
  };

  const startLoop = async () => {
    setBusy("start"); setError(null);
    const r = await autopilotStart({ services: enabledServices, intervalMs: 60_000 });
    setBusy(null);
    if (!("ok" in r) || !r.ok) { setError(("message" in r && r.message) || "Start failed."); return; }
    await refresh();
  };

  const stopLoop = async () => {
    setBusy("stop"); setError(null);
    await autopilotStop();
    setBusy(null);
    await refresh();
  };

  const openPlan = async (planId: string) => {
    setOpenPlanId(planId);
    setPlan(null); setReport(null); setPlanError(null);
    setAcknowledged(false);
    const r = await autopilotGetPlan(planId);
    if ("ok" in r && r.ok) setPlan(r.plan);
    else setPlanError(("message" in r && r.message) || "Plan not found.");
  };

  const issues: AutopilotIssue[] = status?.lastScan?.issues ?? [];

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <PageHeader
        eyebrow="Autopilot"
        title="Safe Remediation Engine"
        description="Continuously monitors configured services, prepares deterministic fix plans, and executes only after technician approval. AI explains, the engine decides."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={!!busy}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button size="sm" onClick={scanNow} disabled={!!busy}>{busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Scan Now</Button>
            {status?.loopRunning ? (
              <Button size="sm" variant="destructive" onClick={stopLoop} disabled={!!busy}><Square className="h-4 w-4" />Stop Autopilot</Button>
            ) : (
              <Button size="sm" variant="default" onClick={startLoop} disabled={!!busy}><Play className="h-4 w-4" />Start Autopilot</Button>
            )}
          </div>
        }
      />

      {error && (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />{error}</CardContent></Card>
      )}

      {/* 1. Status */}
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Loop" value={status?.loopRunning ? "Running" : "Stopped"} tone={status?.loopRunning ? "success" : "muted"} />
          <Stat label="Monitored services" value={String(status?.monitoredCount ?? enabledServices.length)} />
          <Stat label="Last scan" value={status?.lastScanAt ? new Date(status.lastScanAt).toLocaleTimeString() : "—"} />
          <Stat label="Open issues" value={String(status?.currentIssueCount ?? 0)} tone={(status?.currentIssueCount ?? 0) > 0 ? "warning" : "success"} />
        </CardContent>
      </Card>

      {/* 2. Issues + plans */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Detected issues</h2>
        {issues.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-muted-foreground">No issues detected. Run a scan to check current state.</CardContent></Card>
        ) : issues.map((it) => (
          <Card key={it.planId}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{it.serviceName}</span>
                    <span className="text-xs text-muted-foreground">{it.role} · {it.host}</span>
                  </div>
                  <div className="mt-0.5 text-sm">{it.rootCause} <span className="text-xs text-muted-foreground">({it.issueType})</span></div>
                </div>
                <div className="flex items-center gap-2">
                  <RiskPill risk={it.riskLevel} />
                  <span className="text-[11px] text-muted-foreground">conf {(it.confidence * 100).toFixed(0)}%</span>
                  <Button size="sm" variant={openPlanId === it.planId ? "default" : "outline"} onClick={() => openPlan(it.planId)}>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", openPlanId === it.planId && "rotate-180")} />
                    {openPlanId === it.planId ? "Hide plan" : "Show plan"}
                  </Button>
                </div>
              </div>

              {openPlanId === it.planId && (
                <PlanPanel
                  plan={plan}
                  loading={!plan && !planError}
                  error={planError}
                  password={password}
                  setPassword={setPassword}
                  acknowledged={acknowledged}
                  setAcknowledged={setAcknowledged}
                  report={report}
                  setReport={setReport}
                  setError={setError}
                  onRefresh={refresh}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* 3. Recent executions */}
      {status?.recentExecutions?.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent executions</h2>
          {status.recentExecutions.slice(0, 10).map((r) => (
            <Card key={r.executionId}>
              <CardContent className="space-y-1 p-4 text-sm">
                <div className="flex items-center gap-2">
                  {r.success ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
                  <span className="font-medium">{r.success ? "Success" : "Failed"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString()} · {r.actionsRun} action(s)</span>
                </div>
                <div className="text-xs text-muted-foreground">plan {r.planId}</div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning" | "muted" }) {
  const toneCls = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold", toneCls)}>{value}</div>
    </div>
  );
}

function PlanPanel(props: {
  plan: AutopilotPlan | null;
  loading: boolean;
  error: string | null;
  password: string;
  setPassword: (s: string) => void;
  acknowledged: boolean;
  setAcknowledged: (b: boolean) => void;
  report: AutopilotExecutionReport | null;
  setReport: (r: AutopilotExecutionReport | null) => void;
  setError: (s: string | null) => void;
  onRefresh: () => void;
}) {
  const { plan, loading, error, password, setPassword, acknowledged, setAcknowledged, report, setReport, setError, onRefresh } = props;
  const [running, setRunning] = useState(false);

  if (loading) return <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading plan…</div>;
  if (error) return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  if (!plan) return null;

  const hasMedium = plan.actions.some((a) => a.risk === "MEDIUM" && !a.blocked);
  const allBlocked = plan.actions.every((a) => a.blocked || a.risk === "HIGH");

  const exec = async (mode: "all" | "readonly") => {
    if (!plan.serviceRef) { setError("Plan has no service credentials reference."); return; }
    if (!password) { setError("SSH password is required to execute on the target host."); return; }
    if (mode === "all" && hasMedium && !acknowledged) { setError("Acknowledge the restart before executing."); return; }
    setRunning(true); setError(null);
    const r = mode === "all"
      ? await autopilotExecute({ planId: plan.planId, password, acknowledged })
      : await autopilotVerify({ planId: plan.planId, password });
    setRunning(false);
    if ("ok" in r && r.ok) { setReport(r.report); onRefresh(); }
    else setError(("message" in r && r.message) || ("reason" in r && r.reason) || "Execution failed.");
  };

  const copyPlan = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(plan, null, 2)); } catch {}
  };

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium">{plan.summary}</div>
          <div className="text-xs text-muted-foreground">plan {plan.planId} · verify: {plan.verification}{plan.rollbackAvailable ? " · rollback available" : ""}</div>
        </div>
        <div className="flex items-center gap-2"><RiskPill risk={plan.riskLevel} /></div>
      </div>

      {plan.evidence.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Evidence ({plan.evidence.length})</summary>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            {plan.evidence.map((e, i) => <li key={i} className="rounded bg-background/50 px-2 py-1">{e}</li>)}
          </ul>
        </details>
      )}

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planned actions</div>
        {plan.actions.map((a) => (
          <div key={a.id} className="rounded border border-border/40 bg-background/40 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.label}</span>
              <RiskPill risk={a.risk} />
            </div>
            {a.blocked ? (
              <div className="mt-1 text-destructive">Blocked: {a.blockReason}</div>
            ) : (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px]">{a.command}</pre>
            )}
            {a.verifyCommand && <div className="mt-1 text-[11px] text-muted-foreground">Verify: <span className="font-mono">{a.verifyCommand}</span>{a.verifyExpect ? ` (expect /${a.verifyExpect}/)` : ""}</div>}
            <div className="mt-1 text-[11px] text-muted-foreground">{a.explanation}</div>
          </div>
        ))}
      </div>

      {plan.manualNotes.length > 0 && (
        <div className="rounded border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
          {plan.manualNotes.map((n, i) => <div key={i}>⚠ {n}</div>)}
        </div>
      )}

      {plan.riskLevel === "HIGH" ? (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <div className="font-semibold">Manual action required.</div>
          <div className="text-xs">High-risk remediations (config edits, certificate replacement, CCP, DB writes, reboots) cannot be executed by Autopilot.</div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="ap-pw" className="text-xs">SSH password for {plan.serviceRef?.username}@{plan.host}</Label>
              <Input id="ap-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="required to execute" />
            </div>
            {hasMedium && (
              <label className="flex items-end gap-2 pb-1 text-xs">
                <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(Boolean(v))} />
                <span>I understand this will restart a service.</span>
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => exec("all")} disabled={running || allBlocked}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve and Execute
            </Button>
            <Button size="sm" variant="outline" onClick={() => exec("readonly")} disabled={running}>
              <RefreshCw className="h-4 w-4" /> Run Read-Only Checks
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setReport(null); }}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={copyPlan}><Copy className="h-4 w-4" />Copy Plan</Button>
          </div>
        </div>
      )}

      {report && <ReportPanel report={report} />}
    </div>
  );
}

function ReportPanel({ report }: { report: AutopilotExecutionReport }) {
  return (
    <div className="space-y-2 rounded border border-border/60 bg-background/40 p-3 text-xs">
      <div className="flex items-center gap-2">
        {report.success ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
        <span className="font-semibold">Execution {report.success ? "succeeded" : "failed"}</span>
        <span className="text-muted-foreground">· {new Date(report.startedAt).toLocaleTimeString()} → {new Date(report.finishedAt).toLocaleTimeString()}</span>
      </div>
      {report.commandOutputs.map((r) => (
        <details key={r.actionId} className="rounded bg-muted/40 p-2">
          <summary className="cursor-pointer">
            <span className={cn("mr-2 font-medium", r.ok ? "text-success" : "text-destructive")}>{r.ok ? "PASS" : "FAIL"}</span>
            {r.label || r.actionId}{typeof r.exitCode === "number" ? ` (exit ${r.exitCode})` : ""}{r.reason ? ` — ${r.reason}` : ""}
          </summary>
          {r.command && <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{r.command}</pre>}
          {r.stdout && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[10px]">{r.stdout}</pre>}
          {r.stderr && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-destructive/10 p-2 font-mono text-[10px] text-destructive">{r.stderr}</pre>}
          {r.verify && (
            <div className="mt-1 text-[11px]">Verify: {r.verify.matched === false ? <span className="text-destructive">did not match</span> : r.verify.matched ? <span className="text-success">matched</span> : "ran"}</div>
          )}
        </details>
      ))}
      {report.nextSteps?.length > 0 && (
        <div className="text-muted-foreground">Next: {report.nextSteps.join(" · ")}</div>
      )}
    </div>
  );
}
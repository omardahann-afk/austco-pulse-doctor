import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CheckCircle2, XCircle, AlertTriangle, AlertOctagon, Loader2, MinusCircle,
  Wrench, ChevronRight, ChevronDown, Workflow, Cpu, Network, ListTree,
  ServerCog, ShieldCheck, Activity, Clock, Database, Settings2, ArrowLeft,
  Wifi, Search, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDiagnosisRun, deriveFinalResult,
  type DiagnosisRunSnapshot, type FinalResult, type ModuleToggleKey,
} from "@/lib/diagnosisRunStore";
import type { ChainStep } from "@/lib/breakpointEngine";
import type { CallPointStep } from "@/lib/callPointTrace";
import type { RcTraceStep } from "@/lib/roomControllerDoctor";
import type { ServiceLogResult } from "@/lib/logEngine";

export const Route = createFileRoute("/diagnosis")({
  head: () => ({ meta: [
    { title: "Diagnosis — Austco Site Doctor" },
    { name: "description", content: "Trace-first diagnostic view: shows where the system broke, why, and how to fix it." },
  ]}),
  component: DiagnosisPage,
});

/* =================================================================== */
/*  Top-level page                                                     */
/* =================================================================== */

function DiagnosisPage() {
  const snap = useDiagnosisRun();
  const final = useMemo(() => deriveFinalResult(snap), [snap]);

  if (snap.state.status === "idle") return <IdleEmpty />;

  return (
    <div className="space-y-5">
      <TopBar snap={snap} />
      <FinalResultBlock final={final} snap={snap} />
      <ConfigEvidenceTopCard final={final} />
      <TraceFlowSection snap={snap} />
      <CcpAnalysisSection snap={snap} />
      <RoomControllerSection snap={snap} />
      <IpnetTreeSection snap={snap} />
      <ServiceHealthSection snap={snap} />
      <DeploymentHealthSection snap={snap} />
    </div>
  );
}

/* =================================================================== */
/*  Idle empty state                                                   */
/* =================================================================== */

function IdleEmpty() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Search className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">No diagnosis run yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Configure the site on the Command Center and press <span className="font-mono">Run Full Diagnosis</span>.
      </p>
      <Link to="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:bg-info/90">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Command Center
      </Link>
    </div>
  );
}

/* =================================================================== */
/*  TOP BAR                                                            */
/* =================================================================== */

function TopBar({ snap }: { snap: DiagnosisRunSnapshot }) {
  const { state } = snap;
  const site = state.status === "ready" ? state.site : snap.payload?.name ?? "Site";
  const dep  = state.status === "ready" ? state.deploymentType : snap.payload?.deploymentType ?? "—";
  const backendOk = state.status === "ready" ? state.backendOk : false;
  const ts = state.status === "ready" ? new Date(state.finishedAt).toLocaleString()
           : state.status === "running" ? `Started ${new Date(state.startedAt).toLocaleTimeString()}`
           : "—";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/70 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-info" />
        <span className="text-sm font-semibold">{site}</span>
      </div>
      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{dep}</Badge>
      <span className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        backendOk ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
      )}>
        <Wifi className="h-3 w-3" /> Backend: {backendOk ? "Connected" : "Mock"}
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" /> {ts}
        {state.status === "running" && <Loader2 className="ml-1 h-3 w-3 animate-spin text-info" />}
      </span>
      <Link to="/" className="inline-flex items-center gap-1 rounded border border-border/60 bg-background/50 px-2 py-1 text-[11px] hover:bg-background">
        <Settings2 className="h-3 w-3" /> Edit site
      </Link>
    </div>
  );
}

/* =================================================================== */
/*  FINAL RESULT                                                       */
/* =================================================================== */

function FinalResultBlock({ final, snap }: { final: FinalResult; snap: DiagnosisRunSnapshot }) {
  const running = snap.state.status === "running";
  const ok = final.ok;

  return (
    <Card className={cn(
      "overflow-hidden border-2",
      ok ? "border-success/50 bg-gradient-to-br from-success/15 to-success/5"
         : "border-critical/60 bg-gradient-to-br from-critical/20 to-critical/5 shadow-[0_0_60px_-20px_var(--critical)]",
    )}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
            ok ? "bg-success text-success-foreground" : "bg-critical text-critical-foreground",
          )}>
            {ok ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.2em]",
              ok ? "text-success" : "text-critical",
            )}>
              {ok ? "1 · Diagnosis Passed" : "1 · Break Found At"}
            </div>
            <h2 className="mt-0.5 text-xl font-bold leading-tight md:text-2xl">{final.breakAt}</h2>
            {final.previousStepPassed && !ok && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Last working step: <span className="font-mono text-foreground">{final.previousStepPassed}</span>
              </div>
            )}
            {running && (
              <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Trace still running — result may refine as more layers report.
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SourceBadge source={final.source} />
              <Badge variant="outline" className={cn(
                "text-[10px] uppercase tracking-wider",
                ok ? "border-success/60 text-success" : "border-critical/60 text-critical",
              )}>status: {ok ? "passed" : "failed"}</Badge>
              {final.failedLayer && !ok && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">layer: {final.failedLayer}</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <ResultBox label="2 · Why">
            <p>{final.why}</p>
          </ResultBox>
          <ResultBox label="3 · Evidence">
            {final.evidence.length === 0
              ? <p className="text-muted-foreground">No evidence rows — finding based on trace data only.</p>
              : (
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {final.evidence.slice(0, 4).map((e, i) => <li key={i}>• {e}</li>)}
                  {final.evidence.length > 4 && <li className="text-muted-foreground">… +{final.evidence.length - 4} more</li>}
                </ul>
              )}
          </ResultBox>
          <ResultBox label="4 · Fix Steps">
            {final.fix.length === 0
              ? <p className="text-muted-foreground">No fix required.</p>
              : (
                <ol className="list-decimal space-y-0.5 pl-4 text-[12px]">
                  {final.fix.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
          </ResultBox>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/50 p-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/* ---------- Source badge (single source of truth for source colors) ---------- */

function SourceBadge({ source }: { source: string }) {
  // Normalize known engine/source names to a common 5-tone palette.
  const k = source.toLowerCase();
  let tone: "scan" | "config" | "log" | "mock" | "manual" | "trace" = "trace";
  if (k.includes("log"))                                 tone = "log";
  else if (k.includes("config") || k.includes("sim-046") || k.includes("ccp")) tone = "config";
  else if (k.includes("scan") || k.includes("real"))     tone = "scan";
  else if (k.includes("manual") || k.includes("paste"))  tone = "manual";
  else if (k.includes("mock") || k === "none")           tone = "mock";
  const cls = {
    scan:   "bg-info/15 text-info",
    config: "bg-insight/15 text-insight",
    log:    "bg-success/15 text-success",
    mock:   "bg-muted/40 text-muted-foreground",
    manual: "bg-warning/15 text-warning",
    trace:  "bg-info/15 text-info",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>
      source: {source}
    </span>
  );
}

/* =================================================================== */
/*  TOP CONFIG EVIDENCE TABLE                                          */
/* =================================================================== */

function ConfigEvidenceTopCard({ final }: { final: FinalResult }) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-info" /> Config Evidence — proves the finding
          <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wider">
            {final.configEvidence.length} row{final.configEvidence.length === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {final.configEvidence.length === 0 ? (
          <div className="px-4 py-4 text-xs text-muted-foreground">
            Config evidence not available — finding based on trace/log data only.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Field</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {final.configEvidence.map((e, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-[11px]">{e.source}</TableCell>
                  <TableCell className="font-mono text-[11px]">{e.field}</TableCell>
                  <TableCell className="text-xs">{e.expected}</TableCell>
                  <TableCell className="text-xs text-critical">{e.actual}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{e.impact}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* =================================================================== */
/*  TRACE FLOW                                                         */
/* =================================================================== */

type UnifiedStep = {
  id: string;
  layer: string;
  label: string;
  detail: string;
  status: "Pending" | "Running" | "Passed" | "Failed" | "Skipped";
  evidence: string[];
  source: string;
};

function unifySteps(snap: DiagnosisRunSnapshot): UnifiedStep[] {
  // Prefer the SIM-046 trace (richest), fall back to call-point trace, then chain.
  // The CCP step is inserted between Room Controller and Output layers.
  const base =
    snap.rcSteps.length ? snap.rcSteps.map(toUnified) :
    snap.cpSteps.length ? snap.cpSteps.map(toUnified) :
    snap.chainSteps.map(toUnified);
  if (!snap.ccpStep) return base;
  const ccpUnified = toUnified(snap.ccpStep);
  // Insert after the last Room Controller / IPnet step, before Pulse Gateway.
  const insertIdx = (() => {
    const lastRc = [...base].map((s, i) => /room|ipnet|controller/i.test(s.layer) ? i : -1).filter((i) => i >= 0).pop();
    if (lastRc !== undefined) return lastRc + 1;
    return Math.min(2, base.length);
  })();
  return [...base.slice(0, insertIdx), ccpUnified, ...base.slice(insertIdx)];
}

function toUnified(s: RcTraceStep | CallPointStep | ChainStep): UnifiedStep {
  return {
    id: s.id, layer: s.layer, label: s.label, detail: s.detail,
    status: s.status as UnifiedStep["status"],
    evidence: s.evidence ?? [],
    source: (s as ChainStep).source ?? "mock",
  };
}

function TraceFlowSection({ snap }: { snap: DiagnosisRunSnapshot }) {
  const steps = unifySteps(snap);
  const failedIdx = steps.findIndex((s) => s.status === "Failed");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (steps.length === 0) {
    return (
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Trace Flow</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">Trace not started — Not tested.</CardContent>
      </Card>
    );
  }

  const selected = steps.find((s) => s.id === selectedId)
    ?? (failedIdx >= 0 ? steps[failedIdx] : steps[steps.length - 1]);

  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Workflow className="h-4 w-4 text-info" /> Trace Flow</span>
          <span className="text-[10px] font-normal text-muted-foreground">click any step to inspect</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <div className="flex min-w-max items-stretch gap-1.5 p-1">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1">
                <TraceStepChip
                  step={s}
                  selected={selected?.id === s.id}
                  onClick={() => setSelectedId(s.id)}
                />
                {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </div>

        {selected && <BreakpointDetails step={selected} />}
      </CardContent>
    </Card>
  );
}

function TraceStepChip({
  step, selected, onClick,
}: { step: UnifiedStep; selected: boolean; onClick: () => void }) {
  const tone =
    step.status === "Passed"  ? "border-success/50 bg-success/10 text-success" :
    step.status === "Failed"  ? "border-critical/70 bg-critical/20 text-critical shadow-[0_0_28px_-6px_var(--critical)] animate-pulse" :
    step.status === "Running" ? "border-info/60 bg-info/10 text-info" :
    step.status === "Skipped" ? "border-border bg-muted/20 text-muted-foreground opacity-60" :
                                "border-border bg-muted/20 text-muted-foreground";
  const Icon =
    step.status === "Passed"  ? CheckCircle2 :
    step.status === "Failed"  ? XCircle :
    step.status === "Running" ? Loader2 :
    step.status === "Skipped" ? MinusCircle : MinusCircle;
  return (
    <button type="button" onClick={onClick}
      title={`${step.layer} · ${step.detail}`}
      className={cn(
        "min-w-[170px] max-w-[210px] rounded-lg border p-2 text-left transition-transform hover:-translate-y-0.5",
        tone,
        selected && "ring-2 ring-info/70",
      )}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5", step.status === "Running" && "animate-spin")} />
        <span className="text-[10px] font-semibold uppercase tracking-wide">{step.layer}</span>
      </div>
      <div className="mt-1 text-xs font-medium leading-snug">{step.label}</div>
      <div className="mt-0.5 text-[11px] leading-snug opacity-80">{step.detail}</div>
    </button>
  );
}

function BreakpointDetails({ step }: { step: UnifiedStep }) {
  const failed = step.status === "Failed";
  return (
    <div className={cn(
      "rounded-lg border p-3",
      failed ? "border-critical/50 bg-critical/5" : "border-border/60 bg-background/40",
    )}>
      <div className="flex flex-wrap items-baseline gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Step</div>
        <div className="text-sm font-semibold">{step.layer} → {step.label}</div>
        <Badge variant="outline" className={cn(
          "ml-auto text-[10px] uppercase tracking-wider",
          failed && "border-critical/60 text-critical",
          step.status === "Passed" && "border-success/60 text-success",
        )}>{step.status}</Badge>
        <SourceBadge source={step.source} />
      </div>
      <p className="mt-2 text-xs">
        <span className="text-muted-foreground">Why:</span>{" "}
        <span>{step.detail || "Not verified"}</span>
      </p>
      {step.evidence.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence</div>
          <ul className="mt-1 space-y-0.5 rounded border border-border/40 bg-background/40 p-2 font-mono text-[11px]">
            {step.evidence.map((e, i) => <li key={i}>• {e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/* =================================================================== */
/*  ROOM CONTROLLER DOCTOR (structured)                                */
/* =================================================================== */

function RoomControllerSection({ snap }: { snap: DiagnosisRunSnapshot }) {
  const reports = snap.rcReports;
  if (!reports || reports.length === 0) return null;
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cpu className="h-4 w-4 text-info" /> Room Controller Doctor
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">{reports.length} controller{reports.length === 1 ? "" : "s"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((r) => {
          const c = r.controller;
          const crit = r.findings.filter((f) => f.severity === "Critical").length;
          const warn = r.findings.filter((f) => f.severity === "Warning").length;
          const tone = crit ? "border-critical/50" : warn ? "border-warning/50" : "border-success/40";
          return (
            <div key={c.name} className={cn("rounded-md border bg-background/30 p-3", tone)}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-semibold text-sm">{c.name}</span>
                <KV label="IP" value={c.ip} mono />
                <KV label="ID" value={c.controllerId || "Not configured"} mono />
                <KV label="VLAN" value={c.vlan} mono />
                <KV label="Web" value={c.hasWebAccess ? "reachable" : "not reachable"}
                  tone={c.hasWebAccess ? "ok" : "bad"} />
                <KV label="Auth" value={authLabel(c.authStatus)}
                  tone={authTone(c.authStatus)} />
              </div>

              {r.findings.length === 0 ? (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> No findings — controller passes SIM-046 checks.
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {r.findings.map((f, i) => (
                    <ExpandableFinding key={i}
                      severity={f.severity}
                      title={f.title}
                      detail={f.detail}
                      area={f.area}
                      evidence={f.evidence}
                      fix={f.fix}
                      configEvidence={f.configEvidence}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function authLabel(s?: string): string {
  switch (s) {
    case "authenticated_default": return "success (admin/admin)";
    case "authenticated_custom":  return "success (custom)";
    case "auth_failed":           return "failed";
    case "auth_failed_custom":    return "failed (custom)";
    case "unreachable":           return "unreachable";
    default:                      return "not tested";
  }
}
function authTone(s?: string): "ok" | "bad" | "warn" | undefined {
  if (s === "authenticated_custom") return "ok";
  if (s === "authenticated_default") return "warn";
  if (s === "auth_failed" || s === "auth_failed_custom" || s === "unreachable") return "bad";
  return undefined;
}

function KV({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "bad" | "warn" }) {
  const cls = tone === "ok" ? "text-success" : tone === "bad" ? "text-critical" : tone === "warn" ? "text-warning" : "";
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono", cls)}>{value}</span>
    </span>
  );
}

function ExpandableFinding({
  severity, title, detail, area, evidence, fix, configEvidence,
}: {
  severity: "Info" | "Warning" | "Critical";
  title: string; detail: string; area: string;
  evidence: string[]; fix: string[];
  configEvidence: { source: string; field: string; expected: string; actual: string; impact: string }[];
}) {
  const [open, setOpen] = useState(false);
  const Icon = severity === "Critical" ? AlertOctagon : severity === "Warning" ? AlertTriangle : CheckCircle2;
  const iconCls = severity === "Critical" ? "text-critical" : severity === "Warning" ? "text-warning" : "text-info";
  return (
    <li className="rounded border border-border/50 bg-card/60">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-muted/20">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", iconCls)} />
            <span className="font-medium">{title}</span>
            <Badge variant="outline" className={cn(
              "ml-auto text-[9px] uppercase tracking-wider",
              severity === "Critical" && "border-critical/60 text-critical",
              severity === "Warning" && "border-warning/60 text-warning",
            )}>{severity}</Badge>
            <Badge variant="outline" className="text-[9px] uppercase tracking-wider">{area}</Badge>
            <SourceBadge source={configEvidence.length ? "config" : "trace"} />
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-t border-border/40 px-2 py-2 text-xs">
          <p className="text-muted-foreground">{detail}</p>
          {evidence.length > 0 && (
            <ul className="space-y-0.5 rounded bg-background/40 p-1.5 font-mono text-[10px]">
              {evidence.map((e, j) => <li key={j}>• {e}</li>)}
            </ul>
          )}
          {fix.length > 0 && (
            <div className="flex items-start gap-1.5">
              <Wrench className="mt-0.5 h-3 w-3 text-muted-foreground" />
              <span>{fix.join(" → ")}</span>
            </div>
          )}
          {configEvidence.length > 0 && (
            <div className="rounded border border-border/40">
              <div className="border-b border-border/40 bg-muted/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Config Evidence
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border/40 text-left text-[9px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1">Source</th><th className="px-2 py-1">Field</th>
                    <th className="px-2 py-1">Expected</th><th className="px-2 py-1">Actual</th>
                    <th className="px-2 py-1">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {configEvidence.map((e, i) => (
                    <tr key={i} className="border-b border-border/30 last:border-0">
                      <td className="px-2 py-1 font-mono">{e.source}</td>
                      <td className="px-2 py-1 font-mono">{e.field}</td>
                      <td className="px-2 py-1">{e.expected}</td>
                      <td className="px-2 py-1 text-critical">{e.actual}</td>
                      <td className="px-2 py-1 text-muted-foreground">{e.impact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/* =================================================================== */
/*  IPNET DEVICE TREE                                                  */
/* =================================================================== */

function IpnetTreeSection({ snap }: { snap: DiagnosisRunSnapshot }) {
  const reports = snap.rcReports;
  if (!reports || reports.length === 0) return null;
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListTree className="h-4 w-4 text-info" /> IPnet Device Tree
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {reports.map((r) => {
          const devs = r.controller.ipnetDevices ?? [];
          return (
            <div key={r.controller.name} className="rounded-md border border-border/50 bg-background/30 p-2 font-mono text-xs">
              <div className="font-semibold text-foreground">{r.controller.name}</div>
              {devs.length === 0 ? (
                <div className="mt-1 pl-4 text-muted-foreground">└─ (no IPnet devices — Not verified)</div>
              ) : (
                <ul className="mt-1 pl-4">
                  {devs.map((d, i) => {
                    const last = i === devs.length - 1;
                    const stTone =
                      d.status === "Online" ? "text-success"
                      : d.status === "Offline" || d.status === "Fault" ? "text-critical"
                      : "text-muted-foreground";
                    return (
                      <li key={i} className="leading-relaxed">
                        <span className="text-muted-foreground">{last ? "└─ " : "├─ "}</span>
                        <span className="text-foreground">{d.name}</span>
                        <span className="text-muted-foreground"> · {d.type} · @{d.address}</span>
                        {d.portRun && <span className="text-muted-foreground"> · port {d.portRun}</span>}
                        <span className={cn("ml-2", stTone)}>[{d.status ?? "Not verified"}]</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* =================================================================== */
/*  SERVICE HEALTH                                                     */
/* =================================================================== */

function ServiceHealthSection({ snap }: { snap: DiagnosisRunSnapshot }) {
  const logs = snap.logAnalysis;
  const enabled = snap.modules;
  // Mandatory services always show; optional services are hidden unless the
  // matching module is enabled OR the backend actually returned data for it
  // (i.e. it was detected on the wire).
  const moduleMap: Record<string, keyof typeof enabled | undefined> = {
    "Pulse Gateway": "pulseGateway",
    "Pulse Manage":  "pulseGateway",
    "IPConnect":     "ipconnect",
    "Integration Gateway": "ipconnect",
    "License Service": "license",
    // Optional → mapped to the toggle that gates them
    "Mobile Gateway":  "webDevices",
    "WebSocket MQTT Adapter": "webDevices",
    "MQTT Broker":            "webDevices",
    "Vocera":   "vocera",
    "VoIP":     "voip",
    "Paging":   "voip",
    "HL7":      "voip",
    "RTLS Gateway": "voip",
  };
  const OPTIONAL: ModuleToggleKey[] = ["webDevices", "vocera", "voip"];
  const services = (logs ?? []).filter((s) => {
    const k = moduleMap[s.service];
    if (!k) return true;
    if (!OPTIONAL.includes(k)) return enabled[k] !== false;
    // Optional: hide unless explicitly enabled OR the service has data.
    if (enabled[k]) return true;
    return s.status === "reachable" || s.errors.length > 0 || s.warnings.length > 0;
  });
  const hiddenCount = (logs ?? []).length - services.length;

  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-info" /> Service Health
          <span className="ml-auto text-[10px] font-normal text-muted-foreground">
            {logs ? `${services.length} services` : "Not tested"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!logs ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            Backend log collection unavailable — Not tested.
          </div>
        ) : services.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">No enabled services returned logs.</div>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Logs</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => <ServiceRow key={s.service} svc={s} />)}
            </TableBody>
          </Table>
          {hiddenCount > 0 && (
            <div className="border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground">
              {hiddenCount} optional service{hiddenCount === 1 ? "" : "s"} hidden — enable on Command Center to show.
            </div>
          )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ svc }: { svc: ServiceLogResult }) {
  const [open, setOpen] = useState(false);
  const ok = svc.status === "reachable" && svc.logStatus === "found" && svc.errors.length === 0;
  const fail = svc.status === "unreachable" || svc.errors.length > 0;
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/20" onClick={() => setOpen((o) => !o)}>
        <TableCell className="font-medium">{svc.service}</TableCell>
        <TableCell>
          <span className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
            ok ? "bg-success/15 text-success" : fail ? "bg-critical/15 text-critical" : "bg-warning/15 text-warning",
          )}>
            {ok ? "OK" : fail ? "FAIL" : "WARN"}
          </span>
        </TableCell>
        <TableCell>
          <span className={svc.logStatus === "found" ? "text-success" : "text-muted-foreground"}>
            {svc.logStatus === "found" ? "Log found" : "No log"}
          </span>
        </TableCell>
        <TableCell className="text-right font-mono text-xs">{svc.errors.length}</TableCell>
        <TableCell><SourceBadge source="log" /></TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-background/40">
          <TableCell colSpan={5}>
            <div className="space-y-2 px-1 py-2 text-xs">
              {svc.error && <p className="text-critical">{svc.error}</p>}
              {svc.errors.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Errors</div>
                  <ul className="mt-1 space-y-0.5 rounded bg-background p-2 font-mono text-[10px]">
                    {svc.errors.slice(0, 6).map((l, i) => <li key={i}>• {l.text}</li>)}
                  </ul>
                </div>
              )}
              {svc.tail.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tail</div>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[10px]">{svc.tail.join("\n")}</pre>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* =================================================================== */
/*  DEPLOYMENT HEALTH                                                  */
/* =================================================================== */

function DeploymentHealthSection({ snap }: { snap: DiagnosisRunSnapshot }) {
  const checks = snap.deployHealth;
  if (!checks || checks.length === 0) return null;
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-info" /> Deployment Health
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 md:grid-cols-2">
        {checks.map((c) => (
          <div key={c.name} className="flex items-center gap-2 rounded border border-border/50 bg-background/40 px-3 py-2 text-xs">
            {c.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              : <XCircle className="h-4 w-4 shrink-0 text-critical" />}
            <span className="font-medium">{c.name}</span>
            <span className={cn("ml-auto text-[10px] font-semibold uppercase", c.ok ? "text-success" : "text-critical")}>
              {c.ok ? "PASS" : "FAIL"}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* keep tree-shake quiet */
void Network; void ServerCog;
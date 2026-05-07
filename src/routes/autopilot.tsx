import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Play, Square, RefreshCw, ShieldAlert, ShieldCheck, AlertTriangle, Copy, ChevronDown, Sparkles, Bot, FlaskConical, Info, Lightbulb, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  autopilotGetStatus, autopilotScanNow, autopilotStart, autopilotStop,
  autopilotGetPlan, autopilotExecute, autopilotVerify,
  autopilotExplainPlan, autopilotExplainExecution,
  checkHealth, evidenceLatest,
  type AutopilotStatus, type AutopilotPlan, type AutopilotIssue, type AutopilotExecutionReport, type AutopilotRisk,
  type AutopilotPlanExplanation, type AutopilotExecExplanation, type DeepEvidence,
} from "@/lib/agentClient";
import { MissionStatusBar } from "@/components/autopilot/MissionStatusBar";
import { MissionKpiCards } from "@/components/autopilot/MissionKpiCards";
import { SecurityProofCard } from "@/components/autopilot/SecurityProofCard";
import { ConfidenceLadder } from "@/components/autopilot/ConfidenceLadder";
import { AuditTimeline } from "@/components/autopilot/AuditTimeline";
import { ProofPanel } from "@/components/autopilot/ProofPanel";
import { DeepEvidenceCard } from "@/components/autopilot/DeepEvidenceCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AiCommanderTrigger } from "@/components/AiCommanderTrigger";
import { AddAutopilotServiceDialog } from "@/components/autopilot/AddAutopilotServiceDialog";
import { RecommendationsFromAlertsPanel } from "@/components/autopilot/RecommendationsFromAlertsPanel";
import {
  AUTOPILOT_SERVICES_UPDATED_EVENT,
  AUTOPILOT_SERVICE_PROFILES,
  autopilotServicesApi,
  type AutopilotService,
  type AutopilotServiceTypeKey,
} from "@/lib/autopilotServicesClient";
import type { ServiceRole } from "@/lib/siteConfig";
import { toast } from "sonner";

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
  const tip =
    risk === "HIGH" ? "High risk — engine refuses to execute. Manual action required." :
    risk === "MEDIUM" ? "Medium risk — restarts a service. Requires explicit acknowledgement." :
    "Low risk — read-only or idempotent action. Still requires technician approval.";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider cursor-help", RISK_STYLES[risk])}>{risk}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function AutopilotPage() {
  const [services, setServices] = useState<AutopilotService[]>([]);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<AutopilotService | null>(null);
  const [presetType, setPresetType] = useState<AutopilotServiceTypeKey | null>(null);
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<AutopilotPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [password, setPassword] = useState("");
  const [report, setReport] = useState<AutopilotExecutionReport | null>(null);
  const [backendOk, setBackendOk] = useState<boolean>(true);
  const [aiAvailable, setAiAvailable] = useState<"available" | "unavailable" | "unknown">("unknown");
  const [latestEvidence, setLatestEvidence] = useState<DeepEvidence | null>(null);

  const refresh = async () => {
    const r = await autopilotGetStatus();
    if ("ok" in r && r.ok) { setStatus(r); setError(null); }
    else setError(("message" in r && r.message) || "Failed to load Autopilot status.");
  };

  useEffect(() => {
    const refreshServices = async () => {
      try {
        const r = await autopilotServicesApi.list();
        setServices(r.ok ? r.services : []);
      } catch {
        setServices([]);
      }
    };

    refresh();
    void refreshServices();

    const handleUpdated = () => { void refreshServices(); };
    if (typeof window !== "undefined") {
      window.addEventListener(AUTOPILOT_SERVICES_UPDATED_EVENT, handleUpdated);
    }

    (async () => {
      const h = await checkHealth();
      setBackendOk(h.ok);
    })();
    (async () => {
      const r = await evidenceLatest();
      if ("ok" in r && r.ok) setLatestEvidence(r.evidence);
    })();
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(AUTOPILOT_SERVICES_UPDATED_EVENT, handleUpdated);
      }
    };
  }, []);

  const enabledServices = useMemo(
    () => services.filter((s) => s.enabled !== false).map((s) => ({
      id: s.id,
      role: (s.role || s.type) as ServiceRole,
      name: s.name,
      host: s.host,
      hostname: s.host,
      port: s.sshPort || 22,
      username: s.sshUsername || "tech",
      password: "",
      saveCredentials: false,
      enabled: true,
      required: false,
      logPaths: [],
      notes: s.notes || "",
      serviceManager: s.serviceManager,
      systemdUnit: s.systemdUnit,
      dockerContainer: s.dockerContainer,
      webminPort: s.webminPort,
    })),
    [services],
  );

  async function handleDeleteService(id: string) {
    if (!confirm("Delete this Autopilot service?")) return;
    try {
      await autopilotServicesApi.remove(id);
      toast.success("Service removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

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

  // Mission Control derived metrics — all from real data only.
  const monitored = services.filter((s) => s.enabled !== false).length;
  const needsAttention = status?.currentIssueCount ?? 0;
  const healthy = Math.max(0, monitored - needsAttention);
  const fixReady = (status?.recentPlans ?? []).filter((p) => p.riskLevel !== "HIGH").length;
  const manualRequired = (status?.recentPlans ?? []).filter((p) => p.riskLevel === "HIGH").length;
  const fixExecuted = (status?.recentExecutions ?? []).filter((r) => r.success).length;
  const lastExec = status?.recentExecutions?.[0] ?? null;
  const lastFixResult: "success" | "failed" | "verified" | "none" =
    !lastExec ? "none" : lastExec.fixVerified ? "verified" : lastExec.success ? "success" : "failed";
  const lastFixAt = lastExec?.finishedAt ?? null;

  // Mock / freshness signals (used for the "What should I do next?" card and global banner).
  const evidenceMock = !!latestEvidence?.mock;
  const evidenceAgeMs = latestEvidence?.collectedAt ? Date.now() - new Date(latestEvidence.collectedAt).getTime() : null;
  const evidenceStale = evidenceAgeMs !== null && evidenceAgeMs > 15 * 60 * 1000;
  const noServices = enabledServices.length === 0;
  const noEvidence = !latestEvidence;

  const nextStep: { tone: "info" | "warn" | "ok" | "danger"; title: string; body: string } = (() => {
    if (monitored === 0) return { tone: "warn", title: "No Autopilot services configured yet.", body: "Add IPC, Pulse Gateway, Pulse Manage, INGA, MQTT, HL7, or IPConnect services here." };
    if (evidenceMock) return { tone: "danger", title: "DEV mock evidence is loaded.", body: "Autopilot execution is permanently blocked while a mock scenario is active. Clear the mock from the Deep Evidence page before running real remediation." };
    if (noEvidence) return { tone: "warn", title: "Collect Deep Evidence before trusting automation.", body: "Without Deep Evidence the engine works from logs alone — contradictions will not be detected." };
    if (evidenceStale) return { tone: "warn", title: "Deep Evidence is stale.", body: "Re-collect Deep Evidence before approving a remediation plan." };
    if (needsAttention > 0 && fixReady > 0) return { tone: "info", title: "Review the suggested fix plan.", body: "An issue is detected and a deterministic plan is ready. Approve only after confirming the risk and verification steps." };
    if (needsAttention > 0) return { tone: "warn", title: "Issues detected — manual review required.", body: "Detected issues are HIGH risk or have no safe automated playbook. Open the issue to escalate." };
    return { tone: "ok", title: "All monitored services look healthy.", body: "Last scan found no actionable issues. Re-run Scan Now to refresh." };
  })();

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <PageHeader
        eyebrow="Autopilot · Mission Control"
        title="Safe Remediation Engine"
        description="Continuously monitors configured services, prepares deterministic fix plans, and executes only after technician approval. AI explains, the engine decides."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={!!busy}><RefreshCw className="h-4 w-4" />Refresh</Button>
            <Button size="sm" variant="secondary" onClick={() => { setEditingService(null); setServiceDialogOpen(true); }}>
              <Plus className="h-4 w-4" />Add Autopilot Service
            </Button>
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

      {/* Add Autopilot Services — quick-add at top, independent of Command Center */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Add Autopilot Services</h2>
          <p className="text-xs text-muted-foreground">Register services Autopilot can scan and build safe recommendations for. Independent of Command Center.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setEditingService(null); setPresetType(null); setServiceDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Autopilot Service
          </Button>
          {AUTOPILOT_SERVICE_PROFILES.filter((p) => p.type !== "custom").map((p) => (
            <Button
              key={p.type}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { setEditingService(null); setPresetType(p.type); setServiceDialogOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5" /> {p.label}
            </Button>
          ))}
        </div>
        {services.length === 0 ? (
          <Card>
            <CardContent className="space-y-2 p-6 text-center text-sm">
              <div className="font-medium">No Autopilot services configured yet.</div>
              <div className="text-muted-foreground">
                Add IPC, Pulse Gateway, Pulse Manage, INGA, MQTT, HL7, or IPConnect services here.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {services.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono uppercase">{s.type}</span>
                      {!s.enabled && <span className="text-[10px] text-muted-foreground">disabled</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground font-mono">
                      {s.sshUsername}@{s.host}:{s.sshPort} · {s.serviceManager}
                      {s.systemdUnit ? ` · unit=${s.systemdUnit}` : ""}
                      {s.dockerContainer ? ` · container=${s.dockerContainer}` : ""}
                      {s.webminPort ? ` · webmin=${s.webminPort}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditingService(s); setServiceDialogOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:text-red-300" onClick={() => handleDeleteService(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <RecommendationsFromAlertsPanel />

      {/* 1. Mission Control top status bar */}
      <MissionStatusBar
        loopRunning={!!status?.loopRunning}
        aiAvailable={aiAvailable}
        backendConnected={backendOk}
        monitored={monitored}
        activeIssues={needsAttention}
        lastScanAt={status?.lastScanAt ?? null}
        lastFixResult={lastFixResult}
        lastFixAt={lastFixAt}
      />

      {/* 2. Mission Control KPI cards */}
      <MissionKpiCards
        healthy={healthy}
        needsAttention={needsAttention}
        fixReady={fixReady}
        fixExecuted={fixExecuted}
        manualRequired={manualRequired}
      />

      {/* Global mock banner — make it impossible to miss when running against synthetic evidence. */}
      {evidenceMock && (
        <Card className="border-warning/60 bg-warning/10">
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm text-warning">
            <FlaskConical className="h-4 w-4" />
            <strong>DEV MOCK evidence active</strong>
            <span className="text-xs">Autopilot execution against mock evidence is permanently blocked.</span>
          </CardContent>
        </Card>
      )}

      {/* "What should I do next?" guidance card */}
      <NextStepCard step={nextStep} />

      {/* 3. Security proof card */}
      <SecurityProofCard />

      {/* 3b. Deep Evidence summary */}
      <DeepEvidenceCard />

      {/* Autopilot Services registry */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Autopilot services ({services.length})</h2>
          <Button size="sm" variant="outline" onClick={() => { setEditingService(null); setServiceDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add Autopilot Service
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {AUTOPILOT_SERVICE_PROFILES.filter((p) => p.type !== "custom").map((p) => (
            <Button
              key={p.type}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { setEditingService(null); setPresetType(p.type); setServiceDialogOpen(true); }}
            >
              <Plus className="h-3.5 w-3.5" /> {p.label}
            </Button>
          ))}
        </div>
        {services.length === 0 ? (
          <Card>
            <CardContent className="space-y-3 p-6 text-center text-sm">
              <div className="font-medium">No Autopilot services configured yet.</div>
              <div className="text-muted-foreground">
                Add IPC, Pulse Gateway, Pulse Manage, INGA, MQTT, HL7, or IPConnect services here.
              </div>
              <div className="flex justify-center">
                <Button size="sm" onClick={() => { setEditingService(null); setServiceDialogOpen(true); }}>
                  <Plus className="h-4 w-4" /> Add Autopilot Service
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {services.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono uppercase">{s.type}</span>
                      {!s.enabled && <span className="text-[10px] text-muted-foreground">disabled</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground font-mono">
                      {s.sshUsername}@{s.host}:{s.sshPort} · {s.serviceManager}
                      {s.systemdUnit ? ` · unit=${s.systemdUnit}` : ""}
                      {s.dockerContainer ? ` · container=${s.dockerContainer}` : ""}
                      {s.webminPort ? ` · webmin=${s.webminPort}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditingService(s); setServiceDialogOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-red-400 hover:text-red-300" onClick={() => handleDeleteService(s.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

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
                  lastScanAt={status?.lastScanAt ?? null}
                  onAiAvailability={setAiAvailable}
                  evidenceMock={evidenceMock}
                  evidenceStale={evidenceStale}
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

      <AddAutopilotServiceDialog
        open={serviceDialogOpen}
        onOpenChange={(o) => { setServiceDialogOpen(o); if (!o) setPresetType(null); }}
        initial={editingService}
        presetType={presetType}
        onSaved={() => { setEditingService(null); setPresetType(null); }}
      />
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
  lastScanAt: string | null;
  onAiAvailability: (s: "available" | "unavailable" | "unknown") => void;
  evidenceMock?: boolean;
  evidenceStale?: boolean;
}) {
  const { plan, loading, error, password, setPassword, acknowledged, setAcknowledged, report, setReport, setError, onRefresh, lastScanAt, onAiAvailability, evidenceMock, evidenceStale } = props;
  const [running, setRunning] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<"idle" | "ok" | "off" | "error" | "stale">("idle");
  const [aiStatusMsg, setAiStatusMsg] = useState<string>("");
  const [aiExplain, setAiExplain] = useState<AutopilotPlanExplanation | null>(null);
  const [aiExplainedAt, setAiExplainedAt] = useState<string | null>(null);

  // Mark stale when plan changes
  useEffect(() => { setAiExplain(null); setAiExplainedAt(null); setAiStatus("idle"); setAiStatusMsg(""); }, [plan?.planId]);

  const runAi = async () => {
    if (!plan) return;
    setAiLoading(true); setAiStatus("idle"); setAiStatusMsg("");
    const r = await autopilotExplainPlan({ planId: plan.planId });
    setAiLoading(false);
    if ("ok" in r && r.ok) {
      setAiExplain(r.ai); setAiStatus("ok"); setAiStatusMsg(`Local Ollama · ${r.model}`);
      setAiExplainedAt(new Date().toISOString());
      onAiAvailability("available");
    }
    else {
      setAiExplain(null);
      const reason = ("reason" in r && r.reason) || "";
      const off = reason === "ollama_unavailable" || reason === "ollama_timeout";
      setAiStatus(off ? "off" : "error");
      setAiStatusMsg(("message" in r && r.message) || "AI unavailable");
      onAiAvailability(off ? "unavailable" : "unavailable");
    }
  };

  if (loading) return <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading plan…</div>;
  if (error) return <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  if (!plan) return null;

  const actions = plan.actions ?? [];
  const hasMedium = actions.some((a) => a.risk === "MEDIUM" && !a.blocked);
  const allBlocked = actions.length === 0 || actions.every((a) => a.blocked || a.risk === "HIGH");
  const planIsMock = !!plan.mockEvidence || !!evidenceMock;
  const executeBlocked = allBlocked || planIsMock;
  const executeBlockReason =
    planIsMock ? "Mock evidence — execution permanently blocked."
    : allBlocked ? "All actions blocked (HIGH risk or not allowlisted)."
    : evidenceStale ? "Deep Evidence is stale. Re-collect before executing."
    : "";

  // Evidence source label (logs / deep evidence / both / mock).
  const evidenceSourceLabel: { label: string; cls: string } =
    planIsMock ? { label: "MOCK EVIDENCE", cls: "bg-warning/15 text-warning border-warning/40" }
    : plan.deepEvidenceUsed ? { label: "logs + deep evidence", cls: "bg-info/15 text-info border-info/40" }
    : { label: "logs only", cls: "bg-muted/40 text-muted-foreground border-border" };

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
      {planIsMock && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-warning/50 bg-warning/10 p-2 text-xs text-warning">
          <FlaskConical className="h-4 w-4" />
          <strong>Mock evidence plan.</strong>
          <span>This plan was built from a DEV mock scenario. Execute is permanently blocked.</span>
        </div>
      )}
      {!planIsMock && evidenceStale && (
        <div className="flex items-center gap-2 rounded border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
          <AlertTriangle className="h-4 w-4" /> Deep Evidence is stale (&gt;15 min). Re-collect before approving.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <div className="font-medium">{plan.summary}</div>
          <div className="text-xs text-muted-foreground">plan {plan.planId} · verify: {plan.verification}{plan.rollbackAvailable ? " · rollback available" : ""}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", evidenceSourceLabel.cls)} title="Where the diagnosis came from">
            {evidenceSourceLabel.label}
          </span>
          <RiskPill risk={plan.riskLevel} />
          <AiCommanderTrigger
            source="autopilot"
            mode="fix_plan_explainer"
            context={{ plan, rootCause: { primaryCause: plan.rootCause, confidence: plan.confidence, affectedServices: [plan.serviceName] } }}
            label="Explain in AI Commander"
          />
        </div>
      </div>

      {(plan.evidence ?? []).length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Evidence ({plan.evidence?.length ?? 0})</summary>
          <ul className="mt-2 space-y-1 font-mono text-[11px]">
            {(plan.evidence ?? []).map((e, i) => <li key={i} className="rounded bg-background/50 px-2 py-1 break-all">{e}</li>)}
          </ul>
        </details>
      )}

      {/* Confidence ladder — proves the engine is not guessing */}
      <ConfidenceLadder plan={plan} report={report} approved={acknowledged} />

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Planned actions</div>
        {actions.length === 0 && (
          <div className="rounded border border-border/40 bg-background/40 p-3 text-xs text-muted-foreground">
            No actions in this plan — engine refused to suggest a remediation. Manual triage required.
          </div>
        )}
        {actions.map((a) => (
          <div key={a.id} className="rounded border border-border/40 bg-background/40 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{a.label}</span>
              <RiskPill risk={a.risk} />
            </div>
            {a.blocked ? (
              <div className="mt-1 rounded border border-destructive/30 bg-destructive/10 p-1.5 text-destructive">
                <strong>Blocked:</strong> {a.blockReason || "Action not allowlisted."}
              </div>
            ) : (
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/60 p-2 font-mono text-[11px]">{a.command}</pre>
            )}
            {a.verifyCommand && <div className="mt-1 text-[11px] text-muted-foreground">Verify: <span className="font-mono">{a.verifyCommand}</span>{a.verifyExpect ? ` (expect /${a.verifyExpect}/)` : ""}</div>}
            <div className="mt-1 text-[11px] text-muted-foreground">{a.explanation}</div>
          </div>
        ))}
      </div>

      {(plan.manualNotes ?? []).length > 0 && (
        <div className="rounded border border-warning/40 bg-warning/5 p-2 text-xs text-warning">
          {(plan.manualNotes ?? []).map((n, i) => <div key={i}>⚠ {n}</div>)}
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
            <Button size="sm" onClick={() => exec("all")} disabled={running || executeBlocked}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve and Execute
            </Button>
            <Button size="sm" variant="outline" onClick={() => exec("readonly")} disabled={running}>
              <RefreshCw className="h-4 w-4" /> Run Read-Only Checks
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setReport(null); }}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={copyPlan}><Copy className="h-4 w-4" />Copy Plan</Button>
          </div>
          {executeBlocked && executeBlockReason && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" /> {executeBlockReason}
            </div>
          )}
        </div>
      )}

      {report && <ProofPanel plan={plan} report={report} />}
      {report && <ReportPanel report={report} />}
      {report && (
        <div className="flex flex-wrap gap-2">
          <AiCommanderTrigger source="execution" mode="post_fix_analyst" context={{ plan, execution: report }} label="Analyze post-fix in AI Commander" />
          <AiCommanderTrigger source="execution" mode="escalation_writer" context={{ plan, execution: report, rootCause: { primaryCause: plan.rootCause, confidence: plan.confidence } }} label="Draft escalation" />
        </div>
      )}

      {/* Audit trail — always visible alongside the plan */}
      <AuditTimeline plan={plan} report={report} approved={acknowledged} aiExplained={aiExplainedAt} lastScanAt={lastScanAt} />

      {plan && (
        <AiCopilotPlanPanel
          plan={plan}
          aiLoading={aiLoading}
          aiStatus={aiStatus}
          aiStatusMsg={aiStatusMsg}
          aiExplain={aiExplain}
          onRun={runAi}
        />
      )}
      {report && plan && <AiCopilotExecutionPanel planId={plan.planId} report={report} />}
    </div>
  );
}

function ReportPanel({ report }: { report: AutopilotExecutionReport }) {
  return _ReportPanel({ report });
}

function NextStepCard({ step }: { step: { tone: "info" | "warn" | "ok" | "danger"; title: string; body: string } }) {
  const tone =
    step.tone === "ok" ? "border-success/40 bg-success/5 text-success" :
    step.tone === "warn" ? "border-warning/40 bg-warning/5 text-warning" :
    step.tone === "danger" ? "border-destructive/40 bg-destructive/5 text-destructive" :
    "border-info/40 bg-info/5 text-info";
  const Icon = step.tone === "ok" ? ShieldCheck : step.tone === "danger" ? ShieldAlert : step.tone === "warn" ? AlertTriangle : Lightbulb;
  return (
    <Card className={cn("border", tone)}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider opacity-80">What should I do next?</div>
          <div className="mt-0.5 text-sm font-semibold">{step.title}</div>
          <div className="mt-1 text-xs opacity-90">{step.body}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function _ReportPanel({ report }: { report: AutopilotExecutionReport }) {
  return (
    <div className="space-y-2 rounded border border-border/60 bg-background/40 p-3 text-xs">
      <div className="flex items-center gap-2">
        {report.success ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldAlert className="h-4 w-4 text-destructive" />}
        <span className="font-semibold">Execution {report.success ? "succeeded" : "failed"}</span>
        {report.fixVerified && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">Fix verified</span>}
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
          {(r.before || r.verify) && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <BeforeAfterBox label="Before" data={r.before} />
              <BeforeAfterBox label="After" data={r.verify} />
            </div>
          )}
          {r.verifyCommand && <div className="mt-1 text-[10px] text-muted-foreground">Verify cmd: <span className="font-mono">{r.verifyCommand}</span>{r.verifyExpect ? ` (expect /${r.verifyExpect}/)` : ""}</div>}
        </details>
      ))}
      {report.nextSteps?.length > 0 && (
        <div className="text-muted-foreground">Next: {report.nextSteps.join(" · ")}</div>
      )}
    </div>
  );
}

function BeforeAfterBox({ label, data }: { label: string; data?: { ok: boolean; matched?: boolean; stdout?: string; stderr?: string } | null }) {
  if (!data) return (
    <div className="rounded border border-border/40 bg-background/40 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">not captured</div>
    </div>
  );
  const tone = data.matched === true ? "text-success" : data.matched === false ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded border border-border/40 bg-background/40 p-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("text-[10px] font-semibold", tone)}>{data.matched === true ? "matched" : data.matched === false ? "did not match" : "ran"}</div>
      </div>
      {data.stdout && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px]">{data.stdout}</pre>}
      {data.stderr && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-destructive">{data.stderr}</pre>}
    </div>
  );
}
/* ===== AI Copilot panels ===== */

const AI_DISCLAIMER = "AI explanation only. Fix decision and safety are controlled by the deterministic engine.";

function AiStatusBadge({ status, msg }: { status: "idle" | "ok" | "off" | "error" | "stale"; msg: string }) {
  const map: Record<typeof status, { label: string; cls: string }> = {
    idle: { label: "AI: Off", cls: "bg-muted text-muted-foreground border-border" },
    ok: { label: "AI: Local Ollama", cls: "bg-success/10 text-success border-success/30" },
    off: { label: "AI unavailable", cls: "bg-muted text-muted-foreground border-border" },
    error: { label: "AI failed", cls: "bg-destructive/10 text-destructive border-destructive/30" },
    stale: { label: "AI explanation stale", cls: "bg-warning/10 text-warning border-warning/30" },
  };
  const s = map[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider", s.cls)} title={msg}>
      <Bot className="h-3 w-3" /> {s.label}
    </span>
  );
}

function AiField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 whitespace-pre-wrap text-[12px] leading-snug">{value}</div>
    </div>
  );
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function AiCopilotPlanPanel(props: {
  plan: AutopilotPlan;
  aiLoading: boolean;
  aiStatus: "idle" | "ok" | "off" | "error" | "stale";
  aiStatusMsg: string;
  aiExplain: AutopilotPlanExplanation | null;
  onRun: () => void;
}) {
  const { aiLoading, aiStatus, aiStatusMsg, aiExplain, onRun } = props;
  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> AI Copilot
        </div>
        <AiStatusBadge status={aiStatus} msg={aiStatusMsg} />
      </div>
      <div className="text-[11px] italic text-muted-foreground">{AI_DISCLAIMER}</div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="default" onClick={onRun} disabled={aiLoading}>
          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {aiExplain ? "Re-run AI Explanation" : "Explain Plan with AI"}
        </Button>
        {aiExplain && (
          <>
            <Button size="sm" variant="outline" onClick={() => copyText(aiExplain.escalationDraft)}>
              <Copy className="h-4 w-4" /> Copy Escalation Draft
            </Button>
          </>
        )}
      </div>

      {aiStatus === "off" && (
        <div className="rounded border border-border/40 bg-background/40 p-2 text-[11px] text-muted-foreground">
          AI unavailable — deterministic Autopilot still works. {aiStatusMsg}
        </div>
      )}
      {aiStatus === "error" && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">{aiStatusMsg}</div>
      )}

      {aiExplain && (
        <div className="space-y-3 rounded border border-border/40 bg-background/50 p-3">
          <AiField label="Plain English Summary" value={aiExplain.plainEnglishSummary} />
          <AiField label="Why This Matched" value={aiExplain.whyThisMatched} />
          <AiField label="Risk Explanation" value={aiExplain.riskExplanation} />
          <AiField label="What Will Happen" value={aiExplain.whatWillHappen} />
          <AiField label="What Could Go Wrong" value={aiExplain.whatCouldGoWrong} />
          <AiField label="Approval Guidance" value={aiExplain.approvalGuidance} />
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">Escalation Draft (not sent anywhere)</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">{aiExplain.escalationDraft}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function AiCopilotExecutionPanel({ planId, report }: { planId: string; report: AutopilotExecutionReport }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "off" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [ai, setAi] = useState<AutopilotExecExplanation | null>(null);

  useEffect(() => { setAi(null); setStatus("idle"); setStatusMsg(""); }, [report.executionId]);

  const run = async () => {
    setLoading(true); setStatus("idle"); setStatusMsg("");
    const r = await autopilotExplainExecution({ planId, report });
    setLoading(false);
    if ("ok" in r && r.ok) { setAi(r.ai); setStatus("ok"); setStatusMsg(`Local Ollama · ${r.model}`); }
    else {
      setAi(null);
      const reason = ("reason" in r && r.reason) || "";
      setStatus(reason === "ollama_unavailable" || reason === "ollama_timeout" ? "off" : "error");
      setStatusMsg(("message" in r && r.message) || "AI unavailable");
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> AI Copilot — Result
        </div>
        <AiStatusBadge status={status === "idle" ? "idle" : status === "ok" ? "ok" : status === "off" ? "off" : "error"} msg={statusMsg} />
      </div>
      <div className="text-[11px] italic text-muted-foreground">{AI_DISCLAIMER}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {ai ? "Re-run AI Explanation" : "Explain Result with AI"}
        </Button>
        {ai && (
          <Button size="sm" variant="outline" onClick={() => copyText(ai.escalationUpdateDraft)}>
            <Copy className="h-4 w-4" /> Copy Escalation Update
          </Button>
        )}
      </div>

      {status === "off" && (
        <div className="rounded border border-border/40 bg-background/40 p-2 text-[11px] text-muted-foreground">
          AI unavailable — deterministic Autopilot still works. {statusMsg}
        </div>
      )}
      {status === "error" && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">{statusMsg}</div>
      )}

      {ai && (
        <div className="space-y-3 rounded border border-border/40 bg-background/50 p-3">
          <AiField label="Result Summary" value={ai.resultSummary} />
          <AiField label="What Changed" value={ai.whatChanged} />
          <AiField label="Verification Explanation" value={ai.verificationExplanation} />
          <AiField label="Remaining Risk" value={ai.remainingRisk} />
          <AiField label="Next Steps" value={ai.nextSteps} />
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">Escalation Update Draft (not sent anywhere)</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[11px]">{ai.escalationUpdateDraft}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

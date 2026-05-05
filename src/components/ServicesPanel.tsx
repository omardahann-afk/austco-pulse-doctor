import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus, Trash2, Loader2, Eye, EyeOff, ScanLine, FileText,
  CheckCircle2, AlertTriangle, XCircle, RotateCcw, ChevronDown, ChevronRight,
} from "lucide-react";
import {
  type ServiceEntry, type ServiceRole, type SiteConfig,
  REQUIRED_SERVICE_ROLES, OPTIONAL_SERVICE_ROLES, DEFAULT_LOG_PATHS,
  makeService, seedDefaultServices, saveServicesDiagnosis,
} from "@/lib/siteConfig";
import {
  testSsh, diagnoseOneService, diagnoseServices,
  explainDiagnosis,
  type SshTestResult, type ServiceDiagnosisResult, type ServicesDiagnosis,
  type ParsedLog, type LogFinding, type AustcoDiagnosis,
  type AiExplainResult, type AiExplanation, type AiPayload,
} from "@/lib/agentClient";

type PerSvcState = {
  testing?: boolean; testResult?: SshTestResult;
  diagnosing?: boolean; diagnosis?: ServiceDiagnosisResult;
  showPw?: boolean;
};

const ALL_ROLES: ServiceRole[] = [...REQUIRED_SERVICE_ROLES, ...OPTIONAL_SERVICE_ROLES];

function StatusIcon({ status }: { status: string }) {
  if (status === "PASS") return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === "WARN") return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
  if (status === "FAIL") return <XCircle className="h-3.5 w-3.5 text-critical" />;
  return <span className="h-3.5 w-3.5" />;
}

export function ServicesPanel({
  cfg, setCfg,
}: {
  cfg: SiteConfig;
  setCfg: (updater: (c: SiteConfig) => SiteConfig) => void;
}) {
  const [perSvc, setPerSvc] = useState<Record<string, PerSvcState>>({});
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<ServicesDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AI mode state (persisted lightly in localStorage)
  const [aiMode, setAiMode] = useState<"off" | "local_ollama">(() => {
    if (typeof window === "undefined") return "off";
    const v = window.localStorage.getItem("tacera.aiMode");
    return v === "local_ollama" ? "local_ollama" : "off";
  });
  const [aiEndpoint, setAiEndpoint] = useState<string>(() =>
    (typeof window !== "undefined" && window.localStorage.getItem("tacera.aiEndpoint")) || "http://localhost:11434/api/chat");
  const [aiModel, setAiModel] = useState<string>(() =>
    (typeof window !== "undefined" && window.localStorage.getItem("tacera.aiModel")) || "llama3.2:3b");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<AiExplainResult | null>(null);
  const [aiStale, setAiStale] = useState(false);
  const [aiDiagnosisKey, setAiDiagnosisKey] = useState<string | null>(null);
  const [aiUpdatedAt, setAiUpdatedAt] = useState<string | null>(null);

  function persistAi(next: { mode?: "off" | "local_ollama"; endpoint?: string; model?: string }) {
    if (typeof window === "undefined") return;
    if (next.mode !== undefined) window.localStorage.setItem("tacera.aiMode", next.mode);
    if (next.endpoint !== undefined) window.localStorage.setItem("tacera.aiEndpoint", next.endpoint);
    if (next.model !== undefined) window.localStorage.setItem("tacera.aiModel", next.model);
  }

  useEffect(() => {
    if (cfg.services.length === 0) setCfg((c) => ({ ...c, services: seedDefaultServices() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(id: string, patch: Partial<ServiceEntry>) {
    setCfg((c) => ({ ...c, services: c.services.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  }
  function remove(id: string) {
    setCfg((c) => ({ ...c, services: c.services.filter((s) => s.id !== id) }));
    setPerSvc((p) => { const n = { ...p }; delete n[id]; return n; });
  }
  function addOne(role: ServiceRole) {
    setCfg((c) => ({ ...c, services: [...c.services, makeService(role)] }));
  }
  function resetDefaults() {
    if (!confirm("Reset services to Austco defaults? This replaces the current service list.")) return;
    setCfg((c) => ({ ...c, services: seedDefaultServices() }));
    setPerSvc({});
    setRunResult(null);
  }
  function setLogPathsText(id: string, text: string) {
    const paths = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    update(id, { logPaths: paths });
  }
  function patchPer(id: string, patch: Partial<PerSvcState>) {
    setPerSvc((p) => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  }

  async function onTest(svc: ServiceEntry) {
    if (!svc.host && !svc.hostname) { patchPer(svc.id, { testResult: { ok: false, stage: "config", error: "No host/IP set." } }); return; }
    patchPer(svc.id, { testing: true, testResult: undefined });
    try {
      const r = await testSsh({
        host: svc.host || svc.hostname, port: svc.port || 22,
        username: svc.username, password: svc.password,
      });
      patchPer(svc.id, { testing: false, testResult: r });
    } catch (err) {
      patchPer(svc.id, { testing: false, testResult: { ok: false, stage: "network", error: err instanceof Error ? err.message : String(err) } });
    }
  }

  async function onDiagnoseOne(svc: ServiceEntry) {
    if (!svc.host && !svc.hostname) { setError(`Service "${svc.name}" has no host/IP.`); return; }
    setError(null);
    patchPer(svc.id, { diagnosing: true, diagnosis: undefined });
    try {
      const r = await diagnoseOneService({ ...svc, host: svc.host || svc.hostname });
      if ("ok" in r && r.ok) patchPer(svc.id, { diagnosing: false, diagnosis: r.service });
      else patchPer(svc.id, { diagnosing: false }), setError(("message" in r && r.message) || "Backend rejected the request.");
    } catch (err) {
      patchPer(svc.id, { diagnosing: false });
      setError(`Backend unreachable. ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function onRunAll() {
    setError(null);
    const enabled = cfg.services.filter((s) => s.enabled && (s.host || s.hostname));
    if (enabled.length === 0) { setError("Enable at least one service with an IP/hostname."); return; }
    setRunning(true);
    // New run: clear any prior AI explanation immediately
    setAiResult(null);
    setAiStale(false);
    setAiDiagnosisKey(null);
    setAiUpdatedAt(null);
    try {
      const r = await diagnoseServices(enabled.map((s) => ({ ...s, host: s.host || s.hostname })));
      if ("ok" in r && r.ok) {
        setRunResult(r);
        saveServicesDiagnosis(r);
        if (aiMode === "local_ollama" && r.diagnosis) {
          void runAiExplain(r.diagnosis);
        }
      }
      else setError(("message" in r && r.message) || "Backend rejected the request.");
    } catch (err) {
      setError(`Backend unreachable. ${err instanceof Error ? err.message : String(err)}`);
    } finally { setRunning(false); }
  }

  async function runAiExplain(d: AustcoDiagnosis) {
    setAiBusy(true);
    setAiStale(false);
    try {
      const r = await explainDiagnosis({ diagnosis: d, endpoint: aiEndpoint, model: aiModel });
      setAiResult(r);
      setAiDiagnosisKey(diagnosisKey(d));
      if (r && r.ok) setAiUpdatedAt(new Date().toISOString());
    } catch (err) {
      setAiResult({ ok: false, reason: "client_error", message: err instanceof Error ? err.message : String(err) });
    } finally { setAiBusy(false); }
  }

  // Mark AI explanation stale if the underlying diagnosis changes
  useEffect(() => {
    if (!aiResult || !runResult?.diagnosis || !aiDiagnosisKey) return;
    const currentKey = diagnosisKey(runResult.diagnosis);
    if (currentKey !== aiDiagnosisKey) setAiStale(true);
  }, [runResult, aiResult, aiDiagnosisKey]);

  const enabledCount = cfg.services.filter((s) => s.enabled && (s.host || s.hostname)).length;

  return (
    <div className="space-y-4">
      <Card className="bg-card/70 border-dashed opacity-95">
        <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm text-muted-foreground">AI Mode (optional · secondary)</CardTitle>
          <AiStatusBadge aiMode={aiMode} aiResult={aiResult} aiStale={aiStale} aiBusy={aiBusy} />
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            AI is optional and only <span className="font-semibold">summarizes</span> the rule-based diagnosis.
            It cannot change the root cause, confidence, or evidence. The app works fully without AI.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-border/60 bg-background/40 px-2 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Endpoint: <span className="font-mono text-foreground/80">{aiEndpoint || "—"}</span></span>
            <span className="text-muted-foreground">Model: <span className="font-mono text-foreground/80">{aiModel || "—"}</span></span>
            <span className="text-muted-foreground">AI required: <span className="font-semibold text-foreground/80">No</span></span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</Label>
              <select
                value={aiMode}
                onChange={(e) => { const v = e.target.value as "off" | "local_ollama"; setAiMode(v); persistAi({ mode: v }); }}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="off">Off</option>
                <option value="local_ollama">Local Ollama</option>
              </select>
            </div>
            <div className="space-y-1 flex-1 min-w-[220px]">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ollama endpoint</Label>
              <Input
                value={aiEndpoint}
                onChange={(e) => { setAiEndpoint(e.target.value); persistAi({ endpoint: e.target.value }); }}
                disabled={aiMode !== "local_ollama"}
                className="h-8 font-mono text-xs"
                placeholder="http://localhost:11434/api/chat"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Model</Label>
              <Input
                value={aiModel}
                onChange={(e) => { setAiModel(e.target.value); persistAi({ model: e.target.value }); }}
                disabled={aiMode !== "local_ollama"}
                className="h-8 font-mono text-xs w-[160px]"
                placeholder="llama3.2:3b"
              />
            </div>
            <Button
              type="button" variant="outline" size="sm"
              disabled={aiMode !== "local_ollama" || !runResult?.diagnosis || aiBusy}
              onClick={() => runResult?.diagnosis && runAiExplain(runResult.diagnosis)}
            >
              {aiBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Explain with AI
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-sm">Austco Services (SSH/SFTP)</CardTitle>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={resetDefaults}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter each service VM's IP/hostname and SSH credentials. Required services (Integration Gateway, Pulse Gateway, etc.) are enabled by default.
            Optional services (RTLS, HL7, File Server, Mobile Gateway) start disabled. Default credentials <code className="font-mono">tech / tech</code> — edit per site.
            Passwords are kept in memory only unless <span className="font-semibold">Save credentials</span> is enabled per service.
          </p>

          {cfg.services.map((svc) => {
            const ps = perSvc[svc.id] || {};
            return (
              <div key={svc.id} className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={svc.role} onChange={(e) => {
                      const role = e.target.value as ServiceRole;
                      update(svc.id, { role, logPaths: svc.logPaths.length ? svc.logPaths : [...(DEFAULT_LOG_PATHS[role] || [])] });
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Input value={svc.name} placeholder="Display name" className="h-8 max-w-[220px] text-xs" onChange={(e) => update(svc.id, { name: e.target.value })} />
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${svc.required ? "bg-info/20 text-info" : "bg-muted/40 text-muted-foreground"}`}>
                    {svc.required ? "Required" : "Optional"}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Label className="text-[11px] text-muted-foreground">Enabled</Label>
                    <Switch checked={svc.enabled} onCheckedChange={(v) => update(svc.id, { enabled: v })} />
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-critical" onClick={() => remove(svc.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-[1fr_1fr_120px]">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">IP / Host</Label>
                    <Input value={svc.host} placeholder="e.g. 192.168.10.10" className="h-8 font-mono text-xs" onChange={(e) => update(svc.id, { host: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Hostname (optional)</Label>
                    <Input value={svc.hostname} placeholder="e.g. pulse.local" className="h-8 font-mono text-xs" onChange={(e) => update(svc.id, { hostname: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">SSH Port</Label>
                    <Input type="number" value={svc.port} className="h-8 font-mono text-xs" onChange={(e) => update(svc.id, { port: Number(e.target.value) || 22 })} />
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">SSH Username</Label>
                    <Input value={svc.username} className="h-8 font-mono text-xs" onChange={(e) => update(svc.id, { username: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">SSH Password</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type={ps.showPw ? "text" : "password"}
                        value={svc.password}
                        autoComplete="off"
                        className="h-8 font-mono text-xs"
                        onChange={(e) => update(svc.id, { password: e.target.value })}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => patchPer(svc.id, { showPw: !ps.showPw })} aria-label="Toggle password visibility">
                        {ps.showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      <Switch checked={svc.saveCredentials} onCheckedChange={(v) => update(svc.id, { saveCredentials: v })} />
                      <Label className="text-[11px] text-muted-foreground">Save credentials</Label>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Log paths (one per line)</Label>
                  <Textarea
                    value={svc.logPaths.join("\n")}
                    onChange={(e) => setLogPathsText(svc.id, e.target.value)}
                    className="min-h-[60px] font-mono text-[11px]"
                    placeholder="/home/xcare/runtime/.../app.log"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onTest(svc)} disabled={ps.testing}>
                    {ps.testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Test Connection
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => onDiagnoseOne(svc)} disabled={ps.diagnosing}>
                    {ps.diagnosing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanLine className="mr-1.5 h-3.5 w-3.5" />}
                    Pull Logs &amp; Diagnose
                  </Button>
                  {ps.testResult && (
                    <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] ${ps.testResult.ok ? "bg-success/15 text-success" : "bg-critical/15 text-critical"}`}>
                      {ps.testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                      {ps.testResult.ok ? `Auth OK at ${ps.testResult.host}:${ps.testResult.port}` : `${(ps.testResult as Extract<SshTestResult, {ok:false}>).stage}: ${(ps.testResult as Extract<SshTestResult, {ok:false}>).error}`}
                    </span>
                  )}
                </div>

                {ps.diagnosis && (
                  <ServiceDiagnosisDetail d={ps.diagnosis} />
                )}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-1.5 pt-1">
            {ALL_ROLES.map((r) => (
              <Button key={r} type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => addOne(r)}>
                <Plus className="mr-1 h-3 w-3" /> {r}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{enabledCount}</span> enabled service{enabledCount === 1 ? "" : "s"} with a host.
          </div>
          <Button type="button" size="lg" disabled={running || enabledCount === 0} onClick={onRunAll}
            className="ml-auto bg-info text-info-foreground hover:bg-info/90">
            {running
              ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Running real diagnosis…</>
              : <><ScanLine className="mr-1.5 h-4 w-4" /> Run Real Diagnosis (all enabled)</>}
          </Button>
        </CardContent>
        {error && <div className="mx-4 mb-4 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
      </Card>

      {runResult && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">Rule-Based Diagnosis</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {runResult.diagnosis && <AustcoDiagnosisBlock d={runResult.diagnosis} />}
            <div className="flex flex-wrap gap-3">
              <span><span className="font-semibold text-success">{runResult.summary.pass}</span> pass</span>
              <span><span className="font-semibold text-warning">{runResult.summary.warn}</span> warn</span>
              <span><span className="font-semibold text-critical">{runResult.summary.fail}</span> fail</span>
              <span className="text-muted-foreground">Confidence: {runResult.confidence}</span>
              <span className="text-muted-foreground">VM: {runResult.vm.hostname}</span>
            </div>
            {runResult.breakFoundAt && (
              <div className="rounded border border-critical/40 bg-critical/10 px-3 py-2 text-critical">
                First failure at <span className="font-semibold">{runResult.breakFoundAt.name}</span> ({runResult.breakFoundAt.role}) — {runResult.breakFoundAt.host}
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Evidence ({runResult.evidence.length} lines)</summary>
              <pre className="mt-2 max-h-[260px] overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">{runResult.evidence.join("\n")}</pre>
            </details>
            <ul className="space-y-1 pt-1">
              {runResult.services.map((s) => (
                <li key={s.serviceId} className="rounded border border-border/40 bg-background/40 p-2">
                  <div className="flex items-start gap-2">
                    <StatusIcon status={s.status} />
                    <div className="flex-1">
                      <div className="font-semibold">{s.name} <span className="text-muted-foreground font-normal">— {s.role} @ {s.host}:{s.port}</span></div>
                      <div className="text-muted-foreground">{s.message}</div>
                    </div>
                  </div>
                  <ServiceDiagnosisDetail d={s} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {runResult && aiMode === "local_ollama" && (
        <Card className="bg-card/50 border-dashed">
          <CardHeader className="pb-3 flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm text-muted-foreground">AI Explanation <span className="ml-1 text-[10px] font-normal uppercase tracking-wider">(secondary)</span></CardTitle>
            <AiStatusBadge aiMode={aiMode} aiResult={aiResult} aiStale={aiStale} aiBusy={aiBusy} />
          </CardHeader>
          <CardContent className="pt-0 pb-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{aiModel}</span> @ <span className="font-mono">{aiEndpoint}</span> · AI required: <span className="font-semibold">No</span>
          </CardContent>
          <CardContent className="pt-0 pb-2 text-[11px]">
            <AiLastRefresh aiBusy={aiBusy} aiStale={aiStale} aiUpdatedAt={aiUpdatedAt} aiResult={aiResult} />
          </CardContent>
          <CardContent className="space-y-2 text-xs">
            <div className="text-[11px] italic text-muted-foreground">
              AI explanation based only on real backend evidence. Root cause and confidence come from the rule engine, not AI.
            </div>
            {aiBusy && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking local Ollama…</div>}
            {!aiBusy && !aiResult && (
              <div className="text-muted-foreground">No AI explanation yet — click <span className="font-semibold">Explain with AI</span> above.</div>
            )}
            {aiResult && !aiResult.ok && (
              <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
                {aiResult.reason === "ollama_timeout"
                  ? "Local AI timed out — rule-based diagnosis is still available."
                  : "Local AI unavailable — showing rule-based diagnosis only."}
                <div className="mt-1 font-mono text-[10px] opacity-80">{aiResult.message}</div>
              </div>
            )}
            {aiStale && (
              <div className="flex flex-wrap items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] flex-1 min-w-[200px]">
                  This AI explanation was generated from a previous diagnosis. Re-run AI to explain the latest result.
                </span>
                <Button
                  type="button" size="sm" variant="outline" className="ml-auto h-7 text-[11px]"
                  disabled={aiBusy || !runResult?.diagnosis}
                  onClick={() => runResult?.diagnosis && runAiExplain(runResult.diagnosis)}
                >
                  Re-run AI
                </Button>
              </div>
            )}
            {aiResult && aiResult.ok && <AiExplanationBlock ai={aiResult.ai} endpoint={aiResult.endpoint} model={aiResult.model} stale={aiStale} />}
            {aiResult?.payload && (
              <AiEvidenceSnapshot payload={aiResult.payload} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function diagnosisKey(d: AustcoDiagnosis): string {
  return [
    d.breakFoundAt,
    d.primaryCause,
    d.confidence,
    (d.evidence || []).join("|"),
    (d.affectedServices || []).join(","),
  ].join("§");
}

function AiStatusBadge({
  aiMode, aiResult, aiStale, aiBusy,
}: {
  aiMode: "off" | "local_ollama";
  aiResult: AiExplainResult | null;
  aiStale: boolean;
  aiBusy: boolean;
}) {
  let label = "AI: Off";
  let tone = "bg-muted text-muted-foreground border-border";
  if (aiMode === "local_ollama") {
    if (aiBusy) { label = "AI: Working…"; tone = "bg-info/15 text-info border-info/40"; }
    else if (aiStale) { label = "AI: Stale Explanation"; tone = "bg-warning/15 text-warning border-warning/40"; }
    else if (aiResult && !aiResult.ok) {
      if (aiResult.reason === "ollama_timeout") { label = "AI: Timed Out"; tone = "bg-warning/15 text-warning border-warning/40"; }
      else { label = "AI: Local Ollama Unavailable"; tone = "bg-critical/15 text-critical border-critical/40"; }
    }
    else { label = "AI: Local Ollama Enabled"; tone = "bg-success/15 text-success border-success/40"; }
  }
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}

function AiSection({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground/90 whitespace-pre-wrap">{body || "—"}</div>
    </div>
  );
}

function AiLastRefresh({
  aiBusy, aiStale, aiUpdatedAt, aiResult,
}: {
  aiBusy: boolean;
  aiStale: boolean;
  aiUpdatedAt: string | null;
  aiResult: AiExplainResult | null;
}) {
  let label: string;
  let tone = "text-muted-foreground";
  if (aiBusy) { label = "Running now…"; tone = "text-info"; }
  else if (aiStale && aiUpdatedAt) { label = `Stale since diagnosis changed (was ${formatTs(aiUpdatedAt)})`; tone = "text-warning"; }
  else if (aiUpdatedAt && aiResult?.ok) { label = `Last updated: ${formatTs(aiUpdatedAt)}`; tone = "text-foreground/80"; }
  else { label = "Never run"; }
  return (
    <div className={`flex items-center gap-1.5 ${tone}`}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Last AI explanation:</span>
      <span className="font-mono text-[11px]">{label}</span>
    </div>
  );
}

function formatTs(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}


function AiExplanationBlock({ ai, endpoint, model, stale }: { ai: AiExplanation; endpoint: string; model: string; stale?: boolean }) {
  return (
    <div className={`space-y-2 ${stale ? "opacity-60" : ""}`}>
      <AiSection label="Plain English summary" body={ai.plainEnglishSummary} />
      <AiSection label="Technician explanation" body={ai.technicianExplanation} />
      <AiSection label="Escalation summary" body={ai.escalationSummary} />
      <AiSection label="Customer-friendly summary" body={ai.customerFriendlySummary} />
      <AiSection label="Safety notes" body={ai.safetyNotes} />
      <div className="pt-1 text-[10px] font-mono text-muted-foreground">via {model} @ {endpoint}</div>
    </div>
  );
}

function confidenceTone(score: number): string {
  if (score >= 80) return "bg-success/15 text-success border-success/40";
  if (score >= 60) return "bg-info/15 text-info border-info/40";
  if (score >= 40) return "bg-warning/15 text-warning border-warning/40";
  return "bg-muted/30 text-muted-foreground border-border/60";
}

function AustcoDiagnosisBlock({ d }: { d: AustcoDiagnosis }) {
  return (
    <div className="rounded border border-border/60 bg-background/50 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-info/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info">{d.mode}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${confidenceTone(d.confidence)}`}>
          Confidence {d.confidence}%
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Break found at</div>
          <div className="font-semibold text-foreground">{d.breakFoundAt}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Primary cause</div>
          <div className="text-foreground">{d.primaryCause}</div>
        </div>
      </div>

      {d.confidenceReasons.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Why this confidence</div>
          <ul className="ml-4 list-disc space-y-0.5 text-foreground/90">
            {d.confidenceReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {d.evidence.length > 0 && (
        <details open>
          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            Proof ({d.evidence.length})
          </summary>
          <pre className="mt-1 max-h-[240px] overflow-auto rounded bg-background/80 p-2 font-mono text-[10px] whitespace-pre-wrap break-all">
{d.evidence.join("\n")}
          </pre>
        </details>
      )}

      {d.fixActions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fix now</div>
          <ol className="ml-4 list-decimal space-y-0.5 text-foreground/90">
            {d.fixActions.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        </div>
      )}

      {d.affectedServices.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Affected services</div>
          <div className="flex flex-wrap gap-1">
            {d.affectedServices.map((s, i) => (
              <span key={i} className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">{s}</span>
            ))}
          </div>
        </div>
      )}

      {d.traceSteps.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-foreground">
            Trace ({d.traceSteps.length} steps)
          </summary>
          <ul className="mt-1 space-y-0.5">
            {d.traceSteps.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <StatusIcon status={t.status} />
                <span className="font-mono text-[10px] uppercase text-muted-foreground shrink-0">{t.role}</span>
                <span className="text-foreground/90">{t.label}</span>
                <span className="ml-auto rounded bg-muted/30 px-1 py-0.5 text-[9px] text-muted-foreground">{t.source}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {d.warnings.length > 0 && (
        <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-warning">
          <div className="text-[10px] font-bold uppercase tracking-wider">Warnings</div>
          <ul className="ml-4 list-disc space-y-0.5">
            {d.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function connectionLabel(d: ServiceDiagnosisResult): { text: string; tone: "ok" | "fail" | "unknown" } {
  if (d.connection === "ok") return { text: "SSH OK", tone: "ok" };
  if (d.connection === "failed") return { text: "SSH Failed", tone: "fail" };
  return { text: "SSH Unknown", tone: "unknown" };
}

function FindingRow({ f }: { f: LogFinding }) {
  const [open, setOpen] = useState(false);
  const tone =
    f.severity === "ERROR" ? "bg-critical/15 text-critical"
    : f.severity === "WARN" ? "bg-warning/15 text-warning"
    : "bg-muted/30 text-muted-foreground";
  return (
    <li className="rounded border border-border/40 bg-background/40 px-2 py-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 text-left">
        {open ? <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />}
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}>{f.type}</span>
        {f.timestamp && <span className="font-mono text-[10px] text-muted-foreground shrink-0">{f.timestamp}</span>}
        <span className="text-[11px] text-foreground/90 break-all">{f.message}</span>
      </button>
      {open && (
        <pre className="mt-1 ml-5 max-h-48 overflow-auto rounded bg-background/80 p-2 font-mono text-[10px] whitespace-pre-wrap break-all">
{f.raw}
        </pre>
      )}
    </li>
  );
}

function ParsedLogBlock({ p }: { p: ParsedLog }) {
  if (!p.ok) {
    const label = p.reason === "not_found" ? "Log path not found"
      : p.reason === "permission_denied" ? "Permission denied"
      : `Read failed (${p.reason || "error"})`;
    return (
      <div className="rounded border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] text-critical">
        <span className="font-mono">{p.path}</span> — {label}{p.error ? `: ${p.error}` : ""}
      </div>
    );
  }
  return (
    <div className="rounded border border-border/50 bg-background/40 px-2 py-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <FileText className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono text-foreground">{p.path}</span>
        <span className="text-muted-foreground">· {p.totalLines} lines</span>
        <span className="text-critical">· {p.errors} errors</span>
        <span className="text-warning">· {p.warnings} warnings</span>
        <span className="text-muted-foreground">· {p.findings.length} findings</span>
        {p.truncated && <span className="text-muted-foreground">· tail</span>}
      </div>
      {p.findings.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No findings.</div>
      ) : (
        <ul className="space-y-0.5">
          {p.findings.map((f, i) => <FindingRow key={i} f={f} />)}
        </ul>
      )}
    </div>
  );
}

function ServiceDiagnosisDetail({ d }: { d: ServiceDiagnosisResult }) {
  const conn = connectionLabel(d);
  const noLogs = (d.parsedLogs || []).length === 0;
  return (
    <div className="mt-2 space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
          conn.tone === "ok" ? "bg-success/15 text-success"
          : conn.tone === "fail" ? "bg-critical/15 text-critical"
          : "bg-muted/30 text-muted-foreground"
        }`}>{conn.text}</span>
        {d.parsed && (
          <>
            <span className="text-muted-foreground">Errors: <span className="text-critical font-mono">{d.parsed.totalErrors}</span></span>
            <span className="text-muted-foreground">Warnings: <span className="text-warning font-mono">{d.parsed.totalWarnings}</span></span>
          </>
        )}
      </div>
      <details>
        <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Steps ({d.steps.length})</summary>
        <ul className="mt-1 space-y-0.5">
          {d.steps.map((st, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <StatusIcon status={st.status} />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{st.name}</span>
              <span className="text-foreground/80">— {st.detail}</span>
            </li>
          ))}
        </ul>
      </details>
      {d.connection === "failed" && noLogs && (
        <div className="rounded border border-critical/40 bg-critical/10 px-2 py-1.5 text-critical">SSH connection failed — cannot pull logs.</div>
      )}
      {d.connection === "ok" && noLogs && (
        <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-warning">No logs available — cannot analyze.</div>
      )}
      {(d.parsedLogs || []).map((p, i) => <ParsedLogBlock key={i} p={p} />)}
    </div>
  );
}

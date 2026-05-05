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
  type SshTestResult, type ServiceDiagnosisResult, type ServicesDiagnosis,
  type ParsedLog, type LogFinding,
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
    try {
      const r = await diagnoseServices(enabled.map((s) => ({ ...s, host: s.host || s.hostname })));
      if ("ok" in r && r.ok) { setRunResult(r); saveServicesDiagnosis(r); }
      else setError(("message" in r && r.message) || "Backend rejected the request.");
    } catch (err) {
      setError(`Backend unreachable. ${err instanceof Error ? err.message : String(err)}`);
    } finally { setRunning(false); }
  }

  const enabledCount = cfg.services.filter((s) => s.enabled && (s.host || s.hostname)).length;

  return (
    <div className="space-y-4">
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
          <CardHeader className="pb-3"><CardTitle className="text-sm">Diagnosis Result</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
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

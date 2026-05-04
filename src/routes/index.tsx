import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ScanLine, Loader2, Plus, X, Settings2, Server, Network, CircuitBoard, Cpu,
  Router, Workflow, CheckCircle2, XCircle, AlertCircle, FileText, Upload, Download,
} from "lucide-react";
import {
  DEFAULT_PAYLOAD, getBackendUrl, setBackendUrl, DEFAULT_BACKEND_URL,
  DEFAULT_CCP_INPUT,
  type DiagnosisRequest, type DeploymentType, type RoomController, type CallPointEntry,
  type CcpConfigInput, type CcpInputMode,
} from "@/lib/siteDoctorApi";
import { defaultServiceTargets, type ServiceTarget } from "@/lib/logEngine";
import {
  startDiagnosis, DEFAULT_MODULE_TOGGLES, type ModuleToggleKey, type ModuleToggles,
} from "@/lib/diagnosisRunStore";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Austco Site Doctor" },
    { name: "description", content: "Configure the site, then run a full Austco diagnosis. Results open in the trace-first diagnosis view." },
  ]}),
  component: CommandCenter,
});

const DEPLOYMENT_OPTIONS: DeploymentType[] = ["Standalone", "Redundant Pair", "Multi-PuGa", "Floor Controller", "Integration Server Big"];

const MODULE_LABELS: Record<ModuleToggleKey, string> = {
  pulseGateway: "Pulse Gateway",
  ipconnect: "IPConnect",
  inga: "INGA",
  license: "License",
  controllers: "Controllers",
  webDevices: "WebDevices",
  vocera: "Vocera",
  voip: "VoIP",
};
const OPTIONAL_MODULES: ModuleToggleKey[] = ["webDevices", "vocera", "voip"];

function SectionHeader({ icon: Icon, title, sub }: { icon: typeof Server; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-info" />
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em]">{title}</h3>
      {sub && <span className="text-[11px] text-muted-foreground">— {sub}</span>}
    </div>
  );
}

function CommandCenter() {
  const navigate = useNavigate();
  const [payload, setPayload] = useState<DiagnosisRequest>(() => structuredClone(DEFAULT_PAYLOAD));
  const [modules, setModules] = useState<ModuleToggles>({ ...DEFAULT_MODULE_TOGGLES });
  const [services] = useState<ServiceTarget[]>(() => defaultServiceTargets());
  const [backendUrl, setBackendUrlState] = useState<string>(DEFAULT_BACKEND_URL);
  const [backendTest, setBackendTest] = useState<{ status: "idle" | "testing" | "ok" | "fail"; message?: string }>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [ccp, setCcp] = useState<CcpConfigInput>(() => ({ ...DEFAULT_CCP_INPUT }));
  const [ccpStatus, setCcpStatus] = useState<"idle" | "uploaded" | "pulled" | "parse_failed">("idle");
  const [ccpPullErr, setCcpPullErr] = useState<string | null>(null);
  const [ccpPulling, setCcpPulling] = useState(false);

  useEffect(() => { setBackendUrlState(getBackendUrl()); }, []);

  const update = <K extends keyof DiagnosisRequest>(k: K, v: DiagnosisRequest[K]) =>
    setPayload((p) => ({ ...p, [k]: v }));

  async function testConnection() {
    setBackendTest({ status: "testing" });
    try {
      const url = backendUrl.replace(/\/api\/diagnosis.*$/, "") + "/health";
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { signal: ctrl.signal }).catch(() => null);
      clearTimeout(t);
      if (res && res.ok) setBackendTest({ status: "ok", message: `Connected to ${url}` });
      else setBackendTest({ status: "fail", message: "Backend unreachable — diagnosis will use local engines + mock adapters." });
    } catch (err) {
      setBackendTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setBackendUrl(backendUrl);
    // Kick off; navigate immediately so user lands on the trace page while
    // engines stream their results into the store.
    const payloadWithCcp: DiagnosisRequest = { ...payload, ccpConfig: ccp };
    void startDiagnosis({ payload: payloadWithCcp, services, modules, backendUrl });
    navigate({ to: "/diagnosis" });
  }

  async function onUploadCcp(file: File) {
    const text = await file.text();
    setCcp((c) => ({ ...c, mode: "upload", rawText: text, fileName: file.name }));
    setCcpStatus(text.trim() ? "uploaded" : "parse_failed");
  }

  async function onPullCcp() {
    setCcpPulling(true); setCcpPullErr(null);
    try {
      const url = backendUrl.replace(/\/api\/diagnosis.*$/, "") + "/ccp/pull";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipconnectIp: ccp.ipconnectIp, sshPort: ccp.sshPort,
          username: ccp.username, password: ccp.password, ccpPath: ccp.ccpPath,
        }),
      });
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`);
      const json = (await res.json()) as { rawText?: string; fileName?: string };
      setCcp((c) => ({ ...c, mode: "sftp", rawText: json.rawText ?? "", fileName: json.fileName ?? "site.ccp" }));
      setCcpStatus(json.rawText?.trim() ? "pulled" : "parse_failed");
    } catch (err) {
      setCcpPullErr(err instanceof Error ? err.message : String(err));
    } finally {
      setCcpPulling(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Diagnostic Copilot"
        title="Command Center"
        description="Define the site, pick which modules are deployed, then run a full diagnosis. Results open in a trace-first view that shows exactly where the system broke."
      />

      <form onSubmit={onRun} className="space-y-5">
        {/* SECTION 1 — Site Setup */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">1 · Site Setup</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Site Name</Label>
              <Input value={payload.name} onChange={(e) => update("name", e.target.value)} placeholder="Hospital — Building A" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Deployment Type</Label>
              <select
                value={payload.deploymentType ?? "Standalone"}
                onChange={(e) => update("deploymentType", e.target.value as DeploymentType)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {DEPLOYMENT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* SECTION 2 — Network */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">2 · Network</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <SectionHeader icon={Network} title="VLAN Ranges" sub="CIDR scopes the diagnosis will scan" />
              <div className="mt-2 space-y-2">
                {payload.vlans.map((v, i) => (
                  <div key={i} className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                    <Input value={v.name} placeholder="VLAN name" onChange={(e) => {
                      const next = [...payload.vlans]; next[i] = { ...next[i], name: e.target.value }; update("vlans", next);
                    }} />
                    <Input value={v.cidr} placeholder="10.20.1.0/24" className="font-mono" onChange={(e) => {
                      const next = [...payload.vlans]; next[i] = { ...next[i], cidr: e.target.value }; update("vlans", next);
                    }} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                      onClick={() => update("vlans", payload.vlans.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-8"
                  onClick={() => update("vlans", [...payload.vlans, { name: "New VLAN", cidr: "10.0.0.0/24" }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add VLAN
                </Button>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {(["primary", "secondary"] as const).map((side) => (
                <div key={side}>
                  <SectionHeader icon={Server} title={`${side === "primary" ? "Primary" : "Secondary"} Server NICs`} sub="eth0 / eth1 / eth2" />
                  <div className="mt-2 space-y-2">
                    {payload.serverNics[side].map((nic, i) => (
                      <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_auto]">
                        <Input value={nic.ip} placeholder="10.20.1.10" className="font-mono"
                          onChange={(e) => {
                            const next = [...payload.serverNics[side]]; next[i] = { ...next[i], ip: e.target.value };
                            update("serverNics", { ...payload.serverNics, [side]: next });
                          }} />
                        <Input value={nic.purpose} placeholder="LAN / Austco / Mgmt"
                          onChange={(e) => {
                            const next = [...payload.serverNics[side]]; next[i] = { ...next[i], purpose: e.target.value };
                            update("serverNics", { ...payload.serverNics, [side]: next });
                          }} />
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                          onClick={() => update("serverNics", { ...payload.serverNics, [side]: payload.serverNics[side].filter((_, j) => j !== i) })}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="h-8"
                      onClick={() => update("serverNics", { ...payload.serverNics, [side]: [...payload.serverNics[side], { ip: "", purpose: "" }] })}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add NIC
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* SECTION 3 — Modules */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">3 · Modules Deployed</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              {(Object.keys(MODULE_LABELS) as ModuleToggleKey[]).map((k) => {
                const optional = OPTIONAL_MODULES.includes(k);
                return (
                  <label key={k} className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-2">
                    <span className="flex items-center gap-2 text-sm">
                      {MODULE_LABELS[k]}
                      {optional && <span className="rounded bg-muted/40 px-1 text-[9px] uppercase tracking-wider text-muted-foreground">opt</span>}
                    </span>
                    <Switch checked={modules[k]} onCheckedChange={(v) => setModules((m) => ({ ...m, [k]: v }))} />
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Disabled modules are excluded from the trace and from the Service Health table on the diagnosis page.
            </p>
          </CardContent>
        </Card>

        {/* SECTION 4 — Controllers */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">4 · Controllers</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div>
              <SectionHeader icon={Cpu} title="Known Devices" sub="Controllers, IP-IN8, signal lights, room controllers, etc." />
              <div className="mt-2 space-y-2">
                {payload.knownDevices.map((d, i) => (
                  <div key={i} className="grid gap-2 grid-cols-[1.2fr_1fr_1fr_auto]">
                    <Input value={d.name} placeholder="Controller-East" onChange={(e) => {
                      const next = [...payload.knownDevices]; next[i] = { ...next[i], name: e.target.value }; update("knownDevices", next);
                    }} />
                    <Input value={d.ip} placeholder="10.20.4.50" className="font-mono" onChange={(e) => {
                      const next = [...payload.knownDevices]; next[i] = { ...next[i], ip: e.target.value }; update("knownDevices", next);
                    }} />
                    <Input value={d.type} placeholder="Controller / IP-IN8 / Room Controller" onChange={(e) => {
                      const next = [...payload.knownDevices]; next[i] = { ...next[i], type: e.target.value }; update("knownDevices", next);
                    }} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                      onClick={() => update("knownDevices", payload.knownDevices.filter((_, j) => j !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-8"
                  onClick={() => update("knownDevices", [...payload.knownDevices, { name: "", ip: "", type: "" }])}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add device
                </Button>
              </div>
            </div>

            <div>
              <SectionHeader icon={Router} title="Room Controllers" sub="IP-CCT / IPnet routers (SIM-046)" />
              <RoomControllerEditor
                controllers={payload.roomControllers ?? []}
                onChange={(next) => update("roomControllers", next)}
              />
            </div>

            <div>
              <SectionHeader icon={Workflow} title="Call Points" sub="Optional — required for end-to-end trace" />
              <CallPointEditor
                callPoints={payload.callPoints ?? []}
                onChange={(next) => update("callPoints", next)}
              />
            </div>
          </CardContent>
        </Card>

        {/* SECTION 5 — IPConnect CCP (config truth layer) */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-3.5 w-3.5 text-info" /> 5 · IPConnect CCP Site Config
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[11px] text-muted-foreground">
              CCP is the <span className="text-foreground font-medium">config truth layer</span>. The diagnosis cross-checks every controller, callpoint, group signal and output rule against it. Pick one input method.
            </p>

            {/* Mode picker */}
            <div className="flex flex-wrap gap-2">
              {(["upload", "paste", "sftp"] as CcpInputMode[]).map((m) => (
                <button
                  key={m} type="button"
                  onClick={() => setCcp((c) => ({ ...c, mode: m }))}
                  className={`rounded-md border px-3 py-1.5 text-xs uppercase tracking-wider ${
                    ccp.mode === m
                      ? "border-info bg-info/10 text-info"
                      : "border-border/60 bg-background/40 text-muted-foreground hover:border-border"
                  }`}
                >
                  {m === "upload" ? "Upload .ccp" : m === "paste" ? "Paste text" : "Pull via SFTP"}
                </button>
              ))}
              <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                Status:{" "}
                <span className={
                  ccpStatus === "parse_failed" ? "text-critical" :
                  ccpStatus === "uploaded" || ccpStatus === "pulled" ? "text-success" :
                  "text-muted-foreground"
                }>
                  {ccpStatus === "idle" && !ccp.rawText ? "Not provided"
                    : ccpStatus === "uploaded" ? `Uploaded (${ccp.fileName || "file"})`
                    : ccpStatus === "pulled" ? `Pulled from IPConnect (${ccp.fileName || "site.ccp"})`
                    : ccpStatus === "parse_failed" ? "Parse failed"
                    : ccp.rawText ? `Pasted (${ccp.rawText.length} chars)` : "Not provided"}
                </span>
              </span>
            </div>

            {ccp.mode === "upload" && (
              <div className="rounded-md border border-dashed border-border/60 bg-background/30 p-3">
                <Label className="mb-2 inline-flex cursor-pointer items-center gap-2 rounded border border-border/60 bg-background/60 px-3 py-1.5 text-xs hover:bg-background">
                  <Upload className="h-3.5 w-3.5" /> Upload CCP File
                  <input
                    type="file" accept=".ccp,.xml,.txt,application/xml,text/plain"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUploadCcp(f); }}
                  />
                </Label>
                {ccp.fileName && <p className="mt-2 text-[11px] text-muted-foreground">Loaded: <span className="font-mono">{ccp.fileName}</span> ({ccp.rawText?.length ?? 0} chars)</p>}
              </div>
            )}

            {ccp.mode === "paste" && (
              <div>
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Paste CCP / config text</Label>
                <textarea
                  value={ccp.rawText ?? ""}
                  onChange={(e) => { setCcp((c) => ({ ...c, rawText: e.target.value, fileName: c.fileName || "pasted.ccp" })); setCcpStatus(e.target.value.trim() ? "uploaded" : "idle"); }}
                  rows={6}
                  placeholder="Paste exported CCP / IPConnect site config text here…"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px]"
                />
              </div>
            )}

            {ccp.mode === "sftp" && (
              <div className="space-y-3">
                <div className="grid gap-2 md:grid-cols-[1.2fr_100px_1fr_1fr]">
                  <Input value={ccp.ipconnectIp ?? ""} placeholder="IPConnect VM IP" className="font-mono"
                    onChange={(e) => setCcp((c) => ({ ...c, ipconnectIp: e.target.value }))} />
                  <Input type="number" value={ccp.sshPort ?? 22} placeholder="22" className="font-mono"
                    onChange={(e) => setCcp((c) => ({ ...c, sshPort: Number(e.target.value) || 22 }))} />
                  <Input value={ccp.username ?? ""} placeholder="username (default: tech)"
                    onChange={(e) => setCcp((c) => ({ ...c, username: e.target.value }))} />
                  <Input type="password" value={ccp.password ?? ""} placeholder="password (default: tech)"
                    onChange={(e) => setCcp((c) => ({ ...c, password: e.target.value }))} />
                </div>
                <Input value={ccp.ccpPath ?? ""} placeholder="/etc/ipconnect/site.ccp" className="font-mono text-xs"
                  onChange={(e) => setCcp((c) => ({ ...c, ccpPath: e.target.value }))} />
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={onPullCcp} disabled={ccpPulling || !ccp.ipconnectIp}>
                    {ccpPulling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                    Pull CCP From IPConnect
                  </Button>
                  {ccpPullErr && <span className="text-[11px] text-critical">{ccpPullErr}</span>}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Requires <span className="font-mono">node site-doctor.js</span> with the <span className="font-mono">/ccp/pull</span> SFTP route enabled.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION 6 — Backend */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><Settings2 className="h-3.5 w-3.5 text-info" /> 6 · Backend</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row">
              <Input value={backendUrl} onChange={(e) => setBackendUrlState(e.target.value)} placeholder={DEFAULT_BACKEND_URL} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="sm" onClick={testConnection} disabled={backendTest.status === "testing"}>
                {backendTest.status === "testing" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Test Connection
              </Button>
            </div>
            {backendTest.status !== "idle" && (
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                backendTest.status === "ok" ? "border-success/40 bg-success/5 text-success"
                : backendTest.status === "fail" ? "border-warning/40 bg-warning/5 text-warning"
                : "border-info/40 bg-info/5 text-info"
              }`}>
                {backendTest.status === "ok" ? <CheckCircle2 className="h-4 w-4" /> :
                 backendTest.status === "fail" ? <AlertCircle className="h-4 w-4" /> :
                 <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{backendTest.message ?? backendTest.status}</span>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Run <span className="font-mono text-foreground">node site-doctor.js</span> on the technician laptop. If unreachable, the diagnosis falls back to the local engines (results page will mark "Backend: Mock").
            </p>
          </CardContent>
        </Card>

        {/* RUN */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            When you press Run, the trace-first diagnosis page opens immediately and updates as each layer is checked.
          </p>
          <Button type="submit" size="lg" disabled={submitting}
            className="bg-info text-info-foreground hover:bg-info/90">
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : <><ScanLine className="mr-2 h-4 w-4" />Run Full Diagnosis</>}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Inline editors (kept tiny on purpose) ---------- */

function RoomControllerEditor({
  controllers, onChange,
}: { controllers: RoomController[]; onChange: (next: RoomController[]) => void }) {
  return (
    <div className="mt-2 space-y-2">
      {controllers.length === 0 && (
        <div className="rounded border border-dashed border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
          No room controllers declared. SIM-046 trace will be skipped.
        </div>
      )}
      {controllers.map((c, i) => (
        <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_140px_auto] rounded-md border border-border/40 bg-background/30 p-2">
          <Input value={c.name} placeholder="Controller-West" onChange={(e) => {
            const next = [...controllers]; next[i] = { ...next[i], name: e.target.value }; onChange(next);
          }} />
          <Input value={c.ip} placeholder="10.1.3.22" className="font-mono" onChange={(e) => {
            const next = [...controllers]; next[i] = { ...next[i], ip: e.target.value }; onChange(next);
          }} />
          <Input value={c.controllerId} placeholder="ID e.g. RC-W-01" onChange={(e) => {
            const next = [...controllers]; next[i] = { ...next[i], controllerId: e.target.value }; onChange(next);
          }} />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
            onClick={() => onChange(controllers.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onChange([
        ...controllers,
        {
          name: "", ip: "", controllerId: "", vlan: "10.1.3.0/24",
          model: "IP-CCT", credentials: { username: "admin", password: "admin", isDefault: true, rememberForSession: true },
          authStatus: "untested",
        },
      ])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add Room Controller
      </Button>
    </div>
  );
}

function CallPointEditor({
  callPoints, onChange,
}: { callPoints: CallPointEntry[]; onChange: (next: CallPointEntry[]) => void }) {
  return (
    <div className="mt-2 space-y-2">
      {callPoints.length === 0 && (
        <div className="rounded border border-dashed border-border/60 bg-muted/10 p-3 text-[11px] text-muted-foreground">
          No call points declared. End-to-end Callpoint → Output trace will be skipped.
        </div>
      )}
      {callPoints.map((cp, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1.2fr_1fr_80px_1.2fr_auto] rounded-md border border-border/40 bg-background/30 p-2">
          <Input value={cp.name} placeholder="Room 230 Call Point" onChange={(e) => {
            const next = [...callPoints]; next[i] = { ...next[i], name: e.target.value }; onChange(next);
          }} />
          <Input value={cp.controller} placeholder="Controller-West" onChange={(e) => {
            const next = [...callPoints]; next[i] = { ...next[i], controller: e.target.value }; onChange(next);
          }} />
          <Input type="number" value={cp.inputIndex} onChange={(e) => {
            const next = [...callPoints]; next[i] = { ...next[i], inputIndex: Number(e.target.value) || 0 }; onChange(next);
          }} />
          <Input value={cp.expectedOutputGroup} placeholder="West Wing Signal Lights" onChange={(e) => {
            const next = [...callPoints]; next[i] = { ...next[i], expectedOutputGroup: e.target.value }; onChange(next);
          }} />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
            onClick={() => onChange(callPoints.filter((_, j) => j !== i))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onChange([
        ...callPoints,
        { name: "New Call Point", controller: "", inputIndex: 1, expectedOutputGroup: "", expectedSignalLight: "", expectedDisplay: "" },
      ])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add Call Point
      </Button>
    </div>
  );
}

/* Keep unused-imports tree-shake quiet */
void CircuitBoard; void XCircle;
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ScanLine, Loader2, Plus, X, Settings2, ShieldCheck, AlertOctagon, Server,
  Network, CircuitBoard, Cable, ChevronRight, CheckCircle2, XCircle, AlertTriangle,
  HardDrive, Workflow,
} from "lucide-react";
import {
  DEFAULT_PAYLOAD, runDiagnosis, getBackendUrl, setBackendUrl, DEFAULT_BACKEND_URL,
  type DiagnosisRequest, type DiagnosisResponse,
} from "@/lib/siteDoctorApi";
import {
  traceSignalPath, readHardwareHealth, readDeploymentHealth,
  type ChainStep, type Breakpoint, type HardwareHealthRow, type DeploymentHealthCheck,
} from "@/lib/breakpointEngine";
import { BreakpointMap } from "@/components/BreakpointMap";
import { BreakpointReport } from "@/components/BreakpointReport";
import { validateArchitecture, type ArchitectureReport } from "@/lib/architectureValidator";
import { traceCallPoint, type CallPointStep, type CallPointBreakpoint } from "@/lib/callPointTrace";
import { ArchitecturePanel } from "@/components/ArchitecturePanel";
import { CallPointTracePanel } from "@/components/CallPointTracePanel";
import type { CallPointEntry } from "@/lib/siteDoctorApi";
import { RealLogPanel } from "@/components/RealLogPanel";
import { defaultServiceTargets, type ServiceTarget, type ServiceLogResult } from "@/lib/logEngine";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Austco Site Doctor" },
    { name: "description", content: "Configure site network layout and run a full Austco diagnosis against the local diagnostic backend." },
  ]}),
  component: CommandCenter,
});

function SectionTitle({ icon: Icon, title, sub }: { icon: typeof Server; title: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-info" />
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">{title}</h3>
      {sub && <span className="text-xs text-muted-foreground">— {sub}</span>}
    </div>
  );
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="h-8">
      {children}
    </Button>
  );
}

function CommandCenter() {
  const [payload, setPayload] = useState<DiagnosisRequest>(() => structuredClone(DEFAULT_PAYLOAD));
  const [backendUrl, setBackendUrlState] = useState<string>(DEFAULT_BACKEND_URL);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnosisResponse | null>(null);
  const [hwHealth, setHwHealth] = useState<HardwareHealthRow[] | null>(null);
  const [deployHealth, setDeployHealth] = useState<DeploymentHealthCheck[] | null>(null);
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);
  const [breakpoint, setBreakpoint] = useState<Breakpoint | null>(null);
  const [chainConclusion, setChainConclusion] = useState<string>("");
  const [arch, setArch] = useState<ArchitectureReport | null>(null);
  const [cpSteps, setCpSteps] = useState<CallPointStep[]>([]);
  const [cpBreak, setCpBreak] = useState<CallPointBreakpoint | null>(null);
  const [cpConclusion, setCpConclusion] = useState<string>("");
  const [tracedCallPoint, setTracedCallPoint] = useState<CallPointEntry | null>(null);
  const [services, setServices] = useState<ServiceTarget[]>(() => defaultServiceTargets());
  const [manualLogs, setManualLogs] = useState<ServiceLogResult[]>([]);

  useEffect(() => { setBackendUrlState(getBackendUrl()); }, []);

  const update = <K extends keyof DiagnosisRequest>(k: K, v: DiagnosisRequest[K]) =>
    setPayload((p) => ({ ...p, [k]: v }));

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setScanning(true);
    setBackendUrl(backendUrl);
    setHwHealth(null); setDeployHealth(null); setChainSteps([]); setBreakpoint(null); setChainConclusion("");
    setArch(null); setCpSteps([]); setCpBreak(null); setCpConclusion(""); setTracedCallPoint(null);
    try {
      // Always run hardware/breakpoint engine — it works without the local backend.
      const firstCtrl = payload.knownDevices.find((d) => /controller/i.test(d.type))?.ip ?? "10.20.4.22";
      const firstApp1 = payload.knownDevices.find((d) => /app1/i.test(d.type))?.ip ?? "10.20.6.30";
      const firstIn8  = payload.knownDevices.find((d) => /in8/i.test(d.type))?.ip ?? "10.20.5.40";
      const firstLight= payload.knownDevices.find((d) => /light/i.test(d.type))?.ip ?? "10.20.7.50";

      const hwPromise = readHardwareHealth({
        controllerIp: firstCtrl, ipapp1Ip: firstApp1, ipin8Ip: firstIn8, signalLightIp: firstLight,
        pulseGatewayIp: payload.virtualIp ?? undefined,
      });
      const chainPromise = traceSignalPath(
        {
          room: "Room 230", expectedGroup: "East Wing Signal Lights",
          ipin8Ip: firstIn8, controllerIp: firstCtrl,
          ipapp1Ip: firstApp1, signalLightIp: firstLight,
          pulseGatewayIp: payload.virtualIp ?? undefined,
        },
        setChainSteps,
        180,
      );
      setDeployHealth(readDeploymentHealth());

      // Architecture validation (synchronous, pure logic)
      const archReport = validateArchitecture(payload);
      setArch(archReport);

      // Call Point → Output trace for the first declared call point
      const firstCp = payload.callPoints?.[0];
      if (firstCp) {
        setTracedCallPoint(firstCp);
        const cpResult = await traceCallPoint(payload, archReport, firstCp, setCpSteps, 160);
        setCpBreak(cpResult.breakpoint);
        setCpConclusion(cpResult.conclusion);
      }

      // Backend call may fail (laptop not running site-doctor.js) — degrade gracefully.
      const backendPromise = runDiagnosis({ ...payload, services }, backendUrl).then(
        (r) => { setResult(r); return null; },
        (err) => err instanceof Error ? err.message : String(err),
      );

      const [hw, chain, backendErr] = await Promise.all([hwPromise, chainPromise, backendPromise]);
      setHwHealth(hw);
      setBreakpoint(chain.breakpoint);
      setChainConclusion(chain.conclusion);
      if (backendErr) setError(backendErr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Diagnostic Copilot"
        title="Command Center"
        description="Define the site's network topology, then run a full diagnosis against the local Austco backend."
      />

      <form onSubmit={onRun} className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
        {/* LEFT: configuration */}
        <div className="space-y-4">
          <Card className="bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Site Configuration</span>
                <span className="font-mono text-[11px] text-muted-foreground">POST /api/diagnosis</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Site Name</Label>
                  <Input value={payload.name} onChange={(e) => update("name", e.target.value)} placeholder="Site Name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Virtual IP</Label>
                  <Input
                    value={payload.virtualIp ?? ""}
                    onChange={(e) => update("virtualIp", e.target.value || null)}
                    placeholder="10.20.1.12"
                    className="font-mono"
                  />
                </div>
              </div>

              {/* VLANs */}
              <div>
                <SectionTitle icon={Network} title="VLANs" sub="CIDR ranges to scan" />
                <div className="space-y-2">
                  {payload.vlans.map((v, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                      <Input
                        value={v.name}
                        placeholder="VLAN name"
                        onChange={(e) => {
                          const next = [...payload.vlans];
                          next[i] = { ...next[i], name: e.target.value };
                          update("vlans", next);
                        }}
                      />
                      <Input
                        value={v.cidr}
                        placeholder="10.20.1.0/24"
                        className="font-mono"
                        onChange={(e) => {
                          const next = [...payload.vlans];
                          next[i] = { ...next[i], cidr: e.target.value };
                          update("vlans", next);
                        }}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                        onClick={() => update("vlans", payload.vlans.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <RowButton onClick={() => update("vlans", [...payload.vlans, { name: "New VLAN", cidr: "10.0.0.0/24" }])}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add VLAN
                  </RowButton>
                </div>
              </div>

              {/* Server NICs */}
              <div className="grid gap-5 md:grid-cols-2">
                {(["primary", "secondary"] as const).map((side) => (
                  <div key={side}>
                    <SectionTitle icon={Server} title={`${side === "primary" ? "Primary" : "Secondary"} Server NICs`} />
                    <div className="space-y-2">
                      {payload.serverNics[side].map((nic, i) => (
                        <div key={i} className="grid gap-2 grid-cols-[1fr_1fr_auto]">
                          <Input
                            value={nic.ip}
                            placeholder="10.20.1.10"
                            className="font-mono"
                            onChange={(e) => {
                              const next = [...payload.serverNics[side]];
                              next[i] = { ...next[i], ip: e.target.value };
                              update("serverNics", { ...payload.serverNics, [side]: next });
                            }}
                          />
                          <Input
                            value={nic.purpose}
                            placeholder="LAN"
                            onChange={(e) => {
                              const next = [...payload.serverNics[side]];
                              next[i] = { ...next[i], purpose: e.target.value };
                              update("serverNics", { ...payload.serverNics, [side]: next });
                            }}
                          />
                          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                            onClick={() => update("serverNics", { ...payload.serverNics, [side]: payload.serverNics[side].filter((_, j) => j !== i) })}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <RowButton onClick={() => update("serverNics", { ...payload.serverNics, [side]: [...payload.serverNics[side], { ip: "", purpose: "" }] })}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add NIC
                      </RowButton>
                    </div>
                  </div>
                ))}
              </div>

              {/* Known devices */}
              <div>
                <SectionTitle icon={CircuitBoard} title="Known Devices" sub="Controllers, IP-APP1, IP-IN8, etc." />
                <div className="space-y-2">
                  {payload.knownDevices.map((d, i) => (
                    <div key={i} className="grid gap-2 grid-cols-[1.2fr_1fr_1fr_auto]">
                      <Input
                        value={d.name}
                        placeholder="Controller-East"
                        onChange={(e) => {
                          const next = [...payload.knownDevices];
                          next[i] = { ...next[i], name: e.target.value };
                          update("knownDevices", next);
                        }}
                      />
                      <Input
                        value={d.ip}
                        placeholder="10.20.4.50"
                        className="font-mono"
                        onChange={(e) => {
                          const next = [...payload.knownDevices];
                          next[i] = { ...next[i], ip: e.target.value };
                          update("knownDevices", next);
                        }}
                      />
                      <Input
                        value={d.type}
                        placeholder="Controller"
                        onChange={(e) => {
                          const next = [...payload.knownDevices];
                          next[i] = { ...next[i], type: e.target.value };
                          update("knownDevices", next);
                        }}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical"
                        onClick={() => update("knownDevices", payload.knownDevices.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <RowButton onClick={() => update("knownDevices", [...payload.knownDevices, { name: "", ip: "", type: "" }])}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add device
                  </RowButton>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/70">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4 text-info" /> Backend Endpoint
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input
                value={backendUrl}
                onChange={(e) => setBackendUrlState(e.target.value)}
                placeholder={DEFAULT_BACKEND_URL}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Run <span className="font-mono text-foreground">node site-doctor.js</span> on the technician laptop. The frontend POSTs the payload above to this URL — no other endpoints are used.
              </p>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {scanning ? "Running scan against backend…" : "Ready. Verify VLANs and devices, then run."}
            </p>
            <Button type="submit" disabled={scanning} size="lg" className="bg-info text-info-foreground hover:bg-info/90">
              {scanning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running Diagnosis…</> : <><ScanLine className="mr-2 h-4 w-4" />Run Full Diagnosis</>}
            </Button>
          </div>
        </div>

        {/* RIGHT: results */}
        <div className="space-y-4">
          <ResultsPanel
            result={result} error={error} scanning={scanning} backendUrl={backendUrl}
            hwHealth={hwHealth} deployHealth={deployHealth}
            chainSteps={chainSteps} breakpoint={breakpoint} chainConclusion={chainConclusion}
            arch={arch}
            tracedCallPoint={tracedCallPoint}
            cpSteps={cpSteps} cpBreak={cpBreak} cpConclusion={cpConclusion}
            services={services}
            onServicesChange={setServices}
            manualLogs={manualLogs}
            onManualAdd={(r) => setManualLogs((prev) => [...prev, r])}
            onManualClear={() => setManualLogs([])}
          />
        </div>
      </form>
    </div>
  );
}

function ResultsPanel({
  result, error, scanning, backendUrl,
  hwHealth, deployHealth, chainSteps, breakpoint, chainConclusion,
  arch, tracedCallPoint, cpSteps, cpBreak, cpConclusion,
  services, onServicesChange, manualLogs, onManualAdd, onManualClear,
}: {
  result: DiagnosisResponse | null; error: string | null; scanning: boolean; backendUrl: string;
  hwHealth: HardwareHealthRow[] | null; deployHealth: DeploymentHealthCheck[] | null;
  chainSteps: ChainStep[]; breakpoint: Breakpoint | null; chainConclusion: string;
  arch: ArchitectureReport | null;
  tracedCallPoint: CallPointEntry | null;
  cpSteps: CallPointStep[]; cpBreak: CallPointBreakpoint | null; cpConclusion: string;
  services: ServiceTarget[];
  onServicesChange: (next: ServiceTarget[]) => void;
  manualLogs: ServiceLogResult[];
  onManualAdd: (r: ServiceLogResult) => void;
  onManualClear: () => void;
}) {
  const hasAnything = result || hwHealth || deployHealth || chainSteps.length > 0 || arch || cpSteps.length > 0;

  if (error && !hasAnything) {
    return (
      <Alert className="border-critical/40 bg-critical/10 text-critical">
        <AlertOctagon className="h-4 w-4" />
        <AlertTitle>Backend unreachable</AlertTitle>
        <AlertDescription className="space-y-2 text-foreground/80">
          <p className="font-mono text-xs">{error}</p>
          <p className="text-xs">
            Confirm <span className="font-mono">node site-doctor.js</span> is running and reachable at{" "}
            <span className="font-mono">{backendUrl}</span>. Check CORS, firewall, and that you're on the site network.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (!hasAnything) {
    return (
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Diagnosis Results</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/10 p-8 text-center">
            {scanning ? <Loader2 className="h-6 w-6 animate-spin text-info" /> : <ScanLine className="h-6 w-6 text-muted-foreground" />}
            <div className="text-sm font-medium">{scanning ? "Scanning site…" : "No diagnosis run yet"}</div>
            <div className="max-w-xs text-xs text-muted-foreground">
              {scanning
                ? "Pinging hosts, scanning common ports across each VLAN, and walking the truth chain."
                : "Configure the site on the left and press Run Full Diagnosis. Results appear here."}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const critical = result?.issues.filter((i) => i.severity === "Critical").length ?? (breakpoint ? 1 : 0);
  const reachable = result?.devices.filter((d) => d.alive !== false).length ?? (hwHealth?.filter((h) => h.online).length ?? 0);
  const siteName = result?.site ?? "Site";

  return (
    <div className="space-y-4">
      {error && (
        <Alert className="border-warning/40 bg-warning/10 text-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Live backend unreachable — showing hardware adapter results only</AlertTitle>
          <AlertDescription className="text-xs text-foreground/80">
            <span className="font-mono">{error}</span> · backend: <span className="font-mono">{backendUrl}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryStat label="Site" value={siteName} tone="info" Icon={ShieldCheck} />
        <SummaryStat label="Modules online" value={`${reachable}`} sub={`${(result?.devices.length ?? hwHealth?.length ?? 0)} scanned`} tone="ok" Icon={Server} />
        <SummaryStat label="Critical issues" value={`${critical}`} tone={critical ? "crit" : "ok"} Icon={AlertOctagon} />
      </div>

      {/* 1. Austco Deployment Health */}
      {deployHealth && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-info" /> Austco Deployment Health</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {deployHealth.map((d) => (
              <div key={d.name} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/10 px-3 py-2 text-xs">
                {d.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />}
                <div className="flex-1"><div className="font-medium text-sm">{d.name}</div><div className="text-muted-foreground">{d.detail}</div></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 1b. Architecture validation (Tacera/Pulse rules) */}
      {arch && <ArchitecturePanel report={arch} />}

      {/* 2. Hardware Communication Health */}
      {hwHealth && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-4 w-4 text-info" /> Hardware Communication Health</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hwHealth.map((h) => (
                  <TableRow key={h.module}>
                    <TableCell className="font-medium">{h.module}</TableCell>
                    <TableCell className="font-mono text-xs">{h.ip}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${h.online ? "bg-success/15 text-success" : "bg-critical/15 text-critical"}`}>
                        {h.online ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{h.online ? "Online" : "Offline"}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{h.detail}</TableCell>
                    <TableCell><span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">{h.source}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 3. Breakpoint Map */}
      {chainSteps.length > 0 && (
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4 text-info" /> Breakpoint Map · Live Signal Chain</CardTitle></CardHeader>
          <CardContent><BreakpointMap steps={chainSteps} /></CardContent>
        </Card>
      )}

      {/* 3b. Call Point → Output Trace */}
      {tracedCallPoint && cpSteps.length > 0 && (
        <CallPointTracePanel
          callPoint={tracedCallPoint}
          steps={cpSteps}
          breakpoint={cpBreak}
          conclusion={cpConclusion}
        />
      )}

      {/* 4. Root Cause Analysis */}
      {(breakpoint || chainConclusion) && (
        <BreakpointReport bp={breakpoint} conclusion={chainConclusion} />
      )}

      {/* Conclusion */}
      {result && (
        <Card className="border-critical/40 bg-gradient-to-br from-critical/15 to-critical/5">
          <CardContent className="p-5">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-critical">Backend Conclusion</div>
            <div className="mt-1 text-lg font-semibold leading-snug">{result.conclusion}</div>
          </CardContent>
        </Card>
      )}

      {/* Truth chain */}
      {result && <Card className="bg-card/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cable className="h-4 w-4 text-info" /> Truth Layer · Signal Chain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {result.truth.chain.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${s.ok ? "border-success/50 bg-success/10 text-success" : "border-critical/60 bg-critical/15 text-critical shadow-[0_0_24px_-6px_var(--critical)]"}`}>
                  {s.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                  <span>{s.step}</span>
                </div>
                {i < result.truth.chain.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>}

      {/* Issues */}
      {result && <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Issues</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {result.issues.length === 0 && <div className="text-xs text-muted-foreground">No issues reported by backend.</div>}
          {result.issues.map((iss, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/10 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                {iss.severity === "Critical"
                  ? <AlertOctagon className="h-4 w-4 text-critical" />
                  : <AlertTriangle className="h-4 w-4 text-warning" />}
                <span className="font-medium">{iss.title}</span>
              </div>
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${iss.severity === "Critical" ? "bg-critical/20 text-critical" : "bg-warning/20 text-warning"}`}>
                {iss.severity}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>}

      {/* Device table */}
      {result && <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Devices ({result.devices.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP</TableHead>
                <TableHead>VLAN</TableHead>
                <TableHead className="text-right">Latency</TableHead>
                <TableHead>Open Ports</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.devices.length === 0 && (
                <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">No devices returned by scan.</TableCell></TableRow>
              )}
              {result.devices.map((d, i) => (
                <TableRow key={`${d.ip}-${i}`}>
                  <TableCell className="font-mono text-xs">{d.ip}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.vlan ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{d.latency != null ? `${d.latency} ms` : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{d.ports?.length ? d.ports.join(", ") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>}
    </div>
  );
}

function SummaryStat({
  label, value, sub, tone, Icon,
}: { label: string; value: string; sub?: string; tone: "ok" | "warn" | "crit" | "info"; Icon: typeof Server }) {
  const cls = { ok: "border-success/30 text-success", warn: "border-warning/30 text-warning", crit: "border-critical/40 text-critical", info: "border-info/30 text-info" }[tone];
  return (
    <Card className={`border bg-card/70 ${cls}`}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{label}</span><Icon className="h-3.5 w-3.5" />
        </div>
        <div className="mt-1 truncate text-xl font-semibold">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

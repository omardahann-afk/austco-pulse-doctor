import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ScanLine, Loader2, Plus, X, Server, Network, Cpu, Router, FlaskConical, Trash2,
  Download, Upload, FileText, CheckCircle2, AlertTriangle,
} from "lucide-react";
import {
  type SiteConfig, type ModuleEntry, type ControllerEntry, type IpIn8Entry, type DisplayEntry,
  type SwitchEntry, type VlanEntry, type ModuleRole,
  EMPTY_SITE_CONFIG, EXAMPLE_SITE_CONFIG, loadSiteConfig, saveSiteConfig, clearSiteConfig,
  newId, countTestableDevices, saveLastDiagnosis, getBackendUrl, setBackendUrl, DEFAULT_BACKEND_URL,
} from "@/lib/siteConfig";
import { checkHealth, runDiagnosis } from "@/lib/agentClient";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Tacera Doctor" },
    { name: "description", content: "Local diagnostic appliance — enter site IPs, hostnames, VLANs and run real tests from the on-site VM." },
  ]}),
  component: CommandCenter,
});

const ROLES: ModuleRole[] = ["Pulse Gateway", "IPConnect", "INGA / Integration Gateway", "License Server", "Pulse Manage", "Display / IP-APP"];

function parsePorts(s: string): number[] {
  return s.split(/[,\s]+/).map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}
function portsToStr(p: number[] | undefined) { return (p || []).join(", "); }

function CommandCenter() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<SiteConfig>(() => structuredClone(EMPTY_SITE_CONFIG));
  const [backend, setBackend] = useState(DEFAULT_BACKEND_URL);
  const [health, setHealth] = useState<{ status: "idle" | "ok" | "fail"; msg?: string; vm?: { hostname: string; addrs: string[] } }>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCfg(loadSiteConfig()); setBackend(getBackendUrl()); }, []);
  useEffect(() => { saveSiteConfig(cfg); }, [cfg]);

  async function pingHealth() {
    setBackendUrl(backend);
    const r = await checkHealth();
    if (r.ok) setHealth({ status: "ok", vm: r.data.vm, msg: `Agent ${r.data.version} on ${r.data.vm.hostname}` });
    else setHealth({ status: "fail", msg: r.error });
  }

  const total = countTestableDevices(cfg);

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (total === 0) { setError("Insufficient data — enter site IPs, hostnames, VLANs, or upload config before running diagnosis."); return; }
    setBackendUrl(backend);
    setSubmitting(true);
    try {
      const res = await runDiagnosis(cfg);
      if (!("ok" in res) || !res.ok) {
        setError(("message" in res && res.message) || "Backend rejected the request.");
      } else {
        saveLastDiagnosis(res); navigate({ to: "/diagnosis" });
      }
    } catch (err) {
      setError(`Backend unreachable at ${backend}. The diagnosis agent must run on the on-site VM (npm run backend). ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSubmitting(false); }
  }

  function importJson(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result)) as Partial<SiteConfig>;
        setCfg({ ...EMPTY_SITE_CONFIG, ...parsed,
          vlans: parsed.vlans ?? [], modules: parsed.modules ?? [], controllers: parsed.controllers ?? [],
          ipin8s: parsed.ipin8s ?? [], displays: parsed.displays ?? [], switches: parsed.switches ?? [] });
      } catch { setError("Import failed — file is not valid JSON site config."); }
    };
    r.readAsText(file);
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(cfg.siteName || "site").replace(/[^\w-]+/g, "_")}.tacera.json`; a.click();
    URL.revokeObjectURL(url);
  }
  function loadExample() { if (confirm("Load DEMO example site? This will overwrite your current config.")) setCfg(structuredClone(EXAMPLE_SITE_CONFIG)); }
  function clearAll() { if (confirm("Clear all site config?")) { clearSiteConfig(); setCfg(structuredClone(EMPTY_SITE_CONFIG)); } }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Local Diagnostic Appliance"
        title="Command Center"
        description="Enter the site's IPs, hostnames, VLANs, controllers and switches. Diagnosis runs from the on-site VM agent against only what you provide — no defaults, no demo IPs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={exportJson}><Download className="mr-1.5 h-3.5 w-3.5" /> Export JSON</Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border/60 bg-background/60 px-2.5 py-1 text-xs hover:bg-background">
              <Upload className="h-3.5 w-3.5" /> Import JSON
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ""; }} />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={loadExample}><FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Load Example</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearAll}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear</Button>
            <Button asChild type="button" variant="outline" size="sm"><Link to="/logs"><FileText className="mr-1.5 h-3.5 w-3.5" /> Logs</Link></Button>
          </div>
        }
      />

      {/* Backend agent */}
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-sm">0 · Backend Agent</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <Input value={backend} onChange={(e) => setBackend(e.target.value)} placeholder="http://localhost:3001" className="font-mono" />
            <Button type="button" variant="outline" onClick={pingHealth}>Test connection</Button>
          </div>
          {health.status === "ok" && (
            <div className="flex items-center gap-2 rounded border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> {health.msg} · IPs: {health.vm?.addrs.join(", ") || "—"}
            </div>
          )}
          {health.status === "fail" && (
            <div className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Backend unreachable: {health.msg}. Run <code className="font-mono">npm run backend</code> on the on-site VM.
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={onRun} className="space-y-5">
        {/* Site */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">1 · Site</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Site Name</Label>
              <Input value={cfg.siteName} onChange={(e) => setCfg({ ...cfg, siteName: e.target.value })} placeholder="Hospital — Building A" /></div>
            <div className="space-y-1.5"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Technician</Label>
              <Input value={cfg.technician} onChange={(e) => setCfg({ ...cfg, technician: e.target.value })} placeholder="Name" /></div>
            <div className="md:col-span-2 space-y-1.5"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Site Notes</Label>
              <Textarea value={cfg.siteNotes} onChange={(e) => setCfg({ ...cfg, siteNotes: e.target.value })} className="min-h-[60px]" /></div>
          </CardContent>
        </Card>

        {/* VLANs */}
        <RepeaterCard title="2 · VLANs / Subnets" icon={Network}
          add={() => setCfg((c) => ({ ...c, vlans: [...c.vlans, { id: newId(), name: "", cidr: "" }] }))}
          addLabel="Add VLAN/Subnet"
        >
          {cfg.vlans.map((v, i) => (
            <Row key={v.id} onRemove={() => setCfg((c) => ({ ...c, vlans: c.vlans.filter((_, j) => j !== i) }))}>
              <Input value={v.name} placeholder="VLAN name" onChange={(e) => setCfg((c) => { const n = [...c.vlans]; n[i] = { ...n[i], name: e.target.value }; return { ...c, vlans: n }; })} />
              <Input value={v.cidr} placeholder="192.168.10.0/24" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.vlans]; n[i] = { ...n[i], cidr: e.target.value }; return { ...c, vlans: n }; })} />
            </Row>
          ))}
        </RepeaterCard>

        {/* Modules */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">3 · Modules</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {cfg.modules.map((m, i) => (
              <div key={m.id} className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="grid gap-2 md:grid-cols-[200px_1fr_auto]">
                  <select value={m.role} onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], role: e.target.value as ModuleRole }; return { ...c, modules: n }; })}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Input value={m.name} placeholder="Display name" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], name: e.target.value }; return { ...c, modules: n }; })} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => setCfg((c) => ({ ...c, modules: c.modules.filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></Button>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  <Input value={m.ip} placeholder="IP" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], ip: e.target.value }; return { ...c, modules: n }; })} />
                  <Input value={m.hostname} placeholder="Hostname" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], hostname: e.target.value }; return { ...c, modules: n }; })} />
                  <Input value={m.vlan} placeholder="VLAN" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], vlan: e.target.value }; return { ...c, modules: n }; })} />
                  <Input value={portsToStr(m.expectedPorts)} placeholder="Expected ports e.g. 80,443" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], expectedPorts: parsePorts(e.target.value) }; return { ...c, modules: n }; })} />
                </div>
                <Textarea value={m.notes} placeholder="Notes" className="min-h-[36px]" onChange={(e) => setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], notes: e.target.value }; return { ...c, modules: n }; })} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <Button key={r} type="button" variant="outline" size="sm" className="h-8" onClick={() => setCfg((c) => ({ ...c, modules: [...c.modules, { id: newId(), role: r, name: "", ip: "", hostname: "", vlan: "", expectedPorts: [], notes: "" }] }))}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> {r}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Controllers */}
        <RepeaterCard title="4 · Controllers" icon={Cpu}
          add={() => setCfg((c) => ({ ...c, controllers: [...c.controllers, { id: newId(), name: "", ip: "", controllerId: "", area: "", expectedPorts: [], notes: "" }] }))}
          addLabel="Add Controller"
        >
          {cfg.controllers.map((c, i) => (
            <div key={c.id} className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
                <Input value={c.name} placeholder="Controller name" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], name: e.target.value }; return { ...s, controllers: n }; })} />
                <Input value={c.ip} placeholder="IP" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], ip: e.target.value }; return { ...s, controllers: n }; })} />
                <Input value={c.controllerId} placeholder="Controller ID" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], controllerId: e.target.value }; return { ...s, controllers: n }; })} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => setCfg((s) => ({ ...s, controllers: s.controllers.filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Input value={c.area} placeholder="Area / Wing / Floor" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], area: e.target.value }; return { ...s, controllers: n }; })} />
                <Input value={portsToStr(c.expectedPorts)} placeholder="Expected ports" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], expectedPorts: parsePorts(e.target.value) }; return { ...s, controllers: n }; })} />
                <Input value={c.notes} placeholder="Notes" onChange={(e) => setCfg((s) => { const n = [...s.controllers]; n[i] = { ...n[i], notes: e.target.value }; return { ...s, controllers: n }; })} />
              </div>
            </div>
          ))}
        </RepeaterCard>

        {/* IP-IN8 */}
        <RepeaterCard title="5 · IP-IN8 Devices" icon={Cpu}
          add={() => setCfg((c) => ({ ...c, ipin8s: [...c.ipin8s, { id: newId(), name: "", ip: "", vlan: "", expectedPorts: [], notes: "" }] }))} addLabel="Add IP-IN8"
        >
          {cfg.ipin8s.map((d, i) => (
            <Row key={d.id} cols={5} onRemove={() => setCfg((s) => ({ ...s, ipin8s: s.ipin8s.filter((_, j) => j !== i) }))}>
              <Input value={d.name} placeholder="Name" onChange={(e) => setCfg((s) => { const n = [...s.ipin8s]; n[i] = { ...n[i], name: e.target.value }; return { ...s, ipin8s: n }; })} />
              <Input value={d.ip} placeholder="IP" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.ipin8s]; n[i] = { ...n[i], ip: e.target.value }; return { ...s, ipin8s: n }; })} />
              <Input value={d.vlan} placeholder="VLAN" onChange={(e) => setCfg((s) => { const n = [...s.ipin8s]; n[i] = { ...n[i], vlan: e.target.value }; return { ...s, ipin8s: n }; })} />
              <Input value={portsToStr(d.expectedPorts)} placeholder="Expected ports" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.ipin8s]; n[i] = { ...n[i], expectedPorts: parsePorts(e.target.value) }; return { ...s, ipin8s: n }; })} />
            </Row>
          ))}
        </RepeaterCard>

        {/* Displays */}
        <RepeaterCard title="6 · Displays / IP-APP" icon={Cpu}
          add={() => setCfg((c) => ({ ...c, displays: [...c.displays, { id: newId(), name: "", ip: "", vlan: "", expectedPorts: [], notes: "" }] }))} addLabel="Add Display"
        >
          {cfg.displays.map((d, i) => (
            <Row key={d.id} cols={5} onRemove={() => setCfg((s) => ({ ...s, displays: s.displays.filter((_, j) => j !== i) }))}>
              <Input value={d.name} placeholder="Name" onChange={(e) => setCfg((s) => { const n = [...s.displays]; n[i] = { ...n[i], name: e.target.value }; return { ...s, displays: n }; })} />
              <Input value={d.ip} placeholder="IP" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.displays]; n[i] = { ...n[i], ip: e.target.value }; return { ...s, displays: n }; })} />
              <Input value={d.vlan} placeholder="VLAN" onChange={(e) => setCfg((s) => { const n = [...s.displays]; n[i] = { ...n[i], vlan: e.target.value }; return { ...s, displays: n }; })} />
              <Input value={portsToStr(d.expectedPorts)} placeholder="Expected ports" className="font-mono" onChange={(e) => setCfg((s) => { const n = [...s.displays]; n[i] = { ...n[i], expectedPorts: parsePorts(e.target.value) }; return { ...s, displays: n }; })} />
            </Row>
          ))}
        </RepeaterCard>

        {/* Switches */}
        <RepeaterCard title="7 · Switches" icon={Router}
          add={() => setCfg((c) => ({ ...c, switches: [...c.switches, { id: newId(), name: "", ip: "", vendor: "", snmpEnabled: false, community: "", expectedPorts: [], notes: "" }] }))} addLabel="Add Switch"
        >
          {cfg.switches.map((s, i) => (
            <div key={s.id} className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
              <div className="grid gap-2 md:grid-cols-[1fr_180px_140px_auto]">
                <Input value={s.name} placeholder="Switch name" onChange={(e) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], name: e.target.value }; return { ...c, switches: n }; })} />
                <Input value={s.ip} placeholder="IP" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], ip: e.target.value }; return { ...c, switches: n }; })} />
                <Input value={s.vendor} placeholder="Vendor" onChange={(e) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], vendor: e.target.value }; return { ...c, switches: n }; })} />
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => setCfg((c) => ({ ...c, switches: c.switches.filter((_, j) => j !== i) }))}><X className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-2 md:grid-cols-[auto_1fr_1fr]">
                <label className="flex items-center gap-2 rounded border border-border/50 bg-background/40 px-3 py-1.5 text-xs"><span>SNMP</span>
                  <Switch checked={s.snmpEnabled} onCheckedChange={(v) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], snmpEnabled: v }; return { ...c, switches: n }; })} /></label>
                <Input value={s.community} placeholder="Community" disabled={!s.snmpEnabled} onChange={(e) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], community: e.target.value }; return { ...c, switches: n }; })} />
                <Input value={portsToStr(s.expectedPorts)} placeholder="Expected ports" className="font-mono" onChange={(e) => setCfg((c) => { const n = [...c.switches]; n[i] = { ...n[i], expectedPorts: parsePorts(e.target.value) }; return { ...c, switches: n }; })} />
              </div>
            </div>
          ))}
        </RepeaterCard>

        {/* Run */}
        <Card className="bg-card/70">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="text-xs text-muted-foreground"><span className="font-mono text-foreground">{total}</span> testable device{total === 1 ? "" : "s"}.{total === 0 && " Add at least one IP or hostname."}</div>
            <Button type="submit" disabled={submitting || total === 0} className="ml-auto bg-info text-info-foreground hover:bg-info/90">
              {submitting ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Running real tests…</> : <><ScanLine className="mr-1.5 h-3.5 w-3.5" /> Run Real Diagnosis</>}
            </Button>
          </CardContent>
          {error && <div className="mx-4 mb-4 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
        </Card>
      </form>
    </div>
  );
}

function RepeaterCard({ title, icon: Icon, add, addLabel, children }: { title: string; icon: typeof Server; add: () => void; addLabel: string; children: React.ReactNode }) {
  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Icon className="h-4 w-4 text-info" />{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {children}
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" /> {addLabel}</Button>
      </CardContent>
    </Card>
  );
}

function Row({ children, onRemove, cols = 2 }: { children: React.ReactNode; onRemove: () => void; cols?: number }) {
  const grid = cols === 5 ? "md:grid-cols-[1fr_180px_140px_180px_auto]" : "md:grid-cols-[1fr_220px_auto]";
  return (
    <div className={`grid gap-2 ${grid}`}>
      {children}
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={onRemove}><X className="h-4 w-4" /></Button>
    </div>
  );
}

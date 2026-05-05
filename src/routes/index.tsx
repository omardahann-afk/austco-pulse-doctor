import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ScanLine, Loader2, Plus, X, Download, Upload, Trash2,
  CheckCircle2, AlertTriangle, HelpCircle, Save, FolderOpen,
} from "lucide-react";
import {
  type SiteConfig, type ModuleEntry, type ModuleRole,
  EMPTY_SITE_CONFIG, loadSiteConfig, saveSiteConfig, clearSiteConfig,
  newId, saveLastDiagnosis, getBackendUrl, setBackendUrl, DEFAULT_BACKEND_URL,
} from "@/lib/siteConfig";
import { checkHealth, runDiagnosis } from "@/lib/agentClient";
import { ServicesPanel } from "@/components/ServicesPanel";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Tacera / Austco Site Doctor" },
    { name: "description", content: "Local VM diagnostic appliance for real site testing — enter site IPs and run real network diagnostics." },
  ]}),
  component: CommandCenter,
});

const ROLES: ModuleRole[] = [
  "Pulse Gateway", "IPConnect", "INGA / Integration Gateway", "License Server",
  "Pulse Manage", "Controller", "Display", "Switch", "Other",
];

function parsePorts(s: string): number[] {
  return s.split(/[,\s]+/).map((p) => Number(p.trim())).filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}
function portsToStr(p: number[] | undefined) { return (p || []).join(", "); }

type Health =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; msg: string }
  | { status: "fail"; msg: string };

function CommandCenter() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<SiteConfig>(() => structuredClone(EMPTY_SITE_CONFIG));
  const [backend, setBackend] = useState(DEFAULT_BACKEND_URL);
  const [health, setHealth] = useState<Health>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => { setCfg(loadSiteConfig()); setBackend(getBackendUrl()); }, []);

  function persistBackend(url: string) {
    setBackend(url);
    setBackendUrl(url);
  }

  async function pingHealth() {
    setBackendUrl(backend);
    setHealth({ status: "testing" });
    const r = await checkHealth();
    if (r.ok) setHealth({ status: "ok", msg: `Connected — ${r.data.service} v${r.data.version} on ${r.data.vm.hostname} (${r.data.vm.addrs.join(", ") || "no IPv4"})` });
    else setHealth({ status: "fail", msg: `Unreachable: ${r.error}` });
  }

  const testable = cfg.modules.filter((m) => (m.ip || "").trim() || (m.hostname || "").trim()).length;

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (!backend.trim()) { setError("Backend URL required."); return; }
    if (testable === 0) { setError("Insufficient data — enter at least one device IP or hostname."); return; }
    setBackendUrl(backend);
    saveSiteConfig(cfg);
    setSubmitting(true);
    try {
      const res = await runDiagnosis(cfg);
      if (!("ok" in res) || !res.ok) {
        setError(("message" in res && res.message) || "Backend rejected the request.");
      } else {
        saveLastDiagnosis(res);
        navigate({ to: "/diagnosis" });
      }
    } catch (err) {
      setError(`Backend unreachable at ${backend}. Real diagnostics require the on-site Ubuntu VM agent (port 3001). ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSubmitting(false); }
  }

  function importJson(file: File) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result)) as Partial<SiteConfig> & { backendUrl?: string; notes?: string };
        const next: SiteConfig = {
          ...EMPTY_SITE_CONFIG,
          siteName: parsed.siteName || "",
          technician: parsed.technician || "",
          siteNotes: parsed.siteNotes || parsed.notes || "",
          modules: Array.isArray(parsed.modules)
            ? parsed.modules.map((m) => ({
                id: m.id || newId(),
                role: (m.role as ModuleRole) || "Other",
                name: m.name || "",
                ip: m.ip || "",
                hostname: m.hostname || "",
                vlan: m.vlan || "",
                expectedPorts: Array.isArray(m.expectedPorts) ? m.expectedPorts.filter((n) => typeof n === "number") : [],
                notes: m.notes || "",
              }))
            : [],
        };
        setCfg(next);
        if (parsed.backendUrl) persistBackend(parsed.backendUrl);
        setInfo("Config imported.");
      } catch { setError("Import failed — file is not valid JSON site config."); }
    };
    r.readAsText(file);
  }

  function exportJson() {
    const payload = {
      siteName: cfg.siteName,
      technician: cfg.technician,
      notes: cfg.siteNotes,
      backendUrl: backend,
      modules: cfg.modules.map((m) => ({
        name: m.name, role: m.role, ip: m.ip, hostname: m.hostname,
        expectedPorts: m.expectedPorts, notes: m.notes,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${(cfg.siteName || "site").replace(/[^\w-]+/g, "_")}.tacera.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function saveCfgNow() { saveSiteConfig(cfg); setInfo("Config saved to this browser."); }
  function loadCfgNow() { setCfg(loadSiteConfig()); setInfo("Config loaded from this browser."); }
  function clearAll() {
    if (!confirm("Clear all site config?")) return;
    clearSiteConfig();
    setCfg(structuredClone(EMPTY_SITE_CONFIG));
    setInfo("Config cleared.");
  }

  function addModule(role: ModuleRole = "Other") {
    setCfg((c) => ({ ...c, modules: [...c.modules, {
      id: newId(), role, name: "", ip: "", hostname: "", vlan: "", expectedPorts: [], notes: "",
    }]}));
  }
  function updateModule(i: number, patch: Partial<ModuleEntry>) {
    setCfg((c) => { const n = [...c.modules]; n[i] = { ...n[i], ...patch }; return { ...c, modules: n }; });
  }
  function removeModule(i: number) {
    setCfg((c) => ({ ...c, modules: c.modules.filter((_, j) => j !== i) }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Local VM Diagnostic Appliance"
        title="Tacera / Austco Site Doctor"
        description="Local VM diagnostic appliance for real site testing. Enter the site's IPs/hostnames, then run real network tests from the on-site agent."
      />

      {/* 1. Backend status */}
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-sm">1 · Backend Agent</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Backend URL</Label>
              <Input value={backend} onChange={(e) => persistBackend(e.target.value)} placeholder="http://localhost:3001" className="font-mono" />
            </div>
            <Button type="button" variant="outline" onClick={pingHealth} className="self-end" disabled={health.status === "testing"}>
              {health.status === "testing" ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Testing…</> : "Test Backend"}
            </Button>
          </div>
          {health.status === "ok" && (
            <div className="flex items-start gap-2 rounded border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {health.msg}
            </div>
          )}
          {health.status === "fail" && (
            <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div className="font-semibold">{health.msg}</div>
                <div className="mt-0.5 opacity-80">Run <code className="font-mono">npm run backend</code> on the on-site Ubuntu VM. Default URL is <code className="font-mono">http://localhost:3001</code>; change above to <code className="font-mono">http://&lt;VM-IP&gt;:3001</code> if the UI is not on the VM.</div>
              </div>
            </div>
          )}
          {health.status === "idle" && (
            <div className="flex items-start gap-2 rounded border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Not tested yet. Click <span className="font-semibold">Test Backend</span> to verify the local VM agent is reachable.
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={onRun} className="space-y-5">
        {/* 2. Site info */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">2 · Site Info</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Site Name</Label>
              <Input value={cfg.siteName} onChange={(e) => setCfg({ ...cfg, siteName: e.target.value })} placeholder="e.g. Building A — Floor 3" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Technician</Label>
              <Input value={cfg.technician} onChange={(e) => setCfg({ ...cfg, technician: e.target.value })} placeholder="Name" />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Notes</Label>
              <Textarea value={cfg.siteNotes} onChange={(e) => setCfg({ ...cfg, siteNotes: e.target.value })} className="min-h-[60px]" placeholder="Anything relevant for this run…" />
            </div>
          </CardContent>
        </Card>

        {/* 3. Devices / Modules */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3 flex-row items-center justify-between">
            <CardTitle className="text-sm">4 · Devices / Modules (network-only)</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => addModule("Other")}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Device
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {cfg.modules.length === 0 && (
              <div className="rounded border border-dashed border-border/60 bg-background/30 px-4 py-6 text-center text-xs text-muted-foreground">
                Enter site devices or import a JSON config to begin. Add at least one device with an IP address or hostname.
              </div>
            )}

            {cfg.modules.map((m, i) => (
              <div key={m.id} className="rounded border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="grid gap-2 md:grid-cols-[1fr_200px_auto]">
                  <Input value={m.name} placeholder="Device name" onChange={(e) => updateModule(i, { name: e.target.value })} />
                  <select value={m.role} onChange={(e) => updateModule(i, { role: e.target.value as ModuleRole })}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => removeModule(i)} aria-label="Remove device">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">IP Address</Label>
                    <Input value={m.ip} placeholder="e.g. 192.168.10.20" className="font-mono" onChange={(e) => updateModule(i, { ip: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Hostname</Label>
                    <Input value={m.hostname} placeholder="e.g. pulse.local" className="font-mono" onChange={(e) => updateModule(i, { hostname: e.target.value })} />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Expected Ports (comma-separated)</Label>
                    <Input value={portsToStr(m.expectedPorts)} placeholder="e.g. 22, 80, 443, 10000" className="font-mono"
                      onChange={(e) => updateModule(i, { expectedPorts: parsePorts(e.target.value) })} />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</Label>
                    <Textarea value={m.notes} placeholder="Notes for this device" className="min-h-[36px]" onChange={(e) => updateModule(i, { notes: e.target.value })} />
                  </div>
                </div>
                {!(m.ip || "").trim() && !(m.hostname || "").trim() && (
                  <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
                    Requires either an IP address or a hostname.
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2 pt-1">
              {ROLES.map((r) => (
                <Button key={r} type="button" variant="outline" size="sm" className="h-8" onClick={() => addModule(r)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> {r}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 4. JSON config */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">4 · JSON Config</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border/60 bg-background/60 px-3 py-1.5 text-xs hover:bg-background">
              <Upload className="h-3.5 w-3.5" /> Import JSON
              <input type="file" accept="application/json,.json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = ""; }} />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={exportJson}><Download className="mr-1.5 h-3.5 w-3.5" /> Export JSON</Button>
            <Button type="button" variant="outline" size="sm" onClick={saveCfgNow}><Save className="mr-1.5 h-3.5 w-3.5" /> Save Config</Button>
            <Button type="button" variant="outline" size="sm" onClick={loadCfgNow}><FolderOpen className="mr-1.5 h-3.5 w-3.5" /> Load Saved Config</Button>
            <Button type="button" variant="outline" size="sm" onClick={clearAll}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear Config</Button>
          </CardContent>
        </Card>

        {/* 5. Run */}
        <Card className="bg-card/70">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{testable}</span> testable device{testable === 1 ? "" : "s"}.
              {testable === 0 && " Add at least one device with an IP or hostname."}
            </div>
            <Button type="submit" size="lg" disabled={submitting || testable === 0 || !backend.trim()}
              className="ml-auto bg-info text-info-foreground hover:bg-info/90">
              {submitting
                ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Running real diagnosis from local VM agent…</>
                : <><ScanLine className="mr-1.5 h-4 w-4" /> Run Real Diagnosis</>}
            </Button>
          </CardContent>
          {error && <div className="mx-4 mb-4 rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}
          {info && !error && <div className="mx-4 mb-4 rounded border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">{info}</div>}
        </Card>
      </form>
    </div>
  );
}
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import {
  type SiteConfig, type ModuleEntry, type ControllerEntry, type IpIn8Entry,
  type SwitchEntry, type VlanEntry, type ModuleRole,
  EMPTY_SITE_CONFIG, EXAMPLE_SITE_CONFIG, loadSiteConfig, saveSiteConfig,
  clearSiteConfig, newId, countTestableDevices, saveLastDiagnosis,
} from "@/lib/siteConfig";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Tacera Doctor" },
    { name: "description", content: "Enter the site's IPs, hostnames, VLANs and devices, then run a real diagnosis." },
  ]}),
  component: CommandCenter,
});

const REQUIRED_MODULE_ROLES: ModuleRole[] = [
  "Pulse Gateway", "IPConnect", "INGA / Integration Gateway", "License Server", "Pulse Manage",
];

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
  const [cfg, setCfg] = useState<SiteConfig>(() => structuredClone(EMPTY_SITE_CONFIG));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCfg(loadSiteConfig()); }, []);
  useEffect(() => { saveSiteConfig(cfg); }, [cfg]);

  const totalTestable = countTestableDevices(cfg);

  function loadExample() { setCfg(structuredClone(EXAMPLE_SITE_CONFIG)); }
  function clearAll() {
    if (!confirm("Clear all site config?")) return;
    clearSiteConfig();
    setCfg(structuredClone(EMPTY_SITE_CONFIG));
  }

  async function onRun(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (totalTestable === 0) {
      setError("Insufficient data — enter site IPs, hostnames, VLANs, or upload config before running diagnosis.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = await res.json() as
        | { ok: true; [k: string]: unknown }
        | { ok: false; reason: string; message: string };
      if (!data.ok) {
        setError(data.message || `Backend error: ${data.reason}`);
        setSubmitting(false);
        return;
      }
      saveLastDiagnosis(data as never);
      navigate({ to: "/diagnosis" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  /* ---- Mutation helpers ---- */
  function addModule(role: ModuleRole) {
    setCfg((c) => ({ ...c, modules: [...c.modules, { id: newId(), role, name: "", ip: "", hostname: "", vlan: "", notes: "" }] }));
  }
  function updModule(i: number, patch: Partial<ModuleEntry>) {
    setCfg((c) => { const next = [...c.modules]; next[i] = { ...next[i], ...patch }; return { ...c, modules: next }; });
  }
  function rmModule(i: number) { setCfg((c) => ({ ...c, modules: c.modules.filter((_, j) => j !== i) })); }

  function addController() {
    setCfg((c) => ({ ...c, controllers: [...c.controllers, { id: newId(), name: "", ip: "", controllerId: "", area: "", notes: "" }] }));
  }
  function updController(i: number, patch: Partial<ControllerEntry>) {
    setCfg((c) => { const next = [...c.controllers]; next[i] = { ...next[i], ...patch }; return { ...c, controllers: next }; });
  }
  function rmController(i: number) { setCfg((c) => ({ ...c, controllers: c.controllers.filter((_, j) => j !== i) })); }

  function addIpIn8() {
    setCfg((c) => ({ ...c, ipin8s: [...c.ipin8s, { id: newId(), name: "", ip: "", vlan: "", notes: "" }] }));
  }
  function updIpIn8(i: number, patch: Partial<IpIn8Entry>) {
    setCfg((c) => { const next = [...c.ipin8s]; next[i] = { ...next[i], ...patch }; return { ...c, ipin8s: next }; });
  }
  function rmIpIn8(i: number) { setCfg((c) => ({ ...c, ipin8s: c.ipin8s.filter((_, j) => j !== i) })); }

  function addSwitch() {
    setCfg((c) => ({ ...c, switches: [...c.switches, { id: newId(), name: "", ip: "", vendor: "", snmpEnabled: false, community: "", notes: "" }] }));
  }
  function updSwitch(i: number, patch: Partial<SwitchEntry>) {
    setCfg((c) => { const next = [...c.switches]; next[i] = { ...next[i], ...patch }; return { ...c, switches: next }; });
  }
  function rmSwitch(i: number) { setCfg((c) => ({ ...c, switches: c.switches.filter((_, j) => j !== i) })); }

  function addVlan() {
    setCfg((c) => ({ ...c, vlans: [...c.vlans, { id: newId(), name: "", cidr: "" }] }));
  }
  function updVlan(i: number, patch: Partial<VlanEntry>) {
    setCfg((c) => { const next = [...c.vlans]; next[i] = { ...next[i], ...patch }; return { ...c, vlans: next }; });
  }
  function rmVlan(i: number) { setCfg((c) => ({ ...c, vlans: c.vlans.filter((_, j) => j !== i) })); }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Field Diagnostic Copilot"
        title="Command Center"
        description="Enter the site's IPs, hostnames, VLANs, controllers and switches. Diagnosis runs real network tests against only what you provide — no defaults, no demo IPs."
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadExample}>
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" /> Load Example
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearAll}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        }
      />

      <form onSubmit={onRun} className="space-y-5">
        {/* SITE */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">1 · Site</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-w-md">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Site Name</Label>
              <Input value={cfg.siteName} onChange={(e) => setCfg({ ...cfg, siteName: e.target.value })} placeholder="Hospital — Building A" />
            </div>
          </CardContent>
        </Card>

        {/* VLANS */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">2 · VLANs / Subnets</CardTitle></CardHeader>
          <CardContent>
            <SectionHeader icon={Network} title="Add VLAN" sub="example: 192.168.10.0/24" />
            <div className="mt-2 space-y-2">
              {cfg.vlans.map((v, i) => (
                <div key={v.id} className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
                  <Input value={v.name} placeholder="VLAN name" onChange={(e) => updVlan(i, { name: e.target.value })} />
                  <Input value={v.cidr} placeholder="192.168.10.0/24" className="font-mono" onChange={(e) => updVlan(i, { cidr: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => rmVlan(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addVlan}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add VLAN/Subnet
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* MODULES */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">3 · Modules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SectionHeader icon={Server} title="Server-side modules" sub="Only test what is actually deployed at this site" />
            <div className="space-y-2">
              {cfg.modules.map((m, i) => (
                <div key={m.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <div className="grid gap-2 md:grid-cols-[200px_1fr_auto]">
                    <select
                      value={m.role}
                      onChange={(e) => updModule(i, { role: e.target.value as ModuleRole })}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {REQUIRED_MODULE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      {cfg.displaysEnabled && <option value="Display / IP-APP">Display / IP-APP</option>}
                    </select>
                    <Input value={m.name} placeholder="Display name" onChange={(e) => updModule(i, { name: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => rmModule(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <Input value={m.ip} placeholder="IP address" className="font-mono" onChange={(e) => updModule(i, { ip: e.target.value })} />
                    <Input value={m.hostname} placeholder="Hostname (optional)" className="font-mono" onChange={(e) => updModule(i, { hostname: e.target.value })} />
                    <Input value={m.vlan} placeholder="VLAN / Subnet" onChange={(e) => updModule(i, { vlan: e.target.value })} />
                  </div>
                  <Textarea value={m.notes} placeholder="Notes (optional)" className="min-h-[36px]" onChange={(e) => updModule(i, { notes: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_MODULE_ROLES.map((r) => (
                <Button key={r} type="button" variant="outline" size="sm" className="h-8" onClick={() => addModule(r)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> {r}
                </Button>
              ))}
              <label className="ml-auto flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-1.5 text-xs">
                <span>Displays / IP-APP enabled</span>
                <Switch checked={cfg.displaysEnabled} onCheckedChange={(v) => setCfg({ ...cfg, displaysEnabled: v })} />
              </label>
              {cfg.displaysEnabled && (
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => addModule("Display / IP-APP")}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Display / IP-APP
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CONTROLLERS */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">4 · Controllers</CardTitle></CardHeader>
          <CardContent>
            <SectionHeader icon={Cpu} title="Add Controller" sub="Repeat per controller (area / wing / floor)" />
            <div className="mt-2 space-y-2">
              {cfg.controllers.map((c, i) => (
                <div key={c.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
                    <Input value={c.name} placeholder="Controller name" onChange={(e) => updController(i, { name: e.target.value })} />
                    <Input value={c.ip} placeholder="IP" className="font-mono" onChange={(e) => updController(i, { ip: e.target.value })} />
                    <Input value={c.controllerId} placeholder="Controller ID" onChange={(e) => updController(i, { controllerId: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => rmController(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <Input value={c.area} placeholder="Area / Wing / Floor" onChange={(e) => updController(i, { area: e.target.value })} />
                    <Input value={c.notes} placeholder="Notes (optional)" onChange={(e) => updController(i, { notes: e.target.value })} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addController}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Controller
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* IP-IN8 */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">5 · IP-IN8 Devices</CardTitle></CardHeader>
          <CardContent>
            <SectionHeader icon={Cpu} title="Add IP-IN8" />
            <div className="mt-2 space-y-2">
              {cfg.ipin8s.map((d, i) => (
                <div key={d.id} className="grid gap-2 md:grid-cols-[1fr_180px_140px_1fr_auto]">
                  <Input value={d.name} placeholder="Name" onChange={(e) => updIpIn8(i, { name: e.target.value })} />
                  <Input value={d.ip} placeholder="IP" className="font-mono" onChange={(e) => updIpIn8(i, { ip: e.target.value })} />
                  <Input value={d.vlan} placeholder="VLAN" onChange={(e) => updIpIn8(i, { vlan: e.target.value })} />
                  <Input value={d.notes} placeholder="Notes" onChange={(e) => updIpIn8(i, { notes: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => rmIpIn8(i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addIpIn8}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add IP-IN8
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* SWITCHES */}
        <Card className="bg-card/70">
          <CardHeader className="pb-3"><CardTitle className="text-sm">6 · Switches</CardTitle></CardHeader>
          <CardContent>
            <SectionHeader icon={Router} title="Add Switch" />
            <div className="mt-2 space-y-2">
              {cfg.switches.map((s, i) => (
                <div key={s.id} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_140px_auto]">
                    <Input value={s.name} placeholder="Switch name" onChange={(e) => updSwitch(i, { name: e.target.value })} />
                    <Input value={s.ip} placeholder="IP" className="font-mono" onChange={(e) => updSwitch(i, { ip: e.target.value })} />
                    <Input value={s.vendor} placeholder="Vendor" onChange={(e) => updSwitch(i, { vendor: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-critical" onClick={() => rmSwitch(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[auto_1fr_2fr]">
                    <label className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-1.5 text-xs">
                      <span>SNMP</span>
                      <Switch checked={s.snmpEnabled} onCheckedChange={(v) => updSwitch(i, { snmpEnabled: v })} />
                    </label>
                    <Input value={s.community} placeholder="Community (if SNMP)" onChange={(e) => updSwitch(i, { community: e.target.value })} disabled={!s.snmpEnabled} />
                    <Input value={s.notes} placeholder="Notes" onChange={(e) => updSwitch(i, { notes: e.target.value })} />
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={addSwitch}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Switch
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* RUN */}
        <Card className="bg-card/70">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{totalTestable}</span> testable device{totalTestable === 1 ? "" : "s"} configured.
              {totalTestable === 0 && " — Add at least one IP or hostname to run a diagnosis."}
            </div>
            <Button type="submit" disabled={submitting || totalTestable === 0} className="ml-auto bg-info text-info-foreground hover:bg-info/90">
              {submitting ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Running real tests…</> : <><ScanLine className="mr-1.5 h-3.5 w-3.5" /> Run Diagnosis</>}
            </Button>
          </CardContent>
          {error && (
            <div className="mx-4 mb-4 rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
              {error}
            </div>
          )}
        </Card>
      </form>
    </div>
  );
}

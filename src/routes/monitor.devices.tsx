import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Trash2, Zap, Loader2 } from "lucide-react";
import { monitorApi, type MonitorDevice, type ProbeProtocol, type Evidence } from "@/lib/monitorClient";
import { toast } from "sonner";

export const Route = createFileRoute("/monitor/devices")({
  head: () => ({ meta: [
    { title: "Monitored Devices — Tacera Doctor" },
    { name: "description", content: "Register controllers, gateways, brokers and services for live polling." },
  ]}),
  component: DevicesPage,
});

const KINDS = ["controller", "gateway", "broker", "service", "switch", "display", "annunciator", "vm", "generic"] as const;
const PROTOS: ProbeProtocol[] = ["icmp", "tcp", "https", "http", "mqtt"];

type Form = {
  id: string;
  name: string;
  kind: string;
  protocol: ProbeProtocol;
  host: string;
  port: string;
  url: string;
  tls: boolean;
  intervalSec: string;
  enabled: boolean;
};
const EMPTY: Form = { id: "", name: "", kind: "controller", protocol: "icmp", host: "", port: "", url: "", tls: false, intervalSec: "30", enabled: true };

function DevicesPage() {
  const [devices, setDevices] = useState<MonitorDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Evidence | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await monitorApi.devices();
      if (r.ok) setDevices(r.devices);
    } catch (err) {
      toast.error("Could not reach agent: " + (err instanceof Error ? err.message : String(err)));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function update<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  function buildPayload(f: Form) {
    const port = f.port.trim() ? Number(f.port) : null;
    return {
      id: f.id.trim(),
      name: f.name.trim() || f.id.trim(),
      kind: f.kind,
      protocol: f.protocol,
      host: f.host.trim() || null,
      port,
      url: f.url.trim() || null,
      tls: f.tls,
      intervalMs: Math.max(2, Number(f.intervalSec) || 30) * 1000,
      enabled: f.enabled,
    };
  }

  async function save() {
    if (!form.id.trim()) { toast.error("ID is required"); return; }
    setSaving(true);
    try {
      const r = await monitorApi.upsertDevice(buildPayload(form) as Parameters<typeof monitorApi.upsertDevice>[0]);
      if (!r.ok) {
        toast.error("Save failed: " + (r.errors?.join("; ") || r.reason || "unknown"));
        return;
      }
      toast.success(`Device ${r.device?.id} saved`);
      setForm(EMPTY);
      await load();
    } catch (err) {
      toast.error("Could not save: " + (err instanceof Error ? err.message : String(err)));
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm(`Delete device "${id}"? Probe history is also removed.`)) return;
    try {
      const r = await monitorApi.deleteDevice(id);
      if (r.ok) { toast.success("Deleted"); await load(); }
      else toast.error("Delete failed");
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
  }

  async function testNow() {
    setTesting("adhoc"); setTestResult(null);
    try {
      const r = await monitorApi.probeAdhoc(buildPayload(form) as Parameters<typeof monitorApi.probeAdhoc>[0]);
      if (!r.ok) { toast.error(r.errors?.join("; ") || r.reason || "Probe failed"); return; }
      setTestResult(r.evidence ?? null);
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setTesting(null); }
  }

  function loadIntoForm(d: MonitorDevice) {
    setForm({
      id: d.id, name: d.name || "", kind: d.kind, protocol: d.protocol,
      host: d.host || "", port: d.port?.toString() || "",
      url: d.url || "", tls: d.tls, intervalSec: Math.round(d.intervalMs / 1000).toString(),
      enabled: d.enabled,
    });
    setTestResult(null);
  }

  const showHostPort = form.protocol === "icmp" || form.protocol === "tcp" || form.protocol === "mqtt";
  const showUrl = form.protocol === "http" || form.protocol === "https";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Devices"
        title="Monitored Devices"
        description="Register controllers, gateways, brokers, switches and services. The agent will poll each on its own interval and stream results to /monitor."
        actions={
          <Link to="/monitor"><Button size="sm" variant="outline" className="h-8"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Live Monitor</Button></Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(320px,420px)]">
        {/* Existing devices */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Registered devices</CardTitle></CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : devices.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">No devices registered yet. Add your first one on the right.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID / Name</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Interval</TableHead>
                    <TableHead className="w-[140px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium">{d.name || d.id}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{d.id} · {d.kind}</div>
                      </TableCell>
                      <TableCell><span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono uppercase">{d.protocol}</span></TableCell>
                      <TableCell className="font-mono text-xs">{d.url || (d.host ? `${d.host}${d.port ? ":" + d.port : ""}` : "—")}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{Math.round(d.intervalMs / 1000)}s</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => loadIntoForm(d)}>Edit</Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-300" onClick={() => remove(d.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add / edit form */}
        <Card>
          <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{form.id && devices.some((d) => d.id === form.id) ? "Edit device" : "Add device"}</CardTitle>
            {form.id && <Button size="sm" variant="ghost" className="h-7" onClick={() => { setForm(EMPTY); setTestResult(null); }}>Clear</Button>}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">ID (stable, no spaces)</Label>
                <Input value={form.id} onChange={(e) => update("id", e.target.value)} placeholder="ctrl-west-01" className="font-mono text-xs h-9" />
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Controller West Wing" className="h-9" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kind</Label>
                <Select value={form.kind} onValueChange={(v) => update("kind", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Protocol</Label>
                <Select value={form.protocol} onValueChange={(v) => update("protocol", v as ProbeProtocol)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROTOS.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            {showHostPort && (
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div>
                  <Label className="text-xs">Host / IP</Label>
                  <Input value={form.host} onChange={(e) => update("host", e.target.value)} placeholder="10.20.4.22" className="font-mono text-xs h-9" />
                </div>
                <div>
                  <Label className="text-xs">Port</Label>
                  <Input value={form.port} onChange={(e) => update("port", e.target.value)} placeholder={form.protocol === "mqtt" ? "1883" : "22"} inputMode="numeric" className="font-mono text-xs h-9" />
                </div>
              </div>
            )}

            {showUrl && (
              <div>
                <Label className="text-xs">URL</Label>
                <Input value={form.url} onChange={(e) => update("url", e.target.value)} placeholder="https://10.20.1.12/api/health" className="font-mono text-xs h-9" />
              </div>
            )}

            {form.protocol === "mqtt" && (
              <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                <Label className="text-xs">TLS (port 8883)</Label>
                <Switch checked={form.tls} onCheckedChange={(v) => update("tls", v)} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Interval (seconds)</Label>
                <Input value={form.intervalSec} onChange={(e) => update("intervalSec", e.target.value)} inputMode="numeric" className="h-9" />
              </div>
              <div className="flex items-end">
                <div className="flex h-9 w-full items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3">
                  <Label className="text-xs">Enabled</Label>
                  <Switch checked={form.enabled} onCheckedChange={(v) => update("enabled", v)} />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={save} disabled={saving} className="h-9 flex-1">
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                Save device
              </Button>
              <Button size="sm" variant="outline" onClick={testNow} disabled={!!testing} className="h-9">
                {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
                Test now
              </Button>
            </div>

            {testResult && (
              <div className={`rounded-md border px-3 py-2 text-xs ${testResult.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                <div className="font-semibold">{testResult.ok ? "OK" : "FAIL"} · {testResult.protocol.toUpperCase()} · {testResult.latencyMs != null ? testResult.latencyMs.toFixed(1) + " ms" : "—"}</div>
                {testResult.error && <div className="mt-1 text-muted-foreground">{testResult.error}</div>}
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/40 p-2 text-[10px] leading-tight">{JSON.stringify(testResult.raw, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
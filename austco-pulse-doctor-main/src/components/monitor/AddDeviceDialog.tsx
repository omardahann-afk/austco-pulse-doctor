import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { findProfile, TACERA_DEVICE_PROFILES, deviceFromProfile, type TaceraDeviceType } from "@/lib/taceraDeviceProfiles";
import { monitorApi, type Evidence, type MonitorDevice, type ProbeProtocol } from "@/lib/monitorClient";
import { useSiteConfigStore } from "@/stores/siteConfigStore";

const KINDS = ["controller", "gateway", "broker", "service", "switch", "display", "annunciator", "vm", "generic"] as const;
const PROTOS: ProbeProtocol[] = ["icmp", "tcp", "https", "http", "mqtt", "mqtt-fresh", "webmin"];

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
  taceraType: TaceraDeviceType | "";
  critical: boolean;
  parentDeviceId: string;
  mqttTopicsCsv: string;
};

type QuickTemplate = { label: string; hint: string; patch: Partial<Form> };

const EMPTY: Form = {
  id: "",
  name: "",
  kind: "controller",
  protocol: "icmp",
  host: "",
  port: "",
  url: "",
  tls: false,
  intervalSec: "30",
  enabled: true,
  taceraType: "",
  critical: false,
  parentDeviceId: "",
  mqttTopicsCsv: "",
};

const TEMPLATES: QuickTemplate[] = [
  { label: "Webmin HTTPS", hint: "https · port 10000", patch: { kind: "service", protocol: "https", port: "10000", url: "https://HOST:10000", intervalSec: "30" } },
  { label: "IPConnect VM", hint: "tcp · ssh 22", patch: { kind: "vm", protocol: "tcp", port: "22", intervalSec: "30" } },
  { label: "Pulse Gateway HTTPS", hint: "https · port 443", patch: { kind: "gateway", protocol: "https", port: "443", url: "https://HOST/", intervalSec: "30" } },
  { label: "MQTT Broker", hint: "mqtt · 1883/8883", patch: { kind: "broker", protocol: "mqtt", port: "1883", tls: false, intervalSec: "30" } },
  { label: "Controller Ping", hint: "icmp", patch: { kind: "controller", protocol: "icmp", port: "", intervalSec: "20" } },
  { label: "Custom TCP Port", hint: "tcp", patch: { kind: "generic", protocol: "tcp", port: "", intervalSec: "30" } },
];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildPayload(form: Form) {
  const port = form.port.trim() ? Number(form.port) : null;
  const mqttTopics = form.mqttTopicsCsv.split(",").map((value) => value.trim()).filter(Boolean);
  const profile = form.taceraType ? findProfile(form.taceraType as TaceraDeviceType) : undefined;

  return {
    id: form.id.trim(),
    name: form.name.trim() || form.id.trim(),
    kind: form.kind,
    protocol: form.protocol,
    host: form.host.trim() || null,
    port,
    url: form.url.trim() || null,
    tls: form.tls,
    intervalMs: Math.max(2, Number(form.intervalSec) || 30) * 1000,
    enabled: form.enabled,
    deviceType: form.taceraType || null,
    critical: form.critical || profile?.critical || false,
    parentDeviceId: form.parentDeviceId.trim() || null,
    mqttTopics,
    meta: {
      taceraType: form.taceraType || null,
      critical: form.critical,
      mqttTopics,
      parentDeviceId: form.parentDeviceId.trim() || null,
      staleThresholdMs: profile?.staleThresholdMs ?? null,
      expectedPorts: profile?.expectedPorts ?? [],
    },
  };
}

function deviceToForm(device: MonitorDevice): Form {
  return {
    id: device.id,
    name: device.name || "",
    kind: device.kind,
    protocol: device.protocol,
    host: device.host || "",
    port: device.port?.toString() || "",
    url: device.url || "",
    tls: device.tls,
    intervalSec: Math.round(device.intervalMs / 1000).toString(),
    enabled: device.enabled,
    taceraType: (device.deviceType as TaceraDeviceType | "") || "",
    critical: Boolean(device.critical),
    parentDeviceId: device.parentDeviceId || "",
    mqttTopicsCsv: (device.mqttTopics || []).join(", "),
  };
}

export function AddDeviceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDevice?: MonitorDevice | null;
  onSaved?: (device: MonitorDevice) => void;
  title?: string;
  description?: string;
}) {
  const { open, onOpenChange, initialDevice = null, onSaved, title = "Add monitored device", description = "Save a device once and the same registry feeds Command Center, Live Monitor, Monitored Devices, and Autopilot." } = props;

  const monitoredDevices = useSiteConfigStore((state) => state.monitoredDevices);
  const saveMonitoredDevice = useSiteConfigStore((state) => state.saveMonitoredDevice);

  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Evidence | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initialDevice ? deviceToForm(initialDevice) : EMPTY);
    setTestResult(null);
    setSaving(false);
    setTesting(false);
  }, [initialDevice, open]);

  const parentChoices = useMemo(
    () => monitoredDevices.filter((device) => device.id !== initialDevice?.id),
    [initialDevice?.id, monitoredDevices],
  );

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function applyTemplate(template: QuickTemplate) {
    setForm((current) => ({
      ...current,
      ...template.patch,
      name: current.name || template.label,
      id: current.id || slug(template.label),
    }));
  }

  function applyTaceraProfile(type: TaceraDeviceType) {
    const profile = findProfile(type);
    if (!profile) return;

    const patch = deviceFromProfile(profile, form.host);
    setForm((current) => ({
      ...current,
      taceraType: type,
      kind: patch.kind,
      protocol: patch.protocol as ProbeProtocol,
      port: patch.port != null ? String(patch.port) : "",
      intervalSec: String(Math.round(patch.intervalMs / 1000)),
      critical: profile.critical,
      mqttTopicsCsv: profile.mqttTopics.join(", "),
      name: current.name || profile.label,
      tls: patch.protocol === "webmin" ? true : current.tls,
    }));
  }

  async function handleSave() {
    if (!form.id.trim()) {
      toast.error("ID is required");
      return;
    }

    setSaving(true);
    try {
      const saved = await saveMonitoredDevice(buildPayload(form));
      toast.success(`Device ${saved.name || saved.id} saved`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestNow() {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await monitorApi.probeAdhoc(buildPayload(form));
      if (!response.ok) {
        toast.error(response.errors?.join("; ") || response.reason || "Probe failed");
        return;
      }
      setTestResult(response.evidence ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  }

  const showHostPort = form.protocol === "icmp" || form.protocol === "tcp" || form.protocol === "mqtt" || form.protocol === "mqtt-fresh" || form.protocol === "webmin";
  const showUrl = form.protocol === "http" || form.protocol === "https";
  const showMqttTopics = form.protocol === "mqtt-fresh";
  const isEditing = Boolean(initialDevice);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit monitored device" : title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3" /> Quick-add templates
            </Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TEMPLATES.map((template) => (
                <Button key={template.label} type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => applyTemplate(template)} title={template.hint}>
                  {template.label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Tacera device profile</Label>
            <Select value={form.taceraType || "__none"} onValueChange={(value) => value === "__none" ? update("taceraType", "") : applyTaceraProfile(value as TaceraDeviceType)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="None — generic device" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">None — generic device</SelectItem>
                {TACERA_DEVICE_PROFILES.map((profile) => (
                  <SelectItem key={profile.type} value={profile.type}>
                    {profile.category === "tacera" ? "🩺" : "🖥️"} {profile.label}{profile.critical ? " · CRITICAL" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.taceraType && <p className="mt-1 text-[11px] text-muted-foreground">{findProfile(form.taceraType as TaceraDeviceType)?.notes}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">ID (stable, no spaces)</Label>
              <Input value={form.id} onChange={(event) => update("id", event.target.value)} placeholder="ipc-webmin-203" className="h-9 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="IPC Webmin 203" className="h-9" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Kind</Label>
              <Select value={form.kind} onValueChange={(value) => update("kind", value)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((kind) => <SelectItem key={kind} value={kind}>{kind}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Protocol</Label>
              <Select value={form.protocol} onValueChange={(value) => update("protocol", value as ProbeProtocol)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{PROTOS.map((protocol) => <SelectItem key={protocol} value={protocol}>{protocol.toUpperCase()}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {showHostPort && (
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <div>
                <Label className="text-xs">Host / IP</Label>
                <Input value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="192.168.10.203" className="h-9 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Port</Label>
                <Input value={form.port} onChange={(event) => update("port", event.target.value)} placeholder={form.protocol === "mqtt" ? "1883" : form.protocol === "webmin" ? "10000" : "22"} inputMode="numeric" className="h-9 font-mono text-xs" />
              </div>
            </div>
          )}

          {showUrl && (
            <div>
              <Label className="text-xs">URL</Label>
              <Input value={form.url} onChange={(event) => update("url", event.target.value)} placeholder="https://192.168.10.203:10000" className="h-9 font-mono text-xs" />
            </div>
          )}

          {form.protocol === "mqtt" && (
            <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2">
              <Label className="text-xs">TLS (port 8883)</Label>
              <Switch checked={form.tls} onCheckedChange={(value) => update("tls", value)} />
            </div>
          )}

          {showMqttTopics && (
            <div>
              <Label className="text-xs">MQTT topics (comma-separated)</Label>
              <Input value={form.mqttTopicsCsv} onChange={(event) => update("mqttTopicsCsv", event.target.value)} placeholder="xcare/#, xcare/heartbeat/#" className="h-9 font-mono text-xs" />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Interval (seconds)</Label>
              <Input value={form.intervalSec} onChange={(event) => update("intervalSec", event.target.value)} inputMode="numeric" className="h-9" />
            </div>
            <div className="flex items-end">
              <div className="flex h-9 w-full items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3">
                <Label className="text-xs">Enabled</Label>
                <Switch checked={form.enabled} onCheckedChange={(value) => update("enabled", value)} />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Parent device ID (optional)</Label>
              <Select value={form.parentDeviceId || "__none"} onValueChange={(value) => update("parentDeviceId", value === "__none" ? "" : value)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {parentChoices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>{device.name || device.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <div className="flex h-9 w-full items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3">
                <Label className="text-xs">Critical infra</Label>
                <Switch checked={form.critical} onCheckedChange={(value) => update("critical", value)} />
              </div>
            </div>
          </div>

          {testResult && (
            <div className={`rounded-md border px-3 py-2 text-xs ${testResult.ok ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"}`}>
              <div className="font-semibold">{testResult.ok ? "OK" : "FAIL"} · {testResult.protocol.toUpperCase()} · {testResult.latencyMs != null ? `${testResult.latencyMs.toFixed(1)} ms` : "—"}</div>
              {testResult.error && <div className="mt-1 text-muted-foreground">{testResult.error}</div>}
              <pre className="mt-2 max-h-40 overflow-auto rounded bg-background/40 p-2 text-[10px] leading-tight">{JSON.stringify(testResult.raw, null, 2)}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleTestNow} disabled={testing || saving}>
            {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
            Test now
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            {isEditing ? "Save changes" : "Save device"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
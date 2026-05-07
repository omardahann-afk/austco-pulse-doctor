import { useMemo, useState } from "react";
import { Loader2, Save, Trash2, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  LIVE_MONITOR_PROFILES,
  buildDeviceId,
  findLiveMonitorProfile,
  type LiveMonitorProfileKey,
} from "@/lib/liveMonitorProfiles";
import { monitorApi, type Evidence, type ProbeProtocol } from "@/lib/monitorClient";
import { useSiteConfigStore } from "@/stores/siteConfigStore";

const PROTOS: ProbeProtocol[] = ["icmp", "tcp", "http", "https", "mqtt", "mqtt-fresh", "webmin"];

export type DraftDevice = {
  draftId: string;
  profileKey: LiveMonitorProfileKey;
  name: string;
  host: string;
  hostname: string;
  protocol: ProbeProtocol;
  port: string;
  enabled: boolean;
  critical: boolean;
  notes: string;
  sshUsername: string;
  sshPassword: string;
  saveCredentials: boolean;
  sshPort: string;
  logPaths: string;
  mqttTopics: string;
  stableId: string;
  parentDeviceId: string;
};

export function makeDraft(profileKey: LiveMonitorProfileKey): DraftDevice {
  const profile = findLiveMonitorProfile(profileKey);
  return {
    draftId: `${profileKey}-${Math.random().toString(36).slice(2, 8)}`,
    profileKey,
    name: profile?.label ?? "",
    host: "",
    hostname: "",
    protocol: (profile?.protocol ?? "tcp") as ProbeProtocol,
    port: profile?.port != null ? String(profile.port) : "",
    enabled: true,
    critical: profile?.critical ?? false,
    notes: "",
    sshUsername: profile?.ssh?.username ?? "",
    sshPassword: "",
    saveCredentials: false,
    sshPort: profile?.ssh ? String(profile.ssh.port) : "22",
    logPaths: (profile?.logPaths ?? []).join("\n"),
    mqttTopics: (profile?.mqttTopics ?? []).join(", "),
    stableId: "",
    parentDeviceId: "",
  };
}

export function DeviceConfigCard(props: {
  draft: DraftDevice;
  onChange: (next: DraftDevice) => void;
  onRemove: () => void;
  onSaved?: () => void;
}) {
  const { draft, onChange, onRemove, onSaved } = props;
  const profile = findLiveMonitorProfile(draft.profileKey);
  const saveMonitoredDevice = useSiteConfigStore((s) => s.saveMonitoredDevice);
  const monitoredDevices = useSiteConfigStore((s) => s.monitoredDevices);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<Evidence | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const showSsh = Boolean(profile?.ssh);
  const isMqttFresh = draft.protocol === "mqtt-fresh";
  const computedId = useMemo(
    () => draft.stableId.trim() || buildDeviceId(draft.profileKey, draft.host),
    [draft.stableId, draft.profileKey, draft.host],
  );

  function update<K extends keyof DraftDevice>(k: K, v: DraftDevice[K]) {
    onChange({ ...draft, [k]: v });
  }

  function buildPayload() {
    const port = draft.port.trim() ? Number(draft.port) : null;
    const mqttTopics = draft.mqttTopics.split(",").map((t) => t.trim()).filter(Boolean);
    const logPaths = draft.logPaths.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return {
      id: computedId,
      name: draft.name.trim() || profile?.label || computedId,
      kind: profile?.kind ?? "generic",
      protocol: draft.protocol,
      host: draft.host.trim() || null,
      port,
      url: draft.protocol === "https" || draft.protocol === "http"
        ? `${draft.protocol}://${draft.host.trim()}${port ? ":" + port : ""}`
        : null,
      tls: profile?.tls ?? false,
      intervalMs: (profile?.intervalSec ?? 30) * 1000,
      enabled: draft.enabled,
      critical: draft.critical,
      parentDeviceId: draft.parentDeviceId.trim() || null,
      mqttTopics,
      meta: {
        profileKey: draft.profileKey,
        hostname: draft.hostname.trim() || null,
        notes: draft.notes.trim() || null,
        ssh: showSsh ? {
          username: draft.sshUsername.trim() || null,
          port: Number(draft.sshPort) || 22,
          password: draft.saveCredentials ? draft.sshPassword : "",
          saveCredentials: draft.saveCredentials,
        } : null,
        logPaths,
        mqttTopics,
      },
    };
  }

  async function handleSave() {
    if (!draft.host.trim()) {
      toast.error("Host / IP is required");
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      await saveMonitoredDevice(payload);
      toast.success(`${payload.name} saved`);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!draft.host.trim()) {
      toast.error("Enter Host / IP first");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await monitorApi.probeAdhoc(buildPayload());
      if (!r.ok) {
        toast.error(r.errors?.join("; ") || r.reason || "Probe failed");
        return;
      }
      setTestResult(r.evidence ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 py-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-sm font-semibold">
            {profile?.label ?? "Device"}
          </CardTitle>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{computedId}</p>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onRemove} title="Remove card">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Device type</Label>
            <Select value={draft.profileKey} onValueChange={(v) => {
              const next = makeDraft(v as LiveMonitorProfileKey);
              onChange({ ...next, draftId: draft.draftId, host: draft.host, hostname: draft.hostname, name: draft.name });
            }}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LIVE_MONITOR_PROFILES.map((p) => (
                  <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Display name</Label>
            <Input value={draft.name} onChange={(e) => update("name", e.target.value)} placeholder={profile?.label} className="h-9" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <div>
            <Label className="text-xs">IP / Host</Label>
            <Input value={draft.host} onChange={(e) => update("host", e.target.value)} placeholder="192.168.10.203" className="h-9 font-mono text-xs" />
          </div>
          <div>
            <Label className="text-xs">Port</Label>
            <Input value={draft.port} onChange={(e) => update("port", e.target.value)} inputMode="numeric" placeholder={profile?.port != null ? String(profile.port) : "—"} className="h-9 font-mono text-xs" />
          </div>
        </div>

        <div>
          <Label className="text-xs">Hostname (optional)</Label>
          <Input value={draft.hostname} onChange={(e) => update("hostname", e.target.value)} placeholder="ipc-203.local" className="h-9 font-mono text-xs" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex h-9 items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3">
            <Label className="text-xs">Enabled</Label>
            <Switch checked={draft.enabled} onCheckedChange={(v) => update("enabled", v)} />
          </div>
          <div className="flex h-9 items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3">
            <Label className="text-xs">Critical</Label>
            <Switch checked={draft.critical} onCheckedChange={(v) => update("critical", v)} />
          </div>
        </div>

        {showSsh && (
          <div className="space-y-3 rounded-md border border-border/40 bg-muted/10 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">SSH access</div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_100px]">
              <div>
                <Label className="text-xs">SSH username</Label>
                <Input value={draft.sshUsername} onChange={(e) => update("sshUsername", e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">SSH password</Label>
                <Input type="password" value={draft.sshPassword} onChange={(e) => update("sshPassword", e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">SSH port</Label>
                <Input value={draft.sshPort} onChange={(e) => update("sshPort", e.target.value)} inputMode="numeric" className="h-9" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2">
              <Label className="text-xs">Save credentials</Label>
              <Switch checked={draft.saveCredentials} onCheckedChange={(v) => update("saveCredentials", v)} />
            </div>
            <div>
              <Label className="text-xs">Log paths (one per line)</Label>
              <Textarea value={draft.logPaths} onChange={(e) => update("logPaths", e.target.value)} rows={2} className="font-mono text-xs" />
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs">Notes</Label>
          <Textarea value={draft.notes} onChange={(e) => update("notes", e.target.value)} rows={2} />
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-start px-2 text-xs">
              {advancedOpen ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
              Advanced
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Stable ID (optional)</Label>
                <Input value={draft.stableId} onChange={(e) => update("stableId", e.target.value)} placeholder={computedId} className="h-9 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">Protocol</Label>
                <Select value={draft.protocol} onValueChange={(v) => update("protocol", v as ProbeProtocol)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{PROTOS.map((p) => <SelectItem key={p} value={p}>{p.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {isMqttFresh && (
              <div>
                <Label className="text-xs">MQTT topics (comma-separated)</Label>
                <Input value={draft.mqttTopics} onChange={(e) => update("mqttTopics", e.target.value)} placeholder="xcare/#" className="h-9 font-mono text-xs" />
              </div>
            )}
            <div>
              <Label className="text-xs">Parent device ID (optional)</Label>
              <Select value={draft.parentDeviceId || "__none"} onValueChange={(v) => update("parentDeviceId", v === "__none" ? "" : v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None</SelectItem>
                  {monitoredDevices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name || d.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {testResult && (
          <div className={`rounded-md border px-3 py-2 text-xs ${testResult.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10"}`}>
            <div className="font-semibold">
              {testResult.ok ? "OK" : "FAIL"} · {testResult.protocol.toUpperCase()} · {testResult.latencyMs != null ? `${testResult.latencyMs.toFixed(1)} ms` : "—"}
            </div>
            {testResult.error && <div className="mt-1 text-muted-foreground">{testResult.error}</div>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
            Test Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AUTOPILOT_SERVICE_PROFILES,
  autopilotServicesApi,
  type AutopilotService,
  type AutopilotServiceTypeKey,
} from "@/lib/autopilotServicesClient";

type Form = {
  id: string;
  name: string;
  type: AutopilotServiceTypeKey;
  host: string;
  sshUsername: string;
  sshPort: string;
  serviceManager: string;
  systemdUnit: string;
  dockerContainer: string;
  webminPort: string;
  enabled: boolean;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  notes: string;
};

const EMPTY: Form = {
  id: "", name: "", type: "custom", host: "",
  sshUsername: "admin", sshPort: "22",
  serviceManager: "systemd", systemdUnit: "", dockerContainer: "", webminPort: "",
  enabled: true, riskLevel: "MEDIUM", notes: "",
};

function fromService(s: AutopilotService): Form {
  return {
    id: s.id,
    name: s.name,
    type: (s.type as AutopilotServiceTypeKey) || "custom",
    host: s.host,
    sshUsername: s.sshUsername || "admin",
    sshPort: String(s.sshPort || 22),
    serviceManager: s.serviceManager || "systemd",
    systemdUnit: s.systemdUnit || "",
    dockerContainer: s.dockerContainer || "",
    webminPort: s.webminPort != null ? String(s.webminPort) : "",
    enabled: s.enabled !== false,
    riskLevel: (s.riskLevel as "LOW" | "MEDIUM" | "HIGH") || "MEDIUM",
    notes: s.notes || "",
  };
}

export function AddAutopilotServiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AutopilotService | null;
  onSaved?: (s: AutopilotService) => void;
}) {
  const { open, onOpenChange, initial = null, onSaved } = props;
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? fromService(initial) : EMPTY);
    setSaving(false);
  }, [initial, open]);

  function update<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function applyProfile(type: AutopilotServiceTypeKey) {
    const profile = AUTOPILOT_SERVICE_PROFILES.find((p) => p.type === type);
    if (!profile) { update("type", type); return; }
    setForm((f) => ({
      ...f,
      type,
      sshUsername: profile.defaults.sshUsername ?? f.sshUsername,
      sshPort: String(profile.defaults.sshPort ?? f.sshPort),
      serviceManager: profile.defaults.serviceManager ?? f.serviceManager,
      systemdUnit: profile.defaults.systemdUnit ?? f.systemdUnit,
      dockerContainer: profile.defaults.dockerContainer ?? f.dockerContainer,
      webminPort: profile.defaults.webminPort != null ? String(profile.defaults.webminPort) : f.webminPort,
      name: f.name || profile.label,
    }));
  }

  async function save() {
    if (!form.name.trim()) { toast.error("Service name is required"); return; }
    if (!form.host.trim()) { toast.error("Host/IP is required"); return; }
    setSaving(true);
    try {
      const r = await autopilotServicesApi.save({
        id: form.id || undefined,
        name: form.name.trim(),
        type: form.type,
        role: AUTOPILOT_SERVICE_PROFILES.find((p) => p.type === form.type)?.label || form.type,
        host: form.host.trim(),
        sshUsername: form.sshUsername.trim() || "admin",
        sshPort: Number(form.sshPort) || 22,
        serviceManager: form.serviceManager,
        systemdUnit: form.systemdUnit.trim(),
        dockerContainer: form.dockerContainer.trim(),
        webminPort: form.webminPort ? Number(form.webminPort) : null,
        enabled: form.enabled,
        riskLevel: form.riskLevel,
        notes: form.notes,
      });
      toast.success(`Service ${r.service.name} saved`);
      onSaved?.(r.service);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const isEdit = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Autopilot service" : "Add Autopilot Service"}</DialogTitle>
          <DialogDescription>Services Autopilot can scan and build fix plans for. Stored in its own registry — independent of Command Center.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Service name</Label>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="IPC 203 Webmin" className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Service type / profile</Label>
              <Select value={form.type} onValueChange={(v) => applyProfile(v as AutopilotServiceTypeKey)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTOPILOT_SERVICE_PROFILES.map((p) => (
                    <SelectItem key={p.type} value={p.type}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px]">
            <div>
              <Label className="text-xs">Host / IP</Label>
              <Input value={form.host} onChange={(e) => update("host", e.target.value)} placeholder="192.168.10.203" className="h-9 font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">SSH user</Label>
              <Input value={form.sshUsername} onChange={(e) => update("sshUsername", e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">SSH port</Label>
              <Input value={form.sshPort} onChange={(e) => update("sshPort", e.target.value)} inputMode="numeric" className="h-9" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Service manager</Label>
              <Select value={form.serviceManager} onValueChange={(v) => update("serviceManager", v)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="systemd">systemd</SelectItem>
                  <SelectItem value="docker">docker</SelectItem>
                  <SelectItem value="webmin">webmin</SelectItem>
                  <SelectItem value="custom">custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Risk level</Label>
              <Select value={form.riskLevel} onValueChange={(v) => update("riskLevel", v as Form["riskLevel"])}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">LOW</SelectItem>
                  <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                  <SelectItem value="HIGH">HIGH</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.serviceManager === "systemd" && (
            <div>
              <Label className="text-xs">Systemd unit name</Label>
              <Input value={form.systemdUnit} onChange={(e) => update("systemdUnit", e.target.value)} placeholder="mosquitto" className="h-9 font-mono text-xs" />
            </div>
          )}
          {form.serviceManager === "docker" && (
            <div>
              <Label className="text-xs">Docker container name</Label>
              <Input value={form.dockerContainer} onChange={(e) => update("dockerContainer", e.target.value)} placeholder="pulse-gateway" className="h-9 font-mono text-xs" />
            </div>
          )}
          {form.serviceManager === "webmin" && (
            <div>
              <Label className="text-xs">Webmin port</Label>
              <Input value={form.webminPort} onChange={(e) => update("webminPort", e.target.value)} placeholder="10000" className="h-9 font-mono text-xs" />
            </div>
          )}

          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={2} />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2">
            <Label className="text-xs">Enabled</Label>
            <Switch checked={form.enabled} onCheckedChange={(v) => update("enabled", v)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            {isEdit ? "Save changes" : "Save service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
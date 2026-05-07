import { useState } from "react";
import { Camera, FileText, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DeviceLogPanel } from "./DeviceLogPanel";
import { monitorApi, type DeviceStateRow } from "@/lib/monitorClient";
import type { MonitorDevice } from "@/lib/monitorClient";

const EVIDENCE_UPDATED_EVENT = "evidence-snapshots:updated";

export function SavedDeviceActions({
  device,
  state,
}: {
  device: MonitorDevice;
  state?: DeviceStateRow;
}) {
  const [logsOpen, setLogsOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [testing, setTesting] = useState(false);

  const meta = (device.meta || {}) as Record<string, unknown>;
  const ssh = (meta.ssh || {}) as Record<string, unknown>;
  const logPaths = Array.isArray(meta.logPaths) ? (meta.logPaths as string[]) : [];
  const hasSsh = Boolean(ssh.username);
  const passwordSaved = Boolean(ssh.password);

  async function captureEvidence() {
    setCapturing(true);
    try {
      const probe = await monitorApi.probeAdhoc({
        id: device.id,
        kind: device.kind,
        protocol: device.protocol,
        host: device.host,
        port: device.port,
        url: device.url,
        tls: device.tls,
        mqttTopics: device.mqttTopics || [],
      } as never);
      const r = await fetch("/api/evidence/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "manual_capture",
          device: { id: device.id, name: device.name, host: device.host, kind: device.kind, protocol: device.protocol },
          probe: probe.ok ? probe.evidence : null,
          deterministicFindings: state ? [{
            kind: "device_state",
            state: state.state,
            lastError: state.last_error,
            consecutiveFail: state.consecutive_fail,
          }] : [],
          included: { probe: probe.ok, state: Boolean(state), logs: false, alerts: false },
          limitations: probe.ok ? [] : ["probe failed at capture time"],
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.reason || "snapshot_failed");
      toast.success("Evidence snapshot captured");
      window.dispatchEvent(new CustomEvent(EVIDENCE_UPDATED_EVENT));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCapturing(false);
    }
  }

  async function testNow() {
    setTesting(true);
    try {
      const r = await monitorApi.probeNow(device.id);
      if (!r.ok) toast.error(r.reason || "probe_failed");
      else toast.success(`Probe ${r.evidence?.ok ? "OK" : "FAIL"} · ${r.evidence?.latencyMs?.toFixed(1) ?? "—"} ms`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={testNow} disabled={testing}>
          {testing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Zap className="mr-1 h-3 w-3" />} Test Now
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={captureEvidence} disabled={capturing}>
          {capturing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Camera className="mr-1 h-3 w-3" />} Capture Evidence
        </Button>
        {logPaths.length > 0 && (
          <Collapsible open={logsOpen} onOpenChange={setLogsOpen}>
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 text-xs">
                <FileText className="mr-1 h-3 w-3" /> {logsOpen ? "Hide Logs" : "View Logs"}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        )}
      </div>
      {logPaths.length > 0 && (
        <Collapsible open={logsOpen} onOpenChange={setLogsOpen}>
          <CollapsibleContent>
            <DeviceLogPanel
              deviceId={device.id}
              paths={logPaths}
              needsPassword={hasSsh && !passwordSaved}
            />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
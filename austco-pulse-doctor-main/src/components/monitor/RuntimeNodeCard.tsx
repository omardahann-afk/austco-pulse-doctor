import { Link } from "@tanstack/react-router";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StateBadge } from "@/components/monitor/StateBadge";
import { SavedDeviceActions } from "@/components/monitor/SavedDeviceActions";
import { DiagnosticResultPanel } from "@/components/monitor/DiagnosticResultPanel";
import {
  findLiveMonitorProfile,
  type LiveMonitorProfileKey,
} from "@/lib/liveMonitorProfiles";
import { relativeTime, type DeviceStateRow, type MonitorDevice } from "@/lib/monitorClient";

function metricRowState(s: DeviceStateRow["state"] | undefined) {
  switch (s) {
    case "up":       return "border-success/40 bg-success/5";
    case "degraded": return "border-warning/40 bg-warning/5";
    case "down":     return "border-critical/50 bg-critical/10";
    case "stale":    return "border-border/50 bg-muted/10";
    default:         return "border-border/40 bg-muted/5";
  }
}

export function RuntimeNodeCard({ device, state }: { device: MonitorDevice; state?: DeviceStateRow }) {
  const meta = (device.meta || {}) as Record<string, unknown>;
  const profileKey = (meta.profileKey as LiveMonitorProfileKey | undefined) ?? null;
  const profile = profileKey ? findLiveMonitorProfile(profileKey) : undefined;
  const Icon = profile
    ? (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[profile.icon] ?? Icons.Server
    : Icons.Server;
  const ssh = (meta.ssh || {}) as Record<string, unknown>;
  const logPaths = Array.isArray(meta.logPaths) ? (meta.logPaths as string[]) : [];
  const sshConfigured = Boolean(ssh.username);
  const passwordSaved = Boolean(ssh.password);
  const target = device.url || (device.host ? `${device.host}${device.port ? ":" + device.port : ""}` : "—");
  const intervalSec = Math.max(1, Math.round((device.intervalMs || 0) / 1000));

  return (
    <div className={cn(
      "rounded-lg border-2 bg-card/70 shadow-[var(--shadow-panel)] backdrop-blur-sm",
      metricRowState(state?.state),
    )}>
      {/* HEADER */}
      <div className="flex items-start justify-between gap-3 border-b border-border/40 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-primary">
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <Link to="/monitor/$id" params={{ id: device.id }} className="block truncate text-sm font-semibold hover:underline">
              {device.name || device.id}
            </Link>
            <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {profile?.shortName ?? device.kind} · {device.protocol.toUpperCase()}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StateBadge state={state?.state} />
          {device.critical && (
            <span className="inline-flex items-center rounded-sm border border-critical/40 bg-critical/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-critical">CRITICAL</span>
          )}
        </div>
      </div>

      {/* RUNTIME METRICS GRID */}
      <div className="grid grid-cols-4 gap-px border-b border-border/40 bg-border/40">
        {[
          { label: "Latency", value: state?.latency_ms_avg != null ? `${state.latency_ms_avg.toFixed(1)}ms` : "—" },
          { label: "Loss",    value: state?.packet_loss_pct != null ? `${state.packet_loss_pct.toFixed(1)}%` : "—" },
          { label: "Last OK", value: relativeTime(state?.last_ok_ts) },
          { label: "Probe",   value: relativeTime(state?.last_check_ts) },
        ].map((m) => (
          <div key={m.label} className="bg-card/60 px-2 py-2">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{m.label}</div>
            <div className="mt-0.5 truncate font-mono text-[12px] tabular-nums">{m.value}</div>
          </div>
        ))}
      </div>

      {/* SERVICE AREA */}
      <div className="grid grid-cols-2 gap-2 border-b border-border/40 p-3 text-[11px]">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Target</div>
          <div className="mt-0.5 truncate font-mono text-foreground">{target}</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Interval</div>
          <div className="mt-0.5 font-mono">{intervalSec}s</div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">SSH</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono">
            <span className={cn("h-1.5 w-1.5 rounded-full", sshConfigured ? (passwordSaved ? "bg-success" : "bg-warning") : "bg-muted-foreground")} />
            {sshConfigured ? (passwordSaved ? "READY" : "NEEDS PW") : "—"}
          </div>
        </div>
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Logs</div>
          <div className="mt-0.5 font-mono">{logPaths.length} path{logPaths.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      {/* DIAGNOSTIC RESULT AREA */}
      <div className="border-b border-border/40 p-3">
        <DiagnosticResultPanel deviceId={device.id} />
      </div>

      {/* OPERATIONS AREA */}
      <div className="space-y-2 p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Operations</div>
        <SavedDeviceActions device={device} state={state} />
        {state?.last_error && (
          <div className="rounded-md border border-critical/30 bg-critical/5 px-2 py-1.5 font-mono text-[10.5px] text-critical/90" title={state.last_error}>
            ERR · <span className="opacity-90">{state.last_error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function RuntimeNodeCardEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-card/30 p-8 text-center">
      <Icons.Radar className="h-6 w-6 text-muted-foreground" />
      <div className="mt-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">No infrastructure deployed</div>
      <p className="mt-1 max-w-xs text-[11.5px] text-muted-foreground">
        Use the operational quick-deploy tiles above to register IPC, Pulse, MQTT, INGA, controllers, switches and more.
      </p>
      <Button size="sm" className="mt-3" onClick={onAdd}>Deploy IPC Webmin</Button>
    </div>
  );
}
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { intelligenceApi, type Alert, type TimelineEvent } from "@/lib/intelligenceClient";
import { monitorApi, type MonitorDevice } from "@/lib/monitorClient";

/**
 * Deterministic Trace context: device → service → network/MQTT → downstream.
 * Renders only the data the backend has — no synthesis, no fake nodes.
 */
export function TraceContextCard({ deviceId, alertId }: { deviceId?: string; alertId?: string }) {
  const [device, setDevice] = useState<MonitorDevice | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        if (deviceId) {
          const r = await monitorApi.listDevices();
          if (r.ok) setDevice(r.devices.find((d) => d.id === deviceId) || null);
          const tl = await intelligenceApi.listTimeline({ deviceId, limit: 15 });
          if (tl.ok) setTimeline(tl.events);
        }
        if (alertId) {
          const al = await intelligenceApi.listAlerts({});
          if (al.ok) setAlert(al.alerts.find((a) => a.alertId === alertId) || null);
        }
      } catch { /* ignore */ }
    })();
  }, [deviceId, alertId]);

  if (!deviceId && !alertId) return null;

  const hops = device
    ? [
        { label: "Device", value: `${device.name || device.id} (${device.kind})` },
        { label: "Service", value: device.protocol?.toUpperCase() || "—" },
        { label: "Network/MQTT", value: device.host ? `${device.host}${device.port ? ":" + device.port : ""}` : (device.url || "—") },
        { label: "Downstream", value: device.kind === "mqtt-broker" ? "subscribers (Pulse / INGA / etc.)" : "—" },
      ]
    : [];

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-semibold">Deterministic Trace Context</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {device && (
          <div className="flex flex-wrap items-center gap-2">
            {hops.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="rounded-md border border-border/50 bg-muted/20 px-2 py-1">
                  <div className="text-[10px] uppercase text-muted-foreground">{h.label}</div>
                  <div className="font-medium">{h.value}</div>
                </div>
                {i < hops.length - 1 && <span className="text-muted-foreground">→</span>}
              </div>
            ))}
          </div>
        )}

        {alert && (
          <div className="rounded-md border border-border/40 bg-muted/10 p-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] uppercase">{alert.severity}</Badge>
              <span className="font-semibold">{alert.title}</span>
            </div>
            {alert.deterministicCause && <div className="mt-1 text-muted-foreground">Cause: {alert.deterministicCause}</div>}
            {alert.patternIds.length > 0 && (
              <div className="mt-1 text-muted-foreground">Patterns: {alert.patternIds.join(", ")}</div>
            )}
          </div>
        )}

        {timeline.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">Recent timeline</div>
            <ul className="mt-1 space-y-0.5">
              {timeline.slice(0, 8).map((e) => (
                <li key={e.eventId} className="flex gap-2">
                  <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                  <span className="font-medium">[{e.source}]</span>
                  <span className="truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!device && !alert && (
          <div className="text-muted-foreground">No deterministic context found for the requested IDs.</div>
        )}
      </CardContent>
    </Card>
  );
}
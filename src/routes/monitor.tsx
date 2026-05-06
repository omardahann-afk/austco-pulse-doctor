import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useMonitorBus } from "@/hooks/useMonitorBus";
import { StateBadge } from "@/components/monitor/StateBadge";
import { ConnectionPill } from "@/components/monitor/ConnectionPill";
import { monitorApi, relativeTime, type DeviceState } from "@/lib/monitorClient";
import { Play, Square, RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/monitor")({
  head: () => ({ meta: [
    { title: "Live Monitor — Tacera Doctor" },
    { name: "description", content: "Real-time controller and device health, streamed from the local agent." },
  ]}),
  component: MonitorPage,
});

const STATE_ORDER: DeviceState[] = ["down", "degraded", "stale", "unknown", "up"];

function MonitorPage() {
  const { conn, scheduler, devices, lastEventAt, requestSnapshot } = useMonitorBus();

  const grouped = useMemo(() => {
    const buckets = new Map<DeviceState, typeof devices>();
    for (const d of devices) {
      const k = (d.state ?? "unknown") as DeviceState;
      const arr = buckets.get(k) ?? [];
      arr.push(d);
      buckets.set(k, arr);
    }
    return STATE_ORDER.map((s) => ({ state: s, rows: buckets.get(s) ?? [] }));
  }, [devices]);

  const counts = useMemo(() => {
    const c: Record<DeviceState, number> = { up: 0, degraded: 0, down: 0, stale: 0, unknown: 0 };
    for (const d of devices) c[(d.state ?? "unknown") as DeviceState]++;
    return c;
  }, [devices]);

  async function toggleScheduler() {
    try {
      if (scheduler?.running) {
        await monitorApi.stop();
        toast.success("Polling stopped");
      } else {
        const r = await monitorApi.start();
        toast.success(r.alreadyRunning ? "Already running" : `Polling started (${r.devices ?? 0} devices)`);
      }
      requestSnapshot();
    } catch (err) {
      toast.error("Could not reach agent: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Live Monitor"
        title="Controller & Device Health"
        description="Streaming real ICMP / TCP / HTTPS / MQTT probe results from the local Tacera agent."
        actions={
          <div className="flex items-center gap-2">
            <ConnectionPill conn={conn} lastEventAt={lastEventAt} />
            <Button size="sm" variant="outline" onClick={requestSnapshot} className="h-8">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={toggleScheduler} className="h-8">
              {scheduler?.running ? (<><Square className="mr-1.5 h-3.5 w-3.5" /> Stop polling</>) : (<><Play className="mr-1.5 h-3.5 w-3.5" /> Start polling</>)}
            </Button>
            <Link to="/monitor/devices">
              <Button size="sm" variant="secondary" className="h-8">
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add device
              </Button>
            </Link>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["up", "degraded", "down", "stale", "unknown"] as DeviceState[]).map((s) => (
          <Card key={s} className="border-border/50">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{s}</span>
                <StateBadge state={s} />
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{counts[s]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Empty state when no devices registered */}
      {devices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-full bg-muted/50 p-3"><Plus className="h-5 w-5 text-muted-foreground" /></div>
            <div className="text-base font-medium">No monitored devices yet</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Register controllers, gateways, brokers and services on the Devices page. The agent will run real ICMP / TCP / HTTPS / MQTT probes and stream results here.
            </p>
            <Link to="/monitor/devices"><Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add devices</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.filter((g) => g.rows.length > 0).map((g) => (
            <Card key={g.state}>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 py-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <StateBadge state={g.state} /> <span>{g.rows.length} device{g.rows.length === 1 ? "" : "s"}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[28%]">Device</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead className="text-right">Loss%</TableHead>
                      <TableHead className="text-right">Last OK</TableHead>
                      <TableHead className="text-right">Last check</TableHead>
                      <TableHead>Last error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Link to="/monitor/$id" params={{ id: d.id }} className="block">
                            <div className="font-medium hover:underline">{d.name || d.id}</div>
                            <div className="text-[11px] text-muted-foreground">{d.kind} · {d.protocol.toUpperCase()}</div>
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.url || (d.host ? `${d.host}${d.port ? ":" + d.port : ""}` : "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.latency_ms_avg != null ? d.latency_ms_avg.toFixed(1) + " ms" : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{d.packet_loss_pct != null ? d.packet_loss_pct.toFixed(1) + "%" : "—"}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{relativeTime(d.last_ok_ts)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{relativeTime(d.last_check_ts)}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground" title={d.last_error || ""}>{d.last_error || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Scheduler footer */}
      <Card className="border-border/40">
        <CardContent className="flex flex-wrap items-center gap-3 py-3 text-xs text-muted-foreground">
          <Badge variant="outline" className="font-mono">scheduler</Badge>
          {scheduler?.running ? (
            <>
              <span>running since {relativeTime(scheduler.startedAt)}</span>
              <span>· {scheduler.scheduledDevices} scheduled</span>
              <span>· {scheduler.inFlight} in flight</span>
            </>
          ) : (
            <span>stopped — start polling to begin collecting evidence</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
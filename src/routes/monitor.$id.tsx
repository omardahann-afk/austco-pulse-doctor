import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, RefreshCw, Zap, Loader2 } from "lucide-react";
import { monitorApi, relativeTime, type HistoryEntry, type MonitorDevice, type Trend, type DeviceStateRow } from "@/lib/monitorClient";
import { useMonitorBus } from "@/hooks/useMonitorBus";
import { StateBadge } from "@/components/monitor/StateBadge";
import { Sparkline } from "@/components/monitor/Sparkline";
import { ConnectionPill } from "@/components/monitor/ConnectionPill";
import { toast } from "sonner";

export const Route = createFileRoute("/monitor/$id")({
  head: ({ params }) => ({ meta: [
    { title: `Device ${params.id} — Tacera Doctor` },
    { name: "description", content: "Live and historical probe evidence for a single monitored device." },
  ]}),
  component: DeviceDetailPage,
});

function DeviceDetailPage() {
  const { id } = useParams({ from: "/monitor/$id" });
  const { conn, devicesById, lastEventAt } = useMonitorBus();
  const [device, setDevice] = useState<MonitorDevice | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);

  const live: DeviceStateRow | undefined = devicesById.get(id);

  async function refresh() {
    setLoading(true);
    try {
      const r = await monitorApi.history(id, 200);
      if (r.ok) {
        setDevice(r.device ?? null);
        setHistory(r.history);
        setTrend(r.trend);
      } else {
        toast.error("Device not found");
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // When a new probe arrives over WS, refresh history (cheap — last 200).
  useEffect(() => {
    if (!lastEventAt) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEventAt]);

  async function probeNow() {
    setProbing(true);
    try {
      const r = await monitorApi.probeNow(id);
      if (r.ok) toast.success((r.evidence?.ok ? "OK · " : "FAIL · ") + (r.evidence?.protocol.toUpperCase() ?? ""));
      else toast.error(r.reason || "probe failed");
      await refresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setProbing(false); }
  }

  // Reverse: oldest first for sparkline (chronological).
  const sparkValues = [...history].reverse().map((h) => (h.ok ? h.latencyMs : null));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Device"
        title={device?.name || device?.id || id}
        description={device ? `${device.kind} · ${device.protocol.toUpperCase()} · ${device.url || (device.host ? `${device.host}${device.port ? ":" + device.port : ""}` : "")}` : ""}
        actions={
          <div className="flex items-center gap-2">
            <ConnectionPill conn={conn} lastEventAt={lastEventAt} />
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="h-8">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={probeNow} disabled={probing} className="h-8">
              {probing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
              Probe now
            </Button>
            <Link to="/monitor"><Button size="sm" variant="ghost" className="h-8"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back</Button></Link>
          </div>
        }
      />

      {/* Live state strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">State</div>
          <div className="mt-2"><StateBadge state={live?.state ?? "unknown"} /></div>
          {live?.consecutive_fail ? <div className="mt-2 text-xs text-red-400">{live.consecutive_fail} consecutive fails</div> : null}
          {live?.consecutive_ok ? <div className="mt-2 text-xs text-emerald-400">{live.consecutive_ok} consecutive ok</div> : null}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Latency (avg, last 50)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{trend?.latencyMsAvg != null ? trend.latencyMsAvg.toFixed(1) + " ms" : "—"}</div>
          <div className="text-[11px] text-muted-foreground">min {trend?.latencyMsMin?.toFixed(1) ?? "—"} · max {trend?.latencyMsMax?.toFixed(1) ?? "—"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Success rate</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{trend?.successRate != null ? Math.round(trend.successRate * 100) + "%" : "—"}</div>
          <div className="text-[11px] text-muted-foreground">{trend?.failureCount ?? 0} failures of {trend?.samples ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last seen</div>
          <div className="mt-1 text-sm">last ok <span className="font-medium">{relativeTime(live?.last_ok_ts)}</span></div>
          <div className="text-sm">last check <span className="font-medium">{relativeTime(live?.last_check_ts)}</span></div>
        </CardContent></Card>
      </div>

      {/* Sparkline */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Latency trend</CardTitle></CardHeader>
        <CardContent className="px-4 pb-5 pt-0">
          <div className="text-emerald-400">
            <Sparkline values={sparkValues} width={800} height={60} />
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Each tick is one probe. Failed probes appear as gaps.</div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Probe history</CardTitle>
          <Badge variant="outline" className="text-[10px] font-mono">last {history.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No probe history yet. Start polling on the Live Monitor page.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Time</TableHead>
                  <TableHead className="w-[70px]">OK</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h, i) => (
                  <TableRow key={i} className={h.ok ? "" : "bg-red-500/[0.04]"}>
                    <TableCell className="font-mono text-xs">{new Date(h.ts).toLocaleString()}</TableCell>
                    <TableCell>
                      <span className={`inline-block h-2 w-2 rounded-full ${h.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.latencyMs != null ? h.latencyMs.toFixed(1) + " ms" : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{h.durationMs} ms</TableCell>
                    <TableCell className="max-w-[400px] truncate text-xs text-muted-foreground" title={h.error || ""}>{h.error || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
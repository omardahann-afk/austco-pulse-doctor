import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, RefreshCw, Loader2, Brain, Send } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { intelligenceApi, type Alert, ALERTS_UPDATED_EVENT, TIMELINE_UPDATED_EVENT } from "@/lib/intelligenceClient";
import { relativeTime } from "@/lib/monitorClient";
import { RootCauseDialog } from "./RootCauseDialog";
import { recommendationsApi, RECOMMENDATIONS_UPDATED_EVENT, PENDING_ALERT_FOR_AUTOPILOT_KEY } from "@/lib/autopilotRecommendationsClient";

function sevColor(s: Alert["severity"]) {
  if (s === "critical") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (s === "warning") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border/40";
}

export function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [aiAlert, setAiAlert] = useState<Alert | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const r = await intelligenceApi.listAlerts({});
      if (r.ok) setAlerts(r.alerts);
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void load();
    const onUpd = () => void load();
    window.addEventListener(ALERTS_UPDATED_EVENT, onUpd);
    const t = setInterval(load, 15000);
    return () => { window.removeEventListener(ALERTS_UPDATED_EVENT, onUpd); clearInterval(t); };
  }, []);

  async function ack(id: string) {
    setActing(id);
    try { await intelligenceApi.ackAlert(id); toast.success("Acknowledged"); await load(); window.dispatchEvent(new CustomEvent(TIMELINE_UPDATED_EVENT)); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setActing(null); }
  }
  async function resolve(id: string) {
    setActing(id);
    try { await intelligenceApi.resolveAlert(id); toast.success("Resolved"); await load(); window.dispatchEvent(new CustomEvent(TIMELINE_UPDATED_EVENT)); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setActing(null); }
  }

  async function sendToAutopilot(a: Alert) {
    setSending(a.alertId);
    try {
      const r = await recommendationsApi.fromAlert(a.alertId);
      if (!r.ok || !r.recommendation) throw new Error(r.reason || "failed");
      try { sessionStorage.setItem(PENDING_ALERT_FOR_AUTOPILOT_KEY, a.alertId); } catch {}
      window.dispatchEvent(new CustomEvent(RECOMMENDATIONS_UPDATED_EVENT));
      window.dispatchEvent(new CustomEvent(TIMELINE_UPDATED_EVENT));
      toast.success("Recommendation sent to Autopilot");
      void navigate({ to: "/autopilot", hash: `rec-${r.recommendation.recommendationId}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally { setSending(null); }
  }

  const active = alerts.filter((a) => a.status === "active");
  const acked = alerts.filter((a) => a.status === "acknowledged");
  const resolved = alerts.filter((a) => a.status === "resolved").slice(0, 8);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-3.5 w-3.5" /> Alerts
          <Badge variant="outline" className="ml-1 text-[10px]">{active.length} active</Badge>
        </CardTitle>
        <Button size="sm" variant="outline" className="h-7" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.length === 0 && (
          <div className="rounded-md border border-border/40 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            No alerts yet. Failed probes and critical log patterns will appear here.
          </div>
        )}
        {[...active, ...acked, ...resolved].map((a) => (
          <div key={a.alertId} className={`rounded-md border px-3 py-2 ${sevColor(a.severity)}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider">{a.severity}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{a.source}</span>
                  <span className="text-[10px] text-muted-foreground">{a.status}</span>
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{a.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  {a.deviceName || a.deviceId || "—"} · {relativeTime(a.updatedAt)}
                </div>
                {a.description && <div className="mt-1 text-xs text-foreground/80">{a.description}</div>}
                {a.recommendedNextCheck && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Next check: <span className="text-foreground/90">{a.recommendedNextCheck}</span>
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAiAlert(a)}>
                  <Brain className="mr-1 h-3 w-3" /> Ask AI
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={sending === a.alertId} onClick={() => sendToAutopilot(a)}>
                  {sending === a.alertId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />} Send to Autopilot
                </Button>
                {a.status === "active" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={acting === a.alertId} onClick={() => ack(a.alertId)}>
                    Acknowledge
                  </Button>
                )}
                {a.status !== "resolved" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={acting === a.alertId} onClick={() => resolve(a.alertId)}>
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Resolve
                  </Button>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
      <RootCauseDialog alert={aiAlert} open={!!aiAlert} onOpenChange={(o) => !o && setAiAlert(null)} />
    </Card>
  );
}
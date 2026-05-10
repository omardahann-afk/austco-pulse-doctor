import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, Brain, Check, X, ShieldAlert, ShieldCheck, AlertTriangle, BadgeAlert } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  recommendationsApi,
  RECOMMENDATIONS_UPDATED_EVENT,
  PENDING_ALERT_FOR_AUTOPILOT_KEY,
  type AutopilotRecommendation,
} from "@/lib/autopilotRecommendationsClient";
import { intelligenceApi, type Alert } from "@/lib/intelligenceClient";
import { RootCauseDialog } from "@/components/monitor/RootCauseDialog";

const RISK_STYLE: Record<AutopilotRecommendation["riskLevel"], string> = {
  LOW: "bg-success/10 text-success border-success/30",
  MEDIUM: "bg-warning/10 text-warning border-warning/30",
  HIGH: "bg-destructive/10 text-destructive border-destructive/30",
  MANUAL: "bg-muted text-muted-foreground border-border/40",
};

export function RecommendationsFromAlertsPanel() {
  const [recs, setRecs] = useState<AutopilotRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [aiAlert, setAiAlert] = useState<Alert | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await recommendationsApi.list();
      if (r.ok) setRecs(r.recommendations || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const onUpd = () => void load();
    window.addEventListener(RECOMMENDATIONS_UPDATED_EVENT, onUpd);
    // Also pick up hash highlight
    if (typeof window !== "undefined" && window.location.hash.startsWith("#rec-")) {
      setHighlightId(window.location.hash.slice(5));
    }
    try {
      const pending = sessionStorage.getItem(PENDING_ALERT_FOR_AUTOPILOT_KEY);
      if (pending) sessionStorage.removeItem(PENDING_ALERT_FOR_AUTOPILOT_KEY);
    } catch {}
    return () => window.removeEventListener(RECOMMENDATIONS_UPDATED_EVENT, onUpd);
  }, [load]);

  async function approve(id: string) {
    setActing(id);
    try { await recommendationsApi.approve(id); toast.success("Approved (execution requires technician password in pipeline)"); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setActing(null); }
  }
  async function reject(id: string) {
    setActing(id);
    try { await recommendationsApi.reject(id); toast.success("Rejected"); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
    finally { setActing(null); }
  }

  async function explain(rec: AutopilotRecommendation) {
    try {
      const r = await intelligenceApi.listAlerts({});
      const a = r.alerts.find((x) => x.alertId === rec.alertId);
      if (a) setAiAlert(a);
      else toast.error("Original alert not found");
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BadgeAlert className="h-3.5 w-3.5" /> Recommendations from Live Monitor Alerts
          <Badge variant="outline" className="ml-1 text-[10px]">{recs.length}</Badge>
        </CardTitle>
        <Button size="sm" variant="outline" className="h-7" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {recs.length === 0 && (
          <div className="rounded-md border border-border/40 bg-muted/10 p-4 text-center text-xs text-muted-foreground">
            No recommendations yet. Use “Send to Autopilot” on any alert in Live Monitor to generate one.
          </div>
        )}
        {recs.map((rec) => {
          const highlighted = rec.recommendationId === highlightId;
          return (
            <div
              key={rec.recommendationId}
              id={`rec-${rec.recommendationId}`}
              className={`rounded-md border px-3 py-2 ${highlighted ? "border-primary/60 ring-1 ring-primary/40" : "border-border/40"} bg-card/40`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${RISK_STYLE[rec.riskLevel]}`}>
                      {rec.riskLevel === "MANUAL" ? <ShieldAlert className="mr-1 h-3 w-3" /> : rec.riskLevel === "HIGH" ? <ShieldAlert className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
                      {rec.riskLevel}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">{rec.status}</span>
                    {rec.requiresApproval && <Badge variant="outline" className="text-[10px]">approval required</Badge>}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold">{rec.title}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {rec.deviceName || rec.deviceId || "—"} · alert {rec.alertId.slice(-6)} · {new Date(rec.createdAt).toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-foreground/80">{rec.summary}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground"><span className="font-semibold">Matched:</span> {rec.matchedReason}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => explain(rec)}>
                    <Brain className="mr-1 h-3 w-3" /> AI Explain
                  </Button>
                  {rec.status === "pending" && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={acting === rec.recommendationId} onClick={() => approve(rec.recommendationId)}>
                        <Check className="mr-1 h-3 w-3" /> Approve
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={acting === rec.recommendationId} onClick={() => reject(rec.recommendationId)}>
                        <X className="mr-1 h-3 w-3" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Allowed actions</div>
                  {rec.allowedActions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">— none (manual)</div>
                  ) : (
                    <ul className="mt-0.5 space-y-0.5">
                      {rec.allowedActions.map((a) => (
                        <li key={a.id} className="text-xs">
                          <span className="font-medium">{a.label}</span>
                          {a.command && <span className="ml-1 font-mono text-[10px] text-muted-foreground">{a.command}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Blocked actions</div>
                  {rec.blockedActions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">— none</div>
                  ) : (
                    <ul className="mt-0.5 space-y-0.5">
                      {rec.blockedActions.map((a) => (
                        <li key={a.id} className="text-xs">
                          <span className="font-medium">{a.label}</span>
                          {a.reason && <span className="ml-1 text-[10px] text-muted-foreground">— {a.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Verification</div>
                  <ul className="mt-0.5 list-disc pl-4 text-xs text-foreground/80">
                    {rec.verificationSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Rollback notes</div>
                  <ul className="mt-0.5 list-disc pl-4 text-xs text-foreground/80">
                    {rec.rollbackNotes.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
      <RootCauseDialog alert={aiAlert} open={!!aiAlert} onOpenChange={(o) => !o && setAiAlert(null)} />
    </Card>
  );
}
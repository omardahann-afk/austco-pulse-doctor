import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, ShieldCheck, ArrowRight, Ban, ListOrdered } from "lucide-react";
import { ALERTS_UPDATED_EVENT, TIMELINE_UPDATED_EVENT } from "@/lib/intelligenceClient";

type DownDevice = { id: string; name: string; state: string; lastError: string | null };
type AlertRef = { alertId: string; title: string; severity: string; deviceId: string | null };
type CascadeRef = { layer: string; label: string };

type RootCauseCandidate = {
  layer: string;
  label: string;
  confidence: number;
  score: number;
  blastRadius: number;
  downDevices: DownDevice[];
  activeAlerts: AlertRef[];
  cascade: CascadeRef[];
  primaryFix: string;
  doNotDo: string[];
  technicianFocusOrder: string[];
};

type SystemCorrelation = {
  generatedAt: string;
  systemIssues: Array<{ title: string; severity: string; layer: string; confidence: number; cascade: CascadeRef[] }>;
  rootCauseCandidates: RootCauseCandidate[];
  cascadingFailures: Array<{ layer: string; label: string; explainedBy: CascadeRef[]; downDevices: DownDevice[]; activeAlerts: AlertRef[] }>;
  affectedServices: CascadeRef[];
  confidence: number;
  evidence: Array<{ kind: string; id: string; severity: string; title: string; deviceId: string | null; at: string }>;
  recommendedPrimaryFix: string | null;
  doNotDo: string[];
  technicianFocusOrder: string[];
};

function severityClass(s: string) {
  if (s === "critical") return "bg-destructive/15 text-destructive border-destructive/40";
  if (s === "warning") return "bg-warning/15 text-warning border-warning/40";
  return "bg-muted text-muted-foreground border-border";
}

export function SystemCorrelationPanel() {
  const [data, setData] = useState<SystemCorrelation | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/system/correlation");
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || "Correlation engine unavailable");
      setData(j.correlation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener(ALERTS_UPDATED_EVENT, handler);
    window.addEventListener(TIMELINE_UPDATED_EVENT, handler);
    const t = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener(ALERTS_UPDATED_EVENT, handler);
      window.removeEventListener(TIMELINE_UPDATED_EVENT, handler);
      window.clearInterval(t);
    };
  }, [refresh]);

  const top = data?.rootCauseCandidates?.[0] || null;
  const healthy = data && !err && data.rootCauseCandidates.length === 0 && data.cascadingFailures.length === 0;

  return (
    <section className="rounded-xl border-2 border-primary/40 bg-gradient-to-b from-primary/5 to-card/40 p-4 shadow-[var(--shadow-panel)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">// SYSTEM CORRELATION</div>
          <h2 className="mt-0.5 text-base font-bold uppercase tracking-wide">Cross-Service Root Cause</h2>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">Site-wide deterministic intelligence — distinguishes cause from cascade across event bridge, Pulse, INGA, IPConnect, License, controllers and switch fabric.</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="h-8 shrink-0">
          <RefreshCw className={"mr-1.5 h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} /> Recorrelate
        </Button>
      </div>

      {err && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">{err}</div>}

      {!err && healthy && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success">
          <ShieldCheck className="h-4 w-4" /> No cross-system root cause detected. All correlated services are healthy.
        </div>
      )}

      {top && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="rounded-md border border-destructive/40 bg-destructive/15 p-2"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-destructive">// ROOT CAUSE CANDIDATE</div>
                  <div className="text-base font-bold">{top.label}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className={severityClass("critical")}>confidence {Math.round(top.confidence * 100)}%</Badge>
                    <Badge variant="outline" className="border-border">blast radius {top.blastRadius}</Badge>
                    <Badge variant="outline" className="border-border">{top.downDevices.length} down · {top.activeAlerts.length} alerts</Badge>
                  </div>
                </div>
              </div>
            </div>

            {top.cascade.length > 0 && (
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">// CASCADE</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {top.cascade.map((c, i) => (
                    <span key={c.layer} className="inline-flex items-center gap-1.5">
                      {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      <span className="rounded border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">{c.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-primary mb-1">// PRIMARY FIX</div>
              <div className="text-xs">{top.primaryFix}</div>
            </div>

            {top.doNotDo.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-destructive mb-1"><Ban className="h-3 w-3" /> // DO NOT DO</div>
                <ul className="space-y-0.5 text-xs">
                  {top.doNotDo.map((d, i) => <li key={i}>· {d}</li>)}
                </ul>
              </div>
            )}

            {top.technicianFocusOrder.length > 0 && (
              <div className="rounded-md border border-border/60 bg-card/50 p-3">
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1"><ListOrdered className="h-3 w-3" /> // TECHNICIAN FOCUS ORDER</div>
                <ol className="space-y-0.5 text-xs list-decimal pl-5">
                  {top.technicianFocusOrder.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data && data.rootCauseCandidates.length > 1 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {data.rootCauseCandidates.slice(1).map((rc) => (
            <Card key={rc.layer} className="border-border/60">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{rc.label}</div>
                  <Badge variant="outline" className={severityClass(rc.confidence >= 0.7 ? "critical" : "warning")}>{Math.round(rc.confidence * 100)}%</Badge>
                </div>
                <div className="text-[11px] text-muted-foreground">{rc.primaryFix}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && data.cascadingFailures.length > 0 && (
        <div className="mt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">// CASCADING FAILURES (symptoms — do not treat as root cause)</div>
          <div className="grid gap-2 md:grid-cols-2">
            {data.cascadingFailures.map((c) => (
              <div key={c.layer} className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
                <div className="text-xs font-semibold text-warning">{c.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  Explained by: {c.explainedBy.map((e) => e.label).join(", ") || "upstream failure"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <span>generated {new Date(data.generatedAt).toLocaleTimeString()}</span>
          <span>· {data.affectedServices.length} services affected</span>
          <span>· {data.evidence.length} evidence items</span>
        </div>
      )}
    </section>
  );
}
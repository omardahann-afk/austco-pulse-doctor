import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Brain, CheckCircle2, ClipboardList, Loader2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DiagnosticResult = {
  resultId: string;
  createdAt: string;
  deviceId: string;
  deviceName: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  issueTitle: string;
  issueSummary: string;
  likelyCause: string;
  confidencePercent: number;
  accuracyLabel: string;
  confidenceMath: Array<{ label: string; points: number }>;
  evidence: Array<{ type: string; summary: string; detail?: string | null; timestamp?: string | null; severity?: string }>;
  contradictions: Array<{ label: string; points: number }>;
  technicianNextSteps: string[];
  recommendedSolution: string;
  doNotDo: string[];
  escalationNeeded: boolean;
  customerSafeSummary: string;
  internalTechnicalSummary: string;
  systemContext?: { topRootCause: string; confidence: number } | null;
};

function tone(status: DiagnosticResult["status"]) {
  if (status === "healthy") return "border-success/40 bg-success/5 text-success";
  if (status === "down") return "border-critical/50 bg-critical/10 text-critical";
  if (status === "degraded") return "border-warning/50 bg-warning/10 text-warning";
  return "border-border bg-muted/10 text-muted-foreground";
}

function statusIcon(status: DiagnosticResult["status"]) {
  if (status === "healthy") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "down") return <AlertTriangle className="h-4 w-4" />;
  if (status === "degraded") return <Wrench className="h-4 w-4" />;
  return <Brain className="h-4 w-4" />;
}

export function DiagnosticResultPanel({ deviceId }: { deviceId: string }) {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/diagnostics/result/device/${encodeURIComponent(deviceId)}`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || j.reason || "diagnosis failed");
      setResult(j.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void refresh(true); }, [deviceId]);

  if (!result && error) {
    return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">Diagnosis unavailable: {error}</div>;
  }

  return (
    <div className={cn("rounded-lg border p-3", result ? tone(result.status) : "border-border bg-muted/5") }>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] opacity-80">
            {result ? statusIcon(result.status) : <Loader2 className="h-3 w-3 animate-spin" />} Diagnostic Result
          </div>
          <div className="mt-1 text-sm font-bold leading-tight text-foreground">
            {result?.issueTitle || "Generating diagnosis…"}
          </div>
          {result && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {result.likelyCause}
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 shrink-0 text-[11px]" onClick={() => refresh()} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Refresh
        </Button>
      </div>

      {result && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="border-current/40 text-current">{result.status.toUpperCase()}</Badge>
            <Badge variant="outline" className="border-current/40 text-current">{result.confidencePercent}% {result.accuracyLabel}</Badge>
            {result.escalationNeeded && <Badge variant="outline" className="border-critical/40 text-critical">ESCALATE</Badge>}
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-primary/25 bg-primary/5 p-2 text-[11px] text-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-primary"><Wrench className="h-3 w-3" /> Solution</div>
              {result.recommendedSolution}
            </div>
            <div className="rounded-md border border-border/40 bg-background/30 p-2 text-[11px] text-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"><ClipboardList className="h-3 w-3" /> Next tech check</div>
              {result.technicianNextSteps[0] || "Collect more evidence."}
            </div>
          </div>

          {result.doNotDo.length > 0 && (
            <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-destructive"><Ban className="h-3 w-3" /> Do not do</div>
              {result.doNotDo[0]}
            </div>
          )}

          <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => setOpen(!open)}>
            {open ? "Hide Evidence" : "View Evidence / Confidence Math"}
          </Button>

          {open && (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-border/50 bg-card/40 p-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Evidence</div>
                <ul className="mt-1 space-y-1 text-[11px] text-foreground">
                  {result.evidence.length === 0 ? <li>No evidence captured yet.</li> : result.evidence.slice(0, 8).map((e, i) => (
                    <li key={i}>· <span className="font-semibold">{e.type}</span>: {e.summary}{e.detail ? ` — ${e.detail}` : ""}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-md border border-border/50 bg-card/40 p-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Confidence math</div>
                <ul className="mt-1 space-y-1 text-[11px] text-foreground">
                  {result.confidenceMath.map((p, i) => (
                    <li key={i} className={p.points < 0 ? "text-warning" : ""}>· {p.label}: {p.points > 0 ? "+" : ""}{p.points}</li>
                  ))}
                </ul>
                {result.systemContext && (
                  <div className="mt-2 rounded border border-primary/25 bg-primary/5 p-1.5 text-[10.5px] text-primary">
                    Site context: {result.systemContext.topRootCause} ({Math.round(result.systemContext.confidence * 100)}%)
                  </div>
                )}
              </div>
              <div className="md:col-span-2 rounded-md border border-border/50 bg-card/40 p-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">All technician next steps</div>
                <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px] text-foreground">
                  {result.technicianNextSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, AlertCircle, Search, ArrowLeft, RefreshCw, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  loadLastDiagnosis, loadSiteConfig, saveLastDiagnosis,
  type DiagnosisResponse, type DeviceTestResult,
} from "@/lib/siteConfig";

export const Route = createFileRoute("/diagnosis")({
  head: () => ({ meta: [
    { title: "Diagnosis Result — Tacera Doctor" },
    { name: "description", content: "Real network diagnosis results for the configured site." },
  ]}),
  component: DiagnosisPage,
});

function DiagnosisPage() {
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setData(loadLastDiagnosis()); }, []);

  async function rerun() {
    setError(null);
    setRerunning(true);
    try {
      const cfg = loadSiteConfig();
      const res = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const json = await res.json() as
        | DiagnosisResponse
        | { ok: false; reason: string; message: string };
      if (!("ok" in json) || !json.ok) {
        const msg = "message" in json ? json.message : "Diagnosis failed.";
        setError(msg);
      } else {
        saveLastDiagnosis(json);
        setData(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunning(false);
    }
  }

  if (!data) return <IdleEmpty />;

  const { summary, results, siteName, finishedAt } = data;
  const overallOk = summary.fail === 0 && summary.warn === 0 && summary.total > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Diagnosis Result"
        title={siteName}
        description={`${summary.total} device${summary.total === 1 ? "" : "s"} tested · ${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail`}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline"><Link to="/">Edit site</Link></Button>
            <Button size="sm" onClick={rerun} disabled={rerunning}>
              {rerunning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Re-run
            </Button>
          </div>
        }
      />

      {/* Overall banner */}
      <div className={cn(
        "rounded-xl border-l-[6px] bg-card p-5 shadow-md",
        overallOk
          ? "border-l-success bg-gradient-to-br from-success/10 via-card to-card"
          : summary.fail > 0
            ? "border-l-critical bg-gradient-to-br from-critical/15 via-card to-card"
            : "border-l-warning bg-gradient-to-br from-warning/15 via-card to-card",
      )}>
        <div className="flex items-center gap-3">
          {overallOk ? <CheckCircle2 className="h-6 w-6 text-success" /> :
           summary.fail > 0 ? <XCircle className="h-6 w-6 text-critical" /> :
           <AlertCircle className="h-6 w-6 text-warning" />}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Final Result</div>
            <div className="text-xl font-extrabold leading-tight">
              {overallOk ? "All configured devices reachable"
               : summary.fail > 0 ? `${summary.fail} device${summary.fail === 1 ? "" : "s"} unreachable or failing`
               : `${summary.warn} device${summary.warn === 1 ? "" : "s"} with warnings`}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Completed {new Date(finishedAt).toLocaleString()} · Source: REAL TEST
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">
          {error}
        </div>
      )}

      {/* Per-device results */}
      <div className="space-y-3">
        {results.map((r) => <DeviceResultCard key={r.deviceId} r={r} />)}
      </div>
    </div>
  );
}

function DeviceResultCard({ r }: { r: DeviceTestResult }) {
  const tone = r.status === "PASS" ? "success" : r.status === "FAIL" ? "critical" : r.status === "WARN" ? "warning" : "muted";
  const Icon = r.status === "PASS" ? CheckCircle2 : r.status === "FAIL" ? XCircle : AlertCircle;
  const openPorts = r.ports.filter((p) => p.open);

  return (
    <Card className={cn(
      "border-l-[4px]",
      tone === "success" && "border-l-success",
      tone === "critical" && "border-l-critical",
      tone === "warning" && "border-l-warning",
      tone === "muted" && "border-l-border",
    )}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Icon className={cn(
            "h-5 w-5 mt-0.5 shrink-0",
            tone === "success" && "text-success",
            tone === "critical" && "text-critical",
            tone === "warning" && "text-warning",
          )} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{r.name || r.role}</span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{r.role}</span>
              <span className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                tone === "success" && "bg-success/15 text-success",
                tone === "critical" && "bg-critical/15 text-critical",
                tone === "warning" && "bg-warning/15 text-warning",
              )}>{r.status}</span>
            </div>
            <div className="mt-1 text-sm">{r.message}</div>
            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
              <div>IP tested: <span className="font-mono text-foreground">{r.ip || "—"}</span></div>
              <div>Hostname: <span className="font-mono text-foreground">{r.hostname || "—"}</span></div>
              <div>Latency: <span className="font-mono text-foreground">{r.ping.latencyMs != null ? `${r.ping.latencyMs} ms` : "—"}</span></div>
              <div>DNS: <span className="font-mono text-foreground">{r.dns.performed ? (r.dns.resolved ?? `failed (${r.dns.error ?? "no record"})`) : "n/a"}</span></div>
              <div className="md:col-span-2">Timestamp: <span className="font-mono text-foreground">{new Date(r.timestamp).toLocaleString()}</span> · Source: <span className="font-bold text-info">REAL TEST</span></div>
            </div>

            {r.ports.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">TCP Port Probes</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.ports.map((p) => (
                    <span key={p.port} className={cn(
                      "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                      p.open
                        ? "border-success/50 bg-success/10 text-success"
                        : "border-border/50 bg-muted/20 text-muted-foreground",
                    )} title={p.service ? `${p.service}${p.error ? ` — ${p.error}` : ""}` : p.error}>
                      {p.port}{p.service ? ` ${p.service}` : ""}
                    </span>
                  ))}
                </div>
                {openPorts.length === 0 && r.ping.performed && (
                  <p className="mt-1 text-[11px] text-warning">Network reachable but expected services not responding.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function IdleEmpty() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Search className="h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">No diagnosis yet</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Insufficient data — enter site IPs, hostnames, VLANs, or upload config before running diagnosis.
      </p>
      <Link to="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:bg-info/90">
        <ArrowLeft className="h-3.5 w-3.5" /> Go to Command Center
      </Link>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle, Search, ArrowLeft, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadLastDiagnosis, loadSiteConfig, saveLastDiagnosis, type DiagnosisResult, type DeviceResult } from "@/lib/siteConfig";
import { runDiagnosis } from "@/lib/agentClient";

export const Route = createFileRoute("/diagnosis")({
  head: () => ({ meta: [{ title: "Diagnosis Result — Tacera Doctor" }] }),
  component: Page,
});

function Page() {
  const [data, setData] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setData(loadLastDiagnosis()); }, []);

  async function rerun() {
    setError(null); setBusy(true);
    try {
      const r = await runDiagnosis(loadSiteConfig());
      if (!("ok" in r) || !r.ok) setError(("message" in r && r.message) || "Backend error.");
      else { saveLastDiagnosis(r); setData(r); }
    } catch (err) {
      setError(`Backend unreachable — run the on-site agent (npm run backend). ${err instanceof Error ? err.message : String(err)}`);
    } finally { setBusy(false); }
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Search className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">No diagnosis yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">Enter site configuration or upload logs to run diagnosis.</p>
        <Link to="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:bg-info/90"><ArrowLeft className="h-3.5 w-3.5" /> Command Center</Link>
      </div>
    );
  }

  const { mode, summary, devices, vm, finishedAt, breakFoundAt, confidence, evidence, fixActions } = data;
  const overallOk = summary.fail === 0 && summary.warn === 0;
  const isDemo = (data.siteName || "").toLowerCase().includes("demo");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Diagnosis Result"
        title={data.siteName}
        description={`${summary.total} device${summary.total === 1 ? "" : "s"} tested · ${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail`}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline"><Link to="/">Edit site</Link></Button>
            <Button size="sm" onClick={rerun} disabled={busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Re-run</Button>
          </div>
        }
      />

      {/* Mode badges */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
        <span className={cn("rounded px-2 py-0.5", mode === "REAL TEST" ? "bg-info/15 text-info" : "bg-muted/30 text-muted-foreground")}>{mode}</span>
        <span className="rounded bg-muted/30 px-2 py-0.5 text-muted-foreground">Confidence: {confidence}</span>
        {isDemo && <span className="rounded bg-warning/15 px-2 py-0.5 text-warning">DEMO DATA</span>}
        <span className="ml-auto text-muted-foreground normal-case font-normal">Tested from VM: <span className="font-mono">{vm.hostname}</span> ({vm.addrs.join(", ") || "no IPv4"}) · {new Date(finishedAt).toLocaleString()}</span>
      </div>

      {/* Final result banner */}
      <div className={cn("rounded-xl border-l-[6px] bg-card p-5 shadow-md",
        overallOk ? "border-l-success bg-gradient-to-br from-success/10 via-card to-card"
        : summary.fail > 0 ? "border-l-critical bg-gradient-to-br from-critical/15 via-card to-card"
        : "border-l-warning bg-gradient-to-br from-warning/15 via-card to-card")}>
        <div className="flex items-start gap-3">
          {overallOk ? <CheckCircle2 className="h-6 w-6 text-success" /> : summary.fail > 0 ? <XCircle className="h-6 w-6 text-critical" /> : <AlertCircle className="h-6 w-6 text-warning" />}
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">Final Result</div>
            <div className="text-xl font-extrabold leading-tight">
              {overallOk ? "All configured devices reachable"
               : breakFoundAt ? `Break found at ${breakFoundAt.name} (${breakFoundAt.role})`
               : `${summary.warn} warning${summary.warn === 1 ? "" : "s"}`}
            </div>
            {breakFoundAt && <div className="mt-1 text-xs font-mono text-muted-foreground">{breakFoundAt.ip || breakFoundAt.hostname}</div>}
          </div>
        </div>
        {fixActions.length > 0 && (
          <div className="mt-4 rounded border border-border/50 bg-background/40 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-info">Fix Now</div>
            <ol className="mt-2 space-y-1 text-sm">{fixActions.map((s, i) => <li key={i}>{i + 1}. {s}</li>)}</ol>
          </div>
        )}
      </div>

      {error && <div className="rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}

      {/* Evidence summary */}
      {evidence.length > 0 && (
        <Card className="bg-card/70">
          <CardContent className="p-4 space-y-1.5 text-xs">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Evidence</div>
            <ul className="font-mono space-y-0.5">{evidence.slice(0, 30).map((e, i) => <li key={i}>· {e}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {/* Devices */}
      <div className="space-y-3">{devices.map((d) => <DeviceCard key={d.deviceId} d={d} />)}</div>
    </div>
  );
}

function DeviceCard({ d }: { d: DeviceResult }) {
  const [open, setOpen] = useState(false);
  const tone = d.status === "PASS" ? "success" : d.status === "FAIL" ? "critical" : d.status === "WARN" ? "warning" : "muted";
  const Icon = d.status === "PASS" ? CheckCircle2 : d.status === "FAIL" ? XCircle : AlertCircle;
  return (
    <Card className={cn("border-l-[4px]", tone === "success" && "border-l-success", tone === "critical" && "border-l-critical", tone === "warning" && "border-l-warning", tone === "muted" && "border-l-border")}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", tone === "success" && "text-success", tone === "critical" && "text-critical", tone === "warning" && "text-warning")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{d.name}</span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{d.role}</span>
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                tone === "success" && "bg-success/15 text-success", tone === "critical" && "bg-critical/15 text-critical", tone === "warning" && "bg-warning/15 text-warning")}>{d.status}</span>
            </div>
            <div className="mt-1 text-sm">{d.message}</div>
            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
              <div>IP: <span className="font-mono text-foreground">{d.ip || "—"}</span></div>
              <div>Hostname: <span className="font-mono text-foreground">{d.hostname || "—"}</span></div>
              <div>Ping: <span className="font-mono text-foreground">{d.ping.performed ? (d.ping.reachable ? `reachable · ${d.ping.avgLatencyMs ?? "?"}ms · loss ${d.ping.packetLossPct ?? "?"}%` : "unreachable") : (d.ping.error || "n/a")}</span></div>
              <div>DNS: <span className="font-mono text-foreground">{d.dns.performed ? (d.dns.resolved.length ? d.dns.resolved.join(", ") : `failed (${d.dns.error || "no record"})`) : "n/a"}</span></div>
              <div className="md:col-span-2">{new Date(d.timestamp).toLocaleString()} · Source: <span className="font-bold text-info">{d.source}</span></div>
            </div>
            {d.ports.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.ports.map((p) => (
                  <span key={p.port} title={p.service ? `${p.service}${p.error ? ` — ${p.error}` : ""}` : (p.error || "")}
                    className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", p.open ? "border-success/50 bg-success/10 text-success" : "border-border/50 bg-muted/20 text-muted-foreground")}>
                    {p.port}{p.service ? ` ${p.service}` : ""}
                  </span>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Raw evidence
            </button>
            {open && <pre className="mt-1 max-h-64 overflow-auto rounded border border-border/40 bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">{d.ping.raw || "(no raw ping output)"}</pre>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

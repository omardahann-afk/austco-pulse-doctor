import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertCircle, Search, ArrowLeft, RefreshCw, Loader2, ChevronDown, ChevronRight, ServerCrash } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadLastDiagnosis, loadSiteConfig, saveLastDiagnosis, getBackendUrl, type DiagnosisResult, type DeviceResult } from "@/lib/siteConfig";
import { runDiagnosis, checkHealth } from "@/lib/agentClient";

export const Route = createFileRoute("/diagnosis")({
  head: () => ({ meta: [{ title: "Diagnosis Result — Tacera Doctor" }] }),
  component: Page,
});

type BackendState = "unknown" | "ok" | "unreachable";

function Page() {
  const [data, setData] = useState<DiagnosisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendState, setBackendState] = useState<BackendState>("unknown");
  const [backendUrl, setBackendUrlState] = useState<string>("");

  useEffect(() => {
    setData(loadLastDiagnosis());
    setBackendUrlState(getBackendUrl());
  }, []);

  async function testBackend() {
    setBackendUrlState(getBackendUrl());
    const r = await checkHealth();
    setBackendState(r.ok ? "ok" : "unreachable");
  }

  async function rerun() {
    setError(null); setBusy(true);
    try {
      const r = await runDiagnosis(loadSiteConfig());
      if (!("ok" in r) || !r.ok) setError(("message" in r && r.message) || "Backend error.");
      else { saveLastDiagnosis(r); setData(r); }
    } catch (err) {
      setBackendState("unreachable");
      setError(`Backend unreachable — real diagnostics require the on-site Ubuntu VM agent. ${err instanceof Error ? err.message : String(err)}`);
    } finally { setBusy(false); }
  }

  // Empty state — no diagnosis run yet
  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Diagnosis Result" title="No diagnosis yet" description="No diagnosis has been run. Enter site config and run real diagnosis from the Command Center." />
        <Card className="bg-card/70">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Search className="h-10 w-10 text-muted-foreground" />
            <h2 className="text-base font-semibold">No diagnosis run yet — enter site config and run real diagnosis.</h2>
            <p className="max-w-md text-xs text-muted-foreground">Results from the on-site VM agent will appear here.</p>
            <div className="mt-2 flex gap-2">
              <Button asChild size="sm" className="bg-info text-info-foreground hover:bg-info/90">
                <Link to="/"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Command Center</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={testBackend}>Test Backend</Button>
            </div>
            {backendState === "ok" && <div className="mt-2 text-xs text-success">Backend reachable at {backendUrl}.</div>}
            {backendState === "unreachable" && <div className="mt-2 text-xs text-warning">Backend unreachable at {backendUrl}.</div>}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { mode, summary, devices, vm, finishedAt, breakFoundAt, confidence, evidence, fixActions, traceSteps } = data;

  // Backend explicitly returned INSUFFICIENT DATA
  if (mode === "INSUFFICIENT DATA") {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Diagnosis Result" title="Insufficient Data" />
        <Card className="bg-card/70">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="h-10 w-10 text-warning" />
            <h2 className="text-base font-semibold">Insufficient real data — enter site devices/IPs before running diagnosis.</h2>
            <Button asChild size="sm" className="bg-info text-info-foreground hover:bg-info/90">
              <Link to="/"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Command Center</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overallOk = summary.fail === 0 && summary.warn === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Diagnosis Result"
        title={data.siteName || "Unnamed site"}
        description={`${summary.total} device${summary.total === 1 ? "" : "s"} tested · ${summary.pass} pass · ${summary.warn} warn · ${summary.fail} fail`}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline"><Link to="/">Edit site</Link></Button>
            <Button size="sm" onClick={rerun} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />} Re-run
            </Button>
          </div>
        }
      />

      {/* 1. Result Summary */}
      <Card className="bg-card/70">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
            <span className={cn("rounded px-2 py-0.5",
              mode === "REAL TEST" ? "bg-info/15 text-info" : "bg-muted/30 text-muted-foreground")}>
              MODE: {mode}
            </span>
            <span className="rounded bg-muted/30 px-2 py-0.5 text-muted-foreground">Confidence: {confidence}</span>
            <span className="ml-auto text-muted-foreground normal-case font-normal">
              Tested from VM: <span className="font-mono">{vm.hostname}</span> ({vm.addrs.join(", ") || "no IPv4"}) · {new Date(finishedAt).toLocaleString()}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-border/50 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Site</div>
              <div className="mt-0.5 font-semibold">{data.siteName || "Unnamed site"}</div>
            </div>
            <div className="rounded border border-border/50 bg-background/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Tested From</div>
              <div className="mt-0.5 font-mono text-sm">{vm.hostname} ({vm.addrs.join(", ") || "no IPv4"})</div>
            </div>
          </div>
          <div className={cn("rounded-lg border-l-[6px] p-4",
            overallOk ? "border-l-success bg-success/5"
            : summary.fail > 0 ? "border-l-critical bg-critical/5"
            : "border-l-warning bg-warning/5")}>
            <div className="flex items-start gap-3">
              {overallOk ? <CheckCircle2 className="h-5 w-5 text-success" />
                : summary.fail > 0 ? <XCircle className="h-5 w-5 text-critical" />
                : <AlertCircle className="h-5 w-5 text-warning" />}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Break Found At</div>
                <div className="text-base font-semibold">
                  {breakFoundAt ? `${breakFoundAt.name} (${breakFoundAt.role})` : "No confirmed break found"}
                </div>
                {breakFoundAt && <div className="mt-0.5 text-xs font-mono text-muted-foreground">{breakFoundAt.ip || breakFoundAt.hostname}</div>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical">{error}</div>}

      {/* 2. Device Results */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Device Results</h3>
        {devices.length === 0
          ? <div className="rounded border border-border/50 bg-background/40 px-3 py-4 text-xs text-muted-foreground">No backend result available.</div>
          : <div className="space-y-3">{devices.map((d) => <DeviceCard key={d.deviceId} d={d} />)}</div>}
      </section>

      {/* 3. Evidence */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Evidence</h3>
        {evidence.length === 0
          ? <div className="rounded border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">No evidence returned.</div>
          : <Card className="bg-card/70"><CardContent className="p-4 text-xs">
              <ul className="font-mono space-y-0.5">{evidence.map((e, i) => <li key={i}>· {e}</li>)}</ul>
            </CardContent></Card>}
      </section>

      {/* 4. Fix Actions */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Fix Actions</h3>
        {fixActions.length === 0
          ? <div className="rounded border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">No fix actions returned.</div>
          : <Card className="bg-card/70"><CardContent className="p-4">
              <ol className="space-y-1 text-sm">{fixActions.map((s, i) => <li key={i}>{i + 1}. {s}</li>)}</ol>
            </CardContent></Card>}
      </section>

      {/* 5. Trace Steps */}
      <section className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Trace Steps</h3>
        {(!traceSteps || traceSteps.length === 0)
          ? <div className="rounded border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">No trace steps returned.</div>
          : <Card className="bg-card/70"><CardContent className="p-4 space-y-1.5 text-xs">
              {traceSteps.map((t) => (
                <div key={t.id} className="flex flex-wrap items-baseline gap-2 border-b border-border/30 pb-1.5 last:border-0">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                    t.status === "PASS" && "bg-success/15 text-success",
                    t.status === "FAIL" && "bg-critical/15 text-critical",
                    t.status === "WARN" && "bg-warning/15 text-warning",
                    !["PASS","FAIL","WARN"].includes(t.status) && "bg-muted/30 text-muted-foreground")}>
                    {t.status}
                  </span>
                  <span className="font-semibold">{t.label}</span>
                  <span className="text-muted-foreground">{t.detail}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">REAL TEST</span>
                </div>
              ))}
            </CardContent></Card>}
      </section>
    </div>
  );
}

function DeviceCard({ d }: { d: DeviceResult }) {
  const [open, setOpen] = useState(false);
  const tone = d.status === "PASS" ? "success" : d.status === "FAIL" ? "critical" : d.status === "WARN" ? "warning" : "muted";
  const Icon = d.status === "PASS" ? CheckCircle2 : d.status === "FAIL" ? XCircle : AlertCircle;
  const expectedClosed = d.ports.filter((p) => !p.open);
  return (
    <Card className={cn("border-l-[4px]",
      tone === "success" && "border-l-success",
      tone === "critical" && "border-l-critical",
      tone === "warning" && "border-l-warning",
      tone === "muted" && "border-l-border")}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-5 w-5 mt-0.5 shrink-0",
            tone === "success" && "text-success",
            tone === "critical" && "text-critical",
            tone === "warning" && "text-warning")} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{d.name}</span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{d.role}</span>
              <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                tone === "success" && "bg-success/15 text-success",
                tone === "critical" && "bg-critical/15 text-critical",
                tone === "warning" && "bg-warning/15 text-warning")}>{d.status}</span>
            </div>
            <div className="mt-1 text-sm">{d.message}</div>
            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground md:grid-cols-2">
              <div>IP: <span className="font-mono text-foreground">{d.ip || "—"}</span></div>
              <div>Hostname: <span className="font-mono text-foreground">{d.hostname || "—"}</span></div>
              <div>Ping reachable: <span className="font-mono text-foreground">{d.ping.performed ? (d.ping.reachable ? "PASS" : "FAIL") : "n/a"}</span></div>
              <div>Avg latency: <span className="font-mono text-foreground">{d.ping.avgLatencyMs != null ? `${d.ping.avgLatencyMs} ms` : "—"}</span></div>
              <div>Packet loss: <span className="font-mono text-foreground">{d.ping.packetLossPct != null ? `${d.ping.packetLossPct}%` : "—"}</span></div>
              <div>DNS: <span className="font-mono text-foreground">{d.dns.performed ? (d.dns.resolved.length ? d.dns.resolved.join(", ") : `failed (${d.dns.error || "no record"})`) : "n/a"}</span></div>
              <div className="md:col-span-2">{new Date(d.timestamp).toLocaleString()} · Source: <span className="font-bold text-info">{d.source}</span></div>
            </div>
            {d.ports.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Ports</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.ports.map((p) => (
                    <span key={p.port} title={p.service ? `${p.service}${p.error ? ` — ${p.error}` : ""}` : (p.error || "")}
                      className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]",
                        p.open ? "border-success/50 bg-success/10 text-success"
                        : "border-border/50 bg-muted/20 text-muted-foreground")}>
                      {p.port}{p.service ? ` ${p.service}` : ""} {p.open ? "OPEN" : "CLOSED"}
                    </span>
                  ))}
                </div>
                {expectedClosed.length > 0 && (
                  <div className="mt-1 text-[10px] text-warning">Closed: {expectedClosed.map((p) => p.port).join(", ")}</div>
                )}
              </div>
            )}
            <button type="button" onClick={() => setOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Raw evidence
            </button>
            {open && (
              <pre className="mt-1 max-h-64 overflow-auto rounded border border-border/40 bg-background/60 p-2 font-mono text-[10px] whitespace-pre-wrap">
{d.ping.raw || "(no raw ping output)"}
{d.ping.error ? `\n[ping error] ${d.ping.error}` : ""}
{d.dns.error ? `\n[dns error] ${d.dns.error}` : ""}
              </pre>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Keep ServerCrash imported reference live (used implicitly above for empty backend states elsewhere).
void ServerCrash;
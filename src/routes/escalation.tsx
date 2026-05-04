import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Download, CheckCircle2, ArrowLeft } from "lucide-react";
import { loadLastDiagnosis, type DiagnosisResponse } from "@/lib/siteConfig";

export const Route = createFileRoute("/escalation")({
  head: () => ({ meta: [{ title: "Escalation Report — Tacera Doctor" }] }),
  component: Page,
});

function buildReport(d: DiagnosisResponse): string {
  const lines: string[] = [];
  lines.push(`# Escalation Report`);
  lines.push(`Site: ${d.siteName}`);
  lines.push(`Run started: ${d.startedAt}`);
  lines.push(`Run finished: ${d.finishedAt}`);
  lines.push(`Summary: ${d.summary.pass} pass · ${d.summary.warn} warn · ${d.summary.fail} fail · ${d.summary.total} total`);
  lines.push(`Source: REAL TEST (network probes from server)`);
  lines.push("");
  lines.push(`## Device Results`);
  for (const r of d.results) {
    lines.push(`- [${r.status}] ${r.name || r.role} (${r.role})`);
    lines.push(`    IP: ${r.ip || "—"}    Hostname: ${r.hostname || "—"}`);
    lines.push(`    ${r.message}`);
    if (r.dns.performed) lines.push(`    DNS: ${r.dns.resolved ?? `failed (${r.dns.error ?? "no record"})`}`);
    if (r.ping.performed) lines.push(`    Latency: ${r.ping.latencyMs != null ? `${r.ping.latencyMs} ms` : "—"}`);
    const open = r.ports.filter((p) => p.open).map((p) => `${p.port}${p.service ? `/${p.service}` : ""}`).join(", ");
    if (r.ports.length) lines.push(`    Open ports: ${open || "(none)"}`);
    lines.push(`    Tested at: ${r.timestamp}`);
    lines.push("");
  }
  return lines.join("\n");
}

function Page() {
  const [data, setData] = useState<DiagnosisResponse | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setData(loadLastDiagnosis()); }, []);
  const summary = useMemo(() => data ? buildReport(data) : "", [data]);

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <h2 className="text-lg font-semibold">No diagnosis to escalate</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Run a diagnosis from Command Center first.
        </p>
        <Link to="/" className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-info px-3 py-1.5 text-xs font-medium text-info-foreground hover:bg-info/90">
          <ArrowLeft className="h-3.5 w-3.5" /> Go to Command Center
        </Link>
      </div>
    );
  }

  function copy() { navigator.clipboard.writeText(summary).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }
  function download() {
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "tacera-doctor-report.txt"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Escalation Package"
        title="Escalation Report"
        description="Field-evidence package — generated from REAL TEST results for the configured site."
        actions={<div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}>{copied ? <><CheckCircle2 className="mr-1.5 h-4 w-4 text-success"/>Copied</> : <><Copy className="mr-1.5 h-4 w-4"/>Copy</>}</Button>
          <Button size="sm" onClick={download} className="bg-info text-info-foreground hover:bg-info/90"><Download className="mr-1.5 h-4 w-4"/>Export</Button>
        </div>}
      />
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Site</div><div className="mt-0.5 font-medium">{data.siteName}</div></CardContent></Card>
        <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Devices Tested</div><div className="mt-0.5 font-mono">{data.summary.total}</div></CardContent></Card>
        <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Failures</div><div className="mt-0.5 font-mono text-critical">{data.summary.fail}</div></CardContent></Card>
        <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Run Time</div><div className="mt-0.5 font-mono">{new Date(data.finishedAt).toLocaleString()}</div></CardContent></Card>
      </div>
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Report (plain text)</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-[600px] overflow-auto rounded-md border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed">{summary}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { buildEscalationSummary } from "@/lib/reportBuilder";
import type { DiagnosticResult } from "@/lib/types";
import { Copy, Download, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/escalation")({ head: () => ({ meta: [{ title: "Escalation Report — Austco Site Doctor" }] }), component: Page });

function Page() {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { runFullAustcoDiagnosis(siteConfig, undefined, 0).then(setResult); }, []);
  const summary = useMemo(() => result ? buildEscalationSummary(result, siteConfig) : "Building report…", [result]);

  function copy() { navigator.clipboard.writeText(summary).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false), 2000); }); }
  function download() {
    const blob = new Blob([summary], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "austco-site-doctor-report.txt"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dev escalation package"
        title="Escalation Report"
        description="Field-evidence package ready for Austco support / dev. Includes site, technician, IPs, modules, root cause ranking, and event trace."
        actions={<div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}>{copied ? <><CheckCircle2 className="mr-1.5 h-4 w-4 text-success"/>Copied</> : <><Copy className="mr-1.5 h-4 w-4"/>Copy Escalation Summary</>}</Button>
          <Button size="sm" onClick={download} className="bg-info text-info-foreground hover:bg-info/90"><Download className="mr-1.5 h-4 w-4"/>Export Report</Button>
        </div>}
      />
      {result && (
        <div className="grid gap-3 md:grid-cols-4">
          <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Site</div><div className="mt-0.5 font-medium">{result.siteName}</div></CardContent></Card>
          <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Technician</div><div className="mt-0.5 font-medium">{siteConfig.technician}</div></CardContent></Card>
          <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">Laptop IP</div><div className="mt-0.5 font-mono">{siteConfig.laptopIp}</div></CardContent></Card>
          <Card className="bg-card/70"><CardContent className="p-3 text-xs"><div className="uppercase tracking-wider text-muted-foreground">VIP Owner</div><div className="mt-0.5 font-medium">Primary · 10.20.1.12</div></CardContent></Card>
        </div>
      )}
      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Escalation summary (plain text)</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-[600px] overflow-auto rounded-md border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed">{summary}</pre>
        </CardContent>
      </Card>
      <Card className="bg-muted/20"><CardContent className="p-3 text-xs text-muted-foreground">Includes evidence placeholders for screenshots, controller logs, switch port counters, and Pulse service logs. Real Austco integration goes here.</CardContent></Card>
    </div>
  );
}

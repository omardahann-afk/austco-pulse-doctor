import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DeviceTable } from "@/components/DeviceTable";
import { SystemMap } from "@/components/SystemMap";
import { RootCausePanel } from "@/components/RootCausePanel";
import { useDiagnostic, startFullDiagnosis } from "@/lib/diagnosticStore";
import { mockDevices, mockEvents, SITE_NAME } from "@/data/mockSite";
import { runFullAustcoDiagnosis } from "@/lib/diagnosticEngine";
import { siteConfig } from "@/data/mockSite";
import { ScanLine, ShieldCheck, Server, Activity, AlertOctagon, AlertTriangle, ListChecks, Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Command Center — Austco Site Doctor" }, { name: "description", content: "Live site health, root cause ranking, and device inventory for Pulse / Tacera / IP-Connect." }] }),
  component: CommandCenter,
});

function StatCard({ label, value, sub, tone, Icon }: { label: string; value: string; sub?: string; tone: "ok" | "warn" | "crit" | "info"; Icon: typeof ScanLine }) {
  const cls = { ok: "border-success/30 text-success", warn: "border-warning/30 text-warning", crit: "border-critical/40 text-critical", info: "border-info/30 text-info" }[tone];
  return (
    <Card className={`bg-card/70 ${cls} border`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
          <span>{label}</span><Icon className="h-3.5 w-3.5" />
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function CommandCenter() {
  const { isScanning, result } = useDiagnostic();
  const summary = result?.summary ?? { healthy: mockDevices.filter(d=>d.status==="Healthy").length, warnings: mockDevices.filter(d=>d.status==="Warning").length, critical: mockDevices.filter(d=>d.status==="Critical").length, offline: 0 };
  const ranking = useMemo(() => result?.rootCauseRanking ?? [], [result]);
  const fallbackRanking = useMemo(() => {
    if (ranking.length) return ranking;
    // Synchronous preview built without delay so dashboard isn't empty.
    const preview: typeof ranking = [];
    runFullAustcoDiagnosis(siteConfig, undefined, 0).then(r => preview.push(...r.rootCauseRanking));
    return preview;
  }, [ranking]);
  const score = Math.max(0, 100 - summary.critical * 18 - summary.warnings * 6);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Live · ${SITE_NAME}`}
        title="Command Center"
        description="Where exactly did the Austco signal chain fail? Run a full diagnosis to find out."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/trace"><Search className="mr-1.5 h-4 w-4" />Trace This Call</Link></Button>
            <Button onClick={startFullDiagnosis} disabled={isScanning} size="sm" className="bg-info text-info-foreground hover:bg-info/90">
              {isScanning ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Scanning…</> : <><ScanLine className="mr-1.5 h-4 w-4" />Run Full Austco Diagnosis</>}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Site Health" value={`${score}`} sub="0–100 weighted" tone={score > 80 ? "ok" : score > 60 ? "warn" : "crit"} Icon={Activity} />
        <StatCard label="Critical" value={`${summary.critical}`} sub="devices" tone="crit" Icon={AlertOctagon} />
        <StatCard label="Warnings" value={`${summary.warnings}`} sub="devices" tone="warn" Icon={AlertTriangle} />
        <StatCard label="Online" value={`${summary.healthy}`} sub="devices" tone="ok" Icon={ShieldCheck} />
        <StatCard label="Offline" value={`${summary.offline}`} sub="devices" tone="info" Icon={Server} />
        <StatCard label="Active Server" value="Primary" sub="10.20.1.10" tone="ok" Icon={Server} />
        <StatCard label="VIP Owner" value="Primary" sub="10.20.1.12" tone="ok" Icon={ShieldCheck} />
        <StatCard label="Event Queue" value="28" sub="pending · backlog elevated" tone="warn" Icon={ListChecks} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="bg-card/70">
            <CardHeader className="pb-3"><CardTitle className="text-base">Live Site Map</CardTitle></CardHeader>
            <CardContent><SystemMap devices={mockDevices} /></CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <RootCausePanel issues={fallbackRanking} limit={5} />
          <Card className="bg-card/70">
            <CardHeader className="pb-3"><CardTitle className="text-base">Recent Events</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {mockEvents.slice(0, 5).map(e => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/10 px-2 py-1.5">
                  <span className="truncate"><span className="font-mono">{e.eventType}</span> · {e.room}</span>
                  <span className={e.status==="Failed"?"text-critical":e.status==="Pending"?"text-warning":"text-success"}>{e.status}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="bg-card/70">
        <CardHeader className="pb-3"><CardTitle className="text-base">Device Inventory</CardTitle></CardHeader>
        <CardContent><DeviceTable devices={mockDevices} /></CardContent>
      </Card>
    </div>
  );
}
